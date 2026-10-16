/** Real routes and saves; disposable touch profiles with synthetic household data. */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { FROZEN, seed, settleAny, goConceptRoute, go } from '../tools/visual.mjs'

const out = 'reviews/evidence/journey-recovery'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch(), results = { checks: [], failures: [], errors: [] }
async function diary(page, patch) {
  return page.evaluate(async patch => {
    const db = await new Promise(resolve => { const q = indexedDB.open('omron-bp'); q.onsuccess = () => resolve(q.result) })
    const read = (store, key) => new Promise(resolve => { const q = key ? db.transaction(store).objectStore(store).get(key) : db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => resolve(q.result) })
    if (patch) { const settings = await read('meta', 'settings'), tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put({ ...settings, ...patch }, 'settings'); await new Promise(resolve => tx.oncomplete = resolve) }
    const result = { settings: await read('meta', 'settings'), medicines: await read('medicines'), regimens: await read('regimens') }; db.close(); return result
  }, patch)
}
async function pick(page, label, name) {
  await page.getByRole('button', { name: new RegExp('^' + label) }).click()
  await page.locator('dialog[open]').getByRole('button', { name: new RegExp('^' + name) }).click()
}
async function number(page, label, value) {
  const input = page.getByRole('textbox', { name: new RegExp('^' + label) })
  if (await input.count()) await input.fill(value)
  else await page.locator('.wheel').filter({ has: page.getByRole('spinbutton', { name: label, exact: true }) }).locator('.wheel__item').filter({ hasText: new RegExp('^' + value + '$') }).click()
}
const profiles = ['journal', 'rhythm', 'clear'].flatMap(style => ['normal', 'xlarge'].map(scale => ({ style, scale })))
try {
  for (const profile of profiles) {
    const context = await browser.newContext({ viewport: { width: profile.scale === 'xlarge' ? 320 : 390, height: 844 }, hasTouch: true, locale: 'ru-RU', colorScheme: profile.scale === 'xlarge' ? 'dark' : 'light' })
    const page = await context.newPage(); page.setDefaultTimeout(8000)
    await page.route('**/drugs.json', r => r.fulfill({ json: { date: '2026-10-16', forms: [], makers: [], items: [] } }))
    await page.route('**/supplements.json', r => r.fulfill({ json: { date: '2026-10-16', forms: [], makers: [], items: [] } }))
    page.on('pageerror', error => results.errors.push({ profile, error: String(error) }))
    try {
      await page.clock.install({ time: new Date(FROZEN) })
      await page.goto(process.env.URL || 'http://localhost:5199'); await settleAny(page); await seed(page, FROZEN)
      await diary(page, { interfaceStyle: profile.style, theme: profile.scale === 'xlarge' ? 'dark' : 'light', textScale: profile.scale, guideOffered: true,
        people: [{ id: 'p1', name: 'Леонид', deviceUser: 1 }, { id: 'mom', name: 'Мама' }, { id: 'dad', name: 'Отец' }], activePerson: 'p1' })
      await page.reload(); await page.locator('nav.tabs').waitFor()
      await goConceptRoute(page, 'cabinet'); await pick(page, 'Чьи лекарства', 'Отец')
      await goConceptRoute(page, 'overview'); await pick(page, 'Чей дневник', 'Мама')
      assert.equal(await page.locator('.daystrip').count(), 0, 'Today never displays a historical day strip')
      const before = await diary(page)
      await page.getByRole('button', { name: 'Добавить приём', exact: true }).click()
      assert.equal(await page.locator('.app').getAttribute('data-nav'), 'cabinet/regimen')
      assert.equal(await page.getByRole('searchbox', { name: 'Найти препарат в аптечке' }).count(), 1)
      await page.getByRole('searchbox', { name: 'Найти препарат в аптечке' }).fill('Конкор')
      await page.locator('.course-medicine-results button').filter({ hasText: 'Конкор' }).first().click()
      await page.getByRole('group', { name: 'Кто принимает' }).getByRole('button', { name: 'Мама', exact: true }).waitFor()
      assert.equal(await page.getByRole('group', { name: 'Кто принимает' }).getByRole('button', { name: 'Мама', exact: true }).getAttribute('aria-pressed'), 'true')
      await page.getByRole('button', { name: 'Проверить назначение', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'Выберите хотя бы одно время' }).waitFor()
      assert.equal((await diary(page)).regimens.length, before.regimens.length, 'Invalid schedule writes nothing')
      await page.getByRole('button', { name: /Утро.*08:00/ }).click()
      await page.getByRole('group', { name: 'Срок курса', exact: true }).getByRole('button', { name: 'Ограничен', exact: true }).click()
      await number(page, 'Курс, дней', '6')
      await page.getByRole('button', { name: 'Проверить назначение', exact: true }).click()
      await page.getByRole('form', { name: 'Проверка курса' }).waitFor()
      assert.ok((await page.locator('.course-review').innerText()).includes('Мама'))
      assert.equal(await page.evaluate(() => scrollY), 0, 'Review starts at the beginning of the assignment')
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Проверьте приём', 'Review announces its task step')
      const heading = await page.locator('.course-review h3').boundingBox()
      assert.ok(heading.y >= 0 && heading.y < 844, 'Review heading is visible immediately')
      assert.equal((await diary(page)).regimens.length, before.regimens.length, 'Review does not save')
      await page.screenshot({ path: `${out}/review-${profile.style}-${profile.scale}.png`, fullPage: true })
      await page.getByRole('button', { name: 'Добавить в расписание', exact: true }).evaluate(button => { button.click(); button.click() })
      await page.waitForFunction(() => document.querySelector('.app')?.dataset.nav === 'overview')
      await page.locator('.course-saved').waitFor()
      const after = await diary(page), created = after.regimens.filter(r => !before.regimens.some(old => old.id === r.id))
      assert.equal(created.length, 1); assert.equal(created[0].person, 'mom'); assert.equal(created[0].medicineId, 'm1')
      assert.equal(after.medicines.length, before.medicines.length, 'Existing household medicine is reused')
      assert.equal(after.settings.activePerson, 'mom')
      await page.locator('li.dose').filter({ has: page.getByText('Конкор', { exact: true }) }).waitFor()
      results.checks.push({ ...profile, scenario: 'Today -> existing medicine -> explicit owner -> validation -> review -> persisted schedule -> Today' })

      // Browsing yesterday is separate from Today, including group-memory return.
      await goConceptRoute(page, 'intake')
      const today = await page.locator('.daystrip__day[aria-selected=true]').getAttribute('data-day')
      await page.locator(`.daystrip__day[data-day="${Number(today) - 86400000}"]`).click()
      await page.locator('nav.concept-navigation [data-group="today"]').click()
      assert.equal(await page.locator('.app').getAttribute('data-nav'), 'overview')
      assert.equal(await page.locator('.daystrip').count(), 0)
      assert.equal(await page.locator('.intake__head h2').innerText(), 'План на сегодня')
      results.checks.push({ ...profile, scenario: 'Yesterday -> another group -> Today returns to current date' })

      // A shortage CTA must carry the owner instead of the cabinet's old filter.
      await goConceptRoute(page, 'cabinet'); await pick(page, 'Чьи лекарства', 'Отец')
      await goConceptRoute(page, 'overview'); await pick(page, 'Чей дневник', 'Леонид')
      await page.getByRole('button', { name: 'В аптечку', exact: true }).click()
      assert.ok((await page.locator('.concept-header .filterbtn').innerText()).includes('Леонид'))
      await page.locator('.pill__open').filter({ hasText: 'Конкор' }).first().waitFor()
      results.checks.push({ ...profile, scenario: 'Shortage keeps the person and exposes the medicine' })

      await goConceptRoute(page, 'overview'); await page.evaluate(() => scrollTo(0, 500))
      const top = await page.locator('.topbar').evaluate(el => el.getBoundingClientRect().top)
      assert.ok(Math.abs(top) <= 1, 'Person selector sticks to the mobile top edge')
      await page.evaluate(() => scrollTo(0, 0))
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await page.screenshot({ path: `${out}/today-${profile.style}-${profile.scale}.png`, fullPage: true })
      results.checks.push({ ...profile, scenario: 'Mobile sticky context and no horizontal overflow' })
      if (profile.style === 'clear' && profile.scale === 'xlarge') {
        await page.getByRole('button', { name: 'Добавить приём', exact: true }).click()
        await page.getByRole('searchbox', { name: 'Найти препарат в аптечке' }).fill('Конкор')
        await page.locator('.course-medicine-results button').filter({ hasText: 'Конкор' }).first().click()
        await page.getByRole('button', { name: /Утро.*08:00/ }).click()
        await page.getByRole('button', { name: 'Через день', exact: true }).click()
        await page.getByLabel('Списывать без подтверждения', { exact: true }).check()
        await page.getByRole('button', { name: 'Проверить назначение', exact: true }).click()
        await page.getByRole('form', { name: 'Проверка курса' }).waitFor()
        assert.match(await page.locator('.course-review').innerText(), /через день/i)
        assert.match(await page.locator('.course-review').innerText(), /Автоматическое списание/)
        assert.match(await page.locator('.course-review').innerText(), /по 1 шт/)
        await page.goBack()
        await page.getByRole('group', { name: 'Режим приёма', exact: true }).waitFor()
        assert.equal(await page.locator('.app').getAttribute('data-nav'), 'cabinet/regimen')
        await page.getByRole('button', { name: 'Отмена', exact: true }).click()
        await page.waitForFunction(() => document.querySelector('.app').dataset.nav === 'overview')
        results.checks.push({ ...profile, scenario: 'Review includes rhythm, explicit dose and auto-deduction; Back edits; Cancel returns to origin' })

        const stockBefore = await diary(page)
        await page.getByRole('button', { name: 'Добавить приём', exact: true }).click()
        await page.getByRole('button', { name: 'Добавить новый препарат', exact: true }).click()
        const dialog = page.getByRole('dialog', { name: 'Новый препарат для курса', exact: true })
        await dialog.getByRole('combobox', { name: 'Название или поиск препарата', exact: true }).fill('Синтетический препарат 93427')
        await dialog.getByRole('button', { name: 'Продолжить с этим названием вручную', exact: true }).click()
        await dialog.getByRole('button', { name: 'Добавить в аптечку', exact: true }).click()
        await dialog.waitFor({ state: 'hidden' })
        assert.equal((await diary(page)).regimens.length, stockBefore.regimens.length, 'Nested stock save is not a course save')
        await page.getByRole('button', { name: 'По потребности', exact: true }).click()
        await page.getByRole('button', { name: 'Проверить назначение', exact: true }).click()
        assert.match(await page.locator('.course-review').innerText(), /Плановых напоминаний не будет/)
        assert.equal(await page.locator('.course-review').getByText('Относительно еды', { exact: true }).count(), 0)
        await page.getByRole('button', { name: 'Сохранить приём', exact: true }).click()
        await page.waitForFunction(() => document.querySelector('.app').dataset.nav === 'overview')
        const saved = await diary(page), added = saved.regimens.find(r => !stockBefore.regimens.some(old => old.id === r.id))
        assert.equal(saved.medicines.length, stockBefore.medicines.length + 1)
        assert.equal(added.person, 'p1'); assert.equal(added.times, undefined)
        assert.match(await page.locator('.course-saved').innerText(), /по потребности/)
        results.checks.push({ ...profile, scenario: 'Today -> nested new stock -> explicit as-needed -> truthful review -> persisted result' })
      }

    } catch (error) {
      results.failures.push({ profile, error: String(error), nav: await page.locator('.app').getAttribute('data-nav').catch(() => null) })
      await page.screenshot({ path: `${out}/FAIL-${profile.style}-${profile.scale}.png`, fullPage: true }).catch(() => {})
      console.log('FAIL', profile, String(error).split('\n')[0])
    } finally { await context.close() }
  }
} finally { await browser.close() }
writeFileSync(`${out}/journeys.json`, JSON.stringify(results, null, 2) + '\n')
console.log({ checks: results.checks.length, failures: results.failures.length, errors: results.errors.length })
process.exitCode = results.failures.length || results.errors.length ? 1 : 0
