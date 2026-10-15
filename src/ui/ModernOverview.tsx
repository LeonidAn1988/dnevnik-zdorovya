import { GlucoseIcon, PlusIcon, PressureIcon } from './icons'

const DAY = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })

/** Shortcuts only navigate: measurement ownership and saving stay in the
 * existing forms. No second implementation of the diary's medical rules. */
export function ModernOverview({ now, onPressure, onGlucose, compact = false }: {
  now: number
  onPressure?: () => void
  onGlucose?: () => void
  compact?: boolean
}) {
  return <div className="modern-overview-intro no-print">
    {!compact && <div className="modern-overview-intro__heading">
      <h2>Сегодня</h2>
      <p>{DAY.format(now)}</p>
    </div>}
    {(onPressure || onGlucose) && <div className="modern-quick-actions" aria-label="Быстрая запись">
      {onPressure && <button className="modern-quick-action" onClick={onPressure}>
        <PressureIcon /><span>Записать <strong>давление</strong></span><PlusIcon />
      </button>}
      {onGlucose && <button className="modern-quick-action" onClick={onGlucose}>
        <GlucoseIcon /><span>Записать <strong>сахар</strong></span><PlusIcon />
      </button>}
    </div>}
  </div>
}
