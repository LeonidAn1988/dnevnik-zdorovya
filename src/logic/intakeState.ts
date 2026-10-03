import type { Regimen } from '../types'

type States = NonNullable<Regimen['intakeState']>
type History = NonNullable<Regimen['historyState']>

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
export function calendarDay(stamp: number): string {
  const date = new Date(stamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const isDay = (key: string): boolean => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(key)
const timestamp = (key: string): boolean => /^\d+$/.test(key) && Number.isFinite(Number(key))

export function parseIntakeState(value: unknown): Regimen['intakeState'] {
  const result: States = {}
  for (const [key, raw] of Object.entries(record(value))) {
    const cell = record(raw)
    if (timestamp(key) && finite(cell.at) && typeof cell.taken === 'boolean') result[String(Number(key))] = { at: cell.at, taken: cell.taken, ...(typeof cell.day === 'string' && isDay(cell.day) ? { day: cell.day } : {}) }
  }
  return Object.keys(result).length ? mergeIntakeStates({}, result) : undefined
}

export function parseHistoryState(value: unknown): Regimen['historyState'] {
  const raw = record(value)
  if (raw.version !== 1) return undefined
  const result: History = { version: 1, legacy: {}, planned: {} }
  for (const [key, item] of Object.entries(record(raw.legacy))) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) continue
    const cells = (Array.isArray(item) ? item : [item]).map(record).filter(cell => finite(cell.planned) && finite(cell.taken) && finite(cell.until))
    result.legacy[key] = cells.map(cell => ({ planned: cell.planned as number, taken: cell.taken as number, until: cell.until as number, untilDay: typeof cell.untilDay === 'string' && isDay(cell.untilDay) ? cell.untilDay : undefined }))
  }
  for (const [key, item] of Object.entries(record(raw.planned))) {
    const cell = record(item)
    if ((isDay(key) || timestamp(key)) && finite(cell.count) && finite(cell.at)) result.planned[isDay(key) ? key : calendarDay(Number(key))] = { count: cell.count, at: cell.at }
  }
  return mergeHistoryState({ version: 1, legacy: {}, planned: {} }, result)
}

export function intakeStates(course: Regimen): States {
  const states: States = {}
  for (const stamp of course.taken ?? []) states[stamp] = { at: 0, taken: true, day: calendarDay(stamp) }
  for (const stamp of course.untaken ?? []) states[stamp] = { at: 0, taken: false, day: calendarDay(stamp) }
  return mergeIntakeStates(states, course.intakeState ?? {})
}

export function mergeIntakeStates(a: States, b: States): States {
  const result: States = {}
  for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort((x, y) => Number(x) - Number(y))) {
    const left = a[key], right = b[key]
    const day = [left?.day, right?.day].filter((value): value is string => !!value).sort()[0]
    result[key] = !left ? right : !right ? left : left.at > right.at ? left : right.at > left.at ? right : { at: left.at, taken: left.taken && right.taken, ...(day ? { day } : {}) }
  }
  return result
}

