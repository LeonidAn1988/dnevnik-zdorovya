import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { десятичное } from '../logic/plural'
import { GLUCOSE_CONTEXT_LABELS, type BpReading, type GlucoseReading } from '../types'
import { dailyAverages, dailyGlucose, glucoseMovingAverage, movingAverage } from '../logic/stats'
import { DAY_PART_LABELS, dayPart, type DayPart, type GlucoseTargets } from '../logic/classify'

const DATE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })
const TIME = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })
const DATE_YEAR = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
const FULL_DATE = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })

function useSize() {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 300, font: 12 })
  useLayoutEffect(() => {
    const node = ref.current!
    const update = () => {
      const font = parseFloat(getComputedStyle(node).fontSize)
      setSize({ width: node.getBoundingClientRect().width, font })
    }
    const observer = new ResizeObserver(update)
    observer.observe(node)
    // Text size changes can leave the container's width unchanged.
    const attributes = new MutationObserver(update)
    attributes.observe(document.documentElement, { attributes: true, attributeFilter: ['data-text', 'style', 'class'] })
    update()
    return () => { observer.disconnect(); attributes.disconnect() }
  }, [])
  return [ref, size] as const
}

const day = (ts: number) => new Date(ts).setHours(0, 0, 0, 0)
function consecutive(a: number, b: number) {
  const next = new Date(day(a)); next.setDate(next.getDate() + 1)
  return next.getTime() === day(b)
}

/** Daily summaries belong at the last actual measurement of that day, not before it at midnight. */
function positionDaily<T extends { ts: number }>(points: T[], readings: { ts: number }[]): T[] {
  const last = new Map<number, number>()
  for (const r of readings) last.set(day(r.ts), Math.max(last.get(day(r.ts)) ?? -Infinity, r.ts))
  return points.map(p => ({ ...p, ts: last.get(day(p.ts))! }))
}

interface Series { label: string; color: string; values: number[]; trend: { ts: number; value: number }[] }
interface Guide { value: number; label: string; color: string }

