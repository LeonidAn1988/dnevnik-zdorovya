import { useState } from 'react'
import { platform } from '../platform/ports'
import { Banner } from './bits'

/** Permission belongs to the same user action as enabling the schedule. */
export function ReminderNudge({ onEnable, onSnooze, onSettings }: {
  onEnable: () => void
  onSnooze: () => void
  onSettings: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function enable() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const port = platform().reminders
      const granted = await port.permission() === 'granted' || await port.requestPermission() === 'granted'
      if (!granted) {
        setError('Уведомления не разрешены. Напоминания пока выключены. Проверьте разрешение в настройках напоминаний.')
        return
      }
      onEnable()
    } catch {
      setError('Не удалось включить напоминания. Попробуйте ещё раз или откройте настройки напоминаний.')
    } finally { setBusy(false) }
  }
  return <Banner tone="info">
    <b>Напоминать о приёме?</b>
    <div style={{ marginTop: 4 }}>Расписание задано, но напоминания выключены.</div>
    {error && <p role="alert">{error}</p>}
    <div className="row" style={{ marginTop: 'var(--space-3)' }}>
      <button className="btn btn--primary" disabled={busy} onClick={() => void enable()}>
        {busy ? 'Запрашиваем разрешение…' : 'Включить напоминания'}
      </button>
      {error && <button className="btn" onClick={onSettings}>Настройки напоминаний</button>}
      <button className="btn" disabled={busy} onClick={onSnooze}>Скрыть на неделю</button>
    </div>
  </Banner>
}
