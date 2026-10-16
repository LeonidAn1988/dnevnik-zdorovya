/** Published deploy smoke, disposable touch profile; no real account or family key. */
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { FROZEN, seed, settleAny } from './visual.mjs'

const url = 'https://leonidan1988.github.io/dnevnik-zdorovya/'
const version = readFileSync('CHANGELOG.md', 'utf8').match(/^## ([\d.]+) —/m)[1]
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block', locale: 'ru-RU' })
const page = await context.newPage(), errors = []
page.on('pageerror', e => errors.push(String(e)))
try {
  await page.clock.install({ time: new Date(FROZEN) })
  const response = await page.goto(url)
  assert.equal(response.status(), 200)
  await settleAny(page)
  const html = await response.text(), local = readFileSync('dist/index.html', 'utf8')
  const main = local.match(/<script[^>]+src="([^"]+)"/)[1]
  assert.ok(html.includes(main), 'Published HTML references the expected build')
  const asset = await page.request.get(new URL(main, url).href)
  assert.equal(asset.status(), 200)
  const hash = b => createHash('sha256').update(b).digest('hex')
  assert.equal(hash(await asset.body()), hash(readFileSync('dist/' + main.replace(/^\.\//, ''))))
  await seed(page, FROZEN)
  await page.evaluate(async () => {
    const db = await new Promise(r => { const q = indexedDB.open('omron-bp'); q.onsuccess = () => r(q.result) })
    const s = await new Promise(r => { const q = db.transaction('meta').objectStore('meta').get('settings'); q.onsuccess = () => r(q.result) })
    const t = db.transaction('meta', 'readwrite')
    t.objectStore('meta').put({ ...s, interfaceStyle: 'rhythm', guideOffered: true, theme: 'light' }, 'settings')
    await new Promise(r => t.oncomplete = r)
    db.close()
  })
  await page.reload()
  await page.locator('nav.tabs').waitFor()
  assert.equal(await page.locator('.daystrip').count(), 0)
  await page.getByRole('button', { name: 'Добавить приём', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Найти препарат в аптечке' }).fill('Конкор')
  await page.locator('.course-medicine-results button').filter({ hasText: 'Конкор' }).first().click()
  await page.getByRole('button', { name: /Утром.*08:00/ }).click()
  await page.getByRole('button', { name: 'Проверить назначение', exact: true }).click()
  await page.getByRole('form', { name: 'Проверка курса' }).waitFor()
  assert.equal(await page.locator('.app').getAttribute('data-nav'), 'cabinet/regimen/courseReview')
  assert.equal(await page.evaluate(() => scrollY), 0)
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Проверьте приём')
  await page.screenshot({ path: 'reviews/evidence/journey-recovery/published-review.png', fullPage: true })
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  await page.locator('.app[data-nav="overview"]').waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.deepEqual(errors, [])
  const result = { url, httpStatus: 200, version, mainAsset: main, assetSha256MatchesLocal: true, courseFirstFlow: true, review: true, reviewScrollTop: 0, reviewHeadingFocused: true, cancelToToday: true, touch: true, overflow: false, errors, serviceWorker: 'blocked to verify fresh deployment; offline update not retested' }
  writeFileSync('reviews/evidence/journey-recovery/published-web.json', JSON.stringify(result, null, 2) + '\n')
  console.log(result)
} finally { await browser.close() }
