import { chromium } from 'playwright'
import { FROZEN, seed, settleAny, settle, go } from './tools/visual.mjs'
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 360, height: 780 }, locale: 'ru-RU', hasTouch: true })).newPage()
await page.clock.install({ time: new Date(FROZEN) })
await page.goto('http://localhost:5199', { waitUntil: 'domcontentloaded' })
await settleAny(page)
await seed(page, FROZEN)
await page.reload({ waitUntil: 'domcontentloaded' })
await settle(page)
await page.evaluate(async () => {
  const db = await new Promise((r) => { const q = indexedDB.open('omron-bp'); q.onsuccess = () => r(q.result) })
  const st = await new Promise((r) => { const q = db.transaction('meta').objectStore('meta').get('settings'); q.onsuccess = () => r(q.result) })
  st.theme = 'dark'
  await new Promise((r) => { const q = db.transaction('meta','readwrite').objectStore('meta').put(st,'settings'); q.onsuccess = () => r() })
  db.close()
})
await page.reload({ waitUntil: 'domcontentloaded' })
await settle(page)
await go(page, { tab: 'Приём' }); await settle(page)
console.log(JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.daystrip__day')].slice(0,3).concat([...document.querySelectorAll('.daystrip__day')].slice(-4)).map((d) => {
  const точка = d.querySelector('.daystrip__dot')
  const s = getComputedStyle(точка)
  return { день: d.querySelector('.daystrip__date')?.textContent, статус: d.dataset.status, фон: s.backgroundColor, размер: [s.width, s.height], показ: s.display }
})), null, 1))
await browser.close()
