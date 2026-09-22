/**
 * Снимок бланка целиком: выбор файла, уменьшение, запись, показ, удаление.
 *
 * Проверять это руками дорого и ненадёжно: на глаз не видно ни того, во что
 * превратился снимок, ни того, сколько он весит в базе. А цена ошибки —
 * память телефона: с камеры приходит двенадцать мегапикселей, и десяток
 * бланков без уменьшения съедают её целиком.
 *
 * Снимок рисуется здесь же, а не берётся из файла на диске: проверка должна
 * запускаться на чужой машине и через год.
 *
 *     npm run dev          # в соседнем окне
 *     node tools/photos.mjs
 */
import { deflateSync } from 'node:zlib'
import { chromium } from 'playwright'
import { FROZEN, seed, settleAny, settle, go } from './visual.mjs'

const АДРЕС = 'http://localhost:5199'

/**
 * PNG, похожий на снятый бланк: светлый лист, полосы «строк текста», лёгкая
 * неравномерность освещения и немного зерна.
 *
 * Похожий, а не какой угодно: чистый шум JPEG не сжимает вовсе, и проверка
 * «стал легче» на нём ничего не значила бы. Настоящий бланк — это текст на
 * бумаге, и вес после пересжатия должен получаться такой же, как у него.
 */
function png(width, height) {
  const строки = Buffer.alloc((width * 3 + 1) * height)
  let p = 0
  for (let y = 0; y < height; y += 1) {
    строки[p++] = 0 // без фильтра
    // Полосы текста: тридцать строк на лист, как на бланке анализа.
    const строкаТекста = y % Math.round(height / 30) < Math.round(height / 120)
    for (let x = 0; x < width; x += 1) {
      const поля = x < width * 0.1 || x > width * 0.9
      const свет = 235 - Math.round((y / height) * 25) - Math.round((x / width) * 10)
      const зерно = ((x * 7 + y * 13) % 11) - 5
      const v = строкаТекста && !поля ? 60 + ((x * 3) % 40) : свет + зерно
      строки[p++] = v
      строки[p++] = v
      строки[p++] = v
    }
  }
  const кусок = (тип, данные) => {
    const длина = Buffer.alloc(4)
    длина.writeUInt32BE(данные.length)
    const тело = Buffer.concat([Buffer.from(тип, 'ascii'), данные])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(тело) >>> 0)
    return Buffer.concat([длина, тело, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    кусок('IHDR', ihdr),
    кусок('IDAT', deflateSync(строки)),
    кусок('IEND', Buffer.alloc(0)),
  ])
}

const ТАБЛИЦА = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = ТАБЛИЦА[(c ^ b) & 0xff] ^ (c >>> 8)
  return c ^ 0xffffffff
}

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 360, height: 780 }, locale: 'ru-RU' })).newPage()
const ошибки = []
page.on('pageerror', (e) => ошибки.push(String(e)))

await page.clock.install({ time: new Date(FROZEN) })
try {
  await page.goto(АДРЕС, { waitUntil: 'domcontentloaded' })
} catch {
  console.error(`Не открылся ${АДРЕС}. Поднимите сервер: npm run dev`)
  await browser.close()
  process.exit(1)
}
await settleAny(page)
await seed(page, FROZEN)
await page.reload({ waitUntil: 'domcontentloaded' })
await settle(page)
await go(page, { name: 'Анализы', tab: 'Обзор', open: 'Анализы' })
await page.waitForTimeout(400)

let бед = 0
const итог = (ok, имя, деталь = '') => {
  if (!ok) бед++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${имя}${деталь ? ' — ' + деталь : ''}`)
}

// 2400×1800 — примерно то, что отдаёт камера телефона после поворота.
const исходник = png(2400, 1800)
итог(исходник.length > 100_000, 'исходник похож на снятый лист', `${исходник.length} байт`)
await page.locator('input[type=file]').first().setInputFiles({ name: 'blank.png', mimeType: 'image/png', buffer: исходник })
await page.waitForTimeout(3000)

const снимки = await page.evaluate(async () => {
  const db = await new Promise((r) => {
    const q = indexedDB.open('omron-bp')
    q.onsuccess = () => r(q.result)
  })
  if (!db.objectStoreNames.contains('labPhotos')) return 'нет хранилища'
  const все = await new Promise((r) => {
    const q = db.transaction('labPhotos').objectStore('labPhotos').getAll()
    q.onsuccess = () => r(q.result)
  })
  db.close()
  return все.map((p) => ({ labId: p.labId, w: p.width, h: p.height, bytes: p.bytes, тип: p.blob?.type, blob: p.blob?.size }))
})
const с = Array.isArray(снимки) ? (снимки[0] ?? {}) : {}
итог(Array.isArray(снимки) && снимки.length === 1, 'снимок записан', JSON.stringify(снимки))
итог(Math.max(с.w ?? 0, с.h ?? 0) === 1600, 'длинная сторона стала 1600', `${с.w}×${с.h}`)
итог((с.w ?? 0) === 1600 && (с.h ?? 0) === 1200, 'пропорции сохранены', `${с.w}×${с.h}`)
// Четверть мегабайта на бланк — это двадцать бланков на пять мегабайт. Столько
// память телефона выдержит, а больше брать незачем: текст читается и так.
итог((с.bytes ?? 0) < 400_000, 'и весит как бланк, а не как фотография', `${с.bytes} байт`)
итог(с.тип === 'image/jpeg', 'пересжат в JPEG', String(с.тип))
итог(с.blob === с.bytes, 'записанный вес совпадает с самим снимком')
итог(с.labId === 'l1', 'снимок привязан к своему анализу', String(с.labId))

итог((await page.locator('.photo-thumb').count()) === 1, 'плитка появилась')
await page.locator('.photo-thumb').first().click()
await page.waitForTimeout(300)
итог((await page.locator('.photo-view img').count()) === 1, 'крупный вид открывается')
await page.locator('.photo-view button', { hasText: 'Удалить снимок' }).click()
await page.waitForTimeout(800)
итог((await page.locator('.photo-thumb').count()) === 0, 'и удаляется с экрана')
const осталось = await page.evaluate(async () => {
  const db = await new Promise((r) => {
    const q = indexedDB.open('omron-bp')
    q.onsuccess = () => r(q.result)
  })
  const все = await new Promise((r) => {
    const q = db.transaction('labPhotos').objectStore('labPhotos').getAll()
    q.onsuccess = () => r(q.result)
  })
  db.close()
  return все.length
})
итог(осталось === 0, 'и из базы тоже', String(осталось))
итог(ошибки.length === 0, 'без ошибок в консоли', ошибки[0] ?? '')

console.log(бед === 0 ? 'снимки бланков: всё сходится' : `снимки бланков: не сошлось ${бед}`)
await browser.close()
process.exit(бед > 0 ? 1 : 0)
