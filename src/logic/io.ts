import type { GlucoseContext, Measurement, Medicine, Person, Regimen, Settings, Tombstone } from '../types'
import type { LegacyMedicine } from './split'
import { splitBoxes } from './split'
import { deviceMeasurementId } from '../db/store'
import { normalizeRhythm } from './rhythm'
import { platform } from '../platform/ports'

// ── экспорт ────────────────────────────────────────────────────────────────

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * Один файл на оба дневника: колонка `kind` разделяет давление и сахар.
 * Так резервная копия остаётся одна, и её нельзя потерять по половинке.
 */
export function toCsv(items: Measurement[]): string {
  const header = ['datetime', 'kind', 'sys', 'dia', 'bpm', 'ihb', 'mov', 'mmol', 'context', 'user', 'source', 'note']
  const rows = items.map((m) =>
    [
      formatDateTime(m.ts),
      m.kind,
      m.kind === 'bp' ? m.sys : '',
      m.kind === 'bp' ? m.dia : '',
      m.kind === 'bp' ? (m.bpm ?? '') : '',
      m.kind === 'bp' ? (m.ihb ? 1 : 0) : '',
      m.kind === 'bp' ? (m.mov ? 1 : 0) : '',
      m.kind === 'glucose' ? m.mmol : '',
      m.kind === 'glucose' ? m.context : '',
      m.user,
      m.source,
      m.note ?? '',
    ]
      .map(csvCell)
      .join(','),
  )
  // BOM — чтобы Excel не ломал кириллицу в примечаниях.
  return '﻿' + [header.join(','), ...rows].join('\n')
}

/**
 * Полный снимок для резервной копии и переноса на другое устройство.
 *
 * Одних измерений мало: аптечка и настройки — тоже данные, введённые руками, и
 * теряются они так же безвозвратно. Копия, в которой их нет, обещает больше,
 * чем спасает.
 */
export interface Snapshot {
  measurements: Measurement[]
  medicines: Medicine[]
  /**
   * Курсы приёма — отдельным списком с версии формата v4.
   *
   * Копия без них восстанавливала бы аптечку, в которой никто ничего не
   * принимает: расписание, отметки и свёрнутая история живут здесь.
   */
  regimens: Regimen[]
  /**
   * Следы удалённых записей.
   *
   * Без них копия возвращает удалённое: человек убрал ошибочное измерение на
   * телефоне, восстановился из копии — и оно снова здесь. Весят надгробия
   * десятки байт, а без них копия спорит с решениями человека.
   */
  tombstones: Tombstone[]
  /**
   * Настройки без служебных полей.
   *
   * Что и когда копировалось — у каждого устройства своё. Ключ сопряжения с
   * прибором — тоже: это связь этого телефона с этим тонометром, в чужой
   * дневник ей делать нечего.
   */
  settings: Omit<Settings, 'backupLastAt' | 'backupLastCount' | 'pairingKey'> | null
}

export function toJson(snapshot: Snapshot | Measurement[]): string {
  // Массив на входе — старый вызов «только измерения». Оставлен, чтобы выгрузка
  // измерений из раздела «Данные» осталась выгрузкой измерений.
  const full: Snapshot = Array.isArray(snapshot)
    ? { measurements: snapshot, medicines: [], regimens: [], tombstones: [], settings: null }
    : snapshot
  return JSON.stringify(
    {
      format: 'omron-bp/v4',
      exportedAt: new Date().toISOString(),
      measurements: full.measurements,
      medicines: full.medicines,
      regimens: full.regimens,
      tombstones: full.tombstones,
      settings: full.settings ?? undefined,
    },
    null,
    2,
  )
}

/**
 * Отдать файл человеку. Как именно — решает платформа: в браузере скачиванием,
 * на телефоне системным окном. `false` — он отказался, и файла нет.
 */
export function download(filename: string, content: string, mime: string): Promise<boolean> {
  return platform().files.save(filename, content, mime)
}

