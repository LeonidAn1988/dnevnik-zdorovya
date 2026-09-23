/**
 * Анализы: когда сдавать и что получилось.
 *
 * **Черта, за которую этот модуль не заходит.** Здесь нет и не будет ни нормы,
 * ни референсного интервала, ни слов «повышен» и «понижен», ни цвета по
 * значению. Приложение хранит числа со слов человека и напоминает сдать.
 * Сравнение результата с нормой и вывод из него — это медицинское изделие
 * (письмо Росздравнадзора 02И-297/20); та же черта записана в `BACKLOG.md` §11,
 * и по той же причине `events.ts` не толкует события, а `classify.ts` остаётся
 * единственным исключением, доставшимся от давления.
 *
 * Про сроки говорить можно и нужно: «сдать сегодня», «просрочен на три дня» —
 * это факт о списке самого человека, а не суждение о его здоровье.
 */

import { addDays, dayNumber, daysBetween, momentOf, startOfDay } from './days'
import type { LabResult, LabTest, Regimen } from '../types'

/** Во сколько напоминать в день сдачи, если человек не выбрал другое. */
export const DEFAULT_LAB_TIME = '09:00'

/**
 * Сколько дней вокруг даты сдачи анализ ещё считается тем самым.
 *
 * Сдать точно в день назначения удаётся редко: лаборатория работает не всегда,
 * человек занят, а иногда наоборот — сходил раньше, потому что оказался рядом.
 * Результат в этом окне закрывает назначенную сдачу, а не заводит внеплановую.
 */
export const WINDOW_DAYS = 14

/**
 * Окно вокруг одной даты — назад и вперёд, в днях.
 *
 * У повторяющегося анализа окно урезается до половины промежутка. Иначе один
 * результат закрыл бы сразу две сдачи: при повторе раз в десять дней запись,
 * сделанная через четырнадцать, попадает и в своё окно, и в следующее. Человек
 * увидел бы «сдано» там, где не сдавал.
 */
function windowOf(test: LabTest): number {
  const дней = test.schedule?.everyDays ?? (test.schedule?.everyMonths ?? 0) * 30
  if (дней <= 0) return WINDOW_DAYS
  return Math.max(1, Math.min(WINDOW_DAYS, Math.floor(дней / 2)))
}

