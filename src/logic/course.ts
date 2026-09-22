/**
 * Расписание измерений: напоминание мерить и курс, назначенный врачом.
 *
 * Два пункта бэклога (§21.1 и §21.4) оказались одним механизмом. Без срока это
 * «напоминай мерить»: про таблетку телефон напомнит, про тонометр — никто, он
 * лежит в ящике, а таблетница стоит на столе. Со сроком это курс: «две недели
 * утром и вечером», со счётчиком и строкой в отчёте врачу.
 *
 * **Главная тонкость — что считать «уже измерено».** Требование «не напоминать,
 * если измерение за этот день есть» верно буквально только при одном времени в
 * сутки. У курса «утром и вечером» утреннее измерение не должно гасить
 * вечернее — иначе врач получит половину дневника и не узнает об этом. Поэтому
 * сутки делятся на окна границами посередине между соседними временами, и
 * измерение закрывает тот слот, в чьё окно попало.
 */

import { readingOwnerId } from './people'
import type { Measurement, MeasurePlan, Person, Settings } from '../types'
import { isGlucose } from '../types'
import { addDays, daysBetween, momentOf, startOfDay } from './days'
import { normalizeTimes, parseTime } from './medicines'
import { plural } from './plural'

/**
 * Сколько времён помещается в расписание.
 *
 * Не вкус, а разряд номера уведомления: под время отведены три бита, как и под
 * человека. Больше восьми измерений в сутки — это уже не самоконтроль.
 */
export const MAX_MEASURE_TIMES = 8

/** Времена расписания: нормализованные, без дублей, не длиннее разряда. */
export function planTimes(plan: MeasurePlan | undefined | null): string[] {
  return normalizeTimes(plan?.times ?? []).slice(0, MAX_MEASURE_TIMES)
}

/** Окно суток, закреплённое за одним временем расписания. */
export interface SlotWindow {
  time: string
  from: number
  to: number
}

/**
 * Окна суток: границы посередине между временами, края — местные полуночи.
 *
 * Одно время — окно на все сутки, то есть ровно «измерение за этот день».
 * 08:00 и 20:00 — `[00:00, 14:00)` и `[14:00, 24:00)`. Раннее измерение
 * («померил в 6:40, потом завтрак») закрывает утро само: окно начинается с
 * полуночи. Граница принадлежит позднему окну.
 */
export function slotWindows(times: string[], day: number): SlotWindow[] {
  const времена = normalizeTimes(times)
  if (времена.length === 0) return []
  const минуты = времена.map((t) => parseTime(t)!)
  const дата = new Date(startOfDay(day))
  const границы = [
    momentOf(дата, 0),
    ...минуты.slice(1).map((м, i) => momentOf(дата, Math.ceil((минуты[i] + м) / 2))),
    addDays(дата, 1).getTime(),
  ]
  return времена.map((time, i) => ({ time, from: границы[i], to: границы[i + 1] }))
}

/** Какие слоты этого дня уже закрыты измерением. */
export function measuredSlots(plan: MeasurePlan, readings: number[], day: number): boolean[] {
  return slotWindows(planTimes(plan), day).map((окно) => readings.some((ts) => ts >= окно.from && ts < окно.to))
}

/** Номер дня расписания, считая с первого. 0 — ещё не началось. */
export function planDayIndex(plan: MeasurePlan, day: number): number {
  const n = daysBetween(plan.from, day)
  return n < 0 ? 0 : n + 1
}

/** Действует ли расписание в этот день. */
export function planActiveOn(plan: MeasurePlan, day: number): boolean {
  const n = planDayIndex(plan, day)
  if (n === 0) return false
  return plan.days === null || n <= plan.days
}

/**
 * Захватывает ли расписание хоть один день отрезка.
 *
 * Нужно бюджету напоминаний: курс, начинающийся завтра, обязан войти в счёт уже
 * сегодня, иначе горизонт посчитается по сегодняшней разрежённости, а завтра
 * набор перевалит за потолок.
 */
export function planIntersects(plan: MeasurePlan, from: number, to: number): boolean {
  const начало = startOfDay(plan.from)
  const конец = plan.days === null ? Number.POSITIVE_INFINITY : addDays(new Date(начало), plan.days - 1).getTime()
  return начало <= startOfDay(to) && конец >= startOfDay(from)
}

/** Как идёт расписание сегодня. */
export interface CourseToday {
  active: boolean
  /** День курса, считая с первого. 0 — ещё не начался. */
  day: number
  /** Всего дней; `null` — бессрочно, счётчик не показываем. */
  total: number | null
  /** Сколько измерений назначено сегодня и сколько окон уже закрыто. */
  planned: number
  done: number
  /** Ближайшее незакрытое время сегодня. `null` — на сегодня всё. */
  next: string | null
  /** Курс кончился: срок задан и последний день позади. */
  finished: boolean
}

export function courseToday(plan: MeasurePlan, readings: number[], now: number): CourseToday {
  const день = startOfDay(now)
  const времена = planTimes(plan)
  const закрыты = measuredSlots(plan, readings, день)
  const номер = planDayIndex(plan, день)
  const active = planActiveOn(plan, день)
  return {
    active,
    day: номер,
    total: plan.days,
    planned: времена.length,
    done: закрыты.filter(Boolean).length,
    next: времена.find((_, i) => !закрыты[i]) ?? null,
    finished: plan.days !== null && номер > plan.days,
  }
}

