/**
 * Миграция хранилища: версия 1 → 2 → 3 → 5.
 *
 * Версия 1 знала только давление и не хранила вид измерения. Версия 2 добавила
 * сахар, поэтому старым записям проставляется `kind: 'bp'`. Версия 3 добавила
 * аптечку отдельным хранилищем, версия 5 отделила курс приёма от коробки.
 *
 * Потеря данных при обновлении — одна из самых частых жалоб на приложения этого
 * класса, поэтому проверка отдельная и подробная: сверяются не только количество,
 * но и значения каждой записи.
 */
import { IDBFactory } from 'fake-indexeddb'
import {
  installWebPlatform,
  useIndexedDbFactory,
  getAllMeasurements,
  putMeasurements,
  loadSettings,
  getAllMedicines,
  putMedicine,
  deleteMedicine,
  getAllRegimens,
  platform,
  regimenIdFor,
} from './build/api.mjs'

const DB_NAME = 'omron-bp'

/** Создаёт базу в том виде, в каком её оставляла версия 1 приложения. */
function seedVersion1(factory, records) {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      const store = db.createObjectStore('readings', { keyPath: 'id' })
      store.createIndex('ts', 'ts')
      store.createIndex('user', 'user')
      db.createObjectStore('meta')
    }
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('readings', 'readwrite')
      const store = tx.objectStore('readings')
      for (const record of records) store.put(record)
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
    request.onerror = () => reject(request.error)
  })
}