/** Умеет ли платформа передать файл в другое приложение. */
export function canShareFile(): boolean {
  return platform().files.canShare()
}

/** Поделиться текстом: список покупок уходит сообщением, а не вложением. */
export function shareTextOut(text: string, title: string): Promise<boolean> {
  return platform().files.shareText(text, title)
}

/** Скопировать текст. `false` — не вышло, и молчать об этом нельзя. */
export function copyTextOut(text: string): Promise<boolean> {
  return platform().files.copyText(text)
}

/** Отдать файл системному «поделиться». `false` — пользователь закрыл окно. */
export function shareFile(filename: string, content: string, mime: string): Promise<boolean> {
  return platform().files.share(filename, content, mime)
}

// ── импорт ─────────────────────────────────────────────────────────────────

const HEADER_ALIASES: Record<string, string[]> = {
  datetime: ['datetime', 'date_time', 'timestamp', 'дата и время', 'датавремя'],
  date: ['date', 'дата', 'measurement date'],
  time: ['time', 'время', 'measurement time'],
  kind: ['kind', 'type', 'вид', 'тип'],
  sys: ['sys', 'systolic', 'systolic (mmhg)', 'сад', 'систолическое', 'верхнее', 'верхнее давление'],
  dia: ['dia', 'diastolic', 'diastolic (mmhg)', 'дад', 'диастолическое', 'нижнее', 'нижнее давление'],
  bpm: ['bpm', 'pulse', 'pulse (bpm)', 'heart rate', 'heartrate', 'пульс', 'чсс'],
  ihb: ['ihb', 'irregular', 'irregular heartbeat', 'нерегулярное сердцебиение', 'аритмия'],
  mov: ['mov', 'movement', 'body movement', 'движение'],
  mmol: ['mmol', 'glucose', 'blood sugar', 'сахар', 'глюкоза', 'глюкоза (ммоль/л)', 'ммоль/л', 'сахар крови'],
  context: ['context', 'meal', 'момент', 'контекст', 'до/после еды', 'отметка'],
  user: ['user', 'пользователь'],
  note: ['note', 'notes', 'comment', 'memo', 'msg', 'примечание', 'заметка', 'комментарий'],
}

/** Как называется момент замера в чужих файлах и в нашем собственном экспорте. */
const CONTEXT_ALIASES: Record<string, GlucoseContext> = {
  fasting: 'fasting',
  натощак: 'fasting',
  'before-meal': 'before-meal',
  before: 'before-meal',
  'before meal': 'before-meal',
  'до еды': 'before-meal',
  'after-meal': 'after-meal',
  after: 'after-meal',
  'after meal': 'after-meal',
  'после еды': 'after-meal',
  'через 2 часа после еды': 'after-meal',
  bedtime: 'bedtime',
  'перед сном': 'bedtime',
  night: 'night',
  ночью: 'night',
}

function detectDelimiter(line: string): string {
  const counts = [',', ';', '\t'].map((d) => [d, line.split(d).length] as const)
  return counts.sort((a, b) => b[1] - a[1])[0][0]
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else quoted = false
      } else current += char
    } else if (char === '"') quoted = true
    else if (char === delimiter) {
      cells.push(current)
      current = ''
    } else current += char
  }
  cells.push(current)
  return cells.map((c) => c.trim())
}

function mapHeaders(headers: string[]): Record<string, number> {
  const normalized = headers.map((h) => h.replace(/^﻿/, '').trim().toLowerCase())
  const map: Record<string, number> = {}
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = normalized.findIndex((h) => aliases.includes(h))
    if (index >= 0) map[field] = index
  }
  return map
}

