/**
 * Стандартный профиль глюкометра Bluetooth SIG (Glucose Profile / GLS).
 *
 * В отличие от тонометра Omron здесь не проприетарный протокол, а открытая
 * спецификация, поэтому один драйвер покрывает много марок сразу. Плата за это —
 * жёсткая раскладка полей: любая вольность в разборе даст неверный сахар.
 *
 * ВАЖНО: код написан по спецификации, без доступа к физическому прибору.
 * Он покрыт тестами на пакетах, собранных по той же спецификации
 * (tests/glucose-profile.test.mjs), но это проверка «сам себя» — на живом
 * глюкометре первую выгрузку надо просмотреть глазами и сверить с экраном прибора.
 *
 * Порядок работы:
 *   1. подписаться на 0x2A18 (измерения) и 0x2A34 (контекст);
 *   2. подписаться на 0x2A52 (RACP) — по нему приходит завершение операции;
 *   3. записать в RACP «отдать все записи» [0x01, 0x01];
 *   4. собрать посыпавшиеся уведомления, дождаться ответа RACP.
 */

import type { GattCharacteristic, GattService } from '../platform/ports'
import type { GlucoseContext } from '../types'
import type { Logger } from './protocol'
import { OmronProtocolError, hex } from './protocol'

export const GLUCOSE_SERVICE = '00001808-0000-1000-8000-00805f9b34fb'
export const GLUCOSE_MEASUREMENT = '00002a18-0000-1000-8000-00805f9b34fb'
export const GLUCOSE_CONTEXT = '00002a34-0000-1000-8000-00805f9b34fb'
export const RECORD_ACCESS_CONTROL_POINT = '00002a52-0000-1000-8000-00805f9b34fb'

/** Приборы этого профиля рекламируются под самыми разными именами. */
export const GLUCOSE_NAME_PREFIXES = ['Contour', 'CONTOUR', 'Accu-Chek', 'ACCU-CHEK', 'OneTouch', 'Beurer', 'GL']

// ── IEEE-11073 SFLOAT ──────────────────────────────────────────────────────

/**
 * 16-битное медицинское число с плавающей точкой: 4 бита знакового порядка и
 * 12 бит знаковой мантиссы. Обычный float здесь не подходит, а особые значения
 * (NaN, бесконечности) обязаны отсекаться — иначе они превратятся в «сахар».
 */
export function parseSFloat(raw: number): number | null {
  // Зарезервированные комбинации по спецификации: значения нет.
  if (raw === 0x07ff || raw === 0x0800 || raw === 0x07fe || raw === 0x0802 || raw === 0x0801) return null

  let exponent = (raw >> 12) & 0x0f
  let mantissa = raw & 0x0fff
  if (exponent >= 0x08) exponent -= 0x10 // знаковое 4-битное
  if (mantissa >= 0x0800) mantissa -= 0x1000 // знаковое 12-битное
  return mantissa * 10 ** exponent
}

// ── измерение (0x2A18) ─────────────────────────────────────────────────────

export interface GlucoseRecord {
  /** Номер записи в памяти прибора: по нему измерение связывается с контекстом. */
  sequence: number
  /** Момент измерения по часам прибора, локальное время. */
  date: Date
  /** Концентрация, ммоль/л. null — прибор прислал запись без значения. */
  mmol: number | null
  /** Момент относительно еды, если прибор его сообщил. */
  context?: GlucoseContext
  raw: string
}

/**
 * Молярная масса глюкозы 180,156 г/моль, отсюда делитель 18,0156 при переводе
 * мг/дл в ммоль/л. Цифры после запятой здесь не педантизм: на 100 мг/дл выбор
 * между 18,0156 и 18,02 меняет результат с 5,6 на 5,5 — ровно на границе
 * округления до десятых, которые и видит человек.
 */
const GLUCOSE_MOLAR_FACTOR = 18.0156

/** Единицы концентрации по флагу: 0 — кг/л, 1 — моль/л. */
function toMmol(value: number, molarUnits: boolean): number {
  // моль/л → ммоль/л; кг/л → мг/дл (×100000) → ммоль/л.
  return molarUnits ? value * 1000 : (value * 100000) / GLUCOSE_MOLAR_FACTOR
}

export function parseGlucoseMeasurement(bytes: Uint8Array): GlucoseRecord | null {
  if (bytes.length < 10) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  const flags = view.getUint8(0)
  const hasTimeOffset = (flags & 0x01) !== 0
  const hasConcentration = (flags & 0x02) !== 0
  const molarUnits = (flags & 0x04) !== 0

  const sequence = view.getUint16(1, true)
  const year = view.getUint16(3, true)
  const month = view.getUint8(5)
  const day = view.getUint8(6)
  const hours = view.getUint8(7)
  const minutes = view.getUint8(8)
  const seconds = view.getUint8(9)

  // Нулевой год или месяц по спецификации значат «дата неизвестна».
  if (year === 0 || month === 0 || day === 0) return null
  const date = new Date(year, month - 1, day, hours, minutes, seconds)
  if (Number.isNaN(date.getTime())) return null

  let offset = 10
  if (hasTimeOffset) {
    if (bytes.length < offset + 2) return null
    date.setMinutes(date.getMinutes() + view.getInt16(offset, true))
    offset += 2
  }

  let mmol: number | null = null
  if (hasConcentration) {
    if (bytes.length < offset + 3) return null
    const value = parseSFloat(view.getUint16(offset, true))
    mmol = value === null ? null : Math.round(toMmol(value, molarUnits) * 10) / 10
    offset += 3 // SFLOAT + байт «тип и место забора»
  }

  return { sequence, date, mmol, raw: hex(bytes) }
}

