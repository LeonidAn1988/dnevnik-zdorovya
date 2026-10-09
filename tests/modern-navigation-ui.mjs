import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { FROZEN, seed, settle, settleAny } from '../tools/visual.mjs'

const base = process.env.URL ?? 'http://127.0.0.1:5199'
const out = process.env.EVIDENCE_DIR ?? 'reviews/evidence/package-c/after'
mkdirSync(out, { recursive: true })
const onlyControl = process.env.ONLY_CONTROL === '1'
const onlyFourProfile = process.env.ONLY_FOUR_PROFILE === '1'
const onlyZoom = process.env.ONLY_ZOOM === '1'
const widths = onlyControl ? [320] : onlyFourProfile ? [390] : onlyZoom ? [1280] : [320, 360, 390, 768, 1280]
const themes = onlyControl || onlyFourProfile ? ['dark'] : onlyZoom ? ['dark'] : ['light', 'dark']
const scales = onlyControl || onlyFourProfile ? ['xlarge'] : onlyZoom ? ['xlarge'] : ['normal', 'xlarge']
const inputs = onlyControl || onlyFourProfile ? ['touch'] : onlyZoom ? ['mouse'] : ['mouse', 'touch']
const browser = await chromium.launch()
const results = { frozen: FROZEN, matrix: [], checks: [], errors: [] }

async function patchSettings(page, patch) {
  await page.evaluate(async fields => {
    const db = await new Promise((resolve, reject) => { const q = indexedDB.open('omron-bp'); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error) })
    const settings = await new Promise((resolve, reject) => { const q = db.transaction('meta').objectStore('meta').get('settings'); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error) })
    await new Promise((resolve, reject) => { const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put({ ...settings, ...fields }, 'settings'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error) })
    db.close()
  }, patch)
}

async function waitForSheet(dialog) {
  await dialog.waitFor({ state: 'visible' })
  await dialog.evaluate(async element => {
    if (!element.open) throw new Error('navigation sheet is present but not open')
    await Promise.all(element.getAnimations().map(animation => animation.finished))
  })
}

async function fresh({ width, height, theme, scale, input }) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: input === 'touch', locale: 'ru-RU', timezoneId: 'Europe/Moscow', colorScheme: theme })
  const page = await context.newPage()
  page.setDefaultTimeout(6000)
  page.on('pageerror', error => results.errors.push(`${width}/${scale}/${theme}/${input}: ${error.message}`))
  await page.route('https://api.github.com/**', route => route.fulfill({ contentType: 'application/json', body: '[]' }))
  await page.clock.install({ time: new Date(FROZEN) })
  await page.goto(base, { waitUntil: 'domcontentloaded' }); await settleAny(page)
  await seed(page, FROZEN); await page.reload({ waitUntil: 'domcontentloaded' }); await settle(page)
  await patchSettings(page, { interfaceStyle: 'modern', density: 'compact', textScale: scale, theme })
  await page.reload({ waitUntil: 'domcontentloaded' }); await settle(page)
  await page.waitForTimeout(80)
  return { page, context }
}

function dimensions(width) {
  if (width === 320) return 800
  if (width === 360) return 780
  if (width === 390) return 844
  if (width === 768) return 1024
  return 900
}

