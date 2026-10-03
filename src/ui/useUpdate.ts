/** Предложение и установка конкретного опубликованного Android-выпуска. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Release } from '../logic/changelog'
import { АДРЕС_ВЫПУСКОВ, compareVersions, publishedUpdates, releaseAddress, releasePage, пораПроверять, type PublishedUpdate } from '../logic/update'
import { platform } from '../platform/ports'

const КОГДА = 'omron.update-checked'
function прочитать(ключ: string): string | null {
  try { return localStorage.getItem(ключ) } catch { return null }
}
function записать(ключ: string, значение: string): void {
  try { localStorage.setItem(ключ, значение) } catch { /* Проверка не зависит от localStorage. */ }
}

async function readRelease(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
    if (!response.ok) throw new Error(`Не удалось проверить обновление (${response.status}). Попробуйте позже.`)
    return await response.json()
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Сервер обновлений не ответил. Проверьте связь и попробуйте ещё раз.')
    throw error
  } finally { clearTimeout(timeout) }
}

export type Этап = 'нет' | 'качаем' | 'ставим'
export interface UpdateState {
  свежие: Release[]
  страница: string | null
  /** Отложено до следующего открытия приложения, а не навсегда для версии. */
  отложено: boolean
  проверяем: boolean
  этап: Этап
  доля: number
  ошибка: string | null
  некудаРазрешить: boolean
  проверить: () => Promise<void>
  обновить: () => Promise<void>
  отложить: () => void
}

export function useUpdate(installed: string): UpdateState {
  const [свежие, setСвежие] = useState<PublishedUpdate[]>([])
  const [проверяем, setПроверяем] = useState(false)
  const [этап, setЭтап] = useState<Этап>('нет')
  const [доля, setДоля] = useState(0)
  const [ошибка, setОшибка] = useState<string | null>(null)
  const [некудаРазрешить, setНекудаРазрешить] = useState(false)
  const [пропущена, setПропущена] = useState<string | null>(null)
  const checking = useRef<Promise<void> | null>(null)
  const installing = useRef(false)
  const умеет = platform().update.canSelfUpdate()

  const проверить = useCallback((): Promise<void> => {
    if (!умеет || installing.current) return Promise.resolve()
    if (checking.current) return checking.current
    setПроверяем(true)
    setОшибка(null)
    const work = (async () => {
      try {
        const updates = publishedUpdates(await readRelease(АДРЕС_ВЫПУСКОВ))
          .filter(release => compareVersions(release.version, installed) > 0)
        // Результат проверки, начатой раньше установки, не подменяет
        // показанную версию, пока её APK скачивается или открывается.
        if (!installing.current) {
          setСвежие(updates)
          записать(КОГДА, String(Date.now()))
        }
      } catch (error) {
        setОшибка(error instanceof Error ? error.message : String(error))
      } finally {
        setПроверяем(false)
        checking.current = null
      }
    })()
    checking.current = work
    return work
  }, [installed, умеет])

  useEffect(() => {
    if (!умеет) return
    void проверить()
    const проснулись = () => {
      if (document.visibilityState !== 'visible') return
      if (!installing.current) setПропущена(null)
      const было = Number(прочитать(КОГДА)) || undefined
      if (пораПроверять(было, Date.now())) void проверить()
    }
    document.addEventListener('visibilitychange', проснулись)
    return () => document.removeEventListener('visibilitychange', проснулись)
  }, [проверить, умеет])

  const обновить = useCallback(async () => {
    if (installing.current) return
    const offered = свежие[0]
    if (!offered) return
    installing.current = true
    const порт = platform().update
    setОшибка(null)
    setНекудаРазрешить(false)
    try {
      if (!(await порт.canInstall())) {
        setНекудаРазрешить(!(await порт.requestInstall()))
        return
      }
      setЭтап('качаем')
      setДоля(0)
      const response = await readRelease(releaseAddress(offered.tag))
      const verified = publishedUpdates([response]).find(release => release.tag === offered.tag && release.version === offered.version)
      if (!verified) throw new Error(`Файл версии ${offered.version} сейчас недоступен. Проверьте обновления ещё раз.`)
      const path = await порт.download(verified.apk.url, setДоля)
      setЭтап('ставим')
      await порт.install(path)
    } catch (error) {
      setОшибка(error instanceof Error ? error.message : String(error))
    } finally {
      installing.current = false
      setЭтап('нет')
    }
  }, [свежие])

  const отложить = useCallback(() => setПропущена(свежие[0]?.version ?? null), [свежие])
  return { свежие, страница: свежие[0] ? releasePage(свежие[0].tag) : null, отложено: !!пропущена && пропущена === свежие[0]?.version, проверяем, этап, доля, ошибка, некудаРазрешить, проверить, обновить, отложить }
}
