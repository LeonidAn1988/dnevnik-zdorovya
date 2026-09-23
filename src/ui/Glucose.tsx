import { Fragment, useRef, useState } from 'react'
import { десятичное } from '../logic/plural'
import { GLUCOSE_CONTEXT_LABELS, type GlucoseContext, type GlucoseReading, GLUCOSE_CONTEXT_ORDER, GLUCOSE_CONTEXT_SHORT } from '../types'
import { classifyGlucose, glucoseAlertFor, glucoseCeiling, type GlucoseTargets } from '../logic/classify'
import { ADVICE_NOTE, GLUCOSE_SCALE_NOTE } from '../logic/disclaimer'
import type { GlucoseSummary } from '../logic/stats'
import { describeWhen, toLocalInput } from '../logic/when'
import { Banner, Reveal } from './bits'
import { ValueField } from './ValueField'
import { GlucoseEditor } from './EditRow'
import { PencilIcon } from './icons'

const DATE_TIME = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})


/**
 * Предполагаемый момент замера по времени суток. Поле обязательное и влияет на
 * оценку, поэтому подставляется наиболее вероятное значение — но одним касанием
 * меняется, и это видно.
 */
function guessContext(date = new Date()): GlucoseContext {
  const hour = date.getHours()
  if (hour < 10) return 'fasting'
  if (hour >= 23 || hour < 4) return 'night'
  if (hour >= 21) return 'bedtime'
  return 'after-meal'
}

// ── ввод ───────────────────────────────────────────────────────────────────