function month(stamp: number): string {
  const date = new Date(stamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function historyState(course: Regimen): History {
  if (course.historyState) return { version: 1, legacy: { ...course.historyState.legacy }, planned: { ...course.historyState.planned } }
  const legacy: History['legacy'] = {}
  for (const [key, cell] of Object.entries(course.history ?? {})) {
    const [year, month] = key.split('-').map(Number)
    const end = new Date(year, month, 1).getTime()
    const until = Math.min(course.foldedUntil ?? end, end)
    legacy[key] = [{ ...cell, until, untilDay: calendarDay(until) }]
  }
  return { version: 1, legacy, planned: {} }
}

export function mergeHistoryState(a: History, b: History): History {
  const result: History = { version: 1, legacy: { ...a.legacy }, planned: { ...a.planned } }
  for (const key of new Set([...Object.keys(a.legacy), ...Object.keys(b.legacy)])) {
    const boundaries = new Map<string, History['legacy'][string][number]>()
    for (const cell of [...(a.legacy[key] ?? []), ...(b.legacy[key] ?? [])]) {
      // Календарный день нужен назначениям, точная граница — отметкам.
      // Одинаковая дата в двух поясах не означает одинаковое окно baseline.
      const boundary = `${cell.untilDay ?? ''}:${cell.until}`
      const own = boundaries.get(boundary)
      boundaries.set(boundary, own ? { planned: Math.max(own.planned, cell.planned), taken: Math.max(own.taken, cell.taken), until: Math.max(own.until, cell.until), untilDay: cell.untilDay } : cell)
    }
    result.legacy[key] = [...boundaries.values()].sort((a,b) => a.until - b.until)
  }
  for (const [key, cell] of Object.entries(b.planned)) {
    const own = result.planned[key]
    if (!own || cell.at > own.at || (cell.at === own.at && cell.count > own.count)) result.planned[key] = cell
  }
  result.planned = Object.fromEntries(Object.entries(result.planned).sort(([a], [b]) => a.localeCompare(b)))
  result.legacy = Object.fromEntries(Object.entries(result.legacy).sort(([a], [b]) => a.localeCompare(b)))
  return result
}

/** Проекции для старого формата. Неизвестное пересечение legacy не суммируется. */
export function projectIntakes(course: Regimen, states: States, history: History, cutoff = course.foldedUntil ?? 0): Regimen {
  const cells = new Map<string, { taken: number[]; planned: { day: string; count: number }[] }>()
  const cell = (key: string) => {
    if (!cells.has(key)) cells.set(key, { taken: [], planned: [] })
    return cells.get(key)!
  }
  for (const key of Object.keys(history.legacy)) cell(key)
  for (const [key, entry] of Object.entries(states)) {
    const stamp = Number(key)
    if (stamp < cutoff && entry.taken) {
      // Legacy — итог без ID отдельных приёмов. Его календарный месяц мог
      // быть записан в другом поясе. Сопоставляем покрытие по точным границам,
      // иначе общий приём у полуночи прибавится ещё раз в соседнем месяце.
      let belongs = entry.day?.slice(0, 7) ?? month(stamp)
      for (const key of Object.keys(history.legacy).sort()) {
        const [year, monthNumber] = key.split('-').map(Number)
        const covered = history.legacy[key].some(base => {
          const untilDay = base.untilDay ?? calendarDay(base.until)
          const offset = base.until - Date.parse(`${untilDay}T00:00:00Z`)
          const from = Date.UTC(year, monthNumber - 1, 1) + offset
          return stamp >= from && stamp < base.until
        })
        if (covered) { belongs = key; break }
      }
      cell(belongs).taken.push(stamp)
    }
  }
  for (const [key, entry] of Object.entries(history.planned)) {
    if (key < calendarDay(cutoff)) cell(key.slice(0, 7)).planned.push({ day: key, count: entry.count })
  }
  const projected = Object.fromEntries([...cells].sort(([a], [b]) => a.localeCompare(b)).map(([key, cell]) => {
    let taken = cell.taken.length
    let planned = cell.planned.reduce((sum, value) => sum + value.count, 0)
    for (const base of history.legacy[key] ?? []) {
      const beforeTaken = cell.taken.filter(stamp => stamp < base.until).length
      const beforePlanned = cell.planned.filter(value => value.day < (base.untilDay ?? calendarDay(base.until))).reduce((sum, value) => sum + value.count, 0)
      taken = Math.max(taken, Math.max(base.taken, beforeTaken) + cell.taken.length - beforeTaken)
      planned = Math.max(planned, Math.max(base.planned, beforePlanned) + cell.planned.reduce((sum, value) => sum + value.count, 0) - beforePlanned)
    }
    return [key, { planned, taken }]
  }))
  const recent = Object.entries(states).filter(([key]) => Number(key) >= cutoff)
  const hasHistory = Object.keys(projected).length > 0 || !!course.historyState
  return {
    ...course,
    scheduleUpdatedAt: course.legacySchedule ? course.scheduleUpdatedAt : course.scheduleUpdatedAt ?? course.updatedAt ?? 0,
    intakeState: Object.keys(states).length ? states : undefined,
    historyState: hasHistory ? history : undefined,
    history: hasHistory ? projected : undefined,
    taken: recent.some(([, value]) => value.taken) || course.taken !== undefined ? recent.filter(([, value]) => value.taken).map(([key]) => Number(key)) : undefined,
    untaken: recent.some(([, value]) => !value.taken) || course.untaken !== undefined ? recent.filter(([, value]) => !value.taken).map(([key]) => Number(key)) : undefined,
  }
}

export function changeIntake(course: Regimen, stamp: number, taken: boolean, now: number): Regimen {
  const states = intakeStates(course)
  states[stamp] = { at: Math.max(now, (states[stamp]?.at ?? 0) + 1), taken, day: states[stamp]?.day ?? calendarDay(stamp) }
  return projectIntakes(course, mergeIntakeStates({}, states), historyState(course))
}
