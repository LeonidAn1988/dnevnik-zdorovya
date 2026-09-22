import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { десятичное } from '../logic/plural'
import { GLUCOSE_CONTEXT_LABELS, type BpReading, type GlucoseReading } from '../types'
import { dailyAverages, dailyGlucose, glucoseMovingAverage, movingAverage } from '../logic/stats'
import { DAY_PART_LABELS, dayPart, type DayPart, type GlucoseTargets } from '../logic/classify'

const SHORT_DATE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })
const FULL_DATE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })

/** Ширина контейнера в реальных пикселях — чтобы подписи не растягивались вместе с viewBox. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(640)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(node)
    setWidth(node.getBoundingClientRect().width)
    return () => observer.disconnect()
  }, [])
  return [ref, Math.max(width, 260)] as const
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="chart__legend">
      {items.map((item) => (
        <span className="badge" key={item.label} style={{ ['--dot' as string]: item.color }}>
          <span className="badge__dot" />
          {item.label}
        </span>
      ))}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="chart__empty">{text}</div>
}

/** Шкала подписей оси Y круглыми числами. Шаг разный: давление в десятках, сахар в единицах. */
function yTicks(min: number, max: number, step = 20): number[] {
  const ticks: number[] = []
  for (let value = Math.ceil(min / step) * step; value <= max; value += step) ticks.push(value)
  return ticks
}

interface Hover {
  x: number
  y: number
  reading: BpReading
}

// ── Тренд давления ─────────────────────────────────────────────────────────

