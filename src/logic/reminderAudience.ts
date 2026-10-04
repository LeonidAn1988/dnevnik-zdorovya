import type { Settings } from '../types'
import { redirectPerson } from './people'

/** Device-local subscriptions. Missing setting preserves the previous all-people behaviour. */
export function reminderPeopleOf(settings: Pick<Settings, 'people' | 'reminderPeople' | 'mergedPeople'>): string[] {
  if (!Array.isArray(settings.reminderPeople)) return settings.people.map(p => p.id)
  const selected = new Set(settings.reminderPeople.map(id => redirectPerson(id, settings.mergedPeople)))
  return settings.people.filter(p => selected.has(p.id)).map(p => p.id)
}