export function GlucoseEntry({
  user,
  targets,
  onAdd,
}: {
  /** Кнопка на приборе. `null` — её нет, и запись пойдёт с нулём. */
  user: number | null
  targets: GlucoseTargets
  onAdd: (reading: GlucoseReading) => Promise<void>
}) {
  const [value, setValue] = useState('')
  const [context, setContext] = useState<GlucoseContext>(() => guessContext())
  const [when, setWhen] = useState(() => toLocalInput(new Date()))
  const [editingWhen, setEditingWhen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<GlucoseReading | null>(null)
  const valueRef = useRef<HTMLInputElement>(null)

  // Запятая как десятичный разделитель — так набирают на русской раскладке.
  const mmol = Number(value.replace(',', '.'))
  const complete = Number.isFinite(mmol) && mmol > 0.5 && mmol <= 50
  const preview = complete ? classifyGlucose(mmol, context, targets) : null
  const warning = complete ? glucoseAlertFor(mmol, targets) : null

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    // Второе нажатие, пока первое ещё пишется, заводило два одинаковых замера.
    if (busy) return
    if (!complete) {
      valueRef.current?.focus()
      return setError('Введите значение в ммоль/л — обычно это число от 2 до 25')
    }
    const ts = new Date(when).getTime()
    if (!Number.isFinite(ts)) return setError('Проверьте дату и время')

    const reading: GlucoseReading = {
      kind: 'glucose',
      id: `m-${crypto.randomUUID()}`,
      ts,
      mmol: Math.round(mmol * 10) / 10,
      context,
      user: user ?? 0,
      source: 'manual',
    }
    setBusy(true)
    try {
      await onAdd(reading)
    } finally {
      setBusy(false)
    }

    setError(null)
    setSaved(reading)
    setValue('')
    setWhen(toLocalInput(new Date()))
    setContext(guessContext())
    setEditingWhen(false)
    valueRef.current?.focus()
  }

  const ceiling = glucoseCeiling(context, targets)

  return (
    <form className="card" onSubmit={submit}>
      <div className="card__head">
        <h2>Записать сахар</h2>
        {preview && (
          <span className="badge badge--solid" style={{ ['--dot' as string]: preview.color }}>
            <span className="badge__dot" />
            {preview.label}
          </span>
        )}
      </div>

      <div className="grid grid--pair grid--pair-wide">
        <ValueField
          label="Сахар"
          unit="ммоль/л"
          value={value}
          onChange={setValue}
          placeholder="5,4"
          min={1}
          max={40}
          start={5.5}
          step={0.1}
          decimals={1}
          ariaSuffix="ммоль на литр"
          inputRef={valueRef}
          required
        />
        <div className="field">
          <span>Когда</span>
          {editingWhen ? (
            <input type="datetime-local" value={when} autoFocus onChange={(e) => setWhen(e.target.value)} />
          ) : (
            <button type="button" className="btn" onClick={() => setEditingWhen(true)}>
              {describeWhen(when)}
            </button>
          )}
        </div>
      </div>

      <fieldset className="chips" style={{ marginTop: 'var(--space-4)' }}>
        <legend>Момент замера — от него зависит норма</legend>
        {GLUCOSE_CONTEXT_ORDER.map((item) => (
          <button
            key={item}
            type="button"
            className="chip"
            aria-pressed={context === item}
            onClick={() => setContext(item)}
          >
            {GLUCOSE_CONTEXT_SHORT[item]}
          </button>
        ))}
      </fieldset>

      <div className="muted" style={{ marginTop: 'var(--space-2)' }}>
        {GLUCOSE_CONTEXT_LABELS[context]}: ваша цель — ниже {десятичное(ceiling)} ммоль/л
      </div>

      <Reveal open={error !== null}>
        <div style={{ paddingTop: 'var(--space-3)' }} role="alert">
          {error && <Banner tone="critical">{error}</Banner>}
        </div>
      </Reveal>

      <div className="row form-actions" style={{ marginTop: 'var(--space-4)' }}>
        <button className="btn btn--primary" type="submit">
          Добавить
        </button>
      </div>

      {/* Сразу после сохранения человек должен получить пользу, а не пустой экран.
          У конкурентов на этом месте показывают рекламу. */}
      <Reveal open={saved !== null}>
        <div style={{ paddingTop: 'var(--space-3)' }} role="status">
          {saved && (
            <Banner tone={classifyGlucose(saved.mmol, saved.context, targets).level === 'normal' ? 'good' : 'info'}>
              <b>
                Записано: {десятичное(saved.mmol)} ммоль/л
              </b>
              <div style={{ marginTop: 4 }}>
                {GLUCOSE_CONTEXT_LABELS[saved.context].toLowerCase()} —{' '}
                {classifyGlucose(saved.mmol, saved.context, targets).label.toLowerCase()} при вашей цели ниже{' '}
                {десятичное(glucoseCeiling(saved.context, targets))}
              </div>
              <div className="muted" style={{ marginTop: 4 }}>
                {GLUCOSE_SCALE_NOTE}
              </div>
            </Banner>
          )}
        </div>
      </Reveal>

      <Reveal open={warning !== null}>
        <div style={{ paddingTop: 'var(--space-3)' }} role="status">
          {warning && (
            <Banner tone={warning.kind === 'crisis' ? 'critical' : warning.kind === 'severe' ? 'warning' : 'info'}>
              {warning.text}
              <div className="muted" style={{ marginTop: 4 }}>
                {ADVICE_NOTE}
              </div>
            </Banner>
          )}
        </div>
      </Reveal>
    </form>
  )
}

// ── список ─────────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<GlucoseReading['source'], string> = {
  device: 'с глюкометра',
  manual: 'вручную',
  import: 'из файла',
}

