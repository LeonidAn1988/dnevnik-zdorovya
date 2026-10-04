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
import { addDays, daysBetween, startOfDay } from './days'
import { plural } from './plural'


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
  return { ...коробка, ...курс, doseUnit: курс.doseUnit ?? коробка.doseUnit, boxId, regimenId }
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
  regimen: Pick<Regimen, 'endsAt' | 'stoppedAt' | 'plan' | 'planFrom' | 'startedAt' | 'since'>,
  day: number,
  этап?: { finished: boolean } | null,
): boolean {
  if (regimen.stoppedAt !== undefined && day >= regimen.stoppedAt) return true
  const конец = regimen.endsAt
  if (конец !== undefined && startOfDay(day) > startOfDay(конец)) return true
  return этап?.finished ?? false
}

/** Фактический последний календарный день, в том числе при досрочной остановке. */
export function regimenEndDay(regimen: Pick<Regimen, 'endsAt' | 'stoppedAt'>): number | undefined {
  const stopped = regimen.stoppedAt === undefined ? undefined : startOfDay(regimen.stoppedAt)
  if (stopped === undefined) return regimen.endsAt
  return regimen.endsAt === undefined ? stopped : Math.min(stopped, regimen.endsAt)
}

/** Сколько дней курса осталось, считая сегодняшний. `null` — курс без конца. */
export function daysLeftOf(regimen: Pick<Regimen, 'endsAt'>, now: number): number | null {
  if (regimen.endsAt === undefined) return null
  return daysBetween(now, regimen.endsAt) + 1
}

/**
 * Последний день курса по его длине в днях, считая первый день.
 *
 * «Курс десять дней» с сегодняшнего — это сегодня плюс девять, а не плюс
 * десять: день начала считается первым, как его и называет врач.
 */
export function endsAfter(fromDay: number, days: number): number {
  // Календарными сутками: в ночь перевода часов сложение миллисекундами
  // промахивается на час, а сравнение идёт с местной полуночью — курс
  // кончался бы днём позже или раньше назначенного.
  return addDays(new Date(startOfDay(fromDay)), days - 1).getTime()
}

/** Сколько дней в курсе с началом и концом. Обратное к `endsAfter`. */
export function lengthOf(fromDay: number, endsAt: number): number {
  return daysBetween(fromDay, endsAt) + 1
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
export function describeEnd(regimen: Pick<Regimen, 'endsAt' | 'stoppedAt'>, now: number): string | null {
  if (regimen.stoppedAt !== undefined && now >= regimen.stoppedAt) return `Приём прекращён ${formatDay(regimen.stoppedAt)}`
  const осталось = daysLeftOf(regimen, now)
  if (осталось === null) return null
  // Сегодняшний день входит в остаток, поэтому единица — это «сегодня
  // последний», а не «остался один впереди».
  if (осталось <= 0) return `Курс окончен ${formatDay(regimen.endsAt!)}`
  if (осталось === 1) return 'Сегодня последний день курса'
  if (осталось === 2) return 'Завтра последний день курса'
  return `До конца курса ${осталось} дн. — по ${formatDay(regimen.endsAt!)}`
}

/**
 * Когда принимать — одной строкой: «08:00, 20:00 · через день».
 *
 * Ритм приписан к временам, а не вынесен отдельно: «08:00, через день» — это
 * один ответ на один вопрос «когда принимать», и разносить его по двум строкам
 * значит заставлять собирать обратно.
 *
 * Без расписания остаётся расход: «3 раза в день» — это то, что человек указал
 * руками, когда времена ему не нужны. Нет ни того ни другого — пустая строка, и
 * вызывающий сам решает, что показать вместо неё.
 */
export function describeSchedule(
  times: readonly string[] | undefined,
  rhythmText: string | null,
  perDay: number | null,
): string {
  if (times?.length) return `${times.join(', ')}${rhythmText ? ` · ${rhythmText}` : ''}`
  if (perDay !== null && perDay > 0) return `${perDay} ${plural(perDay, 'раз', 'раза', 'раз')} в день`
  return ''
}
