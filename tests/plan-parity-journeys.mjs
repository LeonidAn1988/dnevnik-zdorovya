/** Plan parity: every new-course entrance has review and one unambiguous exit.
 * Disposable touch profiles only; no connected phone or real family account. */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { FROZEN, seed, settleAny, goConceptRoute } from '../tools/visual.mjs'

const out = process.env.EVIDENCE_DIR || '/private/tmp/omron-plan-parity-journeys'
mkdirSync(out, { recursive: true })
const results = { checks: [], failures: [], errors: [] }
const browser = await chromium.launch()

async function read(page) {
  return page.evaluate(async () => {
    const db = await new Promise(resolve => { const q = indexedDB.open('omron-bp'); q.onsuccess = () => resolve(q.result) })
    const all = store => new Promise(resolve => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => resolve(q.result) })
    const result = { regimens: await all('regimens'), medicines: await all('medicines') }
    db.close(); return result
  })
}

async function fixture(page, style) {
  await page.clock.install({ time: new Date(FROZEN) })
  await page.route('https://api.github.com/**', route => route.fulfill({ json: [] }))
  await page.goto(process.env.URL || 'http://localhost:5199')
  await settleAny(page); await seed(page, FROZEN)
  await page.evaluate(async ({ style, now }) => {
    const db = await new Promise(resolve => { const q = indexedDB.open('omron-bp'); q.onsuccess = () => resolve(q.result) })
    const settings = await new Promise(resolve => { const q = db.transaction('meta').objectStore('meta').get('settings'); q.onsuccess = () => resolve(q.result) })
    const day = offset => { const d = new Date(now); d.setDate(d.getDate() + offset); d.setHours(0, 0, 0, 0); return +d }
    const tx = db.transaction(['meta', 'medicines', 'regimens'], 'readwrite')
    tx.objectStore('medicines').clear(); tx.objectStore('regimens').clear()
    tx.objectStore('meta').put({ ...settings, interfaceStyle: style, textScale: 'normal', theme: 'light', guideOffered: true,
      people: [{ id: 'p1', name: 'Анна', deviceUser: 1 }, { id: 'p2', name: 'Борис' }], activePerson: 'p1' }, 'settings')
    for (const [id, name] of [['plan-new', 'Препарат для нового курса'], ['plan-old', 'Препарат завершённого курса']]) {
      tx.objectStore('medicines').put({ id, name, dose: '', inn: '', maker: '', kind: 0, form: 'Таблетки', stockUnit: 'piece',
        packSize: 100, left: 100, leftAt: now, expires: null, perDay: null })
    }
    tx.objectStore('regimens').put({ id: 'plan-ended', medicineId: 'plan-old', person: 'p2', startedAt: day(-12), planFrom: day(-12),
      since: day(-12), endsAt: day(-7), times: ['08:00'], perTime: 2, meal: 'before', mealMinutes: 20,
      taken: [day(-12) + 8 * 3600000], updatedAt: day(-6), scheduleUpdatedAt: day(-6), bindingUpdatedAt: day(-6) })
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error) }); db.close()
  }, { style, now: FROZEN })
  await page.reload(); await page.locator('nav.concept-navigation').waitFor()
  // Wait for the app's one-time legacy schedule normalization before comparing.
  await page.waitForFunction(async () => {
    const db = await new Promise(resolve => { const q = indexedDB.open('omron-bp'); q.onsuccess = () => resolve(q.result) })
    const rows = await new Promise(resolve => { const q = db.transaction('regimens').objectStore('regimens').getAll(); q.onsuccess = () => resolve(q.result) })
    db.close(); return rows.every(row => row.legacySchedule || row.scheduleUpdatedAt !== undefined)
  })
  await goConceptRoute(page, 'cabinet')
  await page.getByRole('button', { name: /^Чьи лекарства/ }).click()
  await page.locator('dialog[open]').getByRole('button', { name: 'Все', exact: true }).click()
}

async function openCourse(page, entrance) {
  const sections = page.getByRole('group', { name: 'Разделы аптечки' })
  if (entrance === 'card') {
    if (await sections.count()) {
      await sections.getByRole('button', { name: /^Запасы/ }).click()
      await page.locator('.pill__open').filter({ hasText: 'Препарат для нового курса' }).click()
    }
    await page.getByRole('button', { name: 'Завести курс приёма', exact: true }).click()
  } else {
    await sections.getByRole('button', { name: /^Курсы/ }).click()
    if (entrance === 'repeat') {
      await page.locator('.pill__open').filter({ hasText: 'Препарат завершённого курса' }).click()
      await page.getByRole('button', { name: 'Повторить курс', exact: true }).click()
    } else {
      await page.getByRole('button', { name: 'Завести курс приёма', exact: true }).click()
      await page.getByRole('searchbox', { name: 'Найти препарат в аптечке' }).fill('Препарат для нового курса')
      await page.locator('.course-medicine-results button').filter({ hasText: 'Препарат для нового курса' }).click()
    }
  }
}

