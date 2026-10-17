import type { CourseToday } from '../logic/course'
import { courseText } from '../logic/course'
import type { FamilySyncStatus } from './useFamilySync'
import { ChevronIcon, PressureIcon } from './icons'

/** A real configured measurement, never an appointment inferred from a mockup. */
export function ConceptMeasureTask({ today, onOpen }: { today: CourseToday; onOpen: () => void }) {
  if (!today.active || !today.planned) return null
  return <section className="concept-measure-task" aria-label="Давление сегодня">
    {today.next ? <button type="button" onClick={onOpen} aria-label={`Записать давление по расписанию ${today.next}`}>
      <span className="concept-measure-task__time">{today.next}</span>
      <span className="concept-measure-task__icon"><PressureIcon /></span>
      <span className="concept-measure-task__text"><strong>Измерить давление</strong><span>По вашему расписанию</span></span>
      <ChevronIcon />
    </button> : <p className="muted">Давление: все измерения на сегодня записаны. {courseText(today)}</p>}
  </section>
}

/** Reports the observed exchange state, not the freshness of a person's health data. */
export function ConceptFamilyStatus({ family, onOpen }: { family: FamilySyncStatus; onOpen: () => void }) {
  if (!family.cloud.connected && !family.sources.length) return null
  const failed = Boolean(family.cloud.error || family.unreadable.length)
  const text = family.busy ? 'Семейный обмен идёт…'
    : failed ? 'Семейный обмен требует внимания'
    : family.cloud.connected && !family.cloud.canRead ? 'Веб: получение семьи — через импорт'
    : family.lastAt ? `Обмен проверен ${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(family.lastAt)}`
    : 'Семейный обмен ещё не проверен'
  return <button type="button" className="concept-family-status" data-warning={failed || undefined} onClick={onOpen}>
    <span>{text}</span><ChevronIcon />
  </button>
}
