/** Additive backup restore. Unlike family sync, an existing local record wins. */
import type { Settings } from '../types'
import { fillMissingFromCopy, mergeRestoredSettings, takesPersonalFrom, type ImportResult } from './io'
import { mergeLab, type Diary } from './merge'
import { redirectPerson } from './people'
import { normalizeSettings } from './settings'

export interface RestoreResult extends Diary {
  settings: Settings
  added: number
  addedMedicines: number
  settingsRestored: boolean
}

export function restoreDiary(current: Diary, local: Settings, incoming: ImportResult): RestoreResult {
  const redirects = { ...incoming.settings?.mergedPeople, ...local.mergedPeople }
  const graves = new Map(current.tombstones.map(t => [t.id, t]))
  for (const t of incoming.tombstones) {
    const old = graves.get(t.id)
    if (!old || t.at > old.at) graves.set(t.id, t)
  }
  const alive = <T extends { id: string }>(items: T[]) => items.filter(item => !graves.has(item.id))
  const readings = new Map(alive(current.measurements).map(m => [m.id, m]))
  let added = 0, addedMedicines = 0
  for (const m of alive(incoming.measurements)) if (!readings.has(m.id)) {
    readings.set(m.id, { ...m, person: redirectPerson(m.person, redirects) ?? undefined }); added++
  }
  const medicines = new Map(alive(current.medicines).map(m => [m.id, m]))
  for (const m of alive(incoming.medicines)) if (!medicines.has(m.id)) { medicines.set(m.id, m); addedMedicines++ }
  const regimens = new Map(alive(current.regimens).map(r => [r.id, r]))
  for (const r of alive(incoming.regimens)) {
    if (!medicines.has(r.medicineId)) continue
    const item = { ...r, person: redirectPerson(r.person, redirects) ?? r.person }
    const old = regimens.get(r.id)
    regimens.set(r.id, old ? fillMissingFromCopy(old, item) : item)
  }
  const labs = new Map(alive(current.labs).map(l => [l.id, l]))
  for (const l of alive(incoming.labs)) {
    const item = { ...l, owner: redirectPerson(l.owner, redirects) ?? l.owner }
    const old = labs.get(l.id)
    labs.set(l.id, old ? mergeLab(old, item) ?? old : item)
  }
  const settings = incoming.settings ? normalizeSettings(mergeRestoredSettings(local, incoming.settings)) : local
  return { measurements: [...readings.values()].sort((a, b) => a.ts - b.ts), medicines: [...medicines.values()], regimens: [...regimens.values()],
    labs: [...labs.values()], tombstones: [...graves.values()], people: settings.people, settings, added, addedMedicines,
    settingsRestored: !!incoming.settings && takesPersonalFrom(local, incoming.settings) }
}
