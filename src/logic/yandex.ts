/**
 * Обмен через Яндекс.Диск: адреса, ключ и имена файлов.
 *
 * Здесь нет сети — только то, что можно проверить обычными тестами. Сами
 * запросы делает платформа: на телефоне мимо браузерных правил, в браузере
 * обычным `fetch`.
 *
 * **Почему Диск, а не WebDAV.** WebDAV из браузера закрыт наглухо — сервер не
 * отдаёт заголовков, без которых чужому сайту нельзя прочитать ответ, — а у
 * Яндекса он вдобавок работает только по платной подписке 360. Обычный
 * интерфейс Диска браузер пускает: проверено запросами 2 и 5 сентября 2026.
 *
 * **Что браузер умеет, а что нет.** Проверено с настоящим ключом 5 сентября:
 * список папки и загрузка файла работают (загрузка вернула 201), а скачивание
 * блокируется — тело файла отдаёт отдельный хост `downloader.disk.yandex.ru`,
 * и он не разрешает чужому сайту прочитать ответ. Поэтому браузер отдаёт свой
 * дневник, но чужие читает только на телефоне или через папку клиента Диска.
 *
 * **Права.** Приложение просит единственное — доступ к своей папке
 * (`cloud_api:disk.app_folder`). Остального Диска оно не видит, и это лучше
 * полного доступа, который просят программы вроде Safe in Cloud.
 */

/** Идентификатор приложения в Яндексе. Публичный по устройству OAuth. */
export const YANDEX_CLIENT_ID = 'e11e6f93b04e4b23b6532e3189ff2839'

/** Папка приложения на Диске. Всё остальное приложению недоступно. */
export const DISK_FOLDER = 'app:/'

const API = 'https://cloud-api.yandex.net/v1/disk'

/**
 * Страница входа.
 *
 * Ключ обмена приложение получить не может: секрета у него нет и быть не
 * должно — он лежал бы прямо в установленном приложении. Поэтому Яндекс
 * показывает ключ человеку, тот его копирует и вставляет в приложение. Один
 * раз примерно на год.
 */
export function authUrl(): string {
  const p = new URLSearchParams({ response_type: 'token', client_id: YANDEX_CLIENT_ID })
  return `https://oauth.yandex.ru/authorize?${p}`
}

/**
 * Вытащить ключ из того, что человек вставил.
 *
 * Вставляют по-разному: сам ключ, всю строку адреса с ним, строку с подписью
 * «access_token=». Разбираем всё это молча — переспрашивать человека, который
 * уже сделал что просили, невежливо.
 */
export function parseToken(pasted: string): string | null {
  const текст = pasted.trim()
  if (!текст) return null
  const изАдреса = текст.match(/access_token=([\w.-]+)/)
  if (изАдреса) return изАдреса[1]
  // Голый ключ: буквы, цифры, подчёркивания. Пробелов и кавычек в нём не бывает.
  const голый = текст.match(/^[\w.-]{20,}$/)
  return голый ? голый[0] : null
}

/** Заголовок с ключом — один на все запросы. */
export function authHeader(token: string): Record<string, string> {
  return { Authorization: `OAuth ${token}` }
}

export const listUrl = (limit = 100): string =>
  `${API}/resources?${new URLSearchParams({ path: DISK_FOLDER, limit: String(limit) })}`

export const uploadUrl = (name: string): string =>
  `${API}/resources/upload?${new URLSearchParams({ path: DISK_FOLDER + name, overwrite: 'true' })}`

export const downloadUrl = (name: string): string =>
  `${API}/resources/download?${new URLSearchParams({ path: DISK_FOLDER + name })}`

export const deleteUrl = (name: string): string =>
  `${API}/resources?${new URLSearchParams({ path: DISK_FOLDER + name, permanently: 'false' })}`

/**
 * Метка установки в имени файла: последние шесть знаков её идентификатора.
 *
 * Идентификатор вида `i` + время + шесть случайных знаков заводится один раз и
 * живёт, пока живёт приложение на этом телефоне. Берём случайный хвост, а не
 * начало: начало — это время установки, и у двух телефонов, настроенных в один
 * день, оно похоже.
 *
 * Пустая строка означает «метки нет» — идентификатор не прочитался. Лучше
 * старое имя без метки, чем `дневник-.json`.
 */
