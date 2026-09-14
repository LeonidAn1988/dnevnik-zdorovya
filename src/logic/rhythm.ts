/**
 * Ритм приёма: не каждый день.
 *
 * Врач назначает не только «по таблетке утром и вечером». Бывает «через день»,
 * бывает «по понедельникам и четвергам», бывает «пять дней принимать, два
 * перерыв». До сих пор аптечка умела только ежедневное расписание, и человек
 * либо заводил препарат ежедневным и терпел лишние напоминания, либо не заводил
 * вовсе — а тогда и запас не считался.
 *
 * **Правил здесь два, а не четыре.** «Через день» — это цикл «1 день приёма,
 * 1 день перерыва», «через 2 дня» — «1 и 2». Отдельного механизма для
 * промежутков не нужно: он оказался частным случаем цикла, и вся разница
 * осталась в подписях на кнопках. Второе правило — дни недели, его циклом не
 * выразить: у недели семь дней, а у цикла может быть любое число.
 *
 * **Главная опасность — не арифметика, а слова.** «Через 2 дня» одни понимают
 * как «каждый третий день», другие как «через день». Спорить с этим бесполезно,
 * поэтому интерфейс обязан показывать не правило, а ближайшие даты: человек
 * сверяет их с тем, что сказал врач, и не рассуждает о том, что значит «через».
 * Ради этого здесь живут `nextIntakeDays` и `describeUpcoming`.
 */

import type { Rhythm } from '../types'
import { addDays, daysBetween, startOfDay } from './days'
import { plural } from './plural'

/** Понедельник — первый: так устроена русская неделя и так подписаны кнопки. */
export const WEEKDAYS: { id: number; short: string; long: string; many: string }[] = [
  { id: 1, short: 'пн', long: 'понедельник', many: 'понедельникам' },
  { id: 2, short: 'вт', long: 'вторник', many: 'вторникам' },
  { id: 3, short: 'ср', long: 'среда', many: 'средам' },
  { id: 4, short: 'чт', long: 'четверг', many: 'четвергам' },
  { id: 5, short: 'пт', long: 'пятница', many: 'пятницам' },
  { id: 6, short: 'сб', long: 'суббота', many: 'субботам' },
  { id: 7, short: 'вс', long: 'воскресенье', many: 'воскресеньям' },
]

/** Номер дня недели по-человечески: 1 — понедельник. У `Date` воскресенье нулевое. */
export function isoWeekday(day: number): number {
  const n = new Date(day).getDay()
  return n === 0 ? 7 : n
}

/**
 * Привести ритм к осмысленному виду. `undefined` — принимать каждый день.
 *
 * Сюда попадает и то, что пришло из чужой копии, поэтому проверяется всё:
 * номера дней недели, дробные и отрицательные длины цикла, цикл без перерыва.
 */