/** Разбирает дату из распространённых форматов: ISO, `ДД.ММ.ГГГГ`, `ДД/ММ/ГГГГ`, `ГГГГ-ММ-ДД`. */
export function parseDateTime(datePart: string, timePart = ''): number | null {
  const text = `${datePart} ${timePart}`.trim()
  if (!text) return null

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ]?(\d{1,2})?:?(\d{2})?:?(\d{2})?/)
  if (iso) {
    return new Date(+iso[1], +iso[2] - 1, +iso[3], +(iso[4] ?? 0), +(iso[5] ?? 0), +(iso[6] ?? 0)).getTime()
  }

  const dmy = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\D*(\d{1,2})?:?(\d{2})?:?(\d{2})?/)
  if (dmy) {
    const year = +dmy[3] < 100 ? 2000 + +dmy[3] : +dmy[3]
    return new Date(year, +dmy[2] - 1, +dmy[1], +(dmy[4] ?? 0), +(dmy[5] ?? 0), +(dmy[6] ?? 0)).getTime()
  }

  const fallback = Date.parse(text)
  return Number.isNaN(fallback) ? null : fallback
}

const truthy = (value: string | undefined) =>
  !!value && ['1', 'true', 'yes', 'да', 'y'].includes(value.trim().toLowerCase())

/** Запятая как десятичный разделитель — норма в русских выгрузках. */
const num = (value: string | undefined): number => Number(String(value ?? '').replace(',', '.'))

function parseContext(value: string | undefined): GlucoseContext {
  const key = String(value ?? '').trim().toLowerCase()
  return CONTEXT_ALIASES[key] ?? 'before-meal'
}

export interface ImportResult {
  measurements: Measurement[]
  skipped: number
  /** Аптечка из копии. Пусто для CSV и для старых файлов. */
  medicines: Medicine[]
  /**
   * Курсы приёма из копии.
   *
   * У файлов до v4 своего списка нет — тогда они получаются разбором коробок
   * старого образца, тем же, что и при обновлении базы.
   */
  regimens: Regimen[]
  /** Следы удалений из копии. Пусто для CSV и для файлов до версии 0.4.2. */
  tombstones: Tombstone[]
  /** Настройки из копии, если файл их содержит. */
  settings: Snapshot['settings']
}

export function parseCsv(text: string): ImportResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return { measurements: [], skipped: 0, medicines: [], regimens: [], tombstones: [], settings: null }

  const delimiter = detectDelimiter(lines[0])
  const headers = splitCsvLine(lines[0], delimiter)
  const columns = mapHeaders(headers)

  const hasBp = columns.sys !== undefined && columns.dia !== undefined
  const hasGlucose = columns.mmol !== undefined
  if (!hasBp && !hasGlucose) {
    throw new Error('В файле не нашлось ни давления, ни сахара — проверьте заголовки столбцов')
  }

  const measurements: Measurement[] = []
  let skipped = 0

  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line, delimiter)
    const ts =
      columns.datetime !== undefined
        ? parseDateTime(cells[columns.datetime])
        : parseDateTime(cells[columns.date ?? -1] ?? '', cells[columns.time ?? -1] ?? '')
    if (!ts) {
      skipped++
      continue
    }

    const user = columns.user !== undefined ? Number(cells[columns.user]) || 1 : 1
    const source = 'import' as const
    const note = cells[columns.note ?? -1] || undefined

    // Вид берём из колонки, если она есть; иначе — по тому, какие числа заполнены.
    const declared = String(cells[columns.kind ?? -1] ?? '').trim().toLowerCase()
    const sys = hasBp ? num(cells[columns.sys]) : NaN
    const dia = hasBp ? num(cells[columns.dia]) : NaN
    const mmol = hasGlucose ? num(cells[columns.mmol]) : NaN

    const isGlucoseRow = declared === 'glucose' || (!declared && !Number.isFinite(sys) && Number.isFinite(mmol))

    if (isGlucoseRow) {
      if (!Number.isFinite(mmol) || mmol <= 0 || mmol > 50) {
        skipped++
        continue
      }
      measurements.push({
        kind: 'glucose',
        id: deviceMeasurementId('glucose', user, ts),
        ts,
        mmol,
        context: parseContext(cells[columns.context ?? -1]),
        user,
        source,
        note,
      })
      continue
    }

    if (!Number.isFinite(sys) || !Number.isFinite(dia) || sys <= 0 || dia <= 0) {
      skipped++
      continue
    }
    const bpmRaw = columns.bpm !== undefined ? num(cells[columns.bpm]) : NaN
    measurements.push({
      kind: 'bp',
      id: deviceMeasurementId('bp', user, ts),
      ts,
      sys,
      dia,
      bpm: Number.isFinite(bpmRaw) && bpmRaw > 0 ? bpmRaw : null,
      ihb: truthy(cells[columns.ihb ?? -1]),
      mov: truthy(cells[columns.mov ?? -1]),
      user,
      source,
      note,
    })
  }

  return { measurements, skipped, medicines: [], regimens: [], tombstones: [], settings: null }
}

