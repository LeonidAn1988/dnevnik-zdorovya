/**
 * Обновление приложения без магазина.
 *
 * Приложение раздаётся APK-файлом: магазина нет, автообновления нет, и до сих
 * пор единственным способом обновиться было получить файл от владельца и
 * поставить руками. На семье из пяти телефонов это означает, что половина из
 * них вечно на старой версии — а старая версия ломает обмен (`BACKLOG.md` §24б)
 * и молчит об этом.
 *
 * Предлагаем только опубликованные выпуски с готовым APK. Версия, файл и
 * заметки принадлежат одному выпуску; содержимое main ещё может не иметь APK.
 * При установке повторно проверяем выбранный тег, а не подменяем файл через
 * releases/latest. Заметки выпуска собираются из CHANGELOG.md.
 *
 * **Чего здесь нет.** Ни тихой установки, ни автоматического скачивания:
 * решение обновиться принимает человек. Установку делает системный установщик
 * Android, он же проверяет подпись — поставить чужой файл поверх дневника
 * нельзя, ключ не сойдётся.
 */

import { parseChangelog, type Release } from './changelog'

/** Где живёт проект. Единственное место в коде, где записан адрес. */
export const РЕПОЗИТОРИЙ = 'LeonidAn1988/dnevnik-zdorovya'

/**
 * История версий из репозитория, а не из выпуска.
 *
 * Берём сырой файл с ветки: он и есть источник правды для «Что изменилось», и
 * запрос к нему идёт на раздающую сеть, без ограничений по частоте, которые
 * есть у API выпусков.
 */
export const АДРЕС_ИСТОРИИ = `https://raw.githubusercontent.com/${РЕПОЗИТОРИЙ}/main/CHANGELOG.md`

/** Последний выпуск — за ним идём только тогда, когда человек нажал «Обновить». */
export const АДРЕС_ВЫПУСКА = `https://api.github.com/repos/${РЕПОЗИТОРИЙ}/releases/latest`

/** Опубликованные выпуски: порядок публикации может отличаться от версии. */
export const АДРЕС_ВЫПУСКОВ = `https://api.github.com/repos/${РЕПОЗИТОРИЙ}/releases?per_page=100`

export interface PublishedUpdate extends Release {
  tag: string
  apk: { url: string; bytes: number }
}

/** Версия, заметки и APK берутся из одного опубликованного выпуска. */
export function publishedUpdates(json: unknown): PublishedUpdate[] {
  if (!Array.isArray(json)) throw new Error('Сервер вернул непонятный список обновлений. Попробуйте позже.')
  const updates: PublishedUpdate[] = []
  for (const value of json) {
    if (!value || typeof value !== 'object') continue
    const release = value as Record<string, unknown>
    if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string') continue
    const match = /^v?(\d+\.\d+\.\d+)$/.exec(release.tag_name)
    if (!match || !Array.isArray(release.assets)) continue
    const version = match[1]
    const prefix = `https://github.com/${РЕПОЗИТОРИЙ}/releases/download/${release.tag_name}/`
    const asset = release.assets.find((asset: Record<string, unknown> | null) => {
      if (!asset || typeof asset.name !== 'string' || typeof asset.browser_download_url !== 'string') return false
      const namedVersion = /(?:^|[_-])v?(\d+\.\d+\.\d+)(?=[_.-])/.exec(asset.name)?.[1]
      return asset.state === 'uploaded' && /\.apk$/i.test(asset.name) && namedVersion === version
        && asset.browser_download_url.startsWith(prefix) && typeof asset.size === 'number' && asset.size > 0
    }) as { browser_download_url: string; size: number } | undefined
    if (!asset) continue
    const date = typeof release.published_at === 'string' ? new Date(release.published_at) : null
    const dateText = date && Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(date).replace(/\s*г\.$/, '') : ''
    const notes = typeof release.body === 'string' ? parseChangelog(`## ${version} — ${dateText || 'новый выпуск'}\n${release.body}`)[0]?.items : undefined
    updates.push({ version, tag: release.tag_name, date: dateText, items: notes?.length ? notes : ['Исправления и улучшения приложения.'], apk: { url: asset.browser_download_url, bytes: asset.size } })
  }
  return updates.sort((a, b) => compareVersions(b.version, a.version))
}

/** При нажатии проверяем тот самый выпуск, который предложили человеку. */
export const releaseAddress = (tag: string) => `https://api.github.com/repos/${РЕПОЗИТОРИЙ}/releases/tags/${encodeURIComponent(tag)}`
export const releasePage = (tag: string) => `https://github.com/${РЕПОЗИТОРИЙ}/releases/tag/${encodeURIComponent(tag)}`

/** Страница загрузок — запасной путь, когда установщик не сработал. */
export const АДРЕС_СТРАНИЦЫ = `https://github.com/${РЕПОЗИТОРИЙ}/releases`