export function normalizeRhythm(rhythm: Rhythm | undefined | null): Rhythm | undefined {
  if (!rhythm) return undefined

  const дни = [...new Set((rhythm.weekdays ?? []).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort(
    (a, b) => a - b,
  )
  // Все семь дней недели — это и есть «каждый день», хранить нечего.
  if (дни.length > 0) return дни.length === 7 ? undefined : { weekdays: дни }

  const on = Math.floor(rhythm.onDays ?? 0)
  const off = Math.floor(rhythm.offDays ?? 0)
  if (!Number.isFinite(on) || !Number.isFinite(off) || on < 1 || off < 1) return undefined
  return { onDays: on, offDays: off, from: startOfDay(rhythm.from ?? 0) }
}

/** Принимать ли в этот день. Без ритма — каждый. */
export function intakeOn(rhythm: Rhythm | undefined | null, day: number): boolean {
  const правило = normalizeRhythm(rhythm)
  if (!правило) return true

  if (правило.weekdays?.length) return правило.weekdays.includes(isoWeekday(day))

  const длина = правило.onDays! + правило.offDays!
  // Остаток по модулю — с поправкой на отрицательные: расписание действует и
  // назад во времени, иначе вчерашний день у свежего ритма выглядел бы приёмным
  // всегда, и отчёт врачу считал бы пропуски там, где перерыв.
  const сдвиг = daysBetween(правило.from ?? 0, day)
  const фаза = ((сдвиг % длина) + длина) % длина
  return фаза < правило.onDays!
}

/**
 * Какая доля дней приёмная. Нужна расчёту запаса.
 *
 * «Хватит на 6 дней» при приёме через день — неправда: хватит на двенадцать.
 * Расход усредняется по ритму, и предупреждение «пора покупать» приходит вовремя,
 * а не вдвое раньше.
 */
export function rhythmDuty(rhythm: Rhythm | undefined | null): number {
  const правило = normalizeRhythm(rhythm)
  if (!правило) return 1
  if (правило.weekdays?.length) return правило.weekdays.length / 7
  return правило.onDays! / (правило.onDays! + правило.offDays!)
}

/** Ближайшие приёмные дни, начиная с `from`. Пустой ритм — просто подряд. */
export function nextIntakeDays(rhythm: Rhythm | undefined | null, from: number, count: number): number[] {
  const дни: number[] = []
  const начало = new Date(startOfDay(from))
  // Потолок обхода: у цикла «1 через 30» до второго приёма месяц, но бесконечно
  // искать нельзя — при испорченном правиле это повесило бы форму.
  for (let i = 0; i < 400 && дни.length < count; i++) {
    const день = addDays(начало, i).getTime()
    if (intakeOn(rhythm, день)) дни.push(день)
  }
  return дни
}

/** Сдвинуть цикл на день. У дней недели фазы нет — они и так привязаны к календарю. */
export function shiftRhythm(rhythm: Rhythm | undefined | null, byDays: number): Rhythm | undefined {
  const правило = normalizeRhythm(rhythm)
  if (!правило || правило.weekdays?.length) return правило
  return { ...правило, from: addDays(new Date(правило.from ?? 0), byDays).getTime() }
}

/**
 * Ритм словами: «через день», «по понедельникам и четвергам».
 *
 * `null` — каждый день; в интерфейсе это обычный случай, и писать о нём нечего.
 */
export function describeRhythm(rhythm: Rhythm | undefined | null): string | null {
  const правило = normalizeRhythm(rhythm)
  if (!правило) return null

  if (правило.weekdays?.length) {
    const выбранные = WEEKDAYS.filter((d) => правило.weekdays!.includes(d.id))
    // До трёх дней — полные имена, они читаются без перевода. Дальше строка
    // становится длиннее экрана, и сокращения честнее многоточия.
    const имена = выбранные.map((d) => (выбранные.length <= 3 ? d.many : d.short))
    return `по ${перечислить(имена)}`
  }

  const on = правило.onDays!
  const off = правило.offDays!
  // «Через день» и «через 2 дня» — то, как это называет врач. Перерыв на день
  // длиннее, чем число в подписи: «через день» значит пропустить один.
  if (on === 1) return off === 1 ? 'через день' : `через ${off} ${plural(off, 'день', 'дня', 'дней')}`
  return `${on} ${plural(on, 'день', 'дня', 'дней')} приёма, ${off} ${plural(off, 'день', 'дня', 'дней')} перерыва`
}

/**
 * Ближайшие приёмы датами — то, по чему человек и сверяется.
 *
 * Правило словами можно понять двояко («через 2 дня» — это каждый третий день
 * или всё-таки через один?), а даты двояко не понимаются. `null` — ритма нет.
 */
export function describeUpcoming(rhythm: Rhythm | undefined | null, now: number): string | null {
  const правило = normalizeRhythm(rhythm)
  if (!правило) return null

  const сегодня = startOfDay(now)
  const назвать = (day: number) => (day === сегодня ? 'сегодня' : ДЕНЬ_МЕСЯЦ.format(day))

  // Цикл с приёмом несколько дней подряд: перечислять каждый день бессмысленно,
  // человеку нужны границы отрезка и когда начнётся следующий.
  if (правило.onDays && правило.onDays > 1) {
    const подряд = nextIntakeDays(правило, сегодня, правило.onDays * 2)
    const первый = подряд[0]
    let последний = первый
    for (const день of подряд) {
      if (daysBetween(последний, день) <= 1) последний = день
      else break
    }
    const следующий = подряд.find((день) => daysBetween(последний, день) > 1)
    const отрезок = первый === последний ? назвать(первый) : `${назвать(первый)} — ${ДЕНЬ_МЕСЯЦ.format(последний)}`
    return следующий ? `Приём ${отрезок}, потом перерыв до ${ДЕНЬ_МЕСЯЦ.format(следующий)}` : `Приём ${отрезок}`
  }

  const дни = nextIntakeDays(правило, сегодня, 3)
  if (дни.length === 0) return null
  return `Ближайшие приёмы: ${перечислить(дни.map(назвать))}`
}

const ДЕНЬ_МЕСЯЦ = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })

/** «а, б и в» — последний союзом, как пишут по-русски, а не запятой. */
function перечислить(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} и ${items[items.length - 1]}`
}
