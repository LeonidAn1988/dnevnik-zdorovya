/**
 * Обмен через Яндекс.Диск целиком — с поддельным Диском вместо настоящего.
 *
 * Проверять это на живом аккаунте нельзя: ошибка здесь стоит чужого дневника,
 * а проверка в двух телефонах руками не повторяется. Поэтому запросы к Диску
 * перехватываются, и приложение разговаривает с подделкой, которая ведёт себя
 * как настоящая папка: перечисляет файлы, принимает загрузку, отдаёт записанное
 * в следующем перечислении и помнит удаления.
 *
 * Что проверяется, по порядку важности:
 *
 * 1. Телефон пишет в файл со своей меткой, а не в общий «дневник.json».
 *    Два телефона с неназванным человеком до 0.30.0 писали в один файл и
 *    затирали друг друга.
 * 2. Прежнее своё имя убирается — иначе переименование человека оставляет в
 *    папке мусор, который вечно приходит как чужой дневник.
 * 3. Файл старого образца и чужие дневники не трогаются. Это главное: удалить
 *    чужое страшнее, чем оставить лишнее.
 * 4. Экран семьи говорит человеку, который файл его, и объясняет старый.
 *
 *     npm run dev            # в соседнем окне
 *     node tools/cloud.mjs
 *
 * Ключ подставляется поддельный, но обязательно латиницей: он уходит в
 * заголовок запроса, а туда кириллица не проходит — `fetch` падает до сети.
 */
import { chromium } from 'playwright'
import { FROZEN, seed, settleAny, settle, go } from './visual.mjs'

const АДРЕС = 'http://localhost:5199'
const КЛЮЧ = 'y0_AgAAAAAtesttesttesttesttest'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, locale: 'ru-RU', hasTouch: true })
const page = await ctx.newPage()
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

// Метку берём из самой базы: она заводится при первом обращении и в каждом
// прогоне новая — подставлять свою значило бы проверять не то, что работает.
const установка = await page.evaluate(async () => {
  const db = await new Promise((r) => {
    const q = indexedDB.open('omron-bp')
    q.onsuccess = () => r(q.result)
  })
  const v = await new Promise((r) => {
    const q = db.transaction('meta').objectStore('meta').get('install')
    q.onsuccess = () => r(q.result)
  })
  db.close()
  return v ?? null
})
const метка = (установка ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(-6)

// В папке лежит всё, что бывает: общий файл прежних версий, наше прежнее имя
// и дневник другого человека.
const ПАПКА = [
  { type: 'file', name: 'дневник.json', modified: '2026-08-01T10:00:00+00:00', size: 900 },
  { type: 'file', name: `дневник-старое-${метка}.json`, modified: '2026-08-02T10:00:00+00:00', size: 900 },
  { type: 'file', name: 'дневник-Жена-aa11bb.json', modified: '2026-08-03T10:00:00+00:00', size: 900 },
]

const записано = []
const удалено = []
await ctx.route('**/cloud-api.yandex.net/**', async (route) => {
  const url = route.request().url()
  if (url.includes('/resources/upload')) {
    записано.push(decodeURIComponent(new URL(url).searchParams.get('path') ?? ''))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ href: 'https://upload.test/put' }) })
  }
  if (route.request().method() === 'DELETE') {
    удалено.push(decodeURIComponent(new URL(url).searchParams.get('path') ?? ''))
    return route.fulfill({ status: 204, body: '' })
  }
  // Записанное обязано появляться в следующем перечислении: иначе приложение
  // никогда не увидит собственный файл, и проверка подписи ничего не значит.
  const свои = [...new Set(записано)]
    .map((p) => p.replace('app:/', ''))
    .filter((имя) => !ПАПКА.some((f) => f.name === имя) && !удалено.includes(`app:/${имя}`))
    .map((имя) => ({ type: 'file', name: имя, modified: '2026-09-22T10:00:00+00:00', size: 1000 }))
  const всё = [...ПАПКА.filter((f) => !удалено.includes(`app:/${f.name}`)), ...свои]
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ _embedded: { items: всё } }) })
})
await ctx.route('**/upload.test/**', (route) => route.fulfill({ status: 201, body: '' }))

await page.evaluate((ключ) => localStorage.setItem('omron.yandex-token', ключ), КЛЮЧ)
await page.reload({ waitUntil: 'domcontentloaded' })
await settle(page)

await go(page, { name: 'семья', tool: 'Настройки', open: 'Семья' })
await page.waitForTimeout(400)
const кнопка = page.getByRole('button', { name: /Обменяться сейчас/ })
if (await кнопка.count()) {
  await кнопка.first().click()
  await page.waitForTimeout(2000)
}

let бед = 0
const итог = (ok, имя, деталь = '') => {
  if (!ok) бед++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${имя}${деталь ? ' — ' + деталь : ''}`)
}

итог(!!метка, 'метка установки прочиталась', метка || '(пусто)')
итог(записано.length > 0 && new Set(записано).size === 1, 'сколько бы обменов ни было — имя одно', записано.join(' | '))
итог(!!метка && записано[0]?.endsWith(`-${метка}.json`), 'пишем в файл со своей меткой', записано[0] ?? '(ничего)')
итог(записано[0] !== 'app:/дневник.json', 'а не в общий дневник.json', записано[0] ?? '(ничего)')
итог(удалено.includes(`app:/дневник-старое-${метка}.json`), 'прежнее своё имя убрано', удалено.join(' | ') || '(ничего)')
итог(!удалено.includes('app:/дневник.json'), 'файл старого образца не тронут', удалено.join(' | ') || '(ничего)')
итог(!удалено.some((n) => n.includes('Жена')), 'чужой дневник не тронут', удалено.join(' | ') || '(ничего)')
итог(ошибки.length === 0, 'без ошибок в консоли', ошибки[0] ?? '')

// Свёрнутое остаётся в разметке, поэтому про баннеры спрашиваем `data-open`, а
// не текст: иначе закрытое предупреждение читается как показанное.
const свёрнут = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[data-open]')].find((n) => (n.textContent ?? '').includes('не сохранилось'))
  return el ? el.getAttribute('data-open') : 'нет такого'
})
итог(свёрнут !== 'true', 'баннер о несохранённом не показан', `data-open=${свёрнут}`)

const экран = await page.evaluate(() => document.body.innerText)
итог(экран.includes('этот телефон'), 'свой файл подписан')
итог(экран.includes('Жена'), 'чужой подписан по имени человека')
итог(!/[a-z0-9]{6}\.json/.test(экран.replace(/Файл старого образца.*/s, '')), 'метка установки человеку не показана')
итог(экран.includes('Файл старого образца'), 'про старый образец сказано')
итог(экран.includes('дневник.json'), 'и названо, какой именно')

console.log(бед === 0 ? 'обмен через Диск: всё сходится' : `обмен через Диск: не сошлось ${бед}`)
await browser.close()
process.exit(бед > 0 ? 1 : 0)
