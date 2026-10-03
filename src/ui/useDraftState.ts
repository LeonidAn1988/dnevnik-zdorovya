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
