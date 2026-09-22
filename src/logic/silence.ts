/**
 * Молчание в чужом дневнике.
 *
 * Сын присматривает за отцом с другого телефона. Данные отца на экране есть —
 * но что они четырёхдневной давности, экран не говорит. «Отец перестал мерить»,
 * «отец не отмечает приём» и «у отца отвалился ключ Диска» выглядят на телефоне
 * сына совершенно одинаково: данные есть.
 *
 * **О чём говорим и о чём молчим.** Говорим о записях: «измерений нет четыре
 * дня». Не о человеке и тем более не о его здоровье: «отец не мерил давление»
 * читается как укор, а «отец перестал следить за собой» — это ещё и вывод,
 * которого приложение делать не вправе. Отсутствие записи означает ровно одно:
 * записи нет. Человек мог уехать на дачу, а телефон мог остаться без сети.
 */

import type { Measurement, Regimen, Person } from '../types'
import { daysBetween } from './days'
import { isGlucose } from '../types'
import { plural } from './plural'

/** С какого дня молчание стоит показывать. */
export const SILENCE_DAYS = 3


/**
 * Что молчит у одного человека.
 *
 * Поле есть — значит об этом есть что сказать. Внутри `days: null` означает
 * «не было никогда». Раньше оба смысла жили в одном `null`, и блок писал
 * «отметок приёма нет ни одной» тому, у кого вовсе нет коробок.
 */
export interface Silence {
  person: Person
  bp?: { days: number | null }
  intake?: { days: number | null }
}

function daysSince(ts: number | null, now: number): number | null {
  if (ts === null) return null
  // Календарными сутками, а не делением на 86 400 000: в ночь перевода часов
  // между двумя полуночами 23 часа, и «четыре дня молчит» превращалось в три.
  // Свой `startOfDay` здесь тоже был — теперь общий, из `days.ts`.
  return Math.max(0, daysBetween(ts, now))
}

/**
 * Кто молчит дольше порога.
 *
 * Возвращает только тех, о ком есть что сказать. Про себя не говорим: свой
 * дневник человек и так видит целиком, а строка «у вас нет измерений четыре
 * дня» рядом с собственным экраном — это уже нытьё.
 */
export function silence(
  people: Person[],
  measurements: Measurement[],
  regimens: Regimen[],
  activePerson: string,
  now: number,
  threshold = SILENCE_DAYS,
): Silence[] {
  const итог: Silence[] = []

  for (const person of people) {
    if (person.id === activePerson) continue

    const свои = measurements.filter((item) => !isGlucose(item) && item.person === person.id)
    const последнее = свои.length ? Math.max(...свои.map((item) => item.ts)) : null

    // Отметки приёма живут в курсах этого человека. Курсов нет — отмечать
    // нечего, и молчание про приём бессмысленно.
    const курсы = regimens.filter((r) => r.person === person.id && (r.times?.length ?? 0) > 0)
    const отметки = курсы.flatMap((r) => r.taken ?? [])
    const последняяОтметка = отметки.length ? Math.max(...отметки) : null

    const bpDays = daysSince(последнее, now)
    const intakeDays = курсы.length === 0 ? null : daysSince(последняяОтметка, now)

    // Молчанием считаем и «никогда не было»: для того, кто только завёл
    // дневник родителю, это тот же вопрос — дошло ли вообще.
    const молчитДавление = свои.length === 0 || (bpDays !== null && bpDays >= threshold)
    const молчитПриём = курсы.length > 0 && (отметки.length === 0 || (intakeDays !== null && intakeDays >= threshold))

    if (молчитДавление || молчитПриём) {
      итог.push({
        person,
        ...(молчитДавление ? { bp: { days: bpDays } } : {}),
        ...(молчитПриём ? { intake: { days: intakeDays } } : {}),
      })
    }
  }

  return итог
}

/** Строка про один вид молчания. `null` — говорить не о чем. */
export function silenceText(days: number | null, kind: 'bp' | 'intake'): string | null {
  const что = kind === 'bp' ? 'измерений' : 'отметок приёма'
  if (days === null) return `${что} нет ни одной`
  if (days === 0) return null
  if (days === 1) return `${что} нет со вчера`
  return `${что} нет ${days} ${plural(days, 'день', 'дня', 'дней')}`
}