// ── контекст измерения (0x2A34) ────────────────────────────────────────────

/**
 * Поле Meal из спецификации. Наши обозначения совпадают почти один в один —
 * кроме Casual: прибор говорит «произвольный замер», а у нас такого нет, и
 * ближайшее по смыслу — «до еды», потому что норма там строже.
 */
const MEAL_TO_CONTEXT: Record<number, GlucoseContext> = {
  1: 'before-meal',
  2: 'after-meal',
  3: 'fasting',
  4: 'before-meal',
  5: 'bedtime',
}

export function parseGlucoseContext(bytes: Uint8Array): { sequence: number; context?: GlucoseContext } | null {
  if (bytes.length < 3) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  const flags = view.getUint8(0)
  const sequence = view.getUint16(1, true)

  let offset = 3
  if (flags & 0x80) offset += 1 // расширенные флаги
  if (flags & 0x01) offset += 3 // идентификатор углеводов + количество
  if ((flags & 0x02) === 0) return { sequence } // поля Meal нет

  if (bytes.length < offset + 1) return { sequence }
  return { sequence, context: MEAL_TO_CONTEXT[view.getUint8(offset)] }
}

// ── точка управления записями (0x2A52) ─────────────────────────────────────

const OP_REPORT_STORED = 0x01
const OP_RESPONSE_CODE = 0x06
const OPERATOR_ALL = 0x01

const RACP_ERRORS: Record<number, string> = {
  2: 'прибор не поддерживает выгрузку всех записей',
  3: 'прибор отклонил условие выборки',
  4: 'прибор не поддерживает такое условие выборки',
  5: 'прибор отклонил параметры запроса',
  6: 'в памяти прибора нет записей',
}

/** Разбирает ответ на команду. Возвращает текст ошибки либо null при успехе. */
export function parseRacpResponse(bytes: Uint8Array): { done: boolean; error: string | null } {
  if (bytes.length < 4 || bytes[0] !== OP_RESPONSE_CODE) return { done: false, error: null }
  const requested = bytes[2]
  const code = bytes[3]
  if (requested !== OP_REPORT_STORED) return { done: false, error: null }
  if (code === 1) return { done: true, error: null }
  return { done: true, error: RACP_ERRORS[code] ?? `прибор вернул код ошибки ${code}` }
}

// ── сеанс выгрузки ─────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Выгружает все записи из памяти глюкометра. Ничего не пишет, кроме команды
 * «отдать все записи» — сама память не меняется.
 */
export async function readAllGlucoseRecords(
  service: GattService,
  log: Logger,
  onProgress?: (count: number) => void,
): Promise<GlucoseRecord[]> {
  const measurement = await service.getCharacteristic(GLUCOSE_MEASUREMENT)
  const racp = await service.getCharacteristic(RECORD_ACCESS_CONTROL_POINT)

  // Контекст поддерживают не все приборы — без него выгрузка всё равно идёт.
  let contextChar: GattCharacteristic | null = null
  try {
    contextChar = await service.getCharacteristic(GLUCOSE_CONTEXT)
  } catch {
    log('debug', 'прибор не предоставляет контекст измерений')
  }

  const records = new Map<number, GlucoseRecord>()
  const contexts = new Map<number, GlucoseContext>()
  let finished = false
  let failure: string | null = null

  await measurement.startNotifications((bytes) => {
    log('debug', `измерение < ${hex(bytes)}`)
    const record = parseGlucoseMeasurement(bytes)
    if (record) {
      records.set(record.sequence, record)
      onProgress?.(records.size)
    }
  })

  if (contextChar) {
    await contextChar.startNotifications((bytes) => {
      log('debug', `контекст < ${hex(bytes)}`)
      const parsed = parseGlucoseContext(bytes)
      if (parsed?.context) contexts.set(parsed.sequence, parsed.context)
    })
  }

  await racp.startNotifications((bytes) => {
    log('debug', `racp < ${hex(bytes)}`)
    const { done, error } = parseRacpResponse(bytes)
    if (done) {
      finished = true
      failure = error
    }
  })

  log('info', 'запрашиваю все записи из памяти глюкометра')
  await racp.writeValue(Uint8Array.from([OP_REPORT_STORED, OPERATOR_ALL]))

  // Ждём завершения. Приборы с большой памятью сыплют уведомления не мгновенно,
  // поэтому таймаут считается от последнего полученного измерения, а не от старта.
  const limitMs = 60_000
  const quietMs = 6_000
  const startedAt = Date.now()
  let lastSeen = records.size
  let lastChange = Date.now()

  while (!finished) {
    await sleep(150)
    if (records.size !== lastSeen) {
      lastSeen = records.size
      lastChange = Date.now()
    }
    if (Date.now() - startedAt > limitMs) throw new OmronProtocolError('Глюкометр не завершил выгрузку за минуту')
    if (Date.now() - lastChange > quietMs && records.size > 0) {
      log('warn', 'прибор не прислал завершение операции — считаю выгрузку оконченной')
      break
    }
    if (Date.now() - lastChange > quietMs && records.size === 0) {
      throw new OmronProtocolError('Глюкометр не прислал ни одной записи. Проверьте, что он в режиме передачи данных.')
    }
  }

  await measurement.stopNotifications()
  await contextChar?.stopNotifications()
  await racp.stopNotifications()

  if (failure) throw new OmronProtocolError(`Глюкометр отказал: ${failure}`)

  const merged = [...records.values()].map((record) => ({ ...record, context: contexts.get(record.sequence) }))
  merged.sort((a, b) => a.date.getTime() - b.date.getTime())
  log('info', `прочитано замеров: ${merged.length}`)
  return merged
}
