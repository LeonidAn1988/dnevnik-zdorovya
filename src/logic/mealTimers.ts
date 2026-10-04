import type { MealTimer, NotificationEntry, Regimen } from '../types'
import type { Reminder } from '../platform/ports'
import { startOfDay, addDays, momentOf } from './days'
import { medicineAlert, type Stock, stageOn, dosesOn, plannedAt, perTimeOf, formatCount } from './medicines'
import { doseUnit } from './units'
import type { Dosing } from './regimen'
import { regimenFinished } from './regimen'

export function createMealTimer(course: Regimen, medicineName: string, kind: MealTimer['kind'], now: number, timers: MealTimer[], anchor = now, planned?: number): MealTimer | null {
  const minutes = course.mealMinutes
  if (!minutes || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return null
  if (kind === 'eat' ? course.meal !== 'before' : course.meal !== 'after') return null
  if (anchor > now || now - anchor > 24 * 60 * 60000) return null
  const existing = timers.find(t => !t.cancelledAt && t.dueAt > now && t.regimenId === course.id && t.kind === kind && (kind === 'dose' ? t.plannedAt === planned : t.startedAt === anchor))
  if (existing) return existing
  let number = 19_200_000 + (now % 700_000)
  while (timers.some(t => t.id === String(number))) number = 19_200_000 + ((number + 1 - 19_200_000) % 700_000)
  return { id: String(number), regimenId: course.id, plannedAt: planned, person: course.person, medicineName, kind, startedAt: anchor, dueAt: anchor + minutes * 60000 }
}
export function timerReminder(timer: MealTimer, personName?: string): Reminder {
  const title = timer.kind === 'eat' ? 'Можно начинать есть' : 'Время принять препарат после еды'
  const body = [personName, timer.medicineName].filter(Boolean).join(' · ')
  return { id: Number(timer.id), kind: 'timer', title, body, details: `${title}: ${body}`, markable: false, at: timer.dueAt, day: startOfDay(timer.dueAt), slot: timer.id, step: 0, person: timer.person }
}
export function timerEntry(timer: MealTimer): NotificationEntry {
  const reminder = timerReminder(timer)
  return { id: `timer:${timer.id}`, kind: 'timer', at: timer.dueAt, title: reminder.title, body: reminder.body, person: timer.person }
}
/** One event per confirmed stock snapshot; resolving the problem cancels future alerts. */
export function stockEntries(stock: Stock[], now: number, history: NotificationEntry[]): NotificationEntry[] {
  const entries: NotificationEntry[] = []
  for (const item of stock) {
    if (!item.intakes.some(c => !regimenFinished(c, now, stageOn(c, now)))) continue
    let alert = medicineAlert(item.box, item.intakes, now)
    let due = now + 3000
    if (!alert) {
      for (let i=1; i<=14; i++) {
        const day = addDays(new Date(now), i)
        if (item.intakes.every(c => regimenFinished(c, day.getTime(), stageOn(c, day.getTime())))) break
        alert = medicineAlert(item.box, item.intakes, momentOf(day, 9*60))
        if (alert) { due = momentOf(day,9*60); break }
      }
    }
    if (!alert) continue
    const fingerprint = JSON.stringify(item.intakes.map(c => [c.regimenId,c.times,c.plan,c.perTime,c.perDay,c.rhythm,c.endsAt,c.planFrom,c.startedAt,c.doseUnit,c.dropsPerMl]).sort((a,b) => String(a[0]).localeCompare(String(b[0]))))
    const id = `stock:${item.box.id}:${alert.kind}:${item.box.stockUpdatedAt ?? item.box.leftAt ?? 0}:${item.box.expires ?? 0}:${item.box.supplyWarningDays ?? item.box.defaultSupplyWarningDays ?? 7}:${item.box.expiryWarningDays ?? item.box.defaultExpiryWarningDays ?? 7}:${fingerprint}`
    const previous = history.find(e => e.id === id)
    if (previous) { entries.push(previous); continue }
    const title = alert.kind === 'out' ? 'Запас препарата закончился' : alert.kind === 'low' ? 'Запас препарата заканчивается' : alert.kind === 'expired' ? 'Срок годности истёк' : 'Срок годности скоро истечёт'
    entries.push({ id, kind: 'stock', at: due, title, body: `${item.box.name}${alert.kind === 'low' ? ` · хватит примерно на ${alert.days} дн.` : ''}` })
  }
  return entries
}
export function stockReminders(entries: NotificationEntry[], now: number): Reminder[] {
  // Sorted IDs and linear probing avoid collisions and remain stable for this queue.
  const used = new Set<number>()
  return entries.filter(e => e.at > now).sort((a,b) => a.id.localeCompare(b.id)).map(e => {
    let hash = 0; for (const char of e.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
    let id = 18_700_000 + hash % 400000
    while (used.has(id)) id = 18_700_000 + (id + 1 - 18_700_000) % 400000
    used.add(id)
    return { id, kind: 'stock', title: e.title, body: e.body, details: e.body, markable: false, at: e.at, slot: e.id, day: startOfDay(e.at), step: 0 }
  })
}

export function doseEntries(courses: Dosing[], now: number): NotificationEntry[] {
  const groups = new Map<string, NotificationEntry>()
  for (let i=-1;i<=0;i++) {
    const day=addDays(new Date(now),i).getTime()
    for (const course of courses) {
      for (const slot of dosesOn(course,day,now)) {
        const at=plannedAt(day,slot.time)
        if (at>now) continue
        const actual=course.intakeState?.[String(at)]
        if (actual?.taken && actual.at<at) continue
        const id=`dose:${course.person}:${day}:${slot.time}`
        const amount=perTimeOf(course,day)
        const line=`${course.name} · ${formatCount(amount)} ${doseUnit(course,amount)}${course.mealMinutes && course.meal ? ` · ${course.meal === 'before' ? 'за' : 'через'} ${course.mealMinutes} мин ${course.meal === 'before' ? 'до' : 'после'} еды` : ''}`
        const existing=groups.get(id)
        if (existing) existing.body += `; ${line}`
        else groups.set(id,{id,kind:'dose',at,title:`Приём по расписанию · ${slot.time}`,body:line,person:course.person})
      }
    }
  }
  return [...groups.values()]
}
