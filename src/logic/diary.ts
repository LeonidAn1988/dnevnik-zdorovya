/**
 * Дневник самоконтроля по дням — та форма, в которой врач его читает.
 *
 * На приёме двенадцать минут. Плоский список отдаёт врачу по строке на каждое
 * измерение: девяносто дней по три замера — это двести семьдесят строк, и три
 * замера, снятые подряд в одно утро, выглядят в нём как три события. Привычная
 * врачу форма другая: строка — день, колонки — утро, день, вечер, ночь.
 *
 * **Свёртка серии — это обработка данных, и правило обязано быть напечатано
 * рядом с таблицей, а не спрятано в коде.** Поэтому оно вынесено сюда одной
 * константой и одной строкой текста, которые интерфейс и печатает.
 */

import type { BpReading, Regimen } from '../types'
import { dayPart, type DayPart } from './classify'

/** Замеры, снятые не дальше этого промежутка друг от друга, — одна серия. */
export const SERIES_GAP_MIN = 10

/** Как объясняем свёртку человеку и врачу. Печатается рядом с таблицей. */
export const SERIES_RULE = `Замеры, снятые подряд в пределах ${SERIES_GAP_MIN} минут, показаны одной строкой со средним значением: это одно измерение, сделанное несколько раз.`

/** Одна ячейка дня: то, что показано в колонке части суток. */
export interface DiaryCell {
  sys: number
  dia: number
  bpm: number | null
  /** Из скольких замеров сложена. Больше одного — была серия. */
  count: number
  /** Время первого замера серии. */
  time: string
}

/** Строка дневника: один календарный день. */
export interface DiaryDay {
  day: number
  cells: Partial<Record<DayPart, DiaryCell>>
  /** Отмечен ли в этот день хоть один приём лекарств. `null` — отмечать нечего. */
  intake: boolean | null
}

const DAY = 24 * 60 * 60 * 1000

const HHMM = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })

function startOfDay(ts: number): number {
  const date = new Date(ts)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * Свернуть серию в одну ячейку.
 *
 * Среднее, а не первое и не последнее: прибор рекомендуют слушать трижды
 * именно потому, что один замер шумит. Число замеров показываем рядом — врач
 * должен видеть, что за цифрой стоит серия.
 */
function fold(series: BpReading[]): DiaryCell {
  const n = series.length
  const пульсы = series.map((r) => r.bpm).filter((b): b is number => typeof b === 'number' && b > 0)
  return {
    sys: Math.round(series.reduce((sum, r) => sum + r.sys, 0) / n),
    dia: Math.round(series.reduce((sum, r) => sum + r.dia, 0) / n),
    bpm: пульсы.length ? Math.round(пульсы.reduce((a, b) => a + b, 0) / пульсы.length) : null,
    count: n,
    time: HHMM.format(series[0].ts),
  }
}

/**
 * Собрать дневник по дням.
 *
 * Дни идут от свежих к старым — так его листают и на экране, и на бумаге.
 * В одной части суток может оказаться несколько серий; тогда в ячейку идёт
 * первая, а полный список остаётся ниже, под «Подробнее»: исходные цифры мы
 * не прячем никогда.
 */
export function diaryByDays(readings: BpReading[], regimens: Pick<Regimen, 'times' | 'taken'>[] = []): DiaryDay[] {
  const поДням = new Map<number, BpReading[]>()
  for (const reading of readings) {
    const key = startOfDay(reading.ts)
    const bucket = поДням.get(key)
    if (bucket) bucket.push(reading)
    else поДням.set(key, [reading])
  }

  // Отметки приёма — по дням, чтобы врач видел, принимал ли пациент лекарства
  // в тот день, когда давление было высоким.
  const отметки = new Set<number>()
  const есть = regimens.some((r) => (r.times?.length ?? 0) > 0)
  for (const курс of regimens) {
    for (const ts of курс.taken ?? []) отметки.add(startOfDay(ts))
  }

  return [...поДням.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([day, список]) => {
      const cells: Partial<Record<DayPart, DiaryCell>> = {}
      const порядок = [...список].sort((a, b) => a.ts - b.ts)

      let серия: BpReading[] = []
      const закрыть = () => {
        if (серия.length === 0) return
        const part = dayPart(new Date(серия[0].ts))
        // Первая серия в этой части суток и остаётся: вторая — редкость, и
        // затирать ею первую нельзя. Обе видны в подробном списке ниже.
        if (!cells[part]) cells[part] = fold(серия)
        серия = []
      }
      for (const reading of порядок) {
        const предыдущий = серия[серия.length - 1]
        if (предыдущий && reading.ts - предыдущий.ts <= SERIES_GAP_MIN * 60_000) серия.push(reading)
        else {
          закрыть()
          серия = [reading]
        }
      }
      закрыть()

      return { day, cells, intake: есть ? отметки.has(day) : null }
    })
}

/** Сколько дней в периоде оказались без единого измерения. */
export function daysMissed(days: DiaryDay[]): number {
  if (days.length < 2) return 0
  const первый = days[days.length - 1].day
  const последний = days[0].day
  const всего = Math.round((последний - первый) / DAY) + 1
  return Math.max(0, всего - days.length)
}
