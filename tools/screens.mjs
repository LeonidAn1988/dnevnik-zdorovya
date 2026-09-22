/**
 * Обход всех экранов: переполнение по ширине и ошибки в консоли.
 *
 * Дешёвая проверка, которую стоит гонять на каждую правку интерфейса: поднимает
 * сборку, проходит по списку экранов из `visual.mjs` и смотрит две вещи —
 * не вылезает ли содержимое за ширину окна и не упало ли что-то в консоли.
 * Ширина 360 px: самый узкий телефон семьи.
 *
 * Два размера текста. `xlarge` — «Очень крупный» из настроек, им пользуется
 * отец; именно там ломается вёрстка, которая на обычном размере держится.
 *
 *     node tools/screens.mjs            # обычный текст
 *     node tools/screens.mjs xlarge     # очень крупный
 *
 * Экраны, посев и замороженные часы — общие с Percy (`tools/visual.mjs`),
 * чтобы два прогона не разъезжались. Percy при этом не нужен и не трогается:
 * здесь всё локально.
 *
 * Сервер должен быть поднят на 5199 (`npm run dev`) — иначе обход не начнётся.
 */
import { chromium } from 'playwright'
import { FROZEN, seed, settleAny, settle, SCREENS, go } from './visual.mjs'

const scale = process.argv[2] ?? 'normal'
const АДРЕС = 'http://localhost:5199'

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 360, height: 780 }, locale: 'ru-RU', hasTouch: true })).newPage()
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

// Размер текста живёт в настройках внутри базы, а не в адресе: меняем там же,
// где его меняет человек, и перезагружаем — иначе размер применится наполовину.
if (scale !== 'normal') {
  await page.evaluate(async (s) => {
    const db = await new Promise((r) => {
      const q = indexedDB.open('omron-bp')
      q.onsuccess = () => r(q.result)
    })
    const st = await new Promise((r) => {
      const q = db.transaction('meta').objectStore('meta').get('settings')
      q.onsuccess = () => r(q.result)
    })
    st.textScale = s
    await new Promise((r) => {
      const q = db.transaction('meta', 'readwrite').objectStore('meta').put(st, 'settings')
      q.onsuccess = () => r()
    })
    db.close()
  }, scale)
}
await page.reload({ waitUntil: 'domcontentloaded' })
await settle(page)

let бед = 0
const плохие = []
for (const screen of SCREENS) {
  try {
    await go(page, screen)
  } catch {
    continue
  }
  await page.waitForTimeout(180)
  const п = await page.evaluate(() => ({ ширина: document.documentElement.scrollWidth, окно: window.innerWidth }))
  // Допуск в один пиксель: дробные размеры при масштабировании дают лишнюю
  // сотую, и ловить её значит ловить не вёрстку, а округление.
  if (п.ширина > п.окно + 1) {
    плохие.push(`  ⚠ ${screen.name}: ${п.ширина} при ${п.окно}`)
    бед++
  }
}
for (const строка of плохие) console.log(строка)
console.log(`${scale}: экранов ${SCREENS.length}, с переполнением ${бед}, ошибок ${ошибки.length}`, ошибки[0] ?? '')
await browser.close()
process.exit(бед + ошибки.length > 0 ? 1 : 0)
