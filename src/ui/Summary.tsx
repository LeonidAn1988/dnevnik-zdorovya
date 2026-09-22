import type { BpReading } from '../types'
import type { Summary as SummaryData } from '../logic/stats'
import { alertFor, classify } from '../logic/classify'
import { Banner, CategoryBadge } from './bits'
import { plural } from '../logic/plural'
import { ADVICE_NOTE, SCALE_NOTE } from '../logic/disclaimer'

const FULL_DATE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })

/** Предупреждение по последнему измерению — самое срочное, что приложение может сказать. */
export function LatestAlert({ latest }: { latest: BpReading | null }) {
  if (!latest) return null
  const alert = alertFor(latest.sys, latest.dia)
  if (!alert) return null
  const tone = alert.kind === 'crisis' ? 'critical' : alert.kind === 'severe' ? 'warning' : 'info'
  return (
    <Banner tone={tone}>
      <b>
        Последнее измерение: {latest.sys}/{latest.dia}
      </b>{' '}
      — {classify(latest.sys, latest.dia).label.toLowerCase()}. {alert.text}
      {/* Подпись стоит здесь, а не в «О приложении»: оговорка в трёх касаниях
          от совета не читается вовсе. */}
      <div className="muted" style={{ marginTop: 4 }}>
        {ADVICE_NOTE}
      </div>
      <div className="muted" style={{ marginTop: 4 }}>
        {FULL_DATE.format(latest.ts)}
      </div>
    </Banner>
  )
}

function Stat({ label, value, unit, note }: { label: string; value: string | number; unit?: string; note?: string }) {
  return (
    <div>
      <div className="tile__label">{label}</div>
      <div className="tile__value">
        {value}
        {unit && <span className="tile__unit">{unit}</span>}
      </div>
      {note && <div className="tile__note">{note}</div>}
    </div>
  )
}

export function SummaryTiles({ summary, targetSys, targetDia }: { summary: SummaryData; targetSys: number; targetDia: number }) {
  const avgSys = Math.round(summary.avgSys)
  const avgDia = Math.round(summary.avgDia)
  const inTarget = Math.round(summary.withinTarget * 100)
  const delta = summary.morningEveningDelta === null ? null : Math.round(summary.morningEveningDelta)
  const hasMarks = summary.ihbCount > 0 || summary.movCount > 0

  return (
    <>
      {/* Одна главная цифра на экране — среднее давление за период. */}
      <div className="lead">
        <div className="card">
          <div className="tile__label">Среднее давление за период</div>
          <div className="lead__value">
            {avgSys}/{avgDia}
            <span className="tile__unit">мм рт. ст.</span>
          </div>
          {/* На чём посчитано — прямо под цифрой.
              Три записи за месяц дают такое же «145/92», как тридцать, и без
              этой строки человек, вернувшийся после перерыва, читает среднее
              как приговор себе за весь месяц. Число дней важнее числа
              измерений: три подряд снятых замера в один вечер — это один день
              наблюдения, а не три. */}
          <div className="tile__note">
            {summary.count} {plural(summary.count, 'измерение', 'измерения', 'измерений')} в{' '}
            {summary.days} {plural(summary.days, 'дне', 'днях', 'днях')}
          </div>
          <div style={{ marginTop: 'var(--space-3)' }}>
            <CategoryBadge sys={avgSys} dia={avgDia} solid />
          </div>
          {/* Один раз на плитку, а не под каждой строкой списка: подпись должна
              стоять там, где показана категория, и не превращаться в шум. */}
          <div className="tile__note" style={{ marginTop: 'var(--space-2)' }}>
            {SCALE_NOTE}
          </div>
        </div>

        <div className="card">
          <div className="tile__label">Уложились в цель</div>
          <div className="lead__value" style={{ fontSize: 'var(--fs-5)' }}>
            {inTarget}%
          </div>
          <div className="tile__note">измерений ниже {targetSys}/{targetDia}</div>
        </div>
      </div>

      <div className="stats-strip">
        <Stat
          label="Средний пульс"
          value={summary.avgBpm ? Math.round(summary.avgBpm) : '—'}
          unit={summary.avgBpm ? 'уд/мин' : undefined}
        />
        <Stat
          label="Разброс верхнего"
          value={`±${summary.sdSys.toFixed(1)}`}
          note={`от ${summary.minSys} до ${summary.maxSys} — чем меньше, тем ровнее`}
        />
        <Stat
          label="Утром против вечера"
          value={delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta}`}
          unit={delta === null ? undefined : 'мм рт. ст.'}
          note={
            delta === null
              ? 'нужны измерения и утром, и вечером'
              : delta > 0
                ? 'по утрам давление выше'
                : 'по утрам давление ниже'
          }
        />
        {hasMarks && (
          <Stat
            label="Прибор отметил"
            value={summary.ihbCount}
            note={`раз нерегулярное сердцебиение${summary.movCount > 0 ? ` · движение: ${summary.movCount}` : ''}`}
          />
        )}
      </div>
    </>
  )
}