/**
 * Аптечка из файла. Проверяем поштучно: чужой или испорченный файл не должен
 * протащить в базу запись без названия — она была бы не редактируемой пустотой.
 */
function parseMedicines(raw: unknown): LegacyMedicine[] {
  if (!Array.isArray(raw)) return []
  const optionalNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  const text = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() !== '' ? value : undefined
  const times = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value)) return undefined
    const list = value.filter((t): t is string => typeof t === 'string' && /^\d{1,2}:\d{2}$/.test(t))
    return list.length > 0 ? list : undefined
  }
  const marks = (value: unknown): number[] | undefined => {
    if (!Array.isArray(value)) return undefined
    const list = value.filter((t): t is number => typeof t === 'number' && Number.isFinite(t))
    return list.length > 0 ? list : undefined
  }

  return raw
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .filter((m) => typeof m.id === 'string' && typeof m.name === 'string' && m.name.trim() !== '')
    .map((m) => ({
      id: m.id as string,
      name: (m.name as string).trim(),
      dose: typeof m.dose === 'string' ? m.dose : '',
      inn: text(m.inn),
      form: text(m.form),
      maker: text(m.maker),
      // Вид препарата — только 1 или 2, иначе пусто: неизвестное число
      // означало бы пометку, которой интерфейс не знает, как назвать.
      kind: m.kind === 1 || m.kind === 2 ? m.kind : undefined,
      packSize: optionalNumber(m.packSize) ?? undefined,
      dropsPerMl: optionalNumber(m.dropsPerMl) ?? undefined,
      left: optionalNumber(m.left),
      perDay: optionalNumber(m.perDay),
      expires: optionalNumber(m.expires),
      note: text(m.note),
      // Расписание, отметки и автосписание переносятся наравне с остальным:
      // без них восстановленная аптечка молчит и остаток перестаёт считаться.
      leftAt: optionalNumber(m.leftAt) ?? undefined,
      times: times(m.times),
      perTime: optionalNumber(m.perTime) ?? undefined,
      meal: m.meal === 'before' || m.meal === 'after' || m.meal === 'any' ? m.meal : undefined,
      autoDeduct: m.autoDeduct === true ? true : undefined,
      rx: m.rx === true ? true : undefined,
      taken: marks(m.taken),
      // Всё, что появилось у препарата после первой версии формата. Без этих
      // полей восстановление молча отдавало все коробки первому человеку,
      // теряло «принимаю с», возвращало пропуски за прошлое (без `since`
      // расписание распространяется назад) и стирало свёрнутую историю.
      // Проверка по каждому полю типа — в tests/io.test.mjs: следующее поле
      // не должно потеряться так же молча.
      regNumber: text(m.regNumber),
      owner: text(m.owner),
      since: optionalNumber(m.since) ?? undefined,
      startedAt: optionalNumber(m.startedAt) ?? undefined,
      foldedUntil: optionalNumber(m.foldedUntil) ?? undefined,
      history: history(m.history),
      plan: plan(m.plan),
      planFrom: optionalNumber(m.planFrom) ?? undefined,
      rhythm: rhythm(m.rhythm),
      // Отметка времени правки переносится как есть: штамповать её «сейчас»
      // при восстановлении нельзя — старая копия выглядела бы свежее местной
      // правки и побеждала бы её при семейном слиянии.
      updatedAt: optionalNumber(m.updatedAt) ?? undefined,
    }))
}

