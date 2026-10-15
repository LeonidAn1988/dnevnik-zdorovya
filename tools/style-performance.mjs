/** Fixed synthetic diary, five reload/navigation samples. No real accounts. */
import { chromium } from 'playwright'
import { performance } from 'node:perf_hooks'
import { mkdirSync, writeFileSync } from 'node:fs'
import { FROZEN, seed, settleAny } from './visual.mjs'

const mode = process.argv.includes('--baseline') ? 'baseline' : 'final'
const styles = mode === 'baseline' ? ['modern'] : ['journal', 'rhythm', 'clear']
const output = 'reviews/evidence/three-styles'
mkdirSync(output, { recursive: true })
const browser = await chromium.launch()
const results = []
try {
  for (const size of ['small', 'stress']) for (const style of styles) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, locale: 'ru-RU' })
    const page = await context.newPage()
    await page.clock.install({ time: new Date(FROZEN) })
    await page.goto('http://localhost:5199')
    await settleAny(page)
    await seed(page, FROZEN)
    await page.evaluate(async ({ style, size, now }) => {
      const db = await new Promise((resolve, reject) => {
        const q = indexedDB.open('omron-bp'); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error)
      })
      const all = store => new Promise(resolve => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => resolve(q.result) })
      const q = db.transaction('meta').objectStore('meta').get('settings')
      const settings = await new Promise(resolve => { q.onsuccess = () => resolve(q.result) })
      const [readings, meds, regimens] = await Promise.all(['readings', 'medicines', 'regimens'].map(all))
      const tx = db.transaction(['meta', 'readings', 'medicines', 'regimens'], 'readwrite')
      tx.objectStore('meta').put({ ...settings, interfaceStyle: style, textScale: 'normal', density: 'normal', guideOffered: true }, 'settings')
      if (size === 'stress') {
        const reading = readings.find(r => r.kind === 'bp')
        for (let i = 0; i < 10000; i++) tx.objectStore('readings').put({ ...reading, id: 'perf-r' + i, ts: now - i * 3600000 })
        for (let i = 0; i < 200; i++) tx.objectStore('medicines').put({ ...meds[0], id: 'perf-m' + i, name: 'Тестовый препарат ' + i })
        for (let i = 0; i < 100; i++) tx.objectStore('regimens').put({ ...regimens[0], id: 'perf-c' + i, medicineId: 'perf-m' + i })
      }
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error) })
      db.close()
    }, { style, size, now: FROZEN })
    const samples = []
    for (let i = 0; i < 5; i++) {
      let start = performance.now()
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.locator('nav.tabs').waitFor()
      await page.locator('.app[data-nav]').waitFor()
      const reload = performance.now() - start
      start = performance.now()
      await page.locator('nav.tabs').getByRole('button', { name: /Аптечка/ }).click()
      await page.waitForFunction(() => document.querySelector('.app')?.getAttribute('data-nav')?.startsWith('cabinet'))
      const cabinet = performance.now() - start
      samples.push({ reload, cabinet })
    }
    await page.screenshot({ path: output + '/' + mode + '-' + style + '-' + size + '.png' })
    results.push({ mode, style, size, samples, medians: Object.fromEntries(['reload', 'cabinet'].map(key => [key, samples.map(x => x[key]).sort((a,b)=>a-b)[2]])) })
    await context.close()
  }
} finally { await browser.close() }
writeFileSync(output + '/performance-' + mode + '.json', JSON.stringify({ environment: 'local Chromium touch 390x844; dev server; wall-clock automation timings', results }, null, 2))
console.log(results.map(x => ({ style: x.style, size: x.size, medians: x.medians })))
