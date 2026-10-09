import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { FROZEN, seed, settleAny, settle } from '../tools/visual.mjs'

const out = 'reviews/evidence/cabinet'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const checks = []
try {
  for (const scale of ['normal', 'xlarge']) {
    const context = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, locale: 'ru-RU' })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(String(error)))
    await page.route('https://api.github.com/**', route => route.fulfill({ contentType: 'application/json', body: '[]' }))
    await page.clock.install({ time: new Date(FROZEN) })
    await page.goto('http://localhost:5199', { waitUntil: 'domcontentloaded' })
    await settleAny(page)
    await seed(page, FROZEN)
    await page.evaluate(async ({ now, scale }) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('omron-bp')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const old = await new Promise(resolve => {
        const request = db.transaction('meta').objectStore('meta').get('settings')
        request.onsuccess = () => resolve(request.result)
      })
      const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1)
      const boxes = [
        { id: 'alpha', name: 'Альфа', left: 2, purpose: 'Давление' },
        { id: 'beta', name: 'Бета', left: 2, purpose: 'Витамины' },
        { id: 'shared', name: 'Общая упаковка', left: 2, expires: yesterday.getTime() },
        { id: 'ended', name: 'Завершённый препарат', left: 0, expires: yesterday.getTime() },
        { id: 'reserve', name: 'Домашний резерв', left: 0 },
      ].map(box => ({ dose: '', expires: null, leftAt: now, ...box }))
      const course = (id, medicineId, person, extra = {}) => ({ id, medicineId, person, times: ['08:00'], perTime: 1, taken: [], ...extra })
      const courses = [
        course('ra', 'alpha', 'p1', { taken: [new Date(now).setHours(8, 0, 0, 0)] }), course('rb', 'beta', 'p2'),
        course('rv', 'alpha', 'p3', { endsAt: yesterday.getTime() }),
        course('rs1', 'shared', 'p1', { endsAt: yesterday.getTime() }), course('rs2', 'shared', 'p2'),
        course('re', 'ended', 'p1', { planFrom: yesterday.getTime(), plan: [{ perTime: 1, days: 1 }] }),
      ]
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['medicines', 'regimens', 'meta'], 'readwrite')
        tx.objectStore('medicines').clear(); tx.objectStore('regimens').clear()
        boxes.forEach(box => tx.objectStore('medicines').put(box))
        courses.forEach(course => tx.objectStore('regimens').put(course))
        tx.objectStore('meta').put({ ...old, textScale: scale, guideOffered: true,
          people: [{ id: 'p1', name: 'Анна', deviceUser: 1 }, { id: 'p2', name: 'Борис', deviceUser: 2 }, { id: 'p3', name: 'Вера' }], activePerson: 'p1' }, 'settings')
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error)
      })
      db.close()
    }, { now: FROZEN, scale })
    await page.reload({ waitUntil: 'domcontentloaded' }); await settle(page)
    await page.getByRole('button', { name: 'Аптечка', exact: true }).click()
    const names = selector => page.locator(selector).allTextContents().then(list => list.map(s => s.trim()).sort())
    const choose = async (label, current, next) => {
      await page.getByRole('button', { name: `${label}: ${current}`, exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: next, exact: true }).click()
    }
    const section = async title => {
      await page.getByRole('group', { name: 'Разделы аптечки' }).getByRole('button', { name: new RegExp(`^${title}`) }).click()
    }
    const layout = async suffix => {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${scale}/${suffix}: horizontal overflow`)
      await page.screenshot({ path: `${out}/${scale}-${suffix}.png`, fullPage: true })
    }
    const diaryOwner = () => page.evaluate(async () => {
      const db = await new Promise(resolve => { const request = indexedDB.open('omron-bp'); request.onsuccess = () => resolve(request.result) })
      const settings = await new Promise(resolve => { const request = db.transaction('meta').objectStore('meta').get('settings'); request.onsuccess = () => resolve(request.result) })
      db.close(); return settings.activePerson
    })
    assert.equal(await page.getByRole('heading', { name: 'Запасы лекарств', exact: true }).count(), 1)
    assert.equal((await names('.pill__name')).length, 5)
    await choose('Для чего', 'Все', 'Давление')
    assert.deepEqual(await names('.pill__name'), ['Альфа'])
    await choose('Для чего', 'Давление', 'Все')
    assert.equal((await names('.pill__name')).length, 5)
    await choose('Что показывать', 'Все', 'Просрочены')
    assert.deepEqual(await names('.pill__name'), ['Завершённый препарат', 'Общая упаковка'])
    await choose('Что показывать', 'Просрочены', 'Все')
    await page.getByRole('searchbox', { name: 'Найти в аптечке' }).fill('Альфа')
    await choose('Чьи лекарства', 'Все', 'Борис')
    await page.getByRole('searchbox', { name: 'Найти в аптечке' }).waitFor()
    await page.getByRole('searchbox', { name: 'Найти в аптечке' }).fill('')
    await page.waitForFunction(() => document.querySelectorAll('.pill__name').length === 2)
    await choose('Чьи лекарства', 'Борис', 'Все')
    await choose('Что показывать', 'Все', 'Просрочены')
    await choose('Чьи лекарства', 'Все', 'Вера')
    assert.equal((await names('.pill__name')).length, 0)
    await choose('Что показывать', 'Просрочены', 'Все')
    assert.deepEqual(await names('.pill__name'), ['Альфа'])
    await choose('Чьи лекарства', 'Вера', 'Все')
    await layout('all-stock')
    await choose('Чьи лекарства', 'Все', 'Анна')
    assert.deepEqual(await names('.pill__name'), ['Альфа', 'Завершённый препарат', 'Общая упаковка'])
    assert.equal(await diaryOwner(), 'p1')
    await section('Курсы')
    assert.equal((await names('.pill__name')).length, 3)
    assert.ok(!(await page.locator('.pills').textContent()).includes('Борис'))
    await choose('Статус курса', 'Все', 'Завершённые')
    assert.deepEqual(await names('.pill__name'), ['Завершённый препарат', 'Общая упаковка'])
    assert.ok((await page.locator('.pill__open', { hasText: 'Завершённый препарат' }).textContent()).includes('Курс завершён'))
    await choose('Статус курса', 'Завершённые', 'Действующие')
    assert.deepEqual(await names('.pill__name'), ['Альфа'])
    await choose('Статус курса', 'Действующие', 'Все')
    await choose('Чьи лекарства', 'Анна', 'Борис')
    assert.deepEqual(await names('.pill__name'), ['Бета', 'Общая упаковка'])
    assert.equal(await diaryOwner(), 'p1', 'фильтр аптечки не меняет дневник')
    await layout('boris-courses')
    await page.getByRole('button', { name: 'Завести курс приёма', exact: true }).click()
    await page.getByRole('searchbox', { name: 'Найти препарат в аптечке' }).fill('Бета')
    await page.getByRole('button', { name: /Бета/ }).click()
    assert.equal(await page.getByRole('group', { name: 'Кто принимает' }).getByRole('button', { name: 'Борис', exact: true }).getAttribute('aria-pressed'), 'true')
    assert.equal(await page.getByRole('button', { name: /^Чьи лекарства:/ }).count(), 0, 'фильтр просмотра не висит над формой')
    await page.getByRole('button', { name: 'Отмена', exact: true }).click()
    await section('Купить')
    assert.deepEqual(await names('.buy__name'), ['Бета', 'Общая упаковка'])
    await choose('Чьи лекарства', 'Борис', 'Анна')
    assert.deepEqual(await names('.buy__name'), ['Альфа'])
    await choose('Чьи лекарства', 'Анна', 'Все')
    assert.deepEqual(await names('.buy__name'), ['Альфа', 'Бета', 'Общая упаковка'])
    assert.ok((await page.locator('.buy__row', { hasText: 'Общая упаковка' }).textContent()).includes('Борис'))
    assert.ok(!(await page.locator('.buy__row', { hasText: 'Общая упаковка' }).textContent()).includes('Анна'))
    await layout('all-buy')
    await section('Курсы')
    assert.equal((await names('.pill__name')).length, 6)
    await page.clock.setSystemTime(FROZEN + 25_000)
    await page.locator('.pill__open', { hasText: 'Альфа' }).filter({ hasText: 'Анна' }).click()
    await page.getByRole('button', { name: 'Больше не принимаю', exact: true }).click()
    await page.getByText(/^Приём прекращён /).waitFor()
    const saved = await page.evaluate(async () => {
      const db = await new Promise(resolve => { const r = indexedDB.open('omron-bp'); r.onsuccess = () => resolve(r.result) })
      const regimen = await new Promise(resolve => { const r = db.transaction('regimens').objectStore('regimens').get('ra'); r.onsuccess = () => resolve(r.result) })
      db.close(); return regimen
    })
    assert.ok(saved.stoppedAt >= FROZEN + 25_000)
    assert.deepEqual(saved.taken, [new Date(FROZEN).setHours(8, 0, 0, 0)])
    await section('Купить')
    assert.deepEqual(await names('.buy__name'), ['Бета', 'Общая упаковка'])
    await section('Курсы')
    await page.locator('.pill__open', { hasText: 'Альфа' }).filter({ hasText: 'Анна' }).click()
    assert.equal(await page.getByRole('button', { name: 'Больше не принимаю', exact: true }).count(), 0)
    await layout('stopped-form')
    await page.getByRole('button', { name: 'Отмена', exact: true }).click()
    await page.getByRole('button', { name: 'Давление', exact: true }).click()
    await page.getByRole('button', { name: 'Чей дневник: Анна', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Аптечка', exact: true }).click()
    await page.getByRole('button', { name: 'Чьи лекарства: Все', exact: true }).waitFor()
    // Оставляем только завершённый курс: срок годности виден в запасах,
    // но пометка «купить» и список покупок должны исчезнуть.
    await page.evaluate(async () => {
      const db = await new Promise(resolve => { const r = indexedDB.open('omron-bp'); r.onsuccess = () => resolve(r.result) })
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['medicines', 'regimens'], 'readwrite')
        for (const id of ['alpha', 'beta', 'shared', 'reserve']) tx.objectStore('medicines').delete(id)
        for (const id of ['ra', 'rb', 'rv', 'rs1', 'rs2']) tx.objectStore('regimens').delete(id)
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error)
      }); db.close()
    })
    await page.reload({ waitUntil: 'domcontentloaded' }); await settle(page)
    await page.getByRole('button', { name: 'Аптечка', exact: true }).click()
    const buyButton = page.getByRole('group', { name: 'Разделы аптечки' }).getByRole('button', { name: /^Купить/ })
    assert.equal(await buyButton.locator('.segmented__mark').count(), 0, 'завершённый курс не подсвечивает покупку')
    await buyButton.click()
    assert.equal(await page.locator('.buy__row').count(), 0)
    await page.getByText('Список покупок пуст.', { exact: true }).waitFor()
    await layout('ended-no-buy')
    assert.deepEqual(errors, [])
    checks.push(`${scale}: All, person, category, expiry and course status; visible reset; shared stock; new course owner; explicit stop preserves history; ended purchase badge absent; diary unchanged`)
    console.log(`ok ${checks.at(-1)}`)
    await context.close()
  }
  writeFileSync(`${out}/integration.json`, JSON.stringify({ at: new Date().toISOString(), checks }, null, 2) + '\n')
} finally { await browser.close() }