/** «День 6 из 14 · сегодня 1 из 2». Без курса — только про сегодня. */
export function courseText(state: CourseToday): string {
  const сегодня = `сегодня ${state.done} из ${state.planned}`
  if (state.total === null) return сегодня[0].toUpperCase() + сегодня.slice(1)
  if (state.finished) return `Курс кончился: он был на ${state.total} ${plural(state.total, 'день', 'дня', 'дней')}`
  if (state.day === 0) return `Курс начнётся: ${state.total} ${plural(state.total, 'день', 'дня', 'дней')}`
  return `День ${state.day} из ${state.total} · ${сегодня}`
}

/** Что сказать в отчёте врачу. `null` — курса не было. */
export interface CourseReport {
  from: number
  to: number
  days: number
  expected: number
  done: number
}

/**
 * Сводка курса для отчёта.
 *
 * Ожидаемое считается только по **начавшимся** окнам: вечер, который ещё не
 * наступил, не может быть пропущен, и записывать его в недостачу нечестно.
 */
export function courseReport(plan: MeasurePlan, readings: number[], now: number): CourseReport | null {
  if (plan.days === null) return null
  const времена = planTimes(plan)
  if (времена.length === 0) return null

  const начало = startOfDay(plan.from)
  let expected = 0
  let done = 0
  for (let i = 0; i < plan.days; i++) {
    const день = addDays(new Date(начало), i).getTime()
    if (день > startOfDay(now)) break
    const окна = slotWindows(времена, день)
    const закрыты = measuredSlots(plan, readings, день)
    окна.forEach((окно, j) => {
      if (окно.from > now) return
      expected += 1
      if (закрыты[j]) done += 1
    })
  }
  return { from: начало, to: addDays(new Date(начало), plan.days - 1).getTime(), days: plan.days, expected, done }
}

/**
 * Строка курса для отчёта врачу.
 *
 * Именно то, о чём договаривались в кабинете: какая схема, за какой срок и
 * сколько из назначенного сделано. Без этой строки врач видит просто россыпь
 * измерений и не знает, велись они по схеме или как придётся.
 */
export function courseReportText(report: CourseReport | null, times: string[]): string | null {
  if (!report) return null
  const дата = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })
  const когда = times.length === 1 ? times[0] : `${times.slice(0, -1).join(', ')} и ${times[times.length - 1]}`
  // Без слова «курс» в начале: подпись строки в отчёте его уже несёт, а
  // дважды подряд оно выглядит как ошибка вёрстки.
  return `${дата.format(report.from)} — ${дата.format(report.to)}, ${когда}. Сделано ${report.done} из ${report.expected}.`
}

/** Расписание словами: «08:00 и 20:00, 14 дней». */
export function describeMeasurePlan(plan: MeasurePlan | undefined | null): string {
  const времена = planTimes(plan)
  if (времена.length === 0) return 'не задано'
  const когда = времена.length === 1 ? времена[0] : `${времена.slice(0, -1).join(', ')} и ${времена[времена.length - 1]}`
  if (!plan || plan.days === null) return `${когда}, бессрочно`
  return `${когда}, ${plan.days} ${plural(plan.days, 'день', 'дня', 'дней')}`
}

/** Кому и что напоминать. Единственное место, где расписание знает про людей. */
export interface MeasureSubject {
  /** Идентификатор человека; `null` — одиночный дневник. */
  person: string | null
  /** Место в списке людей — разряд номера уведомления. */
  index: number
  /** Имя для заголовка уведомления. `null` — людей один, подписывать незачем. */
  name: string | null
  plan: MeasurePlan
  /** Метки времени измерений давления этого человека. */
  readings: number[]
}


/** Расписание этого человека: своё, иначе общее. */
export function measurePlanOf(
  person: Person | null | undefined,
  settings: Pick<Settings, 'measurePlan'>,
): MeasurePlan | undefined {
  return person?.measurePlan ?? settings.measurePlan
}

/**
 * Кому сегодня напоминать мерить.
 *
 * Людей нет или один — один субъект со всеми измерениями, как и везде в
 * приложении. Иначе по человеку, и место в списке берётся из полного списка,
 * а не из отфильтрованного: иначе выключение расписания у отца сдвинуло бы
 * номера уведомлений сыну.
 */
export function measureSubjects(
  settings: Pick<Settings, 'people' | 'measurePlan'>,
  measurements: Measurement[],
  now: number,
): MeasureSubject[] {
  const давление = measurements.filter((m) => !isGlucose(m))
  const день = startOfDay(now)

  if (settings.people.length <= 1) {
    const plan = settings.measurePlan
    if (!plan || planTimes(plan).length === 0 || (plan.days !== null && !planActiveOn(plan, день))) return []
    return [{ person: null, index: 0, name: null, plan, readings: давление.map((m) => m.ts) }]
  }

  return settings.people.flatMap((person, index) => {
    const plan = measurePlanOf(person, settings)
    if (!plan || planTimes(plan).length === 0) return []
    if (plan.days !== null && !planActiveOn(plan, день)) return []
    const свои = давление.filter((m) => readingOwnerId(settings.people, m) === person.id).map((m) => m.ts)
    return [{ person: person.id, index, name: person.name?.trim() || null, plan, readings: свои }]
  })
}

/**
 * Записать расписание измерений — человеку или в общие настройки.
 *
 * Правило то же, что у часов приёма: пока человек один, расписание общее; в
 * семье оно личное, потому что курс назначают одному, а не дому.
 */
export function setMeasurePlan(
  settings: Pick<Settings, 'people'>,
  personId: string | null,
  plan: MeasurePlan | undefined,
): Partial<Settings> {
  if (settings.people.length <= 1 || !personId) return { measurePlan: plan }
  return {
    people: settings.people.map((p) => (p.id === personId ? { ...p, measurePlan: plan } : p)),
  }
}
