import { useEffect, useMemo, useState } from 'react'
import type { Stock } from '../logic/medicines'
import { searchStock } from '../logic/cabinet'
import { CabinetRow } from './Cabinet'
import { ChevronIcon, SearchIcon } from './icons'

/** Read-only desktop companion using the same stock facts and details action. */
export function ConceptStockPreview({ stock, now, onOpen, onPick }: {
  stock: Stock[]
  now: number
  onOpen: () => void
  onPick: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [wide, setWide] = useState(() => matchMedia('(min-width: 900px)').matches)
  useEffect(() => {
    const media = matchMedia('(min-width: 900px)')
    const changed = () => setWide(media.matches)
    media.addEventListener('change', changed)
    return () => media.removeEventListener('change', changed)
  }, [])
  const rows = useMemo(() => query.trim() ? searchStock(stock, query).map(hit => hit.item) : stock, [stock, query])
  if (!wide) return null
  return <aside className="concept-stock-preview" aria-label="Запасы лекарств">
    <div className="concept-section-head"><h2>Аптечка</h2><button type="button" className="concept-text-link" onClick={onOpen}>Все лекарства <ChevronIcon /></button></div>
    <label className="concept-search"><SearchIcon /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Поиск лекарства" aria-label="Поиск в запасах" /></label>
    <ul className="pills">{rows.slice(0, 4).map(item => <CabinetRow key={item.box.id} item={item} now={now} concept onOpen={() => onPick(item.box.id)} />)}</ul>
    {!rows.length && <p className="muted">{stock.length ? 'Совпадений нет.' : 'В аптечке пока нет препаратов.'}</p>}
    <button type="button" className="btn concept-stock-preview__open" onClick={onOpen}>Открыть аптечку</button>
  </aside>
}