/** Идентификаторы — от часов и случайного хвоста, как у остальных записей. */
export function newLabId(now: number): string {
  return `l${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function newResultId(now: number): string {
  return `lr${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function newPhotoId(now: number): string {
  return `lp${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Когда сдавать — с учётом привязки к курсу приёма.
 *
 * `frozen` означает, что правило больше не считается: курс удалили или у него
 * не стало конца. Дата при этом остаётся последней вычисленной — исчезнуть она
 * не вправе, потому что анализ никуда не делся.
 */
export function dueOf(
  test: LabTest,
  regimens: Regimen[] = [],
): { at: number; frozen: boolean } | null {
  const план = test.schedule
  if (!план) return null
  if (план.afterRegimen === undefined) return { at: startOfDay(план.due), frozen: false }

  const курс = regimens.find((r) => r.id === план.afterRegimen)
  if (!курс || курс.endsAt === undefined) return { at: startOfDay(план.due), frozen: true }
  const день = addDays(new Date(курс.endsAt), план.afterDays ?? 0)
  return { at: день.getTime(), frozen: false }
}

/**
 * Записать в анализ ту дату, которая сейчас вычисляется.
 *
 * Зачем: привязка «через две недели после курса» считается на лету, а в поле
 * `due` лежит то, что человек ввёл в форме, — по умолчанию сегодняшнее число.
 * Пропади курс, и заморозка вернула бы не последнюю посчитанную дату, а этот
 * самый сегодняшний день: анализ, назначенный на конец октября, оказался бы
 * «просрочен» посреди сентября.
 *
 * Поэтому дату закрепляем в момент записи — и только её, ничего больше.
 */
export function withResolvedDue(test: LabTest, regimens: Regimen[]): LabTest {
  const срок = dueOf(test, regimens)
  if (!test.schedule || !срок || срок.frozen || срок.at === test.schedule.due) return test
  return { ...test, schedule: { ...test.schedule, due: срок.at } }
}

/**
 * Результат, закрывающий назначенную сдачу.
 *
 * Окно с обеих сторон: анализ, сданный за три дня до назначенной даты, — это
 * тот самый анализ, а не внеплановый. Приложение, которое после этого звонит в
 * день сдачи, выглядит сломанным, и звонит оно ровно тому, кто всё сделал
 * вовремя.
 */
export function resultFor(test: LabTest, due: number): LabResult | null {
  const окно = windowOf(test)
  const от = addDays(new Date(startOfDay(due)), -окно).getTime()
  const до = addDays(new Date(startOfDay(due)), окно).getTime()
  const попавшие = test.results
    .filter((r) => startOfDay(r.day) >= от && startOfDay(r.day) <= до)
    .sort((a, b) => a.day - b.day)
  return попавшие[0] ?? null
}

/** Последний по времени результат — его и показывает карточка. */
export function lastResult(test: LabTest): LabResult | null {
  if (test.results.length === 0) return null
  return [...test.results].sort((a, b) => b.day - a.day)[0]
}

/**
 * Дата через столько-то месяцев, с оглядкой на длину месяца.
 *
 * `setMonth` здесь не годится: у 31 января плюс месяц выходит 3 марта, потому
 * что 31 февраля не бывает и дата переливается через край. Анализ, назначенный
 * на последнее число, поехал бы по календарю вперёд с каждым повтором.
 * Прижимаем к последнему дню месяца — так же, как это делает человек.
 */
function черезМесяцы(from: number, месяцев: number): number {
  const d = new Date(from)
  const число = d.getDate()
  const цель = new Date(d.getFullYear(), d.getMonth() + месяцев, 1, 0, 0, 0, 0)
  const вМесяце = new Date(цель.getFullYear(), цель.getMonth() + 1, 0).getDate()
  цель.setDate(Math.min(число, вМесяце))
  return цель.getTime()
}

/**
 * Даты сдачи в окне `[from, to]`.
 *
 * Повтор разворачивается вперёд от назначенной даты. Назад не ходим: анализ,
 * назначенный на будущее, в прошлом не сдавался, а просроченный отдаётся одной
 * своей датой — напоминать о трёх пропущенных повторах разом незачем.
 */
export function occurrencesOf(
  test: LabTest,
  regimens: Regimen[],
  from: number,
  to: number,
): number[] {
  const срок = dueOf(test, regimens)
  if (!срок) return []

  const шагМесяцев = test.schedule?.everyMonths ?? 0
  const шагДней = test.schedule?.everyDays ?? 0
  const даты: number[] = []

  let текущая = срок.at
  // Просроченная дата попадает в список, даже если она раньше окна: о ней и
  // надо напомнить. Дальше повторы идут вперёд.
  if (текущая <= to) даты.push(текущая)

  if (шагМесяцев <= 0 && шагДней <= 0) return даты.filter((d) => d <= to)

  // Потолок на число повторов — защита от `everyDays: 0.5` и прочих значений,
  // которых форма не даст, а копия с чужого телефона может принести.
  for (let шаг = 1; шаг <= 400; шаг += 1) {
    if (шагМесяцев > 0) {
      текущая = черезМесяцы(срок.at, шагМесяцев * шаг)
    } else {
      текущая = addDays(new Date(срок.at), Math.max(1, Math.round(шагДней)) * шаг).getTime()
    }
    if (текущая > to) break
    if (текущая >= from) даты.push(текущая)
  }
  return даты
}

/**
 * Ближайшая несданная дата: та, по которой ещё нет результата.
 *
 * Именно она показывается на карточке и по ней строятся напоминания.
 */
export function nextDue(test: LabTest, regimens: Regimen[], now: number): number | null {
  const год = addDays(new Date(startOfDay(now)), 400).getTime()
  const даты = occurrencesOf(test, regimens, startOfDay(now), год)
  for (const дата of даты) {
    if (!resultFor(test, дата)) return дата
  }
  return null
}

export type LabState = 'нет срока' | 'сдан' | 'впереди' | 'сегодня' | 'просрочен'

/**
 * Состояние анализа — про сроки, не про результат.
 *
 * `сдан` означает «по последней назначенной дате результат есть», а не «всё
 * хорошо»: о самих числах приложение суждений не выносит.
 */
export function labState(test: LabTest, regimens: Regimen[], now: number): LabState {
  const срок = nextDue(test, regimens, now)
  if (срок === null) return test.schedule ? 'сдан' : 'нет срока'
  const сегодня = startOfDay(now)
  if (срок < сегодня) return 'просрочен'
  if (срок === сегодня) return 'сегодня'
  return 'впереди'
}

const МЕСЯЦЫ = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

/**
 * Дата словами. Год дописывается, только если он не нынешний: «6 февраля» про
 * позапрошлогодний анализ читается как про этот год.
 */
export function formatDay(ts: number, now?: number): string {
  const d = new Date(ts)
  const год = now !== undefined && d.getFullYear() !== new Date(now).getFullYear() ? ` ${d.getFullYear()}` : ''
  return `${d.getDate()} ${МЕСЯЦЫ[d.getMonth()]}${год}`
}

/**
 * Дата для имени файла: `2026-09-23`.
 *
 * Собирается из местных частей даты, а не через `toISOString`: день анализа —
 * это местная полночь, и в UTC она попадает на вчера у всех, кто восточнее
 * Гринвича. Снимок бланка, снятый 23 сентября, уходил бы в чат под именем
 * `бланк-2026-09-22`.
 */
export function dayStamp(ts: number): string {
  const d = new Date(ts)
  const два = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${два(d.getMonth() + 1)}-${два(d.getDate())}`
}

/**
 * Число результата по-русски: с запятой, а не с точкой.
 *
 * `toLocaleString` здесь не годится: он округляет до трёх знаков после запятой,
 * а у анализов бывают и четыре — МНО пишут как 1,0625.
 */
export function formatValue(value: number): string {
  return String(value).replace('.', ',')
}

/** Словами о сроке — то, что читает человек на карточке. */
export function describeDue(test: LabTest, regimens: Regimen[], now: number): string | null {
  const срок = nextDue(test, regimens, now)
  if (срок === null) return test.schedule ? 'Сдан' : null
  const дней = daysBetween(startOfDay(now), срок)
  if (дней === 0) return 'Сдать сегодня'
  if (дней === 1) return 'Сдать завтра'
  if (дней < 0) {
    const сколько = Math.abs(дней)
    return `Просрочен на ${сколько} ${склонение(сколько, 'день', 'дня', 'дней')}`
  }
  return `Сдать ${formatDay(срок)}`
}

function склонение(n: number, один: string, два: string, много: string): string {
  const с = Math.abs(n) % 100
  const е = с % 10
  if (с > 10 && с < 20) return много
  if (е > 1 && е < 5) return два
  if (е === 1) return один
  return много
}

/**
 * Разрыв привязки — словами.
 *
 * Молчать об этом нельзя: человек задал «через две недели после курса», курс
 * исчез, и дата с тех пор не двигается. Выглядит это как обычный срок.
 */
export function describeFrozen(test: LabTest, regimens: Regimen[]): string | null {
  const срок = dueOf(test, regimens)
  if (!срок?.frozen) return null
  return `Дата была привязана к курсу приёма, а курса больше нет. Осталась последняя посчитанная — ${formatDay(срок.at)}.`
}

/** Порядок в списке: сначала то, что горит, потом остальное по дате. */
export function sortLabs(tests: LabTest[], regimens: Regimen[], now: number): LabTest[] {
  const вес: Record<LabState, number> = {
    'просрочен': 0,
    'сегодня': 1,
    'впереди': 2,
    'сдан': 3,
    'нет срока': 4,
  }
  return [...tests].sort((a, b) => {
    const разница = вес[labState(a, regimens, now)] - вес[labState(b, regimens, now)]
    if (разница !== 0) return разница
    const сa = nextDue(a, regimens, now) ?? Number.MAX_SAFE_INTEGER
    const сb = nextDue(b, regimens, now) ?? Number.MAX_SAFE_INTEGER
    if (сa !== сb) return сa - сb
    return a.name.localeCompare(b.name, 'ru')
  })
}

/** Анализы одного человека. */
export function labsOf(tests: LabTest[], person: string | null | undefined): LabTest[] {
  // Человек неизвестен — пусто, а не всё. Та же причина, что у
  // `intakesOfPerson`: чужой анализ под своим именем хуже пустого списка.
  return person ? tests.filter((t) => t.owner === person) : []
}

/** Сколько анализов просрочено или сдаётся сегодня — для карточки на «Обзоре». */
export function labsDue(tests: LabTest[], regimens: Regimen[], now: number): LabTest[] {
  return tests.filter((t) => {
    const состояние = labState(t, regimens, now)
    return состояние === 'просрочен' || состояние === 'сегодня'
  })
}

export { dayNumber, momentOf }
