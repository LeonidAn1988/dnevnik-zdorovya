/** Web cloud capability and the supported one-time phone-copy transfer.
 * Disposable browser storage, synthetic family, no real Disk or credentials. */
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { FROZEN, seed, settle, settleAny, go } from '../tools/visual.mjs'

const out = 'reviews/evidence/cloud-web'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const results = []
async function stored(page) {
  return page.evaluate(async () => {
    const db = await new Promise(resolve => { const q = indexedDB.open('omron-bp'); q.onsuccess = () => resolve(q.result) })
    const read = (name, key) => new Promise(resolve => { const s = db.transaction(name).objectStore(name), q = key ? s.get(key) : s.getAll(); q.onsuccess = () => resolve(q.result) })
    const value = { settings: await read('meta', 'settings'), readings: await read('readings') }
    db.close(); return value
  })
}
try {
  for (const scale of ['normal', 'xlarge']) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 320, height: 800 }, hasTouch: true, locale: 'ru-RU' })
    const page = await context.newPage()
    page.setDefaultTimeout(6000)
    const errors = [], uploads = []
    page.on('pageerror', e => errors.push(e.message))
    await page.route('https://api.github.com/**', r => r.fulfill({ contentType: 'application/json', body: '[]' }))
    await page.route('https://cloud-api.yandex.net/**', route => {
      const url = new URL(route.request().url())
      assert.equal(route.request().method(), 'GET', 'No cloud deletion is allowed during bootstrap/restore')
      if (url.pathname.endsWith('/upload')) return route.fulfill({ json: { href: 'https://cloud-upload.invalid/put' } })
      return route.fulfill({ json: { _embedded: { items: [{ type: 'file', name: 'дневник-Телефон семьи-aa11bb.json', modified: '2026-08-15T10:00:00Z' }] } } })
    })
    await page.route('https://cloud-upload.invalid/**', route => {
      uploads.push(JSON.parse(route.request().postData()))
      return route.fulfill({ status: 201 })
    })
    await page.clock.install({ time: new Date(FROZEN) })
    await page.goto(process.env.URL ?? 'http://127.0.0.1:5199'); await settleAny(page); await seed(page, FROZEN)
    await page.evaluate(async fields => {
      const db = await new Promise(resolve => { const q = indexedDB.open('omron-bp'); q.onsuccess = () => resolve(q.result) })
      const settings = await new Promise(resolve => { const q = db.transaction('meta').objectStore('meta').get('settings'); q.onsuccess = () => resolve(q.result) })
      await new Promise(resolve => {
        const names = ['readings', 'medicines', 'regimens', 'labs', 'tombstones', 'meta'], tx = db.transaction(names, 'readwrite')
        for (const name of names.filter(n => n !== 'meta')) tx.objectStore(name).clear()
        tx.objectStore('meta').put({ ...settings, ...fields, people: [{ id: 'p-browser-new', name: 'Я' }], activePerson: 'p-browser-new', mergedPeople: {}, guideOffered: true }, 'settings')
        tx.oncomplete = resolve
      }); db.close()
    }, { textScale: scale, theme, interfaceStyle: 'modern' })
    await page.reload(); await settle(page)
    await go(page, { tool: 'Настройки', open: 'Семейный обмен' })
    assert.ok(await page.getByText('В браузере доступна только отправка.', { exact: true }).isVisible())
    await page.getByRole('textbox', { name: 'Общий ключ семьи', exact: true }).fill('synthetic-key-never-real-0123456789')
    await page.getByRole('button', { name: 'Подключить отправку на Диск', exact: true }).click()
    await page.getByRole('button', { name: 'Отправить дневник сейчас', exact: true }).waitFor()
    await page.getByText('Телефон семьи', { exact: true }).waitFor()
    assert.ok(await page.getByText('На Диске пока один файл дневника.', { exact: false }).isVisible())
    assert.equal(await page.getByText('ключи от разных аккаунтов', { exact: false }).count(), 0)
    assert.equal(uploads.length, 0, 'Connecting an empty browser must not create a phantom person')
    assert.deepEqual((await stored(page)).settings.people.map(p => p.name), ['Я'], 'A file listing must not pretend to import people')
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    await page.getByRole('button', { name: /Семейный обмен Яндекс.Диск · только отправка/ }).click()
    await page.getByText('Как перенести дневник с телефона', { exact: true }).click()
    assert.ok(await page.getByText('Это разовый перенос.', { exact: false }).isVisible())
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    const inputBefore = await page.evaluate(() => [matchMedia('(pointer: coarse)').matches, navigator.maxTouchPoints])
    await page.screenshot({ path: `${out}/${scale}-${theme}-family.png` })
    assert.deepEqual(await page.evaluate(() => [matchMedia('(pointer: coarse)').matches, navigator.maxTouchPoints]), inputBefore)
    await page.getByRole('button', { name: 'Открыть восстановление', exact: true }).click()
    await page.getByRole('heading', { name: 'Восстановить дневник', exact: true }).waitFor()
    if (scale === 'normal' && theme === 'light') {
      const before = await stored(page)
      const people = [{ id: 'p-phone-a', name: 'Анна', deviceUser: 1 }, { id: 'p-phone-b', name: 'Борис', deviceUser: 2 }]
      const measurements = [{ kind: 'bp', id: 'phone-bp-1', person: 'p-phone-a', user: 1, ts: FROZEN - 3600000, sys: 123, dia: 81, bpm: 67, source: 'manual', ihb: false, mov: false }]
      const copy = { format: 'omron-bp/v7', measurements, medicines: [], regimens: [], labs: [], tombstones: [], settings: { ...before.settings, people, activePerson: 'p-phone-a' } }
      await page.locator('input[type=file]').setInputFiles({ name: 'phone-copy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(copy)) })
      await page.getByText(/добавлено новых: 1/).waitFor()
      const after = await stored(page)
      assert.deepEqual(after.settings.people.map(p => [p.id, p.name]), people.map(p => [p.id, p.name]))
      assert.equal(after.settings.activePerson, 'p-phone-a')
      assert.equal(after.settings.interfaceStyle, 'modern')
      assert.equal(after.readings.length, 1)
      assert.equal(after.readings[0].person, 'p-phone-a')
      assert.equal(after.readings[0].sys, 123); assert.equal(after.readings[0].dia, 81)
      await go(page, { tool: 'Настройки', open: 'Люди' })
      await page.getByRole('button', { name: /^Анна / }).waitFor()
      await page.getByRole('button', { name: /^Борис / }).waitFor()
      await page.reload(); await settle(page)
      assert.deepEqual((await stored(page)).settings.people.map(p => p.id), people.map(p => p.id))
      assert.equal((await stored(page)).readings.length, 1)
    }
    assert.deepEqual(errors, [])
    results.push({ scale, theme, passed: true })
    await context.close()
  }
  console.log('Web cloud: honest connection status, empty upload guard, 4 touch layouts and phone-copy restore passed')
} finally {
  writeFileSync(`${out}/ui-results.json`, JSON.stringify(results, null, 2))
  await browser.close()
}
