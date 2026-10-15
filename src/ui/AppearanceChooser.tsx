import { useEffect, useState } from 'react'
import type { InterfaceStyle } from '../types'
import { CONCEPT_STYLES, appearanceTitle } from '../logic/appearance'

export function AppearanceChooser({ value, onApply }: { value: InterfaceStyle; onApply: (style: InterfaceStyle) => void }) {
  const [preview, setPreview] = useState(value)
  useEffect(() => setPreview(value), [value])
  return <section className="appearance-chooser" aria-labelledby="appearance-title">
    <h3 id="appearance-title">Оформление</h3>
    <div className="appearance-choices" role="group" aria-label="Оформление приложения">
      {CONCEPT_STYLES.map(item => <button key={item.key} type="button" className="appearance-choice"
        aria-pressed={preview === item.key} onClick={() => setPreview(item.key)}>
        <span className="appearance-preview" data-style={item.key} aria-hidden="true">
          <span className="appearance-preview__title">Сегодня</span>
          <span className="appearance-preview__row"><b>08:00</b><span>Препарат А</span></span>
          <span className="appearance-preview__action">Отметить приём</span>
          <span className="appearance-preview__line" />
        </span>
        <strong>{item.title}</strong><span className="appearance-choice__hint">{item.hint}</span>
        {preview === item.key && <span className="appearance-choice__selected">Выбрано для просмотра</span>}
      </button>)}
    </div>
    <p className="muted">Все функции доступны в каждом оформлении. Размер текста и отступы выбираются отдельно.</p>
    <div className="row">
      <button type="button" className="btn btn--primary" disabled={preview === value} onClick={() => onApply(preview)}>
        Применить оформление
      </button>
      {preview !== value && <button type="button" className="btn" onClick={() => setPreview(value)}>Отменить просмотр</button>}
    </div>
    <p className="muted" role="status">Текущее оформление: {appearanceTitle(value)}</p>
  </section>
}
