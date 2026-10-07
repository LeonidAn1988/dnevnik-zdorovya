// Focused regression checks in disposable synthetic touch profiles; no device bridge.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { FROZEN, seed, settleAny, settle, go } from '../tools/visual.mjs'

const out = 'reviews/evidence/accessibility-fixes'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const checks = [], errors = []
async function photoCount(page) {
  return page.evaluate(async () => {
    const db = await new Promise(resolve => { const q = indexedDB.open('omron-bp'); q.onsuccess = () => resolve(q.result) })
    const count = await new Promise(resolve => { const q = db.transaction('labPhotos').objectStore('labPhotos').count(); q.onsuccess = () => resolve(q.result) })
    db.close(); return count
  })
}
try {
  for (const text of ['normal', 'xlarge']) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, locale: 'ru-RU' })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.clock.install({ time: new Date(FROZEN) })
    await page.goto('http://localhost:5199')
    await settleAny(page); await seed(page, FROZEN)
    await page.evaluate(async ({ text, theme }) => {
      const canvas = document.createElement('canvas'); canvas.width = 10; canvas.height = 10
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
      const db = await new Promise(resolve => { const q = indexedDB.open('omron-bp'); q.onsuccess = () => resolve(q.result) })
      await new Promise(resolve => {
        const tx = db.transaction(['meta', 'labPhotos'], 'readwrite')
        const meta = tx.objectStore('meta'), q = meta.get('settings')
        q.onsuccess = () => meta.put({ ...q.result, theme, textScale: text }, 'settings')
        tx.objectStore('labPhotos').put({ id: 'synthetic-a11y-photo', labId: 'l1', day: Date.now(), blob, bytes: blob.size, width: 10, height: 10 })
        tx.oncomplete = resolve
      }); db.close()
    }, { text, theme })
    await page.reload(); await settle(page)
    const contrast = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement)
      const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      const lum = hex => rgb(hex).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0)
      const bg = lum(root.getPropertyValue('--surface').trim())
      return ['sys', 'dia', 'bpm'].map(series => {
        const fg = lum(root.getPropertyValue('--series-' + series).trim())
        return { series, ratio: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05) }
      })
    })
    assert.ok(contrast.every(c => c.ratio >= 4), JSON.stringify({ text, theme, contrast }))
    const chartsToggle = page.locator('summary').filter({ hasText: 'Графики давления и пульса' })
    if (await chartsToggle.count()) await chartsToggle.click()
    const svg = page.locator('.chart svg').first()
    await svg.waitFor()
    assert.equal(await svg.locator('circle[opacity],line[opacity]').count(), 0, 'Data must not lose contrast through opacity')
    assert.equal(await svg.locator('path[stroke-dasharray="7 4"]').count(), 1, 'Lower trend remains distinguishable in monochrome')
    await svg.evaluate(el => el.scrollIntoView({ block: 'center' }))
    await svg.screenshot({ path: `${out}/${text}-${theme}-chart.png` })
    await page.emulateMedia({ media: 'print' })
    const printColors = await page.evaluate(() => ['sys', 'dia', 'bpm'].map(s => getComputedStyle(document.documentElement).getPropertyValue('--series-' + s).trim()))
    assert.deepEqual(printColors, ['#2a78d6', '#d45222', '#14865c'])
    await page.emulateMedia({ media: 'screen' })
    for (const tab of ['Давление', 'Сахар']) {
      await go(page, { tab })
      await page.locator('form').first().getByRole('button', { name: /сегодня/ }).click()
      assert.equal(await page.getByLabel('Когда', { exact: true }).getAttribute('type'), 'datetime-local')
    }
    await go(page, { tab: 'Обзор', open: 'Анализы' })
    await page.locator('.photo-thumb').first().click()
    await page.getByRole('button', { name: 'Удалить снимок', exact: true }).click()
    await page.getByText('Удалить этот снимок?', { exact: true }).waitFor()
    assert.equal(await photoCount(page), 1)
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Отмена')
    assert.match(await page.getByRole('button', { name: 'Отмена', exact: true }).evaluate(el => document.getElementById(el.getAttribute('aria-describedby')).textContent), /Восстановить его здесь не получится/)
    await page.locator('.photo-view').screenshot({ path: `${out}/${text}-${theme}-photo-confirm.png` })
    await page.getByRole('button', { name: 'Отмена', exact: true }).click()
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Закрыть')
    assert.equal(await photoCount(page), 1, 'Cancel must preserve the stored photo')
    assert.equal(await page.locator('.photo-view img').count(), 1)
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
    await page.locator('.photo-thumb').first().click()
    assert.equal(await page.getByText('Удалить этот снимок?', { exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Удалить снимок', exact: true }).click()
    await page.getByRole('button', { name: 'Да, удалить снимок', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('.photo-thumb'))
    assert.equal(await photoCount(page), 0)
    checks.push({ text, theme, contrast, printColors, dateLabels: true, cancelPreservesPhoto: true, confirmedDeletion: true })
    await context.close()
  }
  assert.deepEqual(errors, [])
  writeFileSync(`${out}/checks.json`, JSON.stringify({ checks, errors }, null, 2))
  console.log('Accessibility fixes: four synthetic touch profiles passed')
} finally { await browser.close() }