/**
 * Ритм приёма из файла.
 *
 * Проверять здесь ничего не нужно: `normalizeRhythm` затем и написан, чтобы
 * отсеивать бессмыслицу, откуда бы она ни пришла — из чужой копии, из старой
 * версии или из испорченного файла. Испорченный ритм превращается в «каждый
 * день»: это безопаснее, чем расписание, которое молча не срабатывает.
 */
function rhythm(raw: unknown): Regimen['rhythm'] {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  return normalizeRhythm({
    weekdays: Array.isArray(r.weekdays) ? r.weekdays.filter((d): d is number => typeof d === 'number') : undefined,
    onDays: typeof r.onDays === 'number' ? r.onDays : undefined,
    offDays: typeof r.offDays === 'number' ? r.offDays : undefined,
    from: typeof r.from === 'number' ? r.from : undefined,
  })
}

/**
 * Схема приёма из файла: только этапы с конечной дозой. Испорченный этап
 * отбрасывается целиком — принимать «NaN таблеток» человеку не предложишь.
 */
function plan(raw: unknown): Regimen['plan'] {
  if (!Array.isArray(raw)) return undefined
  const этапы = raw
    .filter((x): x is { perTime: unknown; days: unknown } => !!x && typeof x === 'object')
    .map((x) => ({
      perTime: typeof x.perTime === 'number' && Number.isFinite(x.perTime) && x.perTime >= 0 ? x.perTime : null,
      days: x.days === null ? null : typeof x.days === 'number' && Number.isFinite(x.days) && x.days > 0 ? x.days : undefined,
    }))
    .filter((x): x is { perTime: number; days: number | null } => x.perTime !== null && x.days !== undefined)
  return этапы.length > 0 ? этапы : undefined
}

/**
 * Свёрнутая история приёма из файла: только ячейки вида `'2026-07' → { planned, taken }`
 * с конечными числами. Испорченная ячейка отбрасывается, а не тянет NaN в отчёт.
 */
function history(raw: unknown): Regimen['history'] {
  if (!raw || typeof raw !== 'object') return undefined
  const out: NonNullable<Regimen['history']> = {}
  for (const [key, cell] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}$/.test(key) || !cell || typeof cell !== 'object') continue
    const { planned, taken } = cell as { planned?: unknown; taken?: unknown }
    if (typeof planned !== 'number' || typeof taken !== 'number' || !Number.isFinite(planned) || !Number.isFinite(taken)) continue
    out[key] = { planned, taken }
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * Настройки из файла. Служебные поля про резервные копии отбрасываем: они
 * описывают устройство, где копия делалась, а не данные внутри неё.
 */
function parseSettings(raw: unknown): Snapshot['settings'] {
  if (!raw || typeof raw !== 'object') return null
  const { backupLastAt: _at, backupLastCount: _count, ...rest } = raw as Settings
  return rest
}

/**
 * Надгробия из файла.
 *
 * Разбор строгий: чужое или испорченное надгробие удаляет запись, а это потеря
 * данных. Пропускаем всё, в чём не уверены, — лишняя запись переживается легче
 * пропавшей.
 */
function parseTombstones(raw: unknown): Tombstone[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (t): t is Tombstone =>
      !!t &&
      typeof t === 'object' &&
      typeof (t as Tombstone).id === 'string' &&
      ((t as Tombstone).kind === 'measurement' ||
        (t as Tombstone).kind === 'medicine' ||
        (t as Tombstone).kind === 'regimen') &&
      Number.isFinite((t as Tombstone).at),
  )
}

/**
 * Курсы приёма из файла. Только у v4 и новее.
 *
 * Разбор строгий по трём полям: без коробки и человека курс не к чему
 * привязать, а без идентификатора он не сольётся и не удалится.
 */