/**
 * Сравнить номера версий: меньше нуля, если `a` старше.
 *
 * Разбор по частям, а не по строке: `0.9.0` и `0.10.0` строкой сравниваются
 * наоборот, и приложение считало бы девятую версию новее десятой. Нечисловой
 * хвост (`0.41.0-проба`) отбрасывается: в этом проекте его не бывает, но
 * прийти он может из чужого файла, и падать на нём незачем.
 */
export function compareVersions(a: string, b: string): number {
  const части = (v: string) => v.split('.').map((ч) => Number.parseInt(ч, 10) || 0)
  const левая = части(a)
  const правая = части(b)
  for (let i = 0; i < Math.max(левая.length, правая.length); i += 1) {
    const разница = (левая[i] ?? 0) - (правая[i] ?? 0)
    if (разница !== 0) return разница < 0 ? -1 : 1
  }
  return 0
}

/**
 * Что вышло после установленной версии — новое первым.
 *
 * Именно список, а не одна верхняя запись: человек мог пропустить три выпуска,
 * и «что изменилось» для него — это все три, а не последний.
 */
export function newerThan(releases: Release[], installed: string): Release[] {
  return releases
    .filter((r) => compareVersions(r.version, installed) > 0)
    .sort((a, b) => compareVersions(b.version, a.version))
}

/** Файл обновления в ответе GitHub. `null` — выпуск без APK, обновлять нечем. */
export function apkFrom(json: unknown): { url: string; bytes: number } | null {
  const выпуск = json as { assets?: { name?: string; browser_download_url?: string; size?: number }[] }
  for (const файл of выпуск?.assets ?? []) {
    // Имя в релизе латиницей — это правило выпуска, и оно же здесь опора:
    // кириллическое имя GitHub превращает в мусор с ведущим дефисом.
    if (файл?.name?.toLowerCase().endsWith('.apk') && файл.browser_download_url) {
      return { url: файл.browser_download_url, bytes: файл.size ?? 0 }
    }
  }
  return null
}

/**
 * Сколько читать с начала файла.
 *
 * История версий выросла до девяноста килобайт и растёт с каждым выпуском, а
 * нужны из неё только верхние записи: они идут новыми вперёд. Восьми килобайт
 * хватает на четыре-пять выпусков — столько человек подряд не пропускает, а
 * если пропустил, файл дочитывается целиком.
 *
 * Заголовок `Range` не требует предварительного запроса (он из
 * разрешённых по умолчанию), а раздающая сеть GitHub отдаёт на него `206`.
 * Не отдаст — придёт весь файл, и всё продолжит работать, просто дороже.
 */
export const КУСОК_ИСТОРИИ = 8192

/**
 * Отрезать у неполного куска последнюю запись.
 *
 * Кусок обрывается посреди выпуска, и его список изменений оказывается
 * обрезанным на полуслове. Показать такое человеку нельзя: он прочтёт половину
 * строки и решит, что так и написано. Записи идут новыми вперёд, поэтому
 * отрезаем снизу — теряется самая старая из прочитанных, а она и так за
 * пределом интереса.
 *
 * Пустая строка в ответе означает «одной записи не набралось» — вызывающий
 * дочитает файл целиком.
 */
export function trimPartial(text: string): string {
  const край = text.lastIndexOf('\n## ')
  if (край <= 0) return ''
  const целое = text.slice(0, край)
  // Отрезанное могло оказаться единственной записью, и тогда в остатке одна
  // шапка файла. Пустая строка вместо неё — чтобы у ответа была одна форма:
  // либо целые записи, либо ничего. Заголовок в шапке не подделаешь: пример
  // формата там стоит с отступом, и строкой `## ` он не начинается.
  return /^## /m.test(целое) ? целое : ''
}

/**
 * Хватило ли куска, чтобы перечислить всё пропущенное.
 *
 * Хватило, если в нём нашлась сама установленная версия или что-то старше:
 * значит, между ней и верхушкой мы прочли всё. Если же весь кусок новее
 * установленного, где-то ниже могли остаться ещё выпуски, и файл надо
 * дочитать целиком — иначе человек увидит не всё, что пропустил.
 */
export function chunkCovers(releases: Release[], installed: string): boolean {
  return releases.some((r) => compareVersions(r.version, installed) <= 0)
}

/**
 * Через сколько проверять снова, вернувшись в приложение.
 *
 * При запуске проверяем всегда — это и есть «при входе», и стоит это восемь
 * килобайт. А вот возвращение на экран случается десятки раз в день: человек
 * отвечает на сообщение и приходит обратно. Час — предел, за которым выпуск
 * считается замеченным не сразу, и при этом запросов выходит около десятка в
 * сутки вместо сотни.
 */
export const ПРОВЕРЯТЬ_РАЗ_В = 60 * 60 * 1000

export function пораПроверять(последняя: number | undefined, now: number): boolean {
  return !последняя || now - последняя >= ПРОВЕРЯТЬ_РАЗ_В
}
