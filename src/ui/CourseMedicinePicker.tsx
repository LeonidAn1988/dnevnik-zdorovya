import { useEffect, useMemo, useRef, useState } from 'react'
import type { Medicine } from '../types'
import { matchNote, searchStock } from '../logic/cabinet'
import { Row } from './Picker'

/** Search the actual household stock, including similarly named packs. */
export function CourseMedicinePicker({ medicines, selected, query, onQuery, onPick, onAdd }: {
  medicines: Medicine[]
  selected?: Medicine
  query: string
  onQuery: (query: string) => void
  onPick: (id: string) => void
  onAdd: () => void
}) {
  const choice = useRef<HTMLButtonElement>(null)
  const focusChoice = useRef(false)
  const [expanded, setExpanded] = useState(!selected)
  const [limit, setLimit] = useState(10)
  useEffect(() => { if (selected?.id) setExpanded(false) }, [selected?.id])
  useEffect(() => {
    if (focusChoice.current && choice.current) { focusChoice.current = false; choice.current.focus() }
  })
  const hits = useMemo(() => query.trim()
    ? searchStock(medicines.map(box => ({ box, intakes: [] })), query)
    : medicines.map(box => ({ item: { box, intakes: [] }, field: 'name' as const })), [medicines, query])
  const show = expanded || !!query || !selected
  return <div className="stack" style={{ gap: 'var(--space-2)' }}>
    {selected && <button ref={choice} type="button" className="btn pickfield course-medicine-choice" aria-expanded={show} onClick={() => setExpanded(!expanded)}>
      <span className="course-medicine-name">{selected.name}{selected.dose ? ` ${selected.dose}` : ''}</span>
      <span className="sheet__hint">{[selected.form, selected.maker].filter(Boolean).join(' · ') || 'Выбран из аптечки'} · Изменить</span>
    </button>}
    {show && <>
      <label className="field">
        <span>Найти препарат в аптечке</span>
        <input type="search" value={query} placeholder="Название, вещество, производитель"
          onKeyDown={event => { if (event.key === 'Enter') event.preventDefault() }}
          onChange={event => { onQuery(event.target.value); setLimit(10) }} />
      </label>
      <div role="region" aria-label="Препараты в аптечке" className="course-medicine-results">
        {hits.slice(0, limit).map(hit => {
          const box = hit.item.box
          return <Row key={box.id} option={{ id: box.id, title: box.name,
            hint: [box.dose, box.form, box.maker, matchNote(hit)].filter(Boolean).join(' · ') || undefined }}
            chosen={box.id === selected?.id} onPick={() => { focusChoice.current = true; onPick(box.id); onQuery(''); setExpanded(false) }} />
        })}
        {hits.length > limit && <button type="button" className="btn" onClick={() => setLimit(limit + 10)}>Показать ещё ({hits.length - limit})</button>}
        {!hits.length && <p className="muted" role="status">{medicines.length ? 'В вашей аптечке совпадений нет.' : 'Аптечка пока пуста. Добавьте препарат, чтобы назначить курс.'}</p>}
      </div>
    </>}
    <button type="button" className="btn" onClick={onAdd}>Добавить новый препарат</button>
  </div>
}
