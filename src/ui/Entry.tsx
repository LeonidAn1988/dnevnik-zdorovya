import { useRef, useState } from 'react'
import type { BpReading } from '../types'
import { alertFor, classify } from '../logic/classify'
import { ADVICE_NOTE } from '../logic/disclaimer'
import { Banner, Field, Reveal } from './bits'
import { describeWhen, toLocalInput } from '../logic/when'
import { ValueField, useCoarsePointer } from './ValueField'


const SAVED_AT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
})

export function Entry({ user, onAdd }: { user: number; onAdd: (reading: BpReading) => Promise<void> }) {
  const [sys, setSys] = useState('')
  const [dia, setDia] = useState('')
  const [bpm, setBpm] = useState('')
  const [when, setWhen] = useState(() => toLocalInput(new Date()))
  const [editingWhen, setEditingWhen] = useState(false)
  const [arm, setArm] = useState<'' | 'left' | 'right'>('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** Запись идёт: кнопка глохнет, второе нажатие не заводит дубль. */
  const [busy, setBusy] = useState(false)
  /** Что именно записали — для подтверждения, которое человек может сверить. */
  const [saved, setSaved] = useState<{ sys: number; dia: number; bpm: number | null; ts: number } | null>(null)

  const coarse = useCoarsePointer()
  const sysRef = useRef<HTMLInputElement>(null)
  const diaRef = useRef<HTMLInputElement>(null)

  const sysValue = Number(sys)
  const diaValue = Number(dia)

  // Пока значения не выглядят завершёнными, ничего не оцениваем: иначе на середине
  // набора «120» человеку с гипертонией показывают «Пониженное давление».
  const complete = sysValue >= 40 && sysValue <= 300 && diaValue >= 20 && diaValue <= 250
  const preview = complete ? classify(sysValue, diaValue) : null
  const warning = complete ? alertFor(sysValue, diaValue) : null

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setSaved(null)

    if (!Number.isFinite(sysValue) || sysValue < 40 || sysValue > 300) {
      sysRef.current?.focus()
      return setError(coarse ? 'Выберите верхнее давление — прокрутите колесо или коснитесь значения' : 'Верхнее давление должно быть от 40 до 300')
    }
    if (!Number.isFinite(diaValue) || diaValue < 20 || diaValue > 250) {
      diaRef.current?.focus()
      return setError(coarse ? 'Выберите нижнее давление — прокрутите колесо или коснитесь значения' : 'Нижнее давление должно быть от 20 до 250')
    }
    if (diaValue >= sysValue) {
      diaRef.current?.focus()
      return setError('Нижнее должно быть меньше верхнего — возможно, поля перепутаны местами')
    }
    const ts = new Date(when).getTime()
    if (!Number.isFinite(ts)) return setError('Не разобрал дату и время')

    const pulse = Number(bpm)
    const reading = {
      kind: 'bp' as const,
      id: `m-${crypto.randomUUID()}`,
      ts,
      sys: Math.round(sysValue),
      dia: Math.round(diaValue),
      bpm: Number.isFinite(pulse) && pulse > 0 ? Math.round(pulse) : null,
      ihb: false,
      mov: false,
      user,
      source: 'manual' as const,
      arm: arm || undefined,
      note: note.trim() || undefined,
    }
    setBusy(true)
    try {
      await onAdd(reading)
    } finally {
      setBusy(false)
    }

    setError(null)
    // Что именно ушло в дневник. Форма после записи очищается и выглядит ровно
    // так же, как до нажатия, — человек, не уверенный, что попал по кнопке,
    // жмёт ещё раз и получает дубль измерения. Подтверждение должно быть
    // соразмерно действию и показывать записанное, а не мигать словом.
    setSaved({
      sys: reading.sys,
      dia: reading.dia,
      bpm: reading.bpm ?? null,
      ts: reading.ts,
    })
    setSys('')
    setDia('')
    setBpm('')
    setNote('')
    setArm('')
    setWhen(toLocalInput(new Date()))
    setEditingWhen(false)
    sysRef.current?.focus()
  }

  return (
    <form className="card" onSubmit={submit} data-tour="bp-entry">
      <div className="card__head">
        <h2>Записать измерение</h2>
        {preview && (
          <span className="badge badge--solid" style={{ ['--dot' as string]: preview.color }}>
            <span className="badge__dot" />
            {preview.label}
          </span>
        )}
      </div>

      {/* Пара давления читается вместе, поэтому стоит рядом. Пульс вторичен и на
          узком экране третьим колесом уже не помещается — кладём его широким
          горизонтальным барабаном под парой. */}
      {/* Пара давления читается вместе, поэтому стоит рядом. На крупном тексте
          пара расходится по строкам: три цифры в половине ширины не помещаются
          и обрезаются — «120» показывалось как «12». */}
      <div className="grid grid--pair">
        <ValueField label="Верхнее" value={sys} onChange={setSys} placeholder="120" min={40} max={300} start={120}
          ariaSuffix="мм рт. ст." inputRef={sysRef} required />
        <ValueField label="Нижнее" value={dia} onChange={setDia} placeholder="80" min={20} max={250} start={80}
          ariaSuffix="мм рт. ст." inputRef={diaRef} required />
      </div>

      <div style={{ marginTop: 'var(--space-3)' }}>
        <ValueField label="Пульс" value={bpm} onChange={setBpm} placeholder="70" min={20} max={250} start={70}
          ariaSuffix="ударов в минуту" axis="x" />
      </div>

      <div className="field" style={{ marginTop: 'var(--space-3)' }}>
        <span>Когда</span>
        {editingWhen ? (
          <input type="datetime-local" value={when} autoFocus onChange={(e) => setWhen(e.target.value)} />
        ) : (
          <button type="button" className="btn" onClick={() => setEditingWhen(true)}>
            {describeWhen(when)}
          </button>
        )}
      </div>

      <details style={{ marginTop: 'var(--space-3)' }}>
        <summary style={{ cursor: 'pointer', fontSize: 'var(--fs-1)', color: 'var(--text-secondary)' }}>
          Рука и примечание
        </summary>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginTop: 'var(--space-3)' }}>
          <Field label="Рука">
            <select value={arm} onChange={(e) => setArm(e.target.value as typeof arm)}>
              <option value="">не указана</option>
              <option value="left">левая</option>
              <option value="right">правая</option>
            </select>
          </Field>
          <Field label="Примечание">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="например: после лекарства" />
          </Field>
        </div>
      </details>

      {/* Ошибка ввода — над кнопкой: она мешает отправке, её нужно прочитать первой. */}
      <Reveal open={error !== null}>
        <div style={{ paddingTop: 'var(--space-3)' }} role="alert">
          {error && <Banner tone="critical">{error}</Banner>}
        </div>
      </Reveal>

      <div className="row form-actions" style={{ marginTop: 'var(--space-4)' }}>
        {/* Кнопка глохнет на время записи: без этого второе нажатие на
            медленном телефоне заводило второе измерение с теми же цифрами, а
            дубль в дневнике давления врач читает как две разные попытки. */}
        <button className="btn btn--primary" type="submit" disabled={busy}>
          {busy ? 'Сохранение…' : 'Добавить'}
        </button>
      </div>

      <Reveal open={saved !== null}>
        <div style={{ paddingTop: 'var(--space-4)' }} role="status" aria-live="polite">
          {saved && (
            <Banner tone="good">
              <b>
                Записано: {saved.sys}/{saved.dia}
                {saved.bpm !== null && <>, пульс {saved.bpm}</>}
              </b>
              <div style={{ marginTop: 4 }}>{SAVED_AT.format(saved.ts)}</div>
            </Banner>
          )}
        </div>
      </Reveal>

      {/* Медицинское предупреждение — под кнопкой: оно не должно сдвигать её вниз
          в тот момент, когда человек уже дописывает вторую цифру. */}
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
