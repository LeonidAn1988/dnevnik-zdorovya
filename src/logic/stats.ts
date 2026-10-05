import { addDays } from './days'
import type { BpReading, GlucoseContext, GlucoseReading } from '../types'
import { dayPart, glucoseCeiling, isWithinTarget, type DayPart, type GlucoseTargets } from './classify'

// ── общее ядро ─────────────────────────────────────────────────────────────

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length

function sd(values: number[]): number {
  if (values.length < 2) return 0
  const m = mean(values)
  return Math.sqrt(values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1))
}

/** Описательная статистика одного числового ряда — общая для давления и сахара. */
export interface Series {
  count: number
  avg: number
  min: number
  max: number
  sd: number
}

export function describe(values: number[]): Series | null {
  if (values.length === 0) return null
  return { count: values.length, avg: mean(values), min: Math.min(...values), max: Math.max(...values), sd: sd(values) }
}

/** Группировка по календарным дням — база для линий тренда в обоих дневниках. */
function byDay<T extends { ts: number }>(items: T[]): Map<number, T[]> {
  const buckets = new Map<number, T[]>()
  for (const item of items) {
    const date = new Date(item.ts)
    const key = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
    else buckets.set(key, [item])
  }
  return buckets
}

export type PeriodKey = '7d' | '30d' | '90d' | 'all'

export const PERIODS: { key: PeriodKey; label: string; days: number | null }[] = [
  { key: '7d', label: '7 дней', days: 7 },
  { key: '30d', label: '30 дней', days: 30 },
  { key: '90d', label: '90 дней', days: 90 },
  { key: 'all', label: 'Всё время', days: null },
]

/** Отчёт врачу период не ограничивает — «Всё время» всегда доступно. */
export function filterByPeriod<T extends { ts: number }>(items: T[], period: PeriodKey): T[] {
  const config = PERIODS.find((p) => p.key === period)
  if (!config?.days) return items
  const now = Date.now()
  const cutoff = now - config.days * 86_400_000
  return items.filter((item) => item.ts >= cutoff && item.ts <= now)
}

// ── давление ───────────────────────────────────────────────────────────────

export interface Aggregate {
  count: number
  sys: number
  dia: number
  bpm: number | null
}

export interface Summary {
  count: number
  /**
   * В скольких календарных днях есть хоть одно измерение.
   *
   * Само по себе среднее ничего не говорит о том, на чём оно посчитано.
   * Три записи за месяц дают такое же «145/92», как тридцать, и человек,
   * вернувшийся после перерыва, читает это как приговор себе за весь месяц.
   * Число дней ставится рядом со средним, чтобы цифра была подписана тем,
   * из чего она сделана.
   */
  days: number
  avgSys: number
  avgDia: number
  avgBpm: number | null
  minSys: number
  maxSys: number
  minDia: number
  maxDia: number
  /** Стандартное отклонение систолического — мера вариабельности давления. */
  sdSys: number
  sdDia: number
  /** Доля измерений в целевом диапазоне, 0..1. */
  withinTarget: number
  ihbCount: number
  movCount: number
  byDayPart: Partial<Record<DayPart, Aggregate>>
  /** Утреннее среднее минус вечернее по систолическому. */
  morningEveningDelta: number | null
  firstTs: number
  lastTs: number
}

function aggregate(readings: BpReading[]): Aggregate {
  const pulses = readings.map((r) => r.bpm).filter((b): b is number => typeof b === 'number' && b > 0)
  return {
    count: readings.length,
    sys: mean(readings.map((r) => r.sys)),
    dia: mean(readings.map((r) => r.dia)),
    bpm: pulses.length ? mean(pulses) : null,
  }
}

export function summarize(readings: BpReading[], targetSys: number, targetDia: number): Summary | null {
  if (readings.length === 0) return null

  const sysStats = describe(readings.map((r) => r.sys))!
  const diaStats = describe(readings.map((r) => r.dia))!
  const base = aggregate(readings)

  const byDayPart: Partial<Record<DayPart, Aggregate>> = {}
  for (const part of ['night', 'morning', 'day', 'evening'] as DayPart[]) {
    const subset = readings.filter((r) => dayPart(new Date(r.ts)) === part)
    if (subset.length) byDayPart[part] = aggregate(subset)
  }

  const morning = byDayPart.morning
  const evening = byDayPart.evening

  return {
    count: readings.length,
    days: new Set(
      readings.map((r) => {
        const d = new Date(r.ts)
        return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
      }),
    ).size,
    avgSys: base.sys,
    avgDia: base.dia,
    avgBpm: base.bpm,
    minSys: sysStats.min,
    maxSys: sysStats.max,
    minDia: diaStats.min,
    maxDia: diaStats.max,
    sdSys: sysStats.sd,
    sdDia: diaStats.sd,
    withinTarget: readings.filter((r) => isWithinTarget(r.sys, r.dia, targetSys, targetDia)).length / readings.length,
    ihbCount: readings.filter((r) => r.ihb).length,
    movCount: readings.filter((r) => r.mov).length,
    byDayPart,
    morningEveningDelta: morning && evening ? morning.sys - evening.sys : null,
    firstTs: Math.min(...readings.map(r => r.ts)),
    lastTs: Math.max(...readings.map(r => r.ts)),
  }
}

