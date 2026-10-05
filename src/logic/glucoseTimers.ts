import type { GlucoseTimer, NotificationEntry } from '../types'
import type { Reminder } from '../platform/ports'
import { startOfDay } from './days'

/** Explicit user timer, two elapsed hours; local to this device. */
export function createGlucoseTimer(person: string, now: number, timers: GlucoseTimer[]): GlucoseTimer {
  const active = timers.find(t => t.person === person && !t.cancelledAt && t.dueAt > now)
  if (active) return active
  let id = 20_100_000 + now % 900_000
  while (timers.some(t => t.id === String(id))) id = 20_100_000 + (id + 1 - 20_100_000) % 900_000
  return { id: String(id), person, startedAt: now, dueAt: now + 2 * 60 * 60_000 }
}
export function glucoseTimerReminder(timer: GlucoseTimer, name?: string): Reminder {
  return { id: Number(timer.id), kind: 'glucose', title: 'Пора измерить сахар', body: [name, 'Прошло 2 часа от запуска таймера после еды'].filter(Boolean).join(' · '), details: 'Измерьте сахар и запишите результат с моментом замера', markable: false, at: timer.dueAt, day: startOfDay(timer.dueAt), slot: timer.id, step: 0, person: timer.person }
}
export function glucoseTimerEntry(timer: GlucoseTimer): NotificationEntry {
  const reminder = glucoseTimerReminder(timer)
  return { id: `glucose:${timer.id}`, at: timer.dueAt, title: reminder.title, body: reminder.body, person: timer.person, kind: 'glucose' }
}