export function TrendChart({
  readings,
  targetSys,
  targetDia,
}: {
  readings: BpReading[]
  targetSys: number
  targetDia: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<Hover | null>(null)

  const height = 268
  // right держит только подпись конца тренда: целевые линии подписаны внутри
  // плоскости слева, иначе на 13px они сталкиваются с этой же подписью.
  const pad = { top: 16, right: 42, bottom: 30, left: 40 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom

  const model = useMemo(() => {
    if (readings.length === 0) return null
    const daily = dailyAverages(readings)
    const trend = movingAverage(daily, 7)

    const times = readings.map((r) => r.ts)
    const tMin = Math.min(...times)
    const tMax = Math.max(...times)
    const span = tMax - tMin || 86_400_000

    const values = [...readings.map((r) => r.sys), ...readings.map((r) => r.dia), targetSys, targetDia]
    const yMin = Math.max(0, Math.floor((Math.min(...values) - 10) / 10) * 10)
    const yMax = Math.ceil((Math.max(...values) + 10) / 10) * 10

    return { daily, trend, tMin, span, yMin, yMax }
  }, [readings, targetSys, targetDia])

  const x = useCallback((ts: number) => (model ? pad.left + ((ts - model.tMin) / model.span) * plotW : 0), [model, plotW, pad.left])
  const y = useCallback(
    (value: number) => (model ? pad.top + plotH - ((value - model.yMin) / (model.yMax - model.yMin)) * plotH : 0),
    [model, plotH, pad.top],
  )

  const onMove = (event: React.PointerEvent<SVGRectElement>) => {
    if (!model) return
    const box = event.currentTarget.getBoundingClientRect()
    const px = event.clientX - box.left + pad.left
    let nearest = readings[0]
    let best = Infinity
    for (const reading of readings) {
      const distance = Math.abs(x(reading.ts) - px)
      if (distance < best) {
        best = distance
        nearest = reading
      }
    }
    setHover({ x: x(nearest.ts), y: y(nearest.sys), reading: nearest })
  }

  if (!model) return <Empty text="Нет измерений за выбранный период" />

  const series = [
    { key: 'sys' as const, label: 'Систолическое (верхнее)', color: 'var(--series-sys)', target: targetSys },
    { key: 'dia' as const, label: 'Диастолическое (нижнее)', color: 'var(--series-dia)', target: targetDia },
  ]

  // На узком экране пять подписей дат налезают друг на друга — оставляем три.
  const dateTicks = (width < 520 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map((f) => model.tMin + f * model.span)

  return (
    <div className="chart" ref={ref}>
      <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />
      <svg height={height} role="img" aria-label="График систолического и диастолического давления по времени">
        {yTicks(model.yMin, model.yMax).map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={pad.left + plotW} y1={y(tick)} y2={y(tick)} stroke="var(--grid)" strokeWidth="1" />
            <text x={pad.left - 8} y={y(tick) + 4} textAnchor="end" className="chart__tick" fill="var(--text-muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {tick}
            </text>
          </g>
        ))}

        {dateTicks.map((ts, i) => (
          <text
            key={i}
            x={x(ts)}
            y={height - 8}
            textAnchor={i === 0 ? 'start' : i === dateTicks.length - 1 ? 'end' : 'middle'}
            className="chart__tick"
            fill="var(--text-muted)"
          >
            {SHORT_DATE.format(ts)}
          </text>
        ))}

        {/* Целевые уровни — ориентир, назначенный врачом или домашняя норма 135/85 */}
        {series.map((s) => (
          <g key={`target-${s.key}`}>
            <line
              x1={pad.left}
              x2={pad.left + plotW}
              y1={y(s.target)}
              y2={y(s.target)}
              stroke={s.color}
              strokeWidth="1"
              opacity="0.45"
            />
            <text x={pad.left + 4} y={y(s.target) - 5} className="chart__tick" fill="var(--text-muted)">
              цель {s.target}
            </text>
          </g>
        ))}

        {/* Отдельные измерения — облако плотности под линией тренда */}
        {series.map((s) =>
          readings.map((reading) => (
            <circle key={`${s.key}-${reading.id}`} cx={x(reading.ts)} cy={y(reading[s.key])} r="2.8" fill={s.color} opacity="0.42" />
          )),
        )}

        {/* Скользящее среднее за 7 дней */}
        {model.trend.length > 1 &&
          series.map((s) => {
            const path = model.trend.map((p, i) => `${i ? 'L' : 'M'}${x(p.ts).toFixed(1)},${y(p[s.key]).toFixed(1)}`).join(' ')
            const last = model.trend[model.trend.length - 1]
            return (
              <g key={`trend-${s.key}`}>
                <path d={path} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                <circle cx={x(last.ts)} cy={y(last[s.key])} r="4.5" fill={s.color} stroke="var(--surface)" strokeWidth="2" />
                <text
                  x={x(last.ts) + 9}
                  y={y(last[s.key]) + 5}
                  className="chart__label"
                  fontWeight="600"
                  fill="var(--text-primary)"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {Math.round(last[s.key])}
                </text>
              </g>
            )
          })}

        {hover && <line x1={hover.x} x2={hover.x} y1={pad.top} y2={pad.top + plotH} stroke="var(--axis)" strokeWidth="1" />}

        <rect
          x={pad.left}
          y={pad.top}
          width={Math.max(plotW, 0)}
          height={plotH}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          style={{ touchAction: 'pan-y' }}
        />
      </svg>

      {hover && (
        <div
          className="chart__tooltip"
          style={{ left: Math.min(Math.max(hover.x - 60, 0), Math.max(width - 150, 0)), top: Math.max(hover.y - 76, 0) }}
        >
          <div className="muted">{FULL_DATE.format(hover.reading.ts)}</div>
          <div>
            <b>{hover.reading.sys}</b> / <b>{hover.reading.dia}</b> мм рт. ст.
          </div>
          {hover.reading.bpm ? <div>Пульс {hover.reading.bpm}</div> : null}
        </div>
      )}
    </div>
  )
}

// ── Пульс ──────────────────────────────────────────────────────────────────

export function PulseChart({ readings }: { readings: BpReading[] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const height = 160
  const pad = { top: 12, right: 42, bottom: 28, left: 40 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom

  const withPulse = useMemo(() => readings.filter((r) => typeof r.bpm === 'number' && r.bpm > 0), [readings])

  const model = useMemo(() => {
    if (withPulse.length === 0) return null
    const daily = dailyAverages(withPulse).filter((p) => p.bpm !== null)
    const times = withPulse.map((r) => r.ts)
    const tMin = Math.min(...times)
    const span = Math.max(...times) - tMin || 86_400_000
    const pulses = withPulse.map((r) => r.bpm!)
    const yMin = Math.max(0, Math.floor((Math.min(...pulses) - 8) / 10) * 10)
    const yMax = Math.ceil((Math.max(...pulses) + 8) / 10) * 10
    return { daily, tMin, span, yMin, yMax }
  }, [withPulse])

  if (!model) return <Empty text="Нет данных о пульсе за выбранный период" />

  const x = (ts: number) => pad.left + ((ts - model.tMin) / model.span) * plotW
  const y = (value: number) => pad.top + plotH - ((value - model.yMin) / (model.yMax - model.yMin)) * plotH
  const path = model.daily.map((p, i) => `${i ? 'L' : 'M'}${x(p.ts).toFixed(1)},${y(p.bpm!).toFixed(1)}`).join(' ')
  const last = model.daily[model.daily.length - 1]

  return (
    <div className="chart" ref={ref}>
      <svg height={height} role="img" aria-label="График пульса по времени">
        {yTicks(model.yMin, model.yMax).map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={pad.left + plotW} y1={y(tick)} y2={y(tick)} stroke="var(--grid)" strokeWidth="1" />
            <text x={pad.left - 8} y={y(tick) + 4} textAnchor="end" className="chart__tick" fill="var(--text-muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {tick}
            </text>
          </g>
        ))}

        {[0, 0.5, 1].map((f, i) => (
          <text
            key={i}
            x={x(model.tMin + f * model.span)}
            y={height - 8}
            textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
            className="chart__tick"
            fill="var(--text-muted)"
          >
            {SHORT_DATE.format(model.tMin + f * model.span)}
          </text>
        ))}

        {withPulse.map((reading) => (
          <circle key={reading.id} cx={x(reading.ts)} cy={y(reading.bpm!)} r="2.6" fill="var(--series-bpm)" opacity="0.42" />
        ))}

        {model.daily.length > 1 && (
          <path d={path} fill="none" stroke="var(--series-bpm)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        )}
        {last && (
          <>
            <circle cx={x(last.ts)} cy={y(last.bpm!)} r="4.5" fill="var(--series-bpm)" stroke="var(--surface)" strokeWidth="2" />
            <text
              x={x(last.ts) + 9}
              y={y(last.bpm!) + 5}
              className="chart__label"
              fontWeight="600"
              fill="var(--text-primary)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {Math.round(last.bpm!)}
            </text>
          </>
        )}
      </svg>
    </div>
  )
}

// ── Средние по времени суток ───────────────────────────────────────────────

/** Столбик со скруглённой шапкой и прямым основанием. */
function columnPath(cx: number, top: number, bottom: number, w: number, r = 4) {
  const half = w / 2
  const radius = Math.min(r, Math.max((bottom - top) / 2, 0), half)
  return [
    `M${cx - half},${bottom}`,
    `L${cx - half},${top + radius}`,
    `Q${cx - half},${top} ${cx - half + radius},${top}`,
    `L${cx + half - radius},${top}`,
    `Q${cx + half},${top} ${cx + half},${top + radius}`,
    `L${cx + half},${bottom}`,
    'Z',
  ].join(' ')
}

export function DayPartChart({ readings }: { readings: BpReading[] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  // bottom вырос под две строки подписей: название части суток и часы с числом измерений.
  const height = 214
  const pad = { top: 22, right: 8, bottom: 46, left: 40 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom

  const groups = useMemo(() => {
    const order: DayPart[] = ['morning', 'day', 'evening', 'night']
    return order
      .map((part) => {
        const subset = readings.filter((r) => dayPart(new Date(r.ts)) === part)
        if (subset.length === 0) return null
        return {
          part,
          label: DAY_PART_LABELS[part].replace(/\s*\(.*\)/, ''),
          hours: DAY_PART_LABELS[part].match(/\((.*)\)/)?.[1] ?? '',
          sys: subset.reduce((a, r) => a + r.sys, 0) / subset.length,
          dia: subset.reduce((a, r) => a + r.dia, 0) / subset.length,
          count: subset.length,
        }
      })
      .filter((g): g is NonNullable<typeof g> => g !== null)
  }, [readings])

  if (groups.length === 0) return <Empty text="Нет измерений за выбранный период" />

  const yMax = Math.ceil((Math.max(...groups.map((g) => g.sys)) + 15) / 20) * 20
  const y = (value: number) => pad.top + plotH - (value / yMax) * plotH
  const band = plotW / groups.length
  const barW = Math.min(24, band / 2 - 3) // 2px воздуха между соседними столбиками

  return (
    <div className="chart" ref={ref}>
      <Legend
        items={[
          { label: 'Систолическое', color: 'var(--series-sys)' },
          { label: 'Диастолическое', color: 'var(--series-dia)' },
        ]}
      />
      <svg height={height} role="img" aria-label="Среднее давление по времени суток">
        {yTicks(0, yMax).map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={pad.left + plotW} y1={y(tick)} y2={y(tick)} stroke="var(--grid)" strokeWidth="1" />
            <text x={pad.left - 8} y={y(tick) + 4} textAnchor="end" className="chart__tick" fill="var(--text-muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {tick}
            </text>
          </g>
        ))}

        {groups.map((group, i) => {
          const center = pad.left + band * (i + 0.5)
          const bars = [
            { value: group.sys, color: 'var(--series-sys)', cx: center - barW / 2 - 1 },
            { value: group.dia, color: 'var(--series-dia)', cx: center + barW / 2 + 1 },
          ]
          return (
            <g key={group.part}>
              {bars.map((bar, j) => (
                <g key={j}>
                  <path d={columnPath(bar.cx, y(bar.value), pad.top + plotH, barW)} fill={bar.color} />
                  {/* Столбики шириной 24px с зазором 2px: на 13px соседние числа
                      сливаются, поэтому здесь потолок кегля — 12px. */}
                  <text
                    x={bar.cx}
                    y={y(bar.value) - 7}
                    textAnchor="middle"
                    className="chart__tick"
                    fontWeight="600"
                    fill="var(--text-primary)"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {Math.round(bar.value)}
                  </text>
                </g>
              ))}
              <text x={center} y={height - 26} textAnchor="middle" className="chart__label" fill="var(--text-secondary)">
                {group.label}
              </text>
              <text x={center} y={height - 8} textAnchor="middle" className="chart__tick" fill="var(--text-muted)">
                {group.hours} · {group.count}
              </text>
            </g>
          )
        })}

        <line x1={pad.left} x2={pad.left + plotW} y1={pad.top + plotH} y2={pad.top + plotH} stroke="var(--axis)" strokeWidth="1" />
      </svg>
    </div>
  )
}

// ── Тренд сахара ───────────────────────────────────────────────────────────

/**
 * Точки замеров и скользящее среднее за 7 дней. Две целевые линии вместо одной:
 * норма натощак и норма через два часа после еды — это разные пороги, и без обеих
 * график вводил бы в заблуждение.
 */
export function GlucoseChart({
  readings,
  targets,
}: {
  readings: GlucoseReading[]
  targets: GlucoseTargets
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<{ x: number; y: number; reading: GlucoseReading } | null>(null)

  const height = 250
  const pad = { top: 16, right: 42, bottom: 30, left: 40 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom

  const model = useMemo(() => {
    if (readings.length === 0) return null
    const daily = dailyGlucose(readings)
    const trend = glucoseMovingAverage(daily, 7)
    const times = readings.map((r) => r.ts)
    const tMin = Math.min(...times)
    const span = Math.max(...times) - tMin || 86_400_000
    const values = [...readings.map((r) => r.mmol), targets.low, targets.postMealMax]
    const yMin = Math.max(0, Math.floor(Math.min(...values) - 1))
    const yMax = Math.ceil(Math.max(...values) + 1)
    return { daily, trend, tMin, span, yMin, yMax }
  }, [readings, targets])

  if (!model) return <Empty text="Нет замеров сахара за выбранный период" />

  const x = (ts: number) => pad.left + ((ts - model.tMin) / model.span) * plotW
  const y = (value: number) => pad.top + plotH - ((value - model.yMin) / (model.yMax - model.yMin)) * plotH

  const onMove = (event: React.PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const px = event.clientX - box.left + pad.left
    let nearest = readings[0]
    let best = Infinity
    for (const reading of readings) {
      const distance = Math.abs(x(reading.ts) - px)
      if (distance < best) {
        best = distance
        nearest = reading
      }
    }
    setHover({ x: x(nearest.ts), y: y(nearest.mmol), reading: nearest })
  }

  const path = model.trend.map((p, i) => `${i ? 'L' : 'M'}${x(p.ts).toFixed(1)},${y(p.mmol).toFixed(1)}`).join(' ')
  const last = model.trend[model.trend.length - 1]
  const dateTicks = (width < 520 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map((f) => model.tMin + f * model.span)

  const guides = [
    { value: targets.postMealMax, label: `после еды ниже ${десятичное(targets.postMealMax)}` },
    { value: targets.fastingMax, label: `натощак ниже ${десятичное(targets.fastingMax)}` },
    { value: targets.low, label: `низкий ниже ${десятичное(targets.low)}` },
  ]

  return (
    <div className="chart" ref={ref}>
      <svg height={height} role="img" aria-label="График уровня сахара по времени">
        {yTicks(model.yMin, model.yMax, model.yMax - model.yMin > 14 ? 5 : 2).map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={pad.left + plotW} y1={y(tick)} y2={y(tick)} stroke="var(--grid)" strokeWidth="1" />
            <text x={pad.left - 8} y={y(tick) + 4} textAnchor="end" className="chart__tick" fill="var(--text-muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {tick}
            </text>
          </g>
        ))}

        {dateTicks.map((ts, i) => (
          <text
            key={i}
            x={x(ts)}
            y={height - 8}
            textAnchor={i === 0 ? 'start' : i === dateTicks.length - 1 ? 'end' : 'middle'}
            className="chart__tick"
            fill="var(--text-muted)"
          >
            {SHORT_DATE.format(ts)}
          </text>
        ))}

        {guides.map((guide) => (
          <g key={guide.label}>
            <line
              x1={pad.left}
              x2={pad.left + plotW}
              y1={y(guide.value)}
              y2={y(guide.value)}
              stroke="var(--series-bpm)"
              strokeWidth="1"
              opacity="0.4"
            />
            <text x={pad.left + 4} y={y(guide.value) - 5} className="chart__tick" fill="var(--text-muted)">
              {guide.label}
            </text>
          </g>
        ))}

        {readings.map((reading) => (
          <circle key={reading.id} cx={x(reading.ts)} cy={y(reading.mmol)} r="3" fill="var(--series-bpm)" opacity="0.45" />
        ))}

        {model.trend.length > 1 && (
          <path d={path} fill="none" stroke="var(--series-bpm)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        )}
        {last && (
          <>
            <circle cx={x(last.ts)} cy={y(last.mmol)} r="4.5" fill="var(--series-bpm)" stroke="var(--surface)" strokeWidth="2" />
            <text
              x={x(last.ts) + 9}
              y={y(last.mmol) + 5}
              className="chart__label"
              fontWeight="600"
              fill="var(--text-primary)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {десятичное(last.mmol)}
            </text>
          </>
        )}

        {hover && <line x1={hover.x} x2={hover.x} y1={pad.top} y2={pad.top + plotH} stroke="var(--axis)" strokeWidth="1" />}

        <rect
          x={pad.left}
          y={pad.top}
          width={Math.max(plotW, 0)}
          height={plotH}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          style={{ touchAction: 'pan-y' }}
        />
      </svg>

      {hover && (
        <div
          className="chart__tooltip"
          style={{ left: Math.min(Math.max(hover.x - 60, 0), Math.max(width - 170, 0)), top: Math.max(hover.y - 76, 0) }}
        >
          <div className="muted">{FULL_DATE.format(hover.reading.ts)}</div>
          <div>
            <b>{десятичное(hover.reading.mmol)}</b> ммоль/л
          </div>
          <div className="muted">{GLUCOSE_CONTEXT_LABELS[hover.reading.context]}</div>
        </div>
      )}
    </div>
  )
}