try {
  for (const width of widths) for (const theme of themes) for (const scale of scales) for (const input of inputs) {
    const profile = { width, height: dimensions(width), theme, scale, input }
    const { page, context } = await fresh(profile)
    const geometry = await page.evaluate(() => {
      const rect = selector => { const element = document.querySelector(selector); if (!element) return null; const r = element.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height, position: getComputedStyle(element).position } }
      const nav = document.querySelector('nav.tabs')
      return {
        viewport: innerWidth, docWidth: document.documentElement.scrollWidth, header: rect('.topbar'), dock: rect('nav.tabs'),
        condensed: nav?.getAttribute('data-sections-menu') === 'true',
        tabButtons: [...(nav?.querySelectorAll('button') ?? [])].filter(e => e.getClientRects().length).map(e => ({ label: e.getAttribute('aria-label') || e.textContent.trim(), width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height })),
      }
    })
    assert.ok(geometry.docWidth <= width + 1, `${JSON.stringify(profile)} horizontal overflow: ${geometry.docWidth}`)
    const targetMinimum = input === 'touch' ? 48 : 40
    assert.ok(geometry.tabButtons.every(button => button.height >= targetMinimum), `${JSON.stringify(profile)} has a short ${input} target (<${targetMinimum}px): ${JSON.stringify(geometry.tabButtons)}`)
    if (scale === 'normal') assert.equal(geometry.condensed, false, `${JSON.stringify(profile)} should preserve normal bottom tabs`)
    if (width >= 768) assert.equal(geometry.condensed, false, `${JSON.stringify(profile)} has enough width for all sections`)
    results.matrix.push({ ...profile, ...geometry })

    if (width === 320 && scale === 'xlarge' && theme === 'dark' && input === 'touch') {
      assert.equal(geometry.condensed, true, '320/xlarge should use the Sections menu only when the labels no longer fit')
      const bottomLabels = await page.locator('nav.tabs button').evaluateAll(buttons => buttons.filter(button => button.getClientRects().length).map(button => button.getAttribute('aria-label')))
      assert.deepEqual(bottomLabels.map(label => label.split(/[.:]/, 1)[0]), ['Обзор', 'Приём лекарств', 'Разделы'], 'xlarge keeps Overview and Intake visible, with the remaining sections grouped')
      await page.locator('nav.tabs').getByRole('button', { name: 'Приём лекарств' }).tap()
      assert.equal(await page.locator('.app').getAttribute('data-nav'), 'intake')
      await page.evaluate(() => scrollTo(0, 0))
      const doseTop = await page.locator('.intake li.dose').evaluateAll(rows => rows.filter(row => row.getClientRects().length && getComputedStyle(row).visibility !== 'hidden').map(row => row.getBoundingClientRect().top).sort((a, b) => a - b)[0] ?? null)
      const afterGeometry = await page.evaluate(() => ({
        headerHeight: document.querySelector('.topbar').getBoundingClientRect().height,
        dock: (() => { const r = document.querySelector('nav.tabs').getBoundingClientRect(); return { top: r.top, height: r.height } })(),
      }))
      assert.ok(doseTop !== null, 'the first intake dose must be rendered')
      await page.screenshot({ path: `${out}/320-xlarge-dark-touch-intake-viewport.png` })
      results.control = { ...profile, ...afterGeometry, firstDoseTop: doseTop, before: { headerHeight: 156.02, dockTop: 665.78, dockHeight: 126.22, firstDoseTop: 522.625 } }

      const sections = page.locator('nav.tabs').getByRole('button', { name: /Разделы/ })
      await sections.focus(); await sections.press('Enter')
      const sectionDialog = page.locator('#modern-sections-sheet')
      await waitForSheet(sectionDialog)
      assert.match(await sectionDialog.textContent(), /Для дневника: Я/)
      for (const label of ['Обзор', 'Давление', 'Сахар', 'Приём лекарств', 'Аптечка']) await sectionDialog.getByRole('button', { name: new RegExp(label) }).waitFor()
      await page.screenshot({ path: `${out}/320-xlarge-dark-touch-sections-sheet.png` })
      await page.keyboard.press('Escape')
      await sectionDialog.waitFor({ state: 'hidden' })
      await page.waitForTimeout(50)
      const focusAfterEscape = await sections.evaluate((button, id) => ({ restored: document.activeElement === button, active: document.activeElement?.outerHTML?.slice(0, 180), dialogOpen: document.getElementById(id)?.open ?? false }), 'modern-sections-sheet')
      assert.equal(focusAfterEscape.restored && !focusAfterEscape.dialogOpen, true, `Escape closes the list and restores focus to Sections: ${JSON.stringify(focusAfterEscape)}`)
      await sections.tap(); await waitForSheet(sectionDialog)
      await sectionDialog.getByRole('button', { name: /^Давление/ }).tap()
      await page.waitForFunction(() => document.querySelector('.app')?.getAttribute('data-nav') === 'bp')
      assert.equal(await sections.getAttribute('aria-current'), 'page', 'a hidden active section is represented by the Sections tab')
      await sections.tap(); await waitForSheet(sectionDialog)
      const activeBp = sectionDialog.getByRole('button', { name: /^Давление/ })
      assert.equal(await activeBp.getAttribute('aria-current'), 'page', 'the Sections sheet names the current hidden section')
      assert.match(await activeBp.textContent(), /· открыт/)
      await page.keyboard.press('Escape'); await sectionDialog.waitFor({ state: 'hidden' })
      await sections.tap(); await sectionDialog.waitFor({ state: 'visible' })
      await sectionDialog.getByRole('button', { name: /^Аптечка/ }).tap()
      await page.waitForFunction(() => document.querySelector('.app')?.getAttribute('data-nav') === 'cabinet')
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-haspopup')), 'dialog', 'Selecting a section restores focus to its trigger')
      results.checks.push('320/xlarge/dark/touch: section menu lists every enabled destination; Escape and selection restore focus')

      // A compact viewport approximates the visual viewport after a mobile
      // keyboard opens. Confirm the sticky save actions remain reachable above
      // the dock while the user focuses the first long-form field.
      await page.setViewportSize({ width: 320, height: 480 })
      await page.locator('.cabinet__add').tap()
      await page.waitForFunction(() => document.querySelector('.app')?.getAttribute('data-nav') === 'cabinet/form')
      const firstField = page.locator('form input').first()
      await firstField.focus()
      await firstField.scrollIntoViewIfNeeded()
      const saveGeometry = await page.evaluate(() => {
        const save = document.querySelector('.form-actions--top button[type="submit"]')
        const dock = document.querySelector('nav.tabs')
        const s = save?.getBoundingClientRect()
        const d = dock?.getBoundingClientRect()
        return { saveTop: s?.top, saveBottom: s?.bottom, saveHeight: s?.height, dockTop: d?.top, focused: document.activeElement === document.querySelector('form input') }
      })
      assert.ok(saveGeometry.saveTop >= 0 && saveGeometry.saveBottom <= saveGeometry.dockTop, `sticky save actions should remain visible above the dock after viewport reduction: ${JSON.stringify(saveGeometry)}`)
      assert.ok(saveGeometry.saveHeight >= 48, `touch save action should be at least 48px: ${JSON.stringify(saveGeometry)}`)
      assert.equal(saveGeometry.focused, true, 'form field receives keyboard focus')
      await page.screenshot({ path: `${out}/320-xlarge-dark-touch-form-reduced-viewport.png` })
      results.checks.push('320/xlarge/dark/touch: form save actions stay reachable in a reduced-height keyboard viewport')

      await page.setViewportSize({ width: 320, height: 800 })
      const more = page.locator('header .modern-tools__trigger')
      await more.tap()
      const tools = page.locator('#modern-tools-sheet')
      await waitForSheet(tools)
      for (const label of ['Прибор', 'Отчёт', 'Настройки', 'Справка']) await tools.getByRole('button', { name: new RegExp(label) }).waitFor()
      assert.match(await tools.textContent(), /Для дневника: Я/)
      await page.screenshot({ path: `${out}/320-xlarge-dark-touch-more-sheet.png` })
      results.checks.push('320/xlarge/dark/touch: More explicitly lists service destinations with person context')
    }

    if (width === 320 && scale === 'normal' && theme === 'light' && input === 'mouse') {
      assert.equal(geometry.tabButtons.length, 5, 'normal text keeps all five daily sections in the bottom bar')
      const more = page.locator('header .modern-tools__trigger')
      await more.click()
      const tools = page.locator('#modern-tools-sheet')
      await waitForSheet(tools)
      await page.screenshot({ path: `${out}/320-normal-light-mouse-more-sheet.png` })
      for (const label of ['Прибор', 'Отчёт', 'Настройки', 'Справка']) await tools.getByRole('button', { name: new RegExp(label) }).waitFor()
      assert.match(await tools.textContent(), /Для дневника: Я/)
      await tools.getByRole('button', { name: /^Настройки/ }).click()
      await page.waitForFunction(() => document.querySelector('.app')?.getAttribute('data-nav') === 'overview/settings')
      results.checks.push('320/normal: daily tabs stay visible; More explicitly exposes device, report, settings, and help with person context')
    }

    if (width === 1280 && scale === 'xlarge' && theme === 'dark' && input === 'mouse') {
      // A desktop browser at 200% zoom has roughly half the CSS viewport width.
      // Playwright cannot change browser-chrome zoom reliably, so exercise that
      // effective layout width directly and label it as a viewport proxy.
      await page.setViewportSize({ width: 640, height: 450 })
      const zoomProxy = await page.evaluate(() => ({
        viewport: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        targets: [...document.querySelectorAll('nav.tabs button')].filter(button => button.getClientRects().length).map(button => button.getBoundingClientRect().height),
      }))
      assert.equal(zoomProxy.viewport, 640)
      assert.ok(zoomProxy.documentWidth <= 640, `200% zoom viewport proxy overflows horizontally: ${JSON.stringify(zoomProxy)}`)
      assert.ok(zoomProxy.targets.every(height => height >= 48), `200% zoom viewport proxy has a small navigation target: ${JSON.stringify(zoomProxy)}`)

      const tabs = page.locator('nav.tabs button').filter({ visible: true })
      if (await tabs.count() > 1) {
        await tabs.first().focus()
        await page.keyboard.press('Tab')
        assert.equal(await tabs.nth(1).evaluate(button => document.activeElement === button), true, 'Keyboard Tab advances through primary navigation at the zoom proxy width')
      }
      const more = page.locator('header .modern-tools__trigger')
      await more.focus(); await page.keyboard.press('Enter')
      const tools = page.locator('#modern-tools-sheet')
      await waitForSheet(tools)
      for (const label of ['Прибор', 'Отчёт', 'Настройки', 'Справка']) await tools.getByRole('button', { name: new RegExp(label) }).waitFor()
      await page.keyboard.press('Escape'); await tools.waitFor({ state: 'hidden' })
      assert.equal(await more.evaluate(button => document.activeElement === button), true, 'Keyboard Escape closes More and restores focus at the zoom proxy width')
      results.checks.push('640px effective CSS viewport proxy for 200% desktop zoom: no overflow, touch-sized nav, keyboard navigation and modal focus return')
    }

    await context.close()
  }

  if (!onlyControl && !onlyZoom) {
    const profile = { width: 390, height: 844, theme: 'dark', scale: 'xlarge', input: 'touch' }
    const { page, context } = await fresh(profile)
    await patchSettings(page, { trackGlucose: false, sections: { overview: true, bp: true, glucose: false, intake: true, cabinet: true } })
    await page.reload({ waitUntil: 'domcontentloaded' }); await settle(page); await page.waitForTimeout(100)
    const geometry = await page.locator('nav.tabs').evaluate(nav => ({
      condensed: nav.getAttribute('data-sections-menu') === 'true',
      navWidth: nav.clientWidth,
      navPadding: getComputedStyle(nav).padding,
      navGap: getComputedStyle(nav).columnGap || getComputedStyle(nav).gap,
      buttons: [...nav.querySelectorAll('.tab')].filter(button => button.getClientRects().length).map(button => ({
        label: button.getAttribute('aria-label'),
        width: button.getBoundingClientRect().width,
        textWidth: (() => {
          const label = button.querySelector('.tab__short')
          const style = getComputedStyle(label)
          const canvas = document.createElement('canvas')
          const context = canvas.getContext('2d')
          context.font = style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily
          return context.measureText(label.textContent).width
        })(),
      })),
    }))
    assert.equal(geometry.buttons.length, 4, '390px/xlarge configuration has four visible tabs when Sugar is off: ' + JSON.stringify(geometry))
    assert.equal(geometry.condensed, false, 'four large-text tabs fit in their ~88px cells at 390px: ' + JSON.stringify(geometry))
    assert.ok(geometry.buttons.every(button => button.textWidth <= button.width), 'each stacked label fits its cell: ' + JSON.stringify(geometry))
    results.checks.push('390/xlarge/touch with Sugar off: four tabs remain visible when stacked labels fit their grid cells')
    await context.close()
  }

  assert.deepEqual(results.errors, [], 'the responsive matrix must not trigger browser errors')
  await writeFileSync(`${out}/matrix.json`, JSON.stringify(results, null, 2))
  console.log(JSON.stringify({ profiles: results.matrix.length, errors: results.errors, checks: results.checks, control: results.control }, null, 2))
} finally { await browser.close() }