function parseRegimens(raw: unknown): Regimen[] {
  if (!Array.isArray(raw)) return []
  const число = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined
  const часы = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value)) return undefined
    const list = value.filter((t): t is string => typeof t === 'string' && /^\d{1,2}:\d{2}$/.test(t))
    return list.length > 0 ? list : undefined
  }
  const отметки = (value: unknown): number[] | undefined => {
    if (!Array.isArray(value)) return undefined
    const list = value.filter((t): t is number => typeof t === 'number' && Number.isFinite(t))
    return list.length > 0 ? list : undefined
  }
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .filter((r) => typeof r.id === 'string' && typeof r.medicineId === 'string' && typeof r.person === 'string')
    .map((r) => ({
      id: r.id as string,
      medicineId: r.medicineId as string,
      person: r.person as string,
      times: часы(r.times),
      perTime: число(r.perTime),
      meal: r.meal === 'before' || r.meal === 'after' || r.meal === 'any' ? r.meal : undefined,
      rhythm: rhythm(r.rhythm),
      plan: plan(r.plan),
      planFrom: число(r.planFrom),
      endsAt: число(r.endsAt),
      perDay: число(r.perDay) ?? null,
      autoDeduct: r.autoDeduct === true ? true : undefined,
      since: число(r.since),
      startedAt: число(r.startedAt),
      taken: отметки(r.taken),
      history: history(r.history),
      foldedUntil: число(r.foldedUntil),
      updatedAt: число(r.updatedAt),
    }))
}

/**
 * Аптечка и курсы из файла.
 *
 * У копий до v4 своего списка курсов нет, а поля приёма лежат внутри коробок.
 * Разбираем тем же `splitBoxes`, что и при обновлении базы: два разных разбора
 * рано или поздно разошлись бы, и старая копия восстанавливалась бы иначе, чем
 * та же аптечка на телефоне.
 *
 * Человек для разбора берётся из настроек самой копии — они лежат в том же
 * файле. Без них курс заведётся с пустым человеком, и его проставит первый
 * запуск.
 */
function аптечка(data: { medicines?: unknown; regimens?: unknown; settings?: unknown }): {
  medicines: Medicine[]
  regimens: Regimen[]
} {
  const коробки = parseMedicines(data?.medicines)
  const свои = parseRegimens(data?.regimens)
  if (свои.length > 0) return { medicines: коробки as Medicine[], regimens: свои }
  const н = data?.settings as Partial<Settings> | undefined
  const кому = н?.activePerson ?? н?.people?.[0]?.id ?? null
  const { boxes, regimens } = splitBoxes(коробки, кому)
  return { medicines: boxes, regimens }
}

/** Наш бэкап (v1–v4) и формат ubpm.json из omblepy. */
export function parseJson(text: string): ImportResult {
  const data = JSON.parse(text)

  // v3 — плюс аптечка и настройки; v2 — оба дневника; v1 — только давление,
  // вид в записях не хранился.
  const own = data?.measurements ?? data?.readings
  if (Array.isArray(own)) {
    const measurements = (own as Partial<Measurement>[])
      // Без идентификатора запись не сольётся ни с чем и не удалится ни по
      // какому надгробию — такой её лучше не пускать, чем копить дубли.
      .filter((m) => m && typeof m.ts === 'number' && typeof m.id === 'string' && m.id !== '')
      .map((m) => (m.kind ? m : { ...m, kind: 'bp' as const }))
      .filter((m) => (m.kind === 'glucose' ? Number.isFinite((m as never)['mmol']) : Number.isFinite((m as never)['sys'])))
    return {
      measurements: measurements as Measurement[],
      skipped: own.length - measurements.length,
      ...аптечка(data),
      tombstones: parseTombstones(data?.tombstones),
      settings: parseSettings(data?.settings),
    }
  }

  if (data?.UBPM && typeof data.UBPM === 'object') {
    const measurements: Measurement[] = []
    let skipped = 0
    for (const [userKey, entries] of Object.entries(data.UBPM as Record<string, unknown[]>)) {
      const user = Number(userKey.replace(/\D/g, '')) || 1
      for (const entry of entries as Record<string, unknown>[]) {
        const ts = parseDateTime(String(entry.date ?? ''), String(entry.time ?? ''))
        const sys = Number(entry.sys)
        const dia = Number(entry.dia)
        if (!ts || !sys || !dia) {
          skipped++
          continue
        }
        measurements.push({
          kind: 'bp',
          id: deviceMeasurementId('bp', user, ts),
          ts,
          sys,
          dia,
          bpm: Number(entry.bpm) || null,
          ihb: Number(entry.ihb) === 1,
          mov: Number(entry.mov) === 1,
          user,
          source: 'import',
          note: String(entry.msg ?? '') || undefined,
        })
      }
    }
    return { measurements, skipped, medicines: [], regimens: [], tombstones: [], settings: null }
  }

  throw new Error('Неизвестный формат JSON. Ожидается резервная копия этого приложения или ubpm.json от omblepy.')
}