export interface DailyPoint {
  /** Полночь соответствующего дня, epoch ms. */
  ts: number
  sys: number
  dia: number
  bpm: number | null
  count: number
}

export function dailyAverages(readings: BpReading[]): DailyPoint[] {
  return [...byDay(readings).entries()]
    .map(([ts, group]) => {
      const agg = aggregate(group)
      return { ts, sys: agg.sys, dia: agg.dia, bpm: agg.bpm, count: agg.count }
    })
    .sort((a, b) => a.ts - b.ts)
}

/**
 * Окно скользящего среднего: для каждой точки — все точки за последние N дней,
 * считая её саму. Общее для давления и сахара: считаются они по разным полям,
 * но окно у них одно, и разъехаться ему нельзя.
 */
function slidingWindow<T extends { ts: number }>(points: T[], windowDays: number): { point: T; frame: T[] }[] {
  return points.map(point => {
    const from = addDays(new Date(point.ts), 1 - windowDays).getTime()
    return { point, frame: points.filter(p => p.ts >= from && p.ts <= point.ts) }
  })
}

/** Скользящее среднее по дневным точкам, окно в днях. */
export function movingAverage(points: DailyPoint[], windowDays = 7): { ts: number; sys: number; dia: number }[] {
  return slidingWindow(points, windowDays).map(({ point, frame }) => ({
    ts: point.ts,
    sys: mean(frame.map((p) => p.sys)),
    dia: mean(frame.map((p) => p.dia)),
  }))
}

// ── сахар ──────────────────────────────────────────────────────────────────

export interface GlucoseSummary {
  days: number
  median: number
  count: number
  avg: number
  min: number
  max: number
  sd: number
  /** Доля замеров в целевом диапазоне с учётом момента замера, 0..1. */
  withinTarget: number
  /** Сколько раз сахар был ниже порога — самое важное число в диабетическом дневнике. */
  lowCount: number
  highCount: number
  /** Средние по моменту замера: натощак, после еды и так далее. */
  byContext: Partial<Record<GlucoseContext, Series>>
  firstTs: number
  lastTs: number
}

export function summarizeGlucose(readings: GlucoseReading[], targets: GlucoseTargets): GlucoseSummary | null {
  if (readings.length === 0) return null
  const stats = describe(readings.map((r) => r.mmol))!

  const byContext: Partial<Record<GlucoseContext, Series>> = {}
  for (const context of ['fasting', 'before-meal', 'after-meal', 'bedtime', 'night'] as GlucoseContext[]) {
    const subset = readings.filter((r) => r.context === context)
    const described = describe(subset.map((r) => r.mmol))
    if (described) byContext[context] = described
  }

  const withinTarget = readings.filter(
    (r) => r.mmol >= targets.low && r.mmol < glucoseCeiling(r.context, targets),
  ).length

  return {
    days: new Set(readings.map(r => new Date(r.ts).setHours(0,0,0,0))).size,
    median: (() => { const values = readings.map(r => r.mmol).sort((a,b) => a-b); const mid = Math.floor(values.length / 2); return values.length % 2 ? values[mid] : (values[mid-1]+values[mid])/2 })(),
    count: readings.length,
    avg: stats.avg,
    min: stats.min,
    max: stats.max,
    sd: stats.sd,
    withinTarget: withinTarget / readings.length,
    lowCount: readings.filter((r) => r.mmol < targets.low).length,
    highCount: readings.filter((r) => r.mmol >= glucoseCeiling(r.context, targets)).length,
    byContext,
    firstTs: Math.min(...readings.map(r => r.ts)),
    lastTs: Math.max(...readings.map(r => r.ts)),
  }
}

export interface DailyGlucosePoint {
  ts: number
  mmol: number
  count: number
}

export function dailyGlucose(readings: GlucoseReading[]): DailyGlucosePoint[] {
  return [...byDay(readings).entries()]
    .map(([ts, group]) => ({ ts, mmol: mean(group.map((r) => r.mmol)), count: group.length }))
    .sort((a, b) => a.ts - b.ts)
}

export function glucoseMovingAverage(points: DailyGlucosePoint[], windowDays = 7): { ts: number; mmol: number }[] {
  return slidingWindow(points, windowDays).map(({ point, frame }) => ({
    ts: point.ts,
    mmol: mean(frame.map((p) => p.mmol)),
  }))
}
