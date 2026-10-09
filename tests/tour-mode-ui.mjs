/** The active basics tour must use the same navigation mode as its guide list. */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { FROZEN, go, seed, settle, settleAny } from '../tools/visual.mjs'

const base = process.env.URL ?? 'http://127.0.0.1:5199'
const browser = await chromium.launch()
const errors = []

async function setSettings(page, interfaceStyle) {
  await page.evaluate(async style => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('omron-bp')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const settings = await new Promise((resolve, reject) => {
      const request = db.transaction('meta').objectStore('meta').get('settings')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('meta', 'readwrite')
      transaction.objectStore('meta').put({ ...settings, interfaceStyle: style, guideOffered: true }, 'settings')
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  }, interfaceStyle)
}

try {
  for (const mode of ['classic', 'modern']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, locale: 'ru-RU', colorScheme: 'light' })
    const page = await context.newPage()
    page.setDefaultTimeout(6000)
    page.on('pageerror', error => errors.push(`${mode}: ${error.message}`))
    page.on('console', message => { if (message.type() === 'error') errors.push(`${mode}: ${message.text()}`) })
    await page.route('https://api.github.com/**', route => route.fulfill({ contentType: 'application/json', body: '[]' }))
    await page.clock.install({ time: new Date(FROZEN) })
    await page.goto(base, { waitUntil: 'domcontentloaded' })
    await settleAny(page)
    await seed(page, FROZEN)
    await setSettings(page, mode)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await settle(page)

    await go(page, { tool: 'Настройки', open: 'Как пользоваться' })
    await page.getByRole('heading', { name: 'Как пользоваться', exact: true }).waitFor()
    await page.locator('.pill__open', { hasText: 'С чего начать' }).click()
    await page.getByRole('heading', { name: 'Разделы внизу', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Дальше', exact: true }).click()

    const title = mode === 'modern' ? 'Меню «Ещё»' : 'Кнопки сверху'
    await page.getByRole('heading', { name: title, exact: true }).waitFor()
    const visibleText = await page.locator('.tour__text').innerText()
    if (mode === 'modern') {
      assert.match(visibleText, /Нажмите «Ещё»/)
      assert.match(visibleText, /прибор, отчёты, настройки и справку/)
      assert.match(await page.locator('header .modern-tools__trigger').getAttribute('aria-label'), /^Ещё(?:\.|$)/)
    } else {
      assert.match(visibleText, /«Прибор».*«Отчёт».*«Настройки».*«Справка»/)
      assert.equal(await page.locator('header button', { hasText: 'Настройки' }).count(), 1)
    }

    await page.getByRole('button', { name: 'Дальше', exact: true }).click()
    await page.getByRole('heading', { name: 'Размер текста и тема', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Дальше', exact: true }).click()
    await page.getByRole('heading', { name: 'Если что-то забудется', exact: true }).waitFor()
    const finalText = await page.locator('.tour__text').innerText()
    if (mode === 'modern') {
      assert.match(finalText, /«Ещё».*«Справка»/)
      assert.match(finalText, /в любой момент заново пройти подсказки/)
      assert.equal(await page.locator('[data-tour="tools"]').count(), 1, 'the final modern step points to the existing More navigation')
    } else {
      assert.equal(finalText, 'Эта кнопка есть на любом экране. В ней — все подсказки, и пройти их можно сколько угодно раз: про давление, про лекарства и про то, где что настроить.')
      assert.equal(await page.locator('[data-tour="tool-guide"]').count(), 1, 'the classic final step keeps its existing Help anchor')
    }
    await page.getByRole('button', { name: 'Готово', exact: true }).click()
    await page.locator('.tour').waitFor({ state: 'detached' })
    console.log(`ok ${mode}: launched basics tour shows the matching navigation guidance`)
    await context.close()
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
}
