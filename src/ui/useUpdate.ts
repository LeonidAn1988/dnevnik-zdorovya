/**
 * Проверка обновления и его установка.
 *
 * Состояние держится здесь, а не в настройках: «когда проверяли» и «эту версию
 * не предлагать» — это про телефон, а не про человека, и в копию дневника им
 * ехать незачем. Поэтому `localStorage`, как у пароля копии.
 *
 * Проверка идёт при открытии приложения и не чаще раза в сутки. Ничего не
 * скачивается само: сеть трогается ровно дважды — маленький текстовый файл при
 * проверке и сам APK после нажатия «Обновить».
 */

import { useCallback, useEffect, useState } from 'react'
import { parseChangelog, type Release } from '../logic/changelog'
import { АДРЕС_ВЫПУСКА, АДРЕС_ИСТОРИИ, apkFrom, newerThan, пораПроверять } from '../logic/update'
import { platform } from '../platform/ports'

const КОГДА = 'omron.update-checked'
const ПРОПУЩЕНА = 'omron.update-skipped'

/** Чтение и запись местных пометок: без них проверка шла бы при каждом запуске. */
function прочитать(ключ: string): string | null {
  try {
    return localStorage.getItem(ключ)
  } catch {
    return null
  }
}

function записать(ключ: string, значение: string): void {
  try {
    localStorage.setItem(ключ, значение)
  } catch {
    // Приватный режим, забитое хранилище — проверка просто пойдёт снова.
  }
}

export type Этап = 'нет' | 'качаем' | 'ставим'

export interface UpdateState {
  /** Выпуски новее установленного, свежий первым. Пусто — обновляться незачем. */
  свежие: Release[]
  /** Человек сказал «не сейчас» про эту самую версию. */
  отложено: boolean
  проверяем: boolean
  этап: Этап
  /** Доля скачанного, 0…1. Может стоять на месте: не все версии плагина её шлют. */
  доля: number
  ошибка: string | null
  /** Нужно разрешение на установку, и системный экран открыть не удалось. */
  некудаРазрешить: boolean
  проверить: () => Promise<void>
  обновить: () => Promise<void>
  отложить: () => void
}

export function useUpdate(installed: string): UpdateState {
  const [свежие, setСвежие] = useState<Release[]>([])
  const [проверяем, setПроверяем] = useState(false)
  const [этап, setЭтап] = useState<Этап>('нет')
  const [доля, setДоля] = useState(0)
  const [ошибка, setОшибка] = useState<string | null>(null)
  const [некудаРазрешить, setНекудаРазрешить] = useState(false)
  const [пропущена, setПропущена] = useState<string | null>(() => прочитать(ПРОПУЩЕНА))

  const умеет = platform().update.canSelfUpdate()

  const проверить = useCallback(async () => {
    if (!умеет) return
    setПроверяем(true)
    setОшибка(null)
    try {
      // `cache: 'no-store'` — иначе раздающая сеть отдаёт вчерашний файл, и
      // приложение объявляет себя свежим ровно тогда, когда вышло обновление.
      const ответ = await fetch(АДРЕС_ИСТОРИИ, { cache: 'no-store' })
      if (!ответ.ok) throw new Error(`история версий не отдалась (${ответ.status})`)
      setСвежие(newerThan(parseChangelog(await ответ.text()), installed))
      записать(КОГДА, String(Date.now()))
    } catch (поймано) {
      // Молчим в интерфейсе: нет сети — не повод пугать человека на «Обзоре».
      // Ошибку показываем только там, где он сам нажал «Проверить».
      setОшибка(поймано instanceof Error ? поймано.message : String(поймано))
    } finally {
      setПроверяем(false)
    }
  }, [installed, умеет])

  // Одна проверка при открытии приложения, не чаще раза в сутки.
  useEffect(() => {
    if (!умеет) return
    const было = Number(прочитать(КОГДА)) || undefined
    if (!пораПроверять(было, Date.now())) return
    void проверить()
  }, [проверить, умеет])

  const обновить = useCallback(async () => {
    const порт = platform().update
    setОшибка(null)
    setНекудаРазрешить(false)
    try {
      // Разрешение спрашиваем до скачивания: качать восемь мегабайт, чтобы
      // упереться в запрет, — это потратить чужой трафик впустую.
      if (!(await порт.canInstall())) {
        const открылось = await порт.requestInstall()
        setНекудаРазрешить(!открылось)
        // Возвращаемся, даже если экран открылся: человек ещё не дал согласия,
        // и продолжать надо по второму нажатию, когда он вернётся.
        return
      }
      setЭтап('качаем')
      setДоля(0)
      const ответ = await fetch(АДРЕС_ВЫПУСКА, { cache: 'no-store' })
      if (!ответ.ok) throw new Error(`не узнать, где файл обновления (${ответ.status})`)
      const файл = apkFrom(await ответ.json())
      if (!файл) throw new Error('в последнем выпуске нет файла приложения')
      const путь = await порт.download(файл.url, setДоля)
      setЭтап('ставим')
      await порт.install(путь)
    } catch (поймано) {
      setОшибка(поймано instanceof Error ? поймано.message : String(поймано))
    } finally {
      setЭтап('нет')
    }
  }, [])

  const отложить = useCallback(() => {
    const версия = свежие[0]?.version
    if (!версия) return
    записать(ПРОПУЩЕНА, версия)
    setПропущена(версия)
  }, [свежие])

  return {
    свежие,
    отложено: !!пропущена && пропущена === свежие[0]?.version,
    проверяем,
    этап,
    доля,
    ошибка,
    некудаРазрешить,
    проверить,
    обновить,
    отложить,
  }
}