export async function run() {
  let failures = 0
  const check = (name, condition, detail = '') => {
    if (condition) console.log(`  ok   ${name}`)
    else {
      console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`)
      failures++
    }
  }

  // Записи в точности того вида, в каком их писала версия 1: без поля kind.
  const legacy = [
    { id: 'd1-1754899200', ts: 1754899200000, sys: 128, dia: 82, bpm: 71, ihb: true, mov: false, user: 1, source: 'device' },
    { id: 'd1-1754942400', ts: 1754942400000, sys: 119, dia: 74, bpm: null, ihb: false, mov: true, user: 1, source: 'device' },
    { id: 'd2-1754899800', ts: 1754899800000, sys: 145, dia: 95, bpm: 88, ihb: false, mov: false, user: 2, source: 'device' },
    { id: 'm-manual-1', ts: 1754985600000, sys: 132, dia: 80, bpm: 66, ihb: false, mov: false, user: 1, source: 'manual', note: 'после прогулки' },
  ]

  const factory = new IDBFactory()
  await seedVersion1(factory, legacy)

  installWebPlatform()
  useIndexedDbFactory(factory)
  const migrated = await getAllMeasurements()

  check('ни одна запись не потеряна', migrated.length === legacy.length, `было ${legacy.length}, стало ${migrated.length}`)
  check('всем записям проставлен вид «давление»', migrated.every((m) => m.kind === 'bp'))

  for (const original of legacy) {
    const restored = migrated.find((m) => m.id === original.id)
    if (!restored) {
      check(`запись ${original.id} на месте`, false)
      continue
    }
    check(
      `запись ${original.id} не изменилась`,
      restored.ts === original.ts &&
        restored.sys === original.sys &&
        restored.dia === original.dia &&
        restored.bpm === original.bpm &&
        restored.ihb === original.ihb &&
        restored.mov === original.mov &&
        restored.user === original.user &&
        restored.source === original.source &&
        (restored.note ?? undefined) === (original.note ?? undefined),
      JSON.stringify(restored),
    )
  }

  // После миграции база обязана принимать записи обоих видов.
  await putMeasurements([
    { kind: 'glucose', id: 'g1-1754985700', ts: 1754985700000, mmol: 6.2, context: 'fasting', user: 1, source: 'manual' },
  ])
  const mixed = await getAllMeasurements()
  check('сахар добавляется рядом с давлением', mixed.length === legacy.length + 1)
  check('давление и сахар различимы по виду', mixed.filter((m) => m.kind === 'glucose').length === 1)

  // Идентификаторы разных видов не должны сталкиваться в одну и ту же секунду.
  const sameSecond = 1755000000000
  await putMeasurements([
    { kind: 'bp', id: 'd1-1755000000', ts: sameSecond, sys: 120, dia: 80, bpm: 70, ihb: false, mov: false, user: 1, source: 'device' },
    { kind: 'glucose', id: 'g1-1755000000', ts: sameSecond, mmol: 5.5, context: 'before-meal', user: 1, source: 'device' },
  ])
  const collision = (await getAllMeasurements()).filter((m) => m.ts === sameSecond)
  check('давление и сахар одной секунды не затирают друг друга', collision.length === 2, `найдено ${collision.length}`)

  const settings = await loadSettings()
  check('настройки получили значения по умолчанию для сахара', settings.glucoseFastingMax === 7 && settings.glucoseLow === 3.9)

  /*
   * Первый человек заводится один раз на установку.
   *
   * До 0.25.0 ключ брался от часов, а заведённый человек не сохранялся: каждый
   * холодный старт рождал нового «Я», семейный обмен разносил их по телефонам,
   * и у владельца накопилось двое. Проверка именно повторной загрузкой, а не
   * чистой функцией: дефект был не в правиле ключа, а в том, что запись не
   * доходила до хранилища.
   */
  check('первый человек заведён', settings.people.length === 1 && settings.people[0].name === 'Я')

  // Смотрим в хранилище мимо `loadSettings`: он дописывает человека на лету, и
  // по его ответу не отличить «сохранили» от «посчитали заново». Дефект был
  // именно в том, что запись не доходила до базы.
  const вБазе = await platform().storage.loadSettings()
  check(
    'и сохранён в базу, а не только отдан в память',
    вБазе?.people?.length === 1 && вБазе.people[0].id === settings.people[0].id,
    `в базе ${вБазе?.people?.length ?? 0} чел.`,
  )

  const второйЗаход = await loadSettings()
  check(
    'повторная загрузка не заводит второго «Я»',
    второйЗаход.people.length === 1 && второйЗаход.people[0].id === settings.people[0].id,
    `${второйЗаход.people.length} чел., ключи ${settings.people[0].id} и ${второйЗаход.people[0]?.id}`,
  )
  check('и выбранным остался он же', второйЗаход.activePerson === settings.people[0].id)

  // ── версия 3: аптечка появилась в базе, где её никогда не было ────────────
  check('аптечка после миграции пуста, а не сломана', (await getAllMedicines()).length === 0)

  await putMedicine({
    id: 'med-1',
    name: 'Лозартан',
    dose: '50 мг',
    left: 28,
    perDay: 1,
    expires: Date.UTC(2027, 4, 1),
    note: 'утром',
  })
  const pills = await getAllMedicines()
  check('препарат сохранён', pills.length === 1 && pills[0].name === 'Лозартан', JSON.stringify(pills))
  check('поля препарата не потерялись', pills[0].left === 28 && pills[0].perDay === 1 && pills[0].note === 'утром')

  check(
    'измерения от аптечки не пострадали',
    (await getAllMeasurements()).length === legacy.length + 3,
    'аптечка лежит в отдельном хранилище и на дневник влиять не должна',
  )

  await deleteMedicine('med-1')
  check('препарат удаляется', (await getAllMedicines()).length === 0)

  // ── версия 5: коробка старого образца разбирается на коробку и курс ───────
  await разбор(check)

  return failures
}

/**
 * Настоящая проверка версии 5: база четвёртой версии с коробкой старого
 * образца, где расписание и отметки лежат внутри препарата.
 *
 * Своя база, а не продолжение предыдущей: ту приложение уже подняло до пятой
 * версии, и разбирать в ней нечего. Ошибка здесь стоит дороже прочих — это
 * молча потерянное расписание на живом дневнике.
 */
async function разбор(check) {
  const factory = new IDBFactory()
  await new Promise((resolve, reject) => {
    const request = factory.open('omron-bp', 4)
    request.onupgradeneeded = () => {
      const db = request.result
      const store = db.createObjectStore('readings', { keyPath: 'id' })
      store.createIndex('ts', 'ts')
      store.createIndex('user', 'user')
      store.createIndex('kind', 'kind')
      db.createObjectStore('meta')
      db.createObjectStore('medicines', { keyPath: 'id' })
      db.createObjectStore('tombstones', { keyPath: 'id' })
    }
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(['medicines', 'meta'], 'readwrite')
      tx.objectStore('meta').put(
        { people: [{ id: 'p-dad', name: 'Отец', deviceUser: 1 }], activePerson: 'p-dad' },
        'settings',
      )
      const кор = tx.objectStore('medicines')
      кор.put({
        id: 'med-old', name: 'Метформин', dose: '850 мг', left: 20, perDay: null, expires: null,
        owner: 'p-dad', times: ['08:00', '20:00'], perTime: 1, meal: 'after', autoDeduct: true,
        taken: [1_700_000_000_000], since: 1_690_000_000_000, updatedAt: 1_700_100_000_000,
        history: { '2026-07': { planned: 62, taken: 60 } }, foldedUntil: 1_699_000_000_000,
      })
      // Коробка без человека: такие завелись до появления людей. Расписание у
      // неё есть, и терять его нельзя — человек берётся из настроек.
      кор.put({ id: 'med-noowner', name: 'Аспирин', dose: '', left: null, perDay: 2, expires: null })
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => reject(tx.error)
    }
    request.onerror = () => reject(request.error)
  })

  useIndexedDbFactory(factory)
  const коробки = await getAllMedicines()
  const курсы = await getAllRegimens()

  check('обе коробки на месте', коробки.length === 2, JSON.stringify(коробки.map((m) => m.id)))
  const коробка = коробки.find((m) => m.id === 'med-old')
  check(
    'из коробки ушло всё про приём',
    коробка.times === undefined && коробка.taken === undefined && коробка.owner === undefined &&
      коробка.autoDeduct === undefined && коробка.history === undefined,
    JSON.stringify(коробка),
  )
  check('а вещественное осталось', коробка.name === 'Метформин' && коробка.left === 20 && коробка.dose === '850 мг')

  check('курсы заведены обоим', курсы.length === 2, JSON.stringify(курсы.map((r) => r.id)))
  const курс = курсы.find((r) => r.medicineId === 'med-old')
  check('курс привязан к своей коробке', курс?.medicineId === 'med-old')
  check('и к своему человеку', курс?.person === 'p-dad')
  check(
    'расписание, отметки и история переехали целиком',
    JSON.stringify(курс.times) === JSON.stringify(['08:00', '20:00']) &&
      курс.perTime === 1 && курс.meal === 'after' && курс.autoDeduct === true &&
      JSON.stringify(курс.taken) === JSON.stringify([1_700_000_000_000]) &&
      курс.since === 1_690_000_000_000 && курс.foldedUntil === 1_699_000_000_000 &&
      курс.history['2026-07'].taken === 60,
    JSON.stringify(курс),
  )
  check('время правки унаследовано от коробки', курс.updatedAt === 1_700_100_000_000)

  // Идентификатор выводится из коробки, а не случайный: два телефона,
  // обновившиеся порознь, обязаны получить один и тот же курс, иначе первый же
  // обмен положит в дневник двойные приёмы.
  check('идентификатор курса выведен из коробки', курс.id === regimenIdFor('med-old'), курс.id)

  const ничей = курсы.find((r) => r.medicineId === 'med-noowner')
  check('коробка без владельца тоже получила курс', ничей !== undefined)
  check('человек взят из настроек дневника', ничей?.person === 'p-dad', ничей?.person)
  check('и расход не потерялся', ничей?.perDay === 2)
}
