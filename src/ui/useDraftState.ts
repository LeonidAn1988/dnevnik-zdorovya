import { useCallback, useSyncExternalStore, type SetStateAction } from 'react'

// Только память этой вкладки. Живой экземпляр узнаёт и о завершении записи
// из формы, размонтированной при переключении на другого человека.
const drafts = new Map<string, unknown>()
const listeners = new Map<string, Set<() => void>>()

export function useDraftState<T>(key: string, initial: T | (() => T)) {
  if (!drafts.has(key)) drafts.set(key, typeof initial === 'function' ? (initial as () => T)() : initial)
  const subscribe = useCallback((notify: () => void) => {
    if (!listeners.has(key)) listeners.set(key, new Set())
    listeners.get(key)!.add(notify)
    return () => { listeners.get(key)?.delete(notify) }
  }, [key])
  const snapshot = useCallback(() => drafts.get(key) as T, [key])
  const value = useSyncExternalStore(subscribe, snapshot, snapshot)
  const update = useCallback((next: SetStateAction<T>) => {
    const previous = drafts.get(key) as T
    const result = typeof next === 'function' ? (next as (value: T) => T)(previous) : next
    if (Object.is(result, previous)) return
    drafts.set(key, result)
    listeners.get(key)?.forEach(notify => notify())
  }, [key])
  return [value, update] as const
}

/** Черновик формы живёт только до закрытия приложения, отдельно для каждого
 * объекта и человека. Изменение исходной модели требует явного решения:
 * старый ввод нельзя незаметно записать поверх семейной синхронизации. */
export function useFormDraft(key: string, source: unknown) {
  const signature = JSON.stringify(source)
  const [draft, setDraft] = useDraftState<{ base: string; fields: Record<string, unknown> }>(
    `form:${key}`, () => ({ base: signature, fields: {} }),
  )
  const hasChanges = Object.keys(draft.fields).length > 0
  const conflict = hasChanges && draft.base !== signature

  function field<T>(name: string, initial: T): readonly [T, (next: SetStateAction<T>) => void] {
    const value = Object.hasOwn(draft.fields, name) ? draft.fields[name] as T : initial
    const update = (next: SetStateAction<T>) => setDraft(previous => {
      const before = Object.hasOwn(previous.fields, name) ? previous.fields[name] as T : initial
      const result = typeof next === 'function' ? (next as (value: T) => T)(before) : next
      if (Object.is(before, result)) return previous
      return {
        base: Object.keys(previous.fields).length ? previous.base : signature,
        fields: { ...previous.fields, [name]: result },
      }
    })
    return [value, update]
  }

  return {
    field,
    conflict,
    hasChanges,
    // Завершившаяся старая запись не стирает более новый ввод, если человек
    // успел вернуться к форме, пока сохранение ещё шло.
    clear: () => setDraft(previous => previous === draft ? { base: signature, fields: {} } : previous),
    keep: () => setDraft(previous => ({ ...previous, base: signature })),
  }
}
