/**
 * Курс приёма: кто принимает из коробки, когда и до какого дня.
 *
 * Отделён от коробки в 0.27.0. До этого `Medicine` описывал две разные вещи
 * сразу — вещь в шкафу и назначение врача, — и из этого следовало три
 * невозможности: домашняя аптечка не могла быть общей (у коробки обязан был
 * быть владелец), одну упаковку не могли принимать двое, а «курс кончился» было
 * не отличить от «коробка больше не нужна».
 *
 * Имя `Regimen`, а не `Course` и не `Intake`: первое занято расписанием
 * измерений (`course.ts`), второе — экраном приёма и типом `IntakeSlot`. В
 * интерфейсе он называется «курс приёма».
 */

import type { Medicine, Regimen } from '../types'
import { startOfDay } from './days'

const DAY = 24 * 60 * 60 * 1000

/**
 * Коробка и курс вместе — то, чем оперирует расписание.
 *
 * Расписание почти всегда спрашивает об обоих сразу: сколько принять и в какие
 * дни — у курса, а в чём это считать и сколько осталось — у коробки. Держать
 * два объекта в каждой подписи значило бы переписать полсотни мест ради того,
 * что всё равно ходит парой.
 *
 * Своего `id` у совмещённого представления нет намеренно: их два, и код,
 * который спросит просто «id», обязан сначала решить, какой именно ему нужен.
 */
export type Dosing = Omit<Medicine, 'id' | 'updatedAt'> &
  Omit<Regimen, 'id' | 'medicineId' | 'updatedAt'> & {
    /** Коробка, из которой принимают. */
    boxId: string
    /** Сам курс. */
    regimenId: string
  }

/** Совместить коробку с курсом. Обратная операция — `putMedicine`/`putRegimen`. */
export function dosing(box: Medicine, regimen: Regimen): Dosing {
  const { id: boxId, updatedAt: _боксБыл, ...коробка } = box
  const { id: regimenId, medicineId: _чья, updatedAt: _курсБыл, ...курс } = regimen
  return { ...коробка, ...курс, boxId, regimenId }
}

/**
 * Все курсы с их коробками.
 *
 * Курс без коробки выбрасывается молча: коробку могли удалить на другом
 * телефоне, и показывать назначение без препарата не из чего. Сам осиротевший
 * курс при этом остаётся в базе — его подберёт `dropOrphanRegimens`, который
 * знает, что удаление уже разошлось по семье.
 */
export function dosings(boxes: Medicine[], regimens: Regimen[]): Dosing[] {
  const поИд = new Map(boxes.map((b) => [b.id, b]))
  const итог: Dosing[] = []
  for (const курс of regimens) {
    const коробка = поИд.get(курс.medicineId)
    if (коробка) итог.push(dosing(коробка, курс))
  }
  return итог
}


/** Курсы, принимаемые из этой коробки, — их может быть несколько. */
export function regimensFor(regimens: Regimen[], medicineId: string): Regimen[] {
  return regimens.filter((r) => r.medicineId === medicineId)
}

/** Осиротевшие курсы: коробки, из которой принимали, больше нет. */
export function orphanRegimens(boxes: Medicine[], regimens: Regimen[]): Regimen[] {
  const есть = new Set(boxes.map((b) => b.id))
  return regimens.filter((r) => !есть.has(r.medicineId))
}

/**
 * Курс закончился к этому дню.
 *
 * Два способа кончиться, и оба настоящие: назначенный срок (`endsAt`) и
 * последний срочный этап схемы. Первый ставит человек словами врача — «курс
 * десять дней», второй вытекает из расписания дозы.
 *
 * `day` — любой момент внутри дня, приводится к местной полуночи здесь.
 */
export function regimenFinished(
  regimen: Pick<Regimen, 'endsAt' | 'plan' | 'planFrom' | 'startedAt' | 'since'>,
  day: number,
  этап?: { finished: boolean } | null,
): boolean {
  const конец = regimen.endsAt
  if (конец !== undefined && startOfDay(day) > startOfDay(конец)) return true
  return этап?.finished ?? false
}

/** Сколько дней курса осталось, считая сегодняшний. `null` — курс без конца. */
export function daysLeftOf(regimen: Pick<Regimen, 'endsAt'>, now: number): number | null {
  if (regimen.endsAt === undefined) return null
  return Math.round((startOfDay(regimen.endsAt) - startOfDay(now)) / DAY) + 1
}

/**
 * Последний день курса по его длине в днях, считая первый день.
 *
 * «Курс десять дней» с сегодняшнего — это сегодня плюс девять, а не плюс
 * десять: день начала считается первым, как его и называет врач.
 */
export function endsAfter(fromDay: number, days: number): number {
  return startOfDay(fromDay) + (days - 1) * DAY
}

/** Сколько дней в курсе с началом и концом. Обратное к `endsAfter`. */
export function lengthOf(fromDay: number, endsAt: number): number {
  return Math.round((startOfDay(endsAt) - startOfDay(fromDay)) / DAY) + 1
}

/** Идентификатор курса. По тому же образцу, что у людей и коробок. */
export function newRegimenId(now: number): string {
  return `r-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const ДЕНЬ_МЕСЯЦ = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })

/** «2 октября» — так дату и произносят вслух. Год не пишем: курс короткий. */
export function formatDay(ts: number): string {
  return ДЕНЬ_МЕСЯЦ.format(new Date(ts))
}

/**
 * Что сказать о конце курса: «осталось 3 дня», «последний день», «курс окончен».
 *
 * `null` — курс без конца, и говорить нечего.
 */
export function describeEnd(regimen: Pick<Regimen, 'endsAt'>, now: number): string | null {
  const осталось = daysLeftOf(regimen, now)
  if (осталось === null) return null
  // Сегодняшний день входит в остаток, поэтому единица — это «сегодня
  // последний», а не «остался один впереди».
  if (осталось <= 0) return `Курс окончен ${formatDay(regimen.endsAt!)}`
  if (осталось === 1) return 'Сегодня последний день курса'
  if (осталось === 2) return 'Завтра последний день курса'
  return `До конца курса ${осталось} дн. — по ${formatDay(regimen.endsAt!)}`
}
