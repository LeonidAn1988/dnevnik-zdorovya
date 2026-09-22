/**
 * Реализация StoragePort поверх IndexedDB.
 *
 * Здесь же живёт миграция схемы: версия 1 знала только давление и не хранила вид
 * измерения, версия 2 добавила сахар, версия 3 — аптечку, версия 4 — следы
 * удалённых записей, версия 5 отделила курс приёма от коробки. Потеря данных
 * при обновлении — одна из самых частых жалоб на приложения этого класса,
 * поэтому миграция покрыта отдельным тестом (tests/migration.test.mjs).
 */

import type { LabPhoto, LabTest, Measurement, Medicine, Regimen, Settings, Tombstone } from '../../types'
import type { StoragePort } from '../ports'
import type { LegacyMedicine } from '../../logic/split'
import { splitBox } from '../../logic/split'

const DB_NAME = 'omron-bp'
const DB_VERSION = 7
const MEASUREMENTS = 'readings'
const META = 'meta'
const MEDICINES = 'medicines'
const TOMBSTONES = 'tombstones'
const REGIMENS = 'regimens'
const LABS = 'labs'
const LAB_PHOTOS = 'labPhotos'

let dbPromise: Promise<IDBDatabase> | null = null

/** Точка подмены для тестов: в Node глобального indexedDB нет. */
let factory: IDBFactory | null = null
export function useIndexedDbFactory(next: IDBFactory) {
  factory = next
  dbPromise = null
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = (factory ?? indexedDB).open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = request.result
      const store = db.objectStoreNames.contains(MEASUREMENTS)
        ? request.transaction!.objectStore(MEASUREMENTS)
        : db.createObjectStore(MEASUREMENTS, { keyPath: 'id' })

      if (!store.indexNames.contains('ts')) store.createIndex('ts', 'ts')
      if (!store.indexNames.contains('user')) store.createIndex('user', 'user')
      if (!store.indexNames.contains('kind')) store.createIndex('kind', 'kind')
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META)
      // Версия 3: аптечка. Отдельное хранилище — препарат не измерение, у него
      // нет момента времени и он не попадает ни в графики, ни в отчёт.
      if (!db.objectStoreNames.contains(MEDICINES)) db.createObjectStore(MEDICINES, { keyPath: 'id' })
      // Версия 4: следы удалений. Отдельное хранилище, а не поле в записи —
      // см. пояснение у `allTombstones` в описании порта.
      if (!db.objectStoreNames.contains(TOMBSTONES)) db.createObjectStore(TOMBSTONES, { keyPath: 'id' })
      // Версия 5: курс приёма отдельно от коробки. Проверка на существование, а
      // не ветка по `oldVersion`, — тогда путь с версий 1, 2, 3 и 4 одинаково
      // доезжает, и повторный запуск обработчика ничего не ломает.
      // Версия 6: анализы. Отдельное хранилище и никакой переделки старого:
      // до этой версии анализов не существовало, переносить нечего.
      if (!db.objectStoreNames.contains(LABS)) db.createObjectStore(LABS, { keyPath: 'id' })
      // Версия 7: снимки бланков. Отдельное хранилище с указателем на анализ:
      // иначе чтение списка анализов тянуло бы за собой мегабайты.
      if (!db.objectStoreNames.contains(LAB_PHOTOS)) {
        db.createObjectStore(LAB_PHOTOS, { keyPath: 'id' }).createIndex('labId', 'labId')
      }
      if (!db.objectStoreNames.contains(REGIMENS)) {
        db.createObjectStore(REGIMENS, { keyPath: 'id' })
        // Разбираем то, что уже лежит: у старой коробки поля курса внутри.
        // Человек берётся из её же `owner`, а у коробок, заведённых до
        // появления людей, — из настроек дневника: они читаются здесь же, в
        // той же транзакции обновления.
        if (event.oldVersion > 0 && db.objectStoreNames.contains(MEDICINES)) {
          const коробки = request.transaction!.objectStore(MEDICINES)
          const курсы = request.transaction!.objectStore(REGIMENS)
          // Настройки читаются здесь же: транзакция обновления охватывает все
          // хранилища. Без человека курс завести не из чего, а терять «чьё
          // это» и расписание нельзя — у коробок, заведённых до появления
          // людей, владельца в поле нет.
          const спросить = request.transaction!.objectStore(META).get('settings')
          спросить.onsuccess = () => {
            const н = спросить.result as Partial<Settings> | undefined
            const кому = н?.activePerson ?? н?.people?.[0]?.id ?? null
            коробки.openCursor().onsuccess = (cursorEvent) => {
              const cursor = (cursorEvent.target as IDBRequest<IDBCursorWithValue>).result
              if (!cursor) return
              const { box, regimen } = splitBox(cursor.value as LegacyMedicine, кому)
              cursor.update(box)
              if (regimen) курсы.put(regimen)
              cursor.continue()
            }
          }
        }
      }

      // До версии 2 вид измерения не хранился — все записи были про давление.
      if (event.oldVersion > 0 && event.oldVersion < 2) {
        store.openCursor().onsuccess = (cursorEvent) => {
          const cursor = (cursorEvent.target as IDBRequest<IDBCursorWithValue>).result
          if (!cursor) return
          const value = cursor.value as Partial<Measurement>
          if (!value.kind) cursor.update({ ...value, kind: 'bp' })
          cursor.continue()
        }
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode)
        const request = run(transaction.objectStore(store))
        // Ответ — по завершении транзакции, а не по успеху запроса: запрос
        // успевает отработать до фиксации, и «сохранено» уходило раньше, чем
        // данные оказывались на диске. Настройки так терялись молча.
        let result: T
        request.onsuccess = () => {
          result = request.result
        }
        request.onerror = () => reject(request.error)
        transaction.oncomplete = () => resolve(result)
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error ?? new Error('транзакция прервана'))
      }),
  )
}