/** Shared layout keeps axes and dates readable in narrow cards and with enlarged text. */
function TimeChart({ readings, series, guides = [], title, empty, detail, step, compact = false }: {
  readings: { id: string; ts: number }[]; series: Series[]; guides?: Guide[]; title: string; empty: string;
  detail: (index: number) => string; step: number; compact?: boolean
}) {
  const [ref, { width, font }] = useSize()
  const [selected, setSelected] = useState<string | null>(null)
  const chosen = readings.findIndex(r => r.id === selected)
  const selectedIndex = chosen >= 0 ? chosen : readings.reduce((latest, r, i) => r.ts > readings[latest].ts ? i : latest, 0)
  const height = compact ? 190 : 260
  const pad = { top: 14, right: 12, bottom: font * 2 + 12, left: font * 3.2 + 8 }
  const plotW = Math.max(1, width - pad.left - pad.right)
  const plotH = height - pad.top - pad.bottom
  const allValues = [...series.flatMap(s => s.values), ...guides.map(g => g.value)]
  const min = Math.max(0, Math.floor((Math.min(...allValues) - step / 2) / step) * step)
  const max = Math.ceil((Math.max(...allValues) + step / 2) / step) * step
  const times = readings.map(r => r.ts)
  const timestampCounts = new Map<number, number>()
  for (const ts of times) timestampCounts.set(ts, (timestampCounts.get(ts) ?? 0) + 1)
  let start = Math.min(...times), end = Math.max(...times)
  // A single measurement is centred; dates never extend into an invented extra day.
  if (start === end) { start -= 30 * 60_000; end += 30 * 60_000 }
  const x = (ts: number) => pad.left + (ts - start) / (end - start) * plotW
  const y = (value: number) => pad.top + plotH - (value - min) / (max - min) * plotH
  const sameDay = day(Math.min(...times)) === day(Math.max(...times))
  const multiYear = new Date(Math.min(...times)).getFullYear() !== new Date(Math.max(...times)).getFullYear()
  const dateFormat = multiYear ? DATE_YEAR : DATE
  const format = (ts: number) => (sameDay ? TIME : dateFormat).format(ts)
  const count = plotW >= font * 34 ? 5 : plotW >= font * 21 ? 3 : 2
  const dateTicks = (readings.length === 0 ? [] : new Set(times).size === 1 ? [times[0]] : Array.from({ length: count }, (_, i) => start + i / (count - 1) * (end - start)))
    .filter((ts, i, ticks) => ticks.findIndex(t => format(t) === format(ts)) === i)
  const tickStep = Math.max(step, Math.ceil((max - min) / (plotH / (font * 2.4)) / step) * step)
  const ticks = []
  for (let value = min; value <= max; value += tickStep) ticks.push(value)
  const nearest = (event: React.PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const px = event.clientX - box.left + pad.left
    const py = event.clientY - box.top + pad.top
    let best = Infinity, index = 0
    readings.forEach((r, i) => {
      const distance = Math.min(...series.map(s => Math.hypot(x(r.ts) - px, y(s.values[i]) - py)))
      if (distance < best) { best = distance; index = i }
    })
    setSelected(readings[index].id)
  }
  return <div className="chart" ref={ref}>
    {!readings.length ? <div className="chart__empty">{empty}</div> : <>
      <div className="chart__legend">
        {series.map(s => <span className="badge" key={s.label} style={{ ['--dot' as string]: s.color }}><span className="badge__dot" />{s.label}</span>)}
      </div>
      {guides.length > 0 && <div className="chart__guides">{guides.map((g, i) => <span key={i}>{g.label}</span>)}</div>}
      <svg height={height} role="img" aria-label={title}>
        <title>{title}</title>
        <desc>Точки — отдельные измерения. Линия прерывается в дни без измерений. Значения доступны в списке под графиком.</desc>
        {ticks.map(t => <g key={t}>
          <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
          <text x={pad.left - 8} y={y(t) + font * .35} textAnchor="end" className="chart__tick" fill="var(--text-muted)">{Number.isInteger(t) ? t : десятичное(t)}</text>
        </g>)}
        {dateTicks.map((ts, i) => <text key={ts} x={x(ts)} y={height - font * .6}
          textAnchor={i === 0 ? 'start' : i === dateTicks.length - 1 ? 'end' : 'middle'} className="chart__tick" fill="var(--text-muted)">{format(ts)}</text>)}
        {guides.map((g, i) => <line key={i} x1={pad.left} x2={width - pad.right} y1={y(g.value)} y2={y(g.value)} stroke={g.color} strokeDasharray="5 5" opacity=".65" />)}
        {series.map(s => <g key={s.label}>
          <path d={s.trend.map((p, i) => `${i && consecutive(s.trend[i - 1].ts, p.ts) ? 'L' : 'M'}${x(p.ts)},${y(p.value)}`).join(' ')} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" />
          {readings.map((r, i) => <circle key={r.id} cx={x(r.ts)} cy={y(s.values[i])} r="3.5" fill={s.color} opacity=".65" />)}
          {s.trend.map(p => <circle key={p.ts} cx={x(p.ts)} cy={y(p.value)} r="4" fill={s.color} stroke="var(--surface)" strokeWidth="1.5" />)}
        </g>)}
        {selected && readings.some(r => r.id === selected) && <line x1={x(readings[selectedIndex].ts)} x2={x(readings[selectedIndex].ts)} y1={pad.top} y2={pad.top + plotH} stroke="var(--axis)" />}
        <rect x={pad.left} y={pad.top} width={plotW} height={plotH} fill="transparent" onPointerDown={nearest} onPointerMove={e => { if (e.pointerType === 'mouse' || e.buttons) nearest(e) }} style={{ touchAction: 'pan-y' }} />
      </svg>
      <div className="chart__period muted">{dateFormat.format(Math.min(...times))}{!sameDay && ` — ${dateFormat.format(Math.max(...times))}`}</div>
      <label className="chart__reading">Измерение
        <select value={readings[selectedIndex].id} onChange={e => setSelected(e.target.value)}>
          {readings.map((r, i) => <option key={r.id} value={r.id}>{FULL_DATE.format(r.ts)}{timestampCounts.get(r.ts)! > 1 ? ` · ${detail(i)}` : ''}</option>)}
        </select>
      </label>
      <p className="chart__detail" aria-live="polite">{detail(selectedIndex)}</p>
    </>}
  </div>
}

