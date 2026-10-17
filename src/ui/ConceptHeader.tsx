import type { ReactNode } from 'react'
import type { ConceptStyle } from '../logic/appearance'
import { CalendarIcon, SettingsIcon } from './icons'
import journalSprig from '../assets/journal-sprig.webp'

const DATE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })

/** Compact persistent identity; the large editorial heading scrolls with content. */
export function ConceptHeader({ title, route, style, nested, person, onSettings }: {
  title: string
  route: string
  style: ConceptStyle
  nested: boolean
  person: ReactNode
  onSettings: () => void
}) {
  const separateHeading = !nested && (route === 'overview' || route === 'cabinet') && style !== 'clear'
  return <header className="topbar concept-header" data-page={route} data-nested={nested || undefined}>
    <div className="topbar__title">
      {separateHeading ? <span className="concept-brand">Дневник</span> : <h1>{title}</h1>}
    </div>
    <div className="concept-tools">
      {person}
      <button type="button" className="btn concept-settings" aria-label="Настройки" onClick={onSettings}><SettingsIcon /></button>
    </div>
  </header>
}

export function ConceptPageHeading({ title, style, now, today, onOpenDay }: {
  title: string
  style: ConceptStyle
  now: number
  today: boolean
  onOpenDay?: () => void
}) {
  return <div className="concept-page-heading" data-page={today ? 'overview' : 'cabinet'}>
    {style !== 'clear' && <div className="concept-page-heading__title"><h1>{title}</h1>
    </div>}
    {today && <div className="concept-page-heading__date"><time dateTime={new Date(now).toLocaleDateString('sv-SE')}>{DATE.format(now)}</time>
      {style === 'journal' && <img className="journal-sprig" src={journalSprig} width="64" height="48" alt="" aria-hidden="true" />}
      {style === 'journal' && onOpenDay && <button type="button" className="btn btn--icon" aria-label="Открыть календарь приёмов" onClick={onOpenDay}><CalendarIcon /></button>}
    </div>}
  </div>
}