/**
 * Удалить запись и оставить след — одной транзакцией.
 *
 * Порознь это два действия, и между ними приложение может закрыться. Удаление
 * без следа означает, что запись вернётся при следующей выгрузке или из копии,
 * то есть человек удалил, а оно осталось. Такое лучше не делать вовсе, чем
 * делать наполовину, поэтому либо оба, либо ни одного.
 */
async function deleteWithTombstone(store: string, id: string, kind: Tombstone['kind'], at: number) {
  const db = await openDb()
  // Автор удаления нужен слиянию: чужое решение нельзя ни молча применить, ни
  // молча отбросить, а «неизвестно чьё» считается своим.
  const by = await installIdOf(db)
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([store, TOMBSTONES], 'readwrite')
    transaction.objectStore(store).delete(id)
    transaction.objectStore(TOMBSTONES).put({ id, kind, at, by } satisfies Tombstone)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

/** Идентификатор установки: заводится при первом обращении и живёт вечно. */
function installIdOf(db: IDBDatabase): Promise<string> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(META, 'readwrite')
    const store = transaction.objectStore(META)
    const ask = store.get('install')
    ask.onsuccess = () => {
      const было = ask.result as string | undefined
      if (было) {
        resolve(было)
        return
      }
      const id = `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      store.put(id, 'install')
      resolve(id)
    }
    transaction.onerror = () => reject(transaction.error)
  })
}

export const webStorage: StoragePort = {
  async allMeasurements() {
    const rows = await tx<Measurement[]>(MEASUREMENTS, 'readonly', (s) => s.getAll())
    return rows.sort((a, b) => a.ts - b.ts)
  },

  /**
   * Запись измерений. Удалённое обратно не пускаем.
   *
   * Проверка стоит здесь, а не в вызывающем коде, и это не перестраховка.
   * Записей прибора у нас детерминированные идентификаторы, и выгрузка отдаёт
   * всю память целиком каждый раз — значит, удалённое руками измерение
   * возвращалось бы при каждой следующей выгрузке. Через этот метод проходят
   * все пути записи: и прибор, и восстановление из копии, и ручной ввод.
   * Отфильтровав здесь, забыть фильтр где-то ещё уже нельзя.
   */
  async putMeasurements(items, stamp = true) {
    if (items.length === 0) return
    const now = Date.now()
    if (stamp) items = items.map((item) => ({ ...item, updatedAt: now }))
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([MEASUREMENTS, TOMBSTONES], 'readwrite')
      const store = transaction.objectStore(MEASUREMENTS)
      const graves = transaction.objectStore(TOMBSTONES)
      for (const item of items) {
        // Точечный запрос по ключу, а не чтение всех надгробий: выгрузка с
        // прибора приносит полсотни записей разом, и полный обход был бы
        // полсотни лишних обходов.
        const ask = graves.get(item.id)
        ask.onsuccess = () => {
          if (!ask.result) store.put(item)
        }
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  },

  async deleteMeasurement(id) {
    await deleteWithTombstone(MEASUREMENTS, id, 'measurement', Date.now())
  },

  async restoreMeasurement(item) {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([MEASUREMENTS, TOMBSTONES], 'readwrite')
      // Сначала снимаем надгробие, потом кладём запись — в одной транзакции,
      // поэтому порядок роли не играет, но читается он так же, как думается.
      transaction.objectStore(TOMBSTONES).delete(item.id)
      transaction.objectStore(MEASUREMENTS).put(item)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error ?? new Error('транзакция прервана'))
    })
  },

  /**
   * «Очистить всё» надгробий не оставляет — и это осознанно.
   *
   * Это не удаление записей, а сброс устройства: перед передачей телефона,
   * после проверки, при начале с чистого листа. Наплодить тысячу надгробий и
   * тем самым запретить восстановление из собственной же копии — ровно
   * противоположно тому, чего человек хотел.
   */
  async clearMeasurements() {
    await tx(MEASUREMENTS, 'readwrite', (s) => s.clear())
  },

  async loadSettings() {
    return tx<Partial<Settings> | undefined>(META, 'readonly', (s) => s.get('settings'))
  },

  async saveSettings(settings) {
    await tx(META, 'readwrite', (s) => s.put(settings, 'settings'))
  },

  /**
   * Идентификатор установки: свой ключ в `meta`, не внутри настроек.
   *
   * Настройки уезжают в копию дневника целиком, и попади он туда — телефон,
   * настроенный восстановлением чужой копии, представлялся бы той же
   * установкой, что и телефон-источник.
   */
  async installId() {
    return installIdOf(await openDb())
  },

  async allMedicines() {
    return tx<Medicine[]>(MEDICINES, 'readonly', (s) => s.getAll())
  },

  /** Препарат. Удалённый обратно не пускаем — по той же причине, что измерения. */
  async putMedicine(item, stamp = true) {
    if (stamp) item = { ...item, updatedAt: Date.now() }
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([MEDICINES, TOMBSTONES], 'readwrite')
      const ask = transaction.objectStore(TOMBSTONES).get(item.id)
      ask.onsuccess = () => {
        if (!ask.result) transaction.objectStore(MEDICINES).put(item)
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  },

  async deleteMedicine(id) {
    await deleteWithTombstone(MEDICINES, id, 'medicine', Date.now())
  },

  async allRegimens() {
    return tx<Regimen[]>(REGIMENS, 'readonly', (s) => s.getAll())
  },

  /** Курс приёма. Удалённый обратно не пускаем — по той же причине, что коробки. */
  async putRegimen(item, stamp = true) {
    if (stamp) item = { ...item, updatedAt: Date.now() }
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([REGIMENS, TOMBSTONES], 'readwrite')
      const ask = transaction.objectStore(TOMBSTONES).get(item.id)
      ask.onsuccess = () => {
        if (!ask.result) transaction.objectStore(REGIMENS).put(item)
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  },

  async deleteRegimen(id) {
    await deleteWithTombstone(REGIMENS, id, 'regimen', Date.now())
  },

  async allLabs() {
    return tx<LabTest[]>(LABS, 'readonly', (s) => s.getAll())
  },

  /** Анализ. Удалённый обратно не пускаем — по той же причине, что коробки. */
  async putLab(item, stamp = true) {
    if (stamp) item = { ...item, updatedAt: Date.now() }
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([LABS, TOMBSTONES], 'readwrite')
      const ask = transaction.objectStore(TOMBSTONES).get(item.id)
      ask.onsuccess = () => {
        if (!ask.result) transaction.objectStore(LABS).put(item)
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  },

  async deleteLab(id) {
    await deleteWithTombstone(LABS, id, 'lab', Date.now())
  },

  async labPhotos(labId) {
    const db = await openDb()
    return new Promise<LabPhoto[]>((resolve, reject) => {
      const transaction = db.transaction(LAB_PHOTOS, 'readonly')
      const ask = transaction.objectStore(LAB_PHOTOS).index('labId').getAll(labId)
      ask.onsuccess = () => resolve((ask.result as LabPhoto[]).sort((a, b) => b.day - a.day))
      transaction.onerror = () => reject(transaction.error)
    })
  },

  async putLabPhoto(item) {
    await tx(LAB_PHOTOS, 'readwrite', (s) => s.put({ ...item, updatedAt: Date.now() }))
  },

  async deleteLabPhoto(id) {
    await tx(LAB_PHOTOS, 'readwrite', (s) => s.delete(id))
  },

  async deleteLabPhotosOf(labId) {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(LAB_PHOTOS, 'readwrite')
      const store = transaction.objectStore(LAB_PHOTOS)
      const ask = store.index('labId').getAllKeys(labId)
      ask.onsuccess = () => {
        for (const key of ask.result) store.delete(key)
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  },

  async labPhotoBytes() {
    const db = await openDb()
    return new Promise<number>((resolve, reject) => {
      const transaction = db.transaction(LAB_PHOTOS, 'readonly')
      // Читаются все записи целиком — но не сами снимки: `Blob` в IndexedDB
      // это ссылка, и байты подтягиваются только при чтении содержимого.
      // Поэтому сумма по полю `bytes` стоит недорого даже на сотне бланков.
      const ask = transaction.objectStore(LAB_PHOTOS).getAll()
      ask.onsuccess = () => resolve((ask.result as LabPhoto[]).reduce((sum, p) => sum + (p.bytes ?? 0), 0))
      transaction.onerror = () => reject(transaction.error)
    })
  },

  async allTombstones() {
    return tx<Tombstone[]>(TOMBSTONES, 'readonly', (s) => s.getAll())
  },

  async putTombstones(items) {
    if (items.length === 0) return
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(TOMBSTONES, 'readwrite')
      const store = transaction.objectStore(TOMBSTONES)
      // Своё решение старше чужого не делаем: у одной записи надгробие одно, и
      // дата первого удаления — та, что человек и помнит.
      for (const item of items) store.put(item)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  },

  /**
   * Постоянное хранилище. Chrome решает сам по «вовлечённости» и установке на
   * домашний экран, Safari даёт его установленным приложениям. Отказ не ошибка:
   * данные останутся, просто без гарантии, что браузер их не вытеснит.
   */
  async requestDurability() {
    if (!navigator.storage?.persist) return null
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  },

}