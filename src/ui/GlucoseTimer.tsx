import { useEffect, useState } from 'react'
import type { GlucoseTimer } from '../types'

export function GlucoseTimerControl({ timers, onStart, onCancel }: { timers: GlucoseTimer[]; onStart: () => Promise<void>; onCancel: (id: string) => void }) {
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  useEffect(() => { const id = setInterval(() => setNow(Date.now()),1000); return () => clearInterval(id) }, [])
  const active = timers.find(t => !t.cancelledAt && t.dueAt > now)
  const due = timers.find(t => !t.cancelledAt && t.dueAt <= now && t.dueAt > now-3600000)
  const seconds = active ? Math.ceil((active.dueAt-now)/1000) : 0
  return <div className="card stack">
    <h2>Сахар после еды</h2>
    <button className="btn btn--primary" disabled={busy || !!active} onClick={async () => { setBusy(true); try { await onStart() } finally { setBusy(false) } }}>Напомнить померить сахар через 2 часа</button>
    <p className="muted">Отсчёт от нажатия. Обычно интервал отсчитывают от начала еды; следуйте назначению врача.</p>
    {active && <><strong>До замера {Math.floor(seconds/3600)}:{String(Math.floor(seconds/60)%60).padStart(2,'0')}:{String(seconds%60).padStart(2,'0')}</strong><button className="btn" onClick={() => onCancel(active.id)}>Отменить напоминание</button></>}
    {due && !active && <><p role="status">Прошло 2 часа — пора измерить сахар и записать результат.</p><button className="btn" onClick={() => onCancel(due.id)}>Скрыть завершённый таймер</button></>}
  </div>
}