async function fillAndReview(page, entrance) {
  const owner = page.getByRole('group', { name: 'Кто принимает', exact: true })
  if (entrance === 'repeat') assert.equal(await owner.getByRole('button', { name: 'Борис', exact: true }).getAttribute('aria-pressed'), 'true')
  // Explicitly change owner twice so a stale header cannot pass by coincidence.
  await owner.getByRole('button', { name: 'Анна', exact: true }).click()
  assert.equal(await page.locator('.concept-header .concept-tools__person').innerText(), 'Анна')
  await owner.getByRole('button', { name: 'Борис', exact: true }).click()
  if (entrance !== 'repeat') await page.getByRole('button', { name: /Утро.*08:00/ }).click()
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight))
  const header = await page.locator('.concept-header').boundingBox()
  assert.ok(header && Math.abs(header.y) <= 1, 'Owner header must remain pinned after scrolling the long course')
  assert.equal(await page.locator('.concept-header .concept-tools__person').innerText(), 'Борис')
  await page.getByRole('button', { name: 'Проверить назначение', exact: true }).click()
  await page.getByRole('form', { name: 'Проверка курса', exact: true }).waitFor()
  assert.match(await page.locator('.course-review').innerText(), /Кто принимает\s+Борис/)
  assert.equal(await page.locator('.concept-header .concept-tools__person').innerText(), 'Борис')
}

try {
  for (const style of ['journal', 'rhythm', 'clear']) for (const entrance of ['list', 'card', 'repeat']) {
    const profile = { style, entrance }
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, locale: 'ru-RU', timezoneId: 'Europe/Moscow' })
    const page = await context.newPage(); page.setDefaultTimeout(10000)
    page.on('pageerror', error => results.errors.push({ ...profile, error: String(error) }))
    try {
      await fixture(page, style)
      const baseline = await read(page)
      const destination = entrance === 'card' ? 'cabinet/card' : 'cabinet'
      await openCourse(page, entrance); await fillAndReview(page, entrance)
      assert.deepEqual(await read(page), baseline, 'Opening review does not save')
      await page.getByRole('button', { name: 'Изменить назначение', exact: true }).click()
      assert.equal(await page.locator('.course-review').count(), 0)
      assert.equal(await page.getByRole('group', { name: 'Кто принимает' }).getByRole('button', { name: 'Борис', exact: true }).getAttribute('aria-pressed'), 'true')
      assert.equal(await page.getByRole('button', { name: /Утро.*08:00/ }).getAttribute('aria-pressed'), 'true', 'Back keeps the selected time')
      await page.getByRole('button', { name: 'Проверить назначение', exact: true }).click()
      await page.getByRole('button', { name: 'Отмена', exact: true }).click()
      await page.waitForFunction(path => document.querySelector('.app')?.dataset.nav === path, destination)
      assert.deepEqual(await read(page), baseline, 'Cancel from review closes the entire course without writing')

      await openCourse(page, entrance); await fillAndReview(page, entrance)
      await page.getByRole('button', { name: 'Добавить в расписание', exact: true }).evaluate(button => { button.click(); button.click() })
      await page.waitForFunction(path => document.querySelector('.app')?.dataset.nav === path, destination)
      const after = await read(page), created = after.regimens.filter(row => !baseline.regimens.some(old => old.id === row.id))
      assert.equal(created.length, 1, 'Double confirm creates exactly one course')
      assert.equal(created[0].person, 'p2')
      assert.equal(created[0].medicineId, entrance === 'repeat' ? 'plan-old' : 'plan-new')
      assert.deepEqual(after.medicines, baseline.medicines, 'Course creation does not create or replace stock')
      for (const old of baseline.regimens) assert.deepEqual(after.regimens.find(row => row.id === old.id), old, 'Archived course and marks remain byte-for-byte unchanged')
      if (entrance === 'repeat') {
        assert.equal(created[0].perTime, 2); assert.equal(created[0].mealMinutes, 20)
        assert.equal(created[0].taken, undefined); assert.equal(created[0].history, undefined)
      }
      assert.equal(await page.locator('.course-review').count(), 0, 'Confirmed save exits review and course')
      results.checks.push({ ...profile, reviewBeforeWrite: true, editPreservesFields: true, cancelReturnsToSource: true,
        stickyDraftOwner: true, exactlyOneNewCourse: true, correctOwner: true, oldCourseUnchanged: true })
      console.log('PASS', style, entrance)
    } catch (error) {
      results.failures.push({ ...profile, error: String(error.stack || error) }); console.error('FAIL', style, entrance, String(error))
      await page.screenshot({ path: `${out}/${style}-${entrance}-failure.png`, fullPage: true }).catch(() => {})
    } finally { await context.close() }
  }
} finally {
  await browser.close()
  writeFileSync(`${out}/result.json`, JSON.stringify(results, null, 2) + '\n')
}
assert.equal(results.failures.length, 0, JSON.stringify(results.failures, null, 2))
assert.equal(results.errors.length, 0, JSON.stringify(results.errors, null, 2))
console.log(`Plan-parity journeys: ${results.checks.length} passed; evidence ${out}/result.json`)