export function parseImportFile(filename: string, text: string): ImportResult {
  return filename.toLowerCase().endsWith('.json') ? parseJson(text) : parseCsv(text)
}


/**
 * Какие настройки брать из копии, а какие оставить свои.
 *
 * Копия не знает, куда её восстанавливают. Раньше файл переписывал всё, кроме
 * темы: чужой файл на телефоне жены заменял её людей на людей отца, её цели —
 * на его, а с ними и ключ сопряжения с прибором. Настройки трёх родов:
 *
 * - **устройства** — тема, размер, вкладки, копии, ключ прибора, напоминания:
 *   всегда свои, из файла не берутся;
 * - **семьи** — люди и кто выбран: берутся из файла, только если здесь семьи
 *   ещё нет (один человек с именем по умолчанию). Иначе восстановление чужого
 *   файла подменило бы людей, а препараты из него всё равно лягут первому;
 * - **человека и дневника** — цели, пороги, часы приёма, дневник сахара:
 *   берутся из файла, как и раньше.
 */
export function mergeRestoredSettings(local: Settings, incoming: NonNullable<Snapshot['settings']>): Settings {
  const своиЛюди = local.people
  const изФайла = incoming.people ?? []
  // Файл свой, если все здешние люди в нём есть (по идентификаторам). Тогда из
  // него можно брать и людей, и всё личное: это та же семья, просто с другого
  // дня. Одиночный дневник с именем по умолчанию — тоже «свой»: ему семью
  // только предстоит завести.
  const братьЛичное = takesPersonalFrom(local, incoming)

  /*
   * Объединённые люди не возвращаются из копии.
   *
   * Копия, снятая до объединения, считается «своей» — после слияния все
   * здешние люди в ней есть по идентификаторам, — и вернула бы обоих дублей
   * вместе с выбранным. Прогоняем список файла через карту: кто был объединён,
   * оттуда выбрасывается, а его записи и так перецепит `mergeDiary`.
   */
  const карта = local.mergedPeople ?? {}
  const изФайлаЖивые = изФайла.filter((p) => !(p.id in карта))
  const выбранныйИзФайла = карта[incoming.activePerson] ?? incoming.activePerson

  const семья = братьЛичное && изФайлаЖивые.length > 0
    ? {
        people: изФайлаЖивые,
        // Выбранного берём только из списка: битая копия не должна оставить
        // приложение с указателем на человека, которого нет.
        activePerson: изФайлаЖивые.some((p) => p.id === выбранныйИзФайла) ? выбранныйИзФайла : изФайлаЖивые[0].id,
      }
    : { people: своиЛюди, activePerson: local.activePerson }

  // Личное — цели, пороги, часы приёма, дневник сахара — тем же условием:
  // чужой файл не должен перекрашивать измерения жены по порогам отца.
  const личное = братьЛичное
    ? {
        targetSys: incoming.targetSys ?? local.targetSys,
        targetDia: incoming.targetDia ?? local.targetDia,
        glucoseFastingMax: incoming.glucoseFastingMax ?? local.glucoseFastingMax,
        glucosePostMealMax: incoming.glucosePostMealMax ?? local.glucosePostMealMax,
        glucoseLow: incoming.glucoseLow ?? local.glucoseLow,
        trackGlucose: incoming.trackGlucose ?? local.trackGlucose,
        intakeTimes: incoming.intakeTimes ?? local.intakeTimes,
        intakeSlots: incoming.intakeSlots ?? local.intakeSlots,
        // Аптеки — тоже личное: человек выбрал, где ему удобно покупать.
        pharmacies: incoming.pharmacies ?? local.pharmacies,
        userNames: incoming.userNames ?? local.userNames,
        activeUser: incoming.activeUser ?? local.activeUser,
      }
    : {}

  return { ...local, ...личное, ...семья }
}