export function GlucoseList({
  readings,
  targets,
  onDelete,
  onUpdate,
}: {
  readings: GlucoseReading[]
  targets: GlucoseTargets
  onDelete?: (id: string) => void
  onUpdate?: (reading: GlucoseReading) => Promise<void>
}) {
  const [editingId, setEditingId] = useState<string | null>(null)

  if (readings.length === 0) {
    return <div className="chart__empty">За выбранный период замеров сахара нет</div>
  }
  const rows = [...readings].sort((a, b) => b.ts - a.ts)
  const editable = Boolean(onUpdate)
  const columns = 5 + (onDelete || editable ? 1 : 0)

  return (
    <div className="table-scroll">
      <table className="readings-table">
        <thead>
          <tr>
            <th>Дата и время</th>
            <th>Сахар</th>
            <th>Оценка</th>
            <th>Момент замера</th>
            <th>Примечание</th>
            {(onDelete || editable) && <th className="no-print" aria-label="Действия" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((reading) => {
            const category = classifyGlucose(reading.mmol, reading.context, targets)
            const editing = editingId === reading.id
            return (
              <Fragment key={reading.id}>
              <tr data-editing={editing || undefined}>
                <td data-col="when">{DATE_TIME.format(reading.ts)}</td>
                <td data-col="val" className="num">
                  {десятичное(reading.mmol)}
                </td>
                <td data-col="cat">
                  <span className="badge" style={{ ['--dot' as string]: category.color }}>
                    <span className="badge__dot" />
                    {category.label}
                  </span>
                </td>
                <td data-col="bpm">{GLUCOSE_CONTEXT_SHORT[reading.context]}</td>
                <td data-col="note" className="wrap">
                  {reading.note ? `${reading.note} · ` : ''}
                  <span className="muted">{SOURCE_LABELS[reading.source]}</span>
                </td>
                {(onDelete || editable) && (
                  <td data-col="del" className="no-print">
                    <div className="row" style={{ gap: 'var(--space-1)', flexWrap: 'nowrap' }}>
                      {editable && (
                        <button
                          className="row-edit"
                          title="Изменить замер"
                          aria-label={`Изменить замер от ${DATE_TIME.format(reading.ts)}`}
                          aria-expanded={editing}
                          onClick={() => setEditingId(editing ? null : reading.id)}
                        >
                          <PencilIcon />
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>

              {editing && onUpdate && (
                <tr data-editor="true" className="no-print">
                  <td colSpan={columns}>
                    <GlucoseEditor
                      reading={reading}
                      onDelete={onDelete ? () => { setEditingId(null); onDelete(reading.id) } : undefined}
                      onCancel={() => setEditingId(null)}
                      onSave={async (next) => {
                        await onUpdate(next)
                        setEditingId(null)
                      }}
                    />
                  </td>
                </tr>
              )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      {/* Одна подпись на весь список, а не под каждой строкой: подпись обязана
          стоять там, где показана категория, но повторять её двадцать раз —
          это уже не честность, а шум. */}
      <div className="muted" style={{ marginTop: 'var(--space-2)' }}>
        {GLUCOSE_SCALE_NOTE}
      </div>
    </div>
  )
}

// ── сводка ─────────────────────────────────────────────────────────────────

export function GlucoseTiles({ summary, targets }: { summary: GlucoseSummary; targets: GlucoseTargets }) {
  const fasting = summary.byContext.fasting
  const afterMeal = summary.byContext['after-meal']

  return (
    <>
      <div className="lead">
        <div className="card">
          <div className="tile__label">Средний сахар за период</div>
          <div className="lead__value">
            {десятичное(summary.avg)}
            <span className="tile__unit">ммоль/л</span>
          </div>
          <div className="tile__note">
            от {десятичное(summary.min)} до {десятичное(summary.max)} · замеров {summary.count}
          </div>
        </div>

        <div className="card">
          <div className="tile__label">Уложились в цель</div>
          <div className="lead__value" style={{ fontSize: 'var(--fs-5)' }}>
            {Math.round(summary.withinTarget * 100)}%
          </div>
          <div className="tile__note">
            с учётом момента замера: ниже {десятичное(targets.fastingMax)} натощак и {десятичное(targets.postMealMax)} после
            еды
          </div>
        </div>
      </div>

      <div className="stats-strip">
        <div>
          <div className="tile__label">Натощак</div>
          <div className="tile__value">{fasting ? десятичное(fasting.avg) : '—'}</div>
          <div className="tile__note">{fasting ? `замеров ${fasting.count}` : 'нет замеров натощак'}</div>
        </div>
        <div>
          <div className="tile__label">После еды</div>
          <div className="tile__value">{afterMeal ? десятичное(afterMeal.avg) : '—'}</div>
          <div className="tile__note">{afterMeal ? `замеров ${afterMeal.count}` : 'нет замеров после еды'}</div>
        </div>
        <div>
          <div className="tile__label">Разброс</div>
          <div className="tile__value">±{десятичное(summary.sd)}</div>
          <div className="tile__note">чем меньше, тем ровнее</div>
        </div>
        {/* Число низких сахаров — самая важная цифра диабетического дневника,
            поэтому показывается всегда, даже когда она ноль. */}
        <div>
          <div className="tile__label">Низкий сахар</div>
          <div className="tile__value">{summary.lowCount}</div>
          <div className="tile__note">раз ниже {десятичное(targets.low)} ммоль/л</div>
        </div>
      </div>
    </>
  )
}
