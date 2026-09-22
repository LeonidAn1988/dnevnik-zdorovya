/**
 * Яндекс.Диск на телефоне.
 *
 * Здесь ограничений браузера нет: запросы идут через нативный слой Capacitor,
 * поэтому работает и скачивание чужих дневников — то, что в вебе запрещает сам
 * Яндекс. Отдельной зависимости не нужно, `CapacitorHttp` лежит в ядре.
 */

import { CapacitorHttp } from '@capacitor/core'
import type { CloudPort } from '../ports'
import { authHeader, deleteUrl, downloadUrl, listUrl, parseHref, parseListing, uploadUrl, type DiskFile } from '../../logic/yandex'

const KEY = 'omron.yandex-token'

function запомненный(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

async function get(url: string, token?: string): Promise<{ status: number; data: unknown }> {
  const { status, data } = await CapacitorHttp.get({
    url,
    headers: token ? authHeader(token) : undefined,
    // Ответ разбираем сами: Диск отдаёт JSON, а тело чужого дневника — текст,
    // и заставлять плагин угадывать значит получить `[object Object]`.
    responseType: 'text',
  })
  return { status, data }
}

function разобрать(data: unknown): unknown {
  if (typeof data !== 'string') return data
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

export const capacitorCloud: CloudPort = {
  token: запомненный,

  setToken(value) {
    try {
      if (value) localStorage.setItem(KEY, value)
      else localStorage.removeItem(KEY)
    } catch {
      // Хранилище закрыто — ключ проживёт эту сессию.
    }
  },

  canDownload() {
    return true
  },

  async list(): Promise<DiskFile[]> {
    const token = запомненный()
    if (!token) return []
    const { status, data } = await get(listUrl(), token)
    if (status !== 200) throw new Error(`Диск ответил ${status}`)
    return parseListing(разобрать(data))
  },

  async upload(name, content) {
    const token = запомненный()
    if (!token) throw new Error('Яндекс.Диск не подключён')
    const ссылка = await get(uploadUrl(name), token)
    if (ссылка.status !== 200) throw new Error(`Диск ответил ${ссылка.status}`)
    const href = parseHref(разобрать(ссылка.data))
    if (!href) throw new Error('Диск не дал ссылку для загрузки')
    const { status } = await CapacitorHttp.put({ url: href, data: content, headers: { 'Content-Type': 'application/json' } })
    if (status < 200 || status >= 300) throw new Error(`Загрузка не прошла: ${status}`)
  },

  async download(name) {
    const token = запомненный()
    if (!token) return null
    const ссылка = await get(downloadUrl(name), token)
    if (ссылка.status !== 200) return null
    const href = parseHref(разобрать(ссылка.data))
    if (!href) return null
    const { status, data } = await get(href)
    if (status !== 200) return null
    return typeof data === 'string' ? data : JSON.stringify(data)
  },

  async remove(name) {
    const token = запомненный()
    if (!token) throw new Error('Яндекс.Диск не подключён')
    const { status } = await CapacitorHttp.delete({ url: deleteUrl(name), headers: authHeader(token) })
    // 204 — убрали, 202 — убирают, 404 — уже нет. Всё это «файла больше нет».
    if (status !== 204 && status !== 202 && status !== 404) throw new Error(`Диск ответил ${status}`)
  },
}
