/**
 * События и сравнение «до и после».
 *
 * Человек мерит давление не ради средних значений, а ради одного вопроса:
 * «врач поменял таблетки — стало лучше?». Приложение на него не отвечало никак:
 * чтобы сравнить, надо помнить дату смены и вручную переключать период, а
 * периодов всего четыре готовых — две недели до и две после не выбрать вовсе.
 *
 * **Где здесь черта.** Сравнение двух средних человек прочтёт как оценку
 * лечения, чего бы мы ни написали. Защита в том, что приложение показывает
 * ровно те же два числа, которые человек получил бы сам, переключив период:
 * оно экономит нажатия, а не делает вывод. Поэтому здесь нет ни слова «лучше»,
 * ни цвета, ни стрелок вверх-вниз — только два средних и, обязательно, из
 * скольких измерений каждое сложено.
 *
 * **И вторая защита — от малых выборок.** Три измерения «после» дадут разницу
 * в двенадцать миллиметров, которой нет. Если измерений мало, средних не
 * показываем вовсе: пустая ячейка честнее красивой цифры.
 */

import type { BpReading } from '../types'
import type { Dosing } from './regimen'
import { doseChangeOn, formatCount, trackedSince } from './medicines'

/** Сколько дней сравниваем по каждую сторону от события. */
export const COMPARE_DAYS = 14

/** Меньше этого числа измерений на стороне — средних не показываем. */
export const COMPARE_MIN = 5

const DAY = 24 * 60 * 60 * 1000

/** Событие: то, от чего человек отсчитывает «до» и «после». */
export interface DiaryEvent {
  /** Устойчивый ключ: строится из происхождения, чтобы не плодиться. */
  id: string
  /** Календарный день события. */
  day: number
  title: string
  /** Откуда взялось: `medicine` — приложение знает само. */
  from: 'medicine' | 'manual'
}

/** Одна сторона сравнения. */
export interface CompareSide {
  count: number
  /** `null` — измерений слишком мало, чтобы называть среднее. */
  avgSys: number | null
  avgDia: number | null
}

export interface Comparison {
  before: CompareSide
  after: CompareSide
  days: number
}

function startOfDay(ts: number): number {
  const date = new Date(ts)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * События, которые приложение знает само.
 *
 * Ничего не выдумываем: день заведения препарата взят из `startedAt`, дни смены
 * дозы — из схемы приёма, которую человек сам и задал. Это не догадки о жизни
 * человека, а то, что он уже записал.
 */
export function medicineEvents(приёмы: Dosing[], now: number, horizonDays = 400): DiaryEvent[] {
  const события: DiaryEvent[] = []
  const начало = startOfDay(now) - horizonDays * DAY

  for (const приём of приёмы) {
    const с = trackedSince(приём, now)
    if (с > начало && с <= now) {
      события.push({
        id: `m:${приём.regimenId}:start`,
        day: startOfDay(с),
        title: `Начали принимать ${приём.name}`,
        from: 'medicine',
      })
    }

    // Дни смены дозы по схеме: «с этого дня по полторы вместо одной».
    for (let day = Math.max(startOfDay(с), начало); day <= startOfDay(now); day += DAY) {
      const смена = doseChangeOn(приём, day)
      if (!смена) continue
      события.push({
        id: `m:${приём.regimenId}:dose:${day}`,
        day,
        title: `${приём.name}: доза ${formatCount(смена.from)} → ${formatCount(смена.to)}`,
        from: 'medicine',
      })
    }
  }

  return события.sort((a, b) => b.day - a.day)
}

/**
 * Сравнить две недели до события и две после.
 *
 * День самого события относим к «после»: если врач поменял назначение утром,
 * вечернее измерение уже про новое лечение.
 */
export function compareAround(readings: BpReading[], day: number, days = COMPARE_DAYS, min = COMPARE_MIN): Comparison {
  const начало = startOfDay(day)
  const левая = readings.filter((r) => r.ts >= начало - days * DAY && r.ts < начало)
  const правая = readings.filter((r) => r.ts >= начало && r.ts < начало + days * DAY)
  return { before: сторона(левая, min), after: сторона(правая, min), days }
}

function сторона(readings: BpReading[], min: number): CompareSide {
  if (readings.length < min) return { count: readings.length, avgSys: null, avgDia: null }
  return {
    count: readings.length,
    avgSys: Math.round(readings.reduce((sum, r) => sum + r.sys, 0) / readings.length),
    avgDia: Math.round(readings.reduce((sum, r) => sum + r.dia, 0) / readings.length),
  }
}

/**
 * Есть ли что показывать.
 *
 * Сравнение без одной из сторон бессмысленно: «после» без «до» — это просто
 * среднее за две недели, которое и так есть на «Обзоре».
 */
export function comparable(comparison: Comparison): boolean {
  return comparison.before.avgSys !== null && comparison.after.avgSys !== null
}