export function TrendChart({ readings, targetSys, targetDia }: { readings: BpReading[]; targetSys: number; targetDia: number }) {
  const trend = useMemo(() => positionDaily(movingAverage(dailyAverages(readings), 7), readings), [readings])
  const series = [
    { label: 'Верхнее', color: 'var(--series-sys)', key: 'sys' as const },
    { label: 'Нижнее', color: 'var(--series-dia)', key: 'dia' as const },
  ].map(s => ({ ...s, values: readings.map(r => r[s.key]), trend: trend.map(p => ({ ts: p.ts, value: p[s.key] })) }))
  return <TimeChart readings={readings} series={series} step={20} title="Давление, мм рт. ст.; среднее за 7 дней" empty="Нет измерений за выбранный период"
    guides={[{ value: targetSys, label: `Цель верхнего: ${targetSys}`, color: 'var(--series-sys)' }, { value: targetDia, label: `Цель нижнего: ${targetDia}`, color: 'var(--series-dia)' }]}
    detail={i => `${readings[i].sys}/${readings[i].dia} мм рт. ст.${readings[i].bpm ? `; пульс ${readings[i].bpm}` : ''}`} />
}

export function PulseChart({ readings }: { readings: BpReading[] }) {
  const withPulse = useMemo(() => readings.filter(r => typeof r.bpm === 'number' && r.bpm > 0), [readings])
  const daily = positionDaily(dailyAverages(withPulse), withPulse)
  return <TimeChart readings={withPulse} series={[{ label: 'Пульс · среднее за день', color: 'var(--series-bpm)', values: withPulse.map(r => r.bpm!), trend: daily.map(p => ({ ts: p.ts, value: p.bpm! })) }]}
    step={10} compact title="Пульс, ударов в минуту" empty="За выбранный период пульс не записан" detail={i => `${withPulse[i].bpm} уд/мин`} />
}

/** Paired zero-based bars with HTML labels: numbers cannot collide inside a narrow SVG. */
export function DayPartChart({ readings }: { readings: BpReading[] }) {
  const groups = (['morning', 'day', 'evening', 'night'] as DayPart[]).map(part => {
    const subset = readings.filter(r => dayPart(new Date(r.ts)) === part)
    return { part, label: DAY_PART_LABELS[part], count: subset.length,
      sys: subset.reduce((sum, r) => sum + r.sys, 0) / subset.length,
      dia: subset.reduce((sum, r) => sum + r.dia, 0) / subset.length }
  }).filter(g => g.count)
  if (!groups.length) return <div className="chart__empty">Нет измерений за выбранный период</div>
  const max = Math.ceil(Math.max(...groups.flatMap(g => [g.sys, g.dia])) / 20) * 20
  return <div className="chart chart--parts">
    <p className="muted">Среднее давление, мм рт. ст. Верхнее / нижнее.</p>
    {groups.map(g => <div className="chart__part" key={g.part}>
      <div className="chart__part-head"><span>{g.label}</span><strong>{Math.round(g.sys)} / {Math.round(g.dia)}</strong></div>
      <div className="chart__bars" aria-hidden="true"><span style={{ width: `${g.sys / max * 100}%`, background: 'var(--series-sys)' }} /><span style={{ width: `${g.dia / max * 100}%`, background: 'var(--series-dia)' }} /></div>
      <span className="muted">Измерений: {g.count}</span>
    </div>)}
    <p className="muted">Длина полос — от 0 до {max} мм рт. ст.</p>
  </div>
}

export function GlucoseChart({ readings, targets }: { readings: GlucoseReading[]; targets: GlucoseTargets }) {
  const trend = useMemo(() => positionDaily(glucoseMovingAverage(dailyGlucose(readings), 7), readings), [readings])
  return <TimeChart readings={readings} series={[{ label: 'Сахар · среднее за 7 дней', color: 'var(--series-bpm)', values: readings.map(r => r.mmol), trend: trend.map(p => ({ ts: p.ts, value: p.mmol })) }]}
    step={2} title="Сахар, ммоль/л; среднее за 7 дней для всех моментов замера" empty="Нет замеров сахара за выбранный период"
    guides={[{ value: targets.postMealMax, label: `После еды: ниже ${десятичное(targets.postMealMax)}`, color: 'var(--series-bpm)' },
      { value: targets.fastingMax, label: `Натощак: ниже ${десятичное(targets.fastingMax)}`, color: 'var(--series-bpm)' },
      { value: targets.low, label: `Низкий: ниже ${десятичное(targets.low)}`, color: 'var(--series-bpm)' }]}
    detail={i => `${десятичное(readings[i].mmol)} ммоль/л · ${GLUCOSE_CONTEXT_LABELS[readings[i].context]}`} />
}