export function installSuffix(installId: string | undefined | null): string {
  const чистый = (installId ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return чистый.length >= 4 ? чистый.slice(-6) : ''
}

/**
 * Имя файла этого телефона.
 *
 * Две части, и обе обязательны.
 *
 * **Имя человека** — чтобы папку можно было читать глазами: в ней лежит
 * несколько дневников, и одинаковые названия не разобрать.
 *
 * **Метка установки** — чтобы два телефона не писали в один файл. До 0.30.0
 * имя строилось только из имени человека, а человек по умолчанию называется
 * «Я»: у двух неназванных телефонов выходил один `дневник.json`. Они затирали
 * друг друга при записи и пропускали как своё при чтении — обмен между ними не
 * работал вовсе, и каждая запись стоила чужой.
 *
 * Метка ещё и переживает переименование: человек сменил имя — сменилось имя
 * файла, но прежний файл узнаётся по метке и убирается. Без неё он остался бы
 * в папке навсегда и продолжал бы приходить как чужой дневник.
 */
export function diskFileName(personName: string | undefined | null, installId?: string | null): string {
  const чей = (personName ?? '').trim().replace(/[\\/:*?"<>|]/g, '')
  const метка = installSuffix(installId)
  const кто = чей && чей !== 'Я' ? `-${чей}` : ''
  return метка ? `дневник${кто}-${метка}.json` : `дневник${кто}.json`
}

/** Наш ли это файл: то же имя или прежнее имя этой же установки. */
export function ownFile(name: string, installId: string | undefined | null): boolean {
  const метка = installSuffix(installId)
  return !!метка && name.toLowerCase().endsWith(`-${метка}.json`)
}

/**
 * Файл старого образца — без метки установки.
 *
 * Такой мог писать не один телефон, поэтому сам его не трогаем: удалить чужое
 * страшнее, чем оставить лишнее. Показываем и объясняем.
 */
export function legacyFile(name: string): boolean {
  return /^дневник(-.+)?\.json$/i.test(name) && !/-[a-z0-9]{6}\.json$/i.test(name)
}

/**
 * Как назвать файл человеку.
 *
 * Метка установки в имени нужна машине, а не глазам: «Отец-x7b4z2» человек
 * читать не должен. Свой файл называем прямо — иначе два неназванных телефона
 * в папке не различить.
 *
 * Хвост снимается раньше начала: у неназванного человека имя состоит из одной
 * метки, и сняв сперва «дневник-», мы бы показали саму метку.
 */
export function fileLabel(name: string, mine = false): string {
  if (mine) return 'этот телефон'
  const без = name
    .replace(/\.json$/i, '')
    .replace(/-[a-z0-9]{6}$/i, '')
    .replace(/^дневник-?/i, '')
  return без || 'дневник без имени'
}

/** Файл в папке приложения, как его описывает Диск. */
export interface DiskFile {
  name: string
  /** Когда изменён, миллисекунды. `null` — Диск не сказал. */
  modified: number | null
  size: number | null
}

/**
 * Разобрать ответ со списком папки.
 *
 * Берём только `.json` и молча пропускаем всё остальное: человек мог положить
 * в папку что угодно, и падать из-за этого нельзя.
 */
export function parseListing(raw: unknown): DiskFile[] {
  const items = (raw as { _embedded?: { items?: unknown[] } })?._embedded?.items
  if (!Array.isArray(items)) return []
  return items
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .filter((x) => x.type === 'file' && typeof x.name === 'string' && (x.name as string).toLowerCase().endsWith('.json'))
    .map((x) => ({
      name: x.name as string,
      modified: typeof x.modified === 'string' ? (Date.parse(x.modified) || null) : null,
      size: typeof x.size === 'number' ? x.size : null,
    }))
}

/** Ссылка на загрузку или скачивание из ответа Диска. */
export function parseHref(raw: unknown): string | null {
  const href = (raw as { href?: unknown })?.href
  return typeof href === 'string' && href.startsWith('https://') ? href : null
}
