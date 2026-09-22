/**
 * Яндекс.Диск из браузера.
 *
 * Проверено с настоящим ключом 5 сентября 2026: список папки и загрузка файла
 * работают, а скачивание — нет. Тело файла отдаёт отдельный хост
 * `downloader.disk.yandex.ru`, и он не разрешает чужому сайту прочитать ответ:
 * запрос возвращается с отказом ещё до того, как приложение увидит данные.
 *
 * Поэтому браузер отдаёт свой дневник семье, но чужие читает только там, где
 * есть настольный клиент Диска — через папку на диске. Обещать большее нельзя:
 * человек решит, что обмен идёт в обе стороны, и не заметит, что не получает
 * чужих отметок.
 */

import type { CloudPort } from '../ports'
import { authHeader, deleteUrl, downloadUrl, listUrl, parseHref, parseListing, uploadUrl, type DiskFile } from '../../logic/yandex'

/** Ключ — в localStorage, а не в дневнике: это связь с сервисом, а не данные. */
const KEY = 'omron.yandex-token'

function запомненный(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

async function json(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, { headers: authHeader(token) })
  if (!response.ok) throw new Error(`Диск ответил ${response.status}`)
  return response.json()
}

export const webCloud: CloudPort = {
  token: запомненный,

  setToken(value) {
    try {
      if (value) localStorage.setItem(KEY, value)
      else localStorage.removeItem(KEY)
    } catch {
      // Приватный режим: ключ проживёт эту сессию.
    }
  },

  canDownload() {
    return false
  },

  async list(): Promise<DiskFile[]> {
    const token = запомненный()
    if (!token) return []
    return parseListing(await json(listUrl(), token))
  },

  async upload(name, content) {
    const token = запомненный()
    if (!token) throw new Error('Яндекс.Диск не подключён')
    const href = parseHref(await json(uploadUrl(name), token))
    if (!href) throw new Error('Диск не дал ссылку для загрузки')
    const response = await fetch(href, { method: 'PUT', body: content })
    if (!response.ok) throw new Error(`Загрузка не прошла: ${response.status}`)
  },

  async download(name) {
    // Ссылку Диск даёт, а прочитать по ней браузеру не позволяет. Не делаем
    // вид, что попробуем: пустой ответ честнее сетевой ошибки в журнале.
    void name
    void downloadUrl
    return null
  },

  async remove(name) {
    const token = запомненный()
    if (!token) throw new Error('Яндекс.Диск не подключён')
    const response = await fetch(deleteUrl(name), { method: 'DELETE', headers: authHeader(token) })
    // 404 — файла и так нет; это не ошибка, а нужный итог.
    if (!response.ok && response.status !== 404) throw new Error(`Диск ответил ${response.status}`)
  },
}