/**
 * Берётся ли из копии личное — люди, цели, часы приёма. Да, если файл свой
 * (все здешние люди в нём есть по идентификаторам) или семья здесь ещё не
 * заведена: один человек с именем и идентификатором по умолчанию. Наружу —
 * чтобы сообщение после восстановления не обещало того, чего не было.
 */
export function takesPersonalFrom(local: Pick<Settings, 'people'>, incoming: NonNullable<Snapshot['settings']>): boolean {
  const своиЛюди = local.people
  const изФайла = incoming.people ?? []
  // Незаведённая семья — один человек с именем по умолчанию. Идентификатор
  // не смотрим: после удаления и повторного добавления он уже не `p1`, а
  // дневник от этого своим быть не перестаёт.
  const семьяЕщёНеЗаведена = своиЛюди.length <= 1 && (своиЛюди[0]?.name ?? 'Я').trim() === 'Я'
  // `p1` — наследие: до 0.7.2 первый человек на любой установке получал именно
  // его, и такие копии уже лежат у людей на телефонах. Одного совпадения по
  // нему мало: файл отца с его `p1` иначе сошёл бы за свой у переименованного
  // одиночки. Поэтому для `p1` требуем ещё и то же имя. Новые установки
  // получают уникальный идентификатор, и правило их не касается.
  const тотЖе = (p: Person, q: Person) =>
    p.id === q.id && (p.id !== 'p1' || (q.name ?? '').trim() === (p.name ?? '').trim())
  const файлСвой = изФайла.length > 0 && своиЛюди.every((p) => изФайла.some((q) => тотЖе(p, q)))
  return семьяЕщёНеЗаведена || файлСвой
}

/** Поля курса, которые прежние версии теряли при восстановлении из копии. */
// `updatedAt` сюда не входит намеренно: дописав чужую отметку времени, местный
// курс стал бы выглядеть свежее, чем он есть, и при семейном слиянии побеждал
// бы правку, которой не было.
//
// Владелец из списка ушёл: он больше не поле коробки, а `Regimen.person`, и
// пустым не бывает — курса без человека не существует.
const ДОПИСЫВАЕМЫЕ = ['since', 'startedAt', 'foldedUntil', 'history'] as const

/**
 * Дописать известному курсу то, чего у него нет, из копии: даты и историю.
 * Остаток и отметки — местные, их не трогаем: они свежее любой копии.
 * Нужна тем, кто наполнял телефон копией до 0.7.1 и получил коробки без
 * владельца и с «пропусками» за прошлое. Если дописывать нечего — тот же объект.
 */
export function fillMissingFromCopy(local: Regimen, incoming: Regimen): Regimen {
  const патч: Partial<Regimen> = {}
  for (const key of ДОПИСЫВАЕМЫЕ) {
    if (local[key] === undefined && incoming[key] !== undefined) Object.assign(патч, { [key]: incoming[key] })
  }
  return Object.keys(патч).length > 0 ? { ...local, ...патч } : local
}
