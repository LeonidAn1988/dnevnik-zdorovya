import { useEffect, useState, useRef } from 'react'
import type { MealTimer, NotificationEntry, Person } from '../types'
import { BackBar } from './bits'

export function MealTimers({ timers, onCancel }: { timers: MealTimer[]; onCancel: (id: string) => void }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [])
  const visible = timers.filter(t => !t.cancelledAt && t.dueAt > now - 3600000)
  if (!visible.length) return null
  return <div className="card stack" aria-label="Таймеры еды">
    <h2>Таймеры еды</h2>
    {visible.map(timer => { const left = Math.max(0, Math.ceil((timer.dueAt - now) / 1000)); return <div key={timer.id} className="stack" style={{ gap: 'var(--space-2)' }}>
      <strong>{timer.medicineName}</strong>
      <span>{left ? `${timer.kind === 'eat' ? 'До еды' : 'До приёма'} ${Math.floor(left / 60)}:${String(left % 60).padStart(2,'0')}` : timer.kind === 'eat' ? 'Интервал прошёл — можно есть' : 'Интервал прошёл — проверьте и отметьте приём'}</span>
      <button className="btn btn--sm" onClick={() => onCancel(timer.id)}>{left ? 'Отменить таймер' : 'Закрыть'}</button>
    </div> })}
  </div>
}
export function NotificationCenter({ entries, people, onBack, onRead }: { entries: NotificationEntry[]; people: Person[]; onBack: () => void; onRead: (id: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [now,setNow] = useState(Date.now())
  useEffect(() => { dialog.current?.showModal(); const id=setInterval(() => setNow(Date.now()),1000); return () => clearInterval(id) }, [])
  const visible = entries.filter(e => e.at <= now).sort((a,b) => b.at-a.at)
  return <dialog className="sheet" ref={dialog} aria-label="История уведомлений" onClose={onBack}><div className="sheet__body stack"><BackBar onBack={() => dialog.current?.close()} /><div className="card stack"><h2>Уведомления</h2>
    <p className="muted">История событий по расписанию. Доставка в шторку зависит от разрешений и настроек телефона.</p>
    {!visible.length && <p>Пока уведомлений нет.</p>}
    {visible.map(e => <article key={e.id} className="stack" style={{ gap: 'var(--space-2)' }}><strong>{e.title}</strong><span>{e.person ? `${people.find(p => p.id === e.person)?.name || 'Человек удалён'} · ` : ''}{e.body}</span><time dateTime={new Date(e.at).toISOString()} className="muted">{new Date(e.at).toLocaleString('ru-RU')}</time>{!e.readAt && <button className="btn btn--sm" onClick={() => onRead(e.id)}>Прочитано</button>}</article>)}
  </div></div></dialog>
}
