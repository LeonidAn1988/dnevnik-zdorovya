/**
 * The optional modern presentation is exercised against the real application.
 * Disposable local profiles only: no phone, real health data or cloud account.
 * Run with the Vite server on 5199: node tests/modern-interface-ui.mjs
 */
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { FROZEN, SCREENS, seed, settleAny, settle, go } from '../tools/visual.mjs'

const base = process.env.URL ?? 'http://127.0.0.1:5199'
const out = 'reviews/evidence/modern-interface'
mkdirSync(out, { recursive: true })
const results = { functional: [], profiles: [], errors: [], failures: [] }
const browser = await chromium.launch()

async function data(page, patch) {
  return page.evaluate(async fields => {
    const db = await new Promise((resolve, reject) => {
      const q = indexedDB.open('omron-bp'); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error)
    })
    const read = (store, key) => new Promise((resolve, reject) => {
      const st = db.transaction(store).objectStore(store), q = key ? st.get(key) : st.getAll()
      q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error)
    })
    if (fields) {
      const settings = await read('meta', 'settings')
      await new Promise((resolve, reject) => {
        const tx = db.transaction('meta', 'readwrite')
        tx.objectStore('meta').put({ ...settings, ...fields }, 'settings')
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error)
      })
    }
    const value = { settings: await read('meta', 'settings') }
    for (const store of ['readings', 'regimens', 'medicines', 'labs']) value[store] = await read(store)
    db.close(); return value
  }, patch)
}

async function fresh(profile = { width: 360, scale: 'normal', theme: 'light', touch: true }, patch = {}) {
  const context = await browser.newContext({
    viewport: { width: profile.width, height: 800 }, hasTouch: profile.touch,
    locale: 'ru-RU', timezoneId: 'Europe/Moscow', colorScheme: profile.theme,
  })
  const page = await context.newPage()
  page.setDefaultTimeout(6000)
  page.on('pageerror', error => results.errors.push({ profile, message: error.message }))
  page.on('console', msg => { if (msg.type() === 'error') results.errors.push({ profile, console: msg.text() }) })
  await page.route('https://api.github.com/**', route => route.fulfill({ contentType: 'application/json', body: '[]' }))
  await page.clock.install({ time: new Date(FROZEN) })
  await page.goto(base, { waitUntil: 'domcontentloaded' }); await settleAny(page)
  await seed(page, FROZEN)
  await data(page, { interfaceStyle: 'modern', theme: profile.theme, textScale: profile.scale, density: 'normal', guideOffered: true, ...patch })
  await page.reload(); await settle(page)
  return { page, context }
}

async function isModern(page, expected = true) {
  await page.waitForFunction(value => (document.documentElement.dataset.interface === 'modern') === value, expected)
}

async function unchanged(page, baseline) {
  const next = await data(page)
  for (const store of ['readings', 'regimens', 'medicines', 'labs']) assert.deepEqual(next[store], baseline[store], `${store} changed by presentation`)
  for (const key of ['people', 'activePerson', 'sections', 'startTab', 'reminderPeople', 'remindersOn', 'mealTimers', 'glucoseTimers']) {
    assert.deepEqual(next.settings[key], baseline.settings[key], `${key} changed by presentation`)
  }
}

async function fillValue(page, label, value) {
  const input = page.getByRole('textbox', { name: new RegExp('^' + label) })
  if (await input.count()) return input.fill(value)
  const wheel = page.locator('.wheel').filter({ has: page.getByRole('spinbutton', { name: label, exact: true }) })
  await wheel.locator('.wheel__item').filter({ hasText: new RegExp('^' + value.replace('.', ',') + '$') }).tap()
  await page.waitForTimeout(400)
  assert.equal(await page.getByRole('spinbutton', { name: label, exact: true }).getAttribute('aria-valuenow'), value, `${label}: tapped value must remain selected after wheel settles`)
}

async function capture(page, name) {
  await page.evaluate(() => scrollTo(0, 0))
  const before = await page.evaluate(() => ({ coarse: matchMedia('(pointer: coarse)').matches, touch: navigator.maxTouchPoints }))
  await page.screenshot({ path: `${out}/${name}-viewport.png` })
  // Full-document capture (including raw CDP captureBeyondViewport) resets
  // touch emulation in this Chromium/Playwright runtime. Viewport screenshots
  // are sufficient for this review and preserve the actual phone controls.
  const after = await page.evaluate(() => ({ coarse: matchMedia('(pointer: coarse)').matches, touch: navigator.maxTouchPoints }))
  assert.deepEqual(after, before, `${name}: screenshot must preserve input-device emulation`)
}

async function inspectGeometry(page, label) {
  return page.evaluate(name => {
    const visible = element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden'
    const nav = document.querySelector('nav.tabs'), navRect = nav?.getBoundingClientRect()
    const dock = nav && getComputedStyle(nav).position === 'fixed'
    const buttons = [...(nav?.querySelectorAll('button') ?? [])].filter(visible).map(element => {
      const r = element.getBoundingClientRect()
      return { name: element.getAttribute('aria-label'), width: r.width, height: r.height, left: r.left, right: r.right }
    })
    return {
      name, viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      coarse: matchMedia('(pointer: coarse)').matches, touchPoints: navigator.maxTouchPoints,
      dock, navTop: navRect?.top, navBottom: navRect?.bottom, buttons,
    }
  }, label)
}

async function saveAboveDock(page, label) {
  const save = page.locator('.form-actions .btn').first()
  if (!await save.count() || !await save.isVisible()) return null
  await save.scrollIntoViewIfNeeded()
  const positions = await page.evaluate(() => {
    const save = document.querySelector('.form-actions .btn'), nav = document.querySelector('nav.tabs')
    return { save: save.getBoundingClientRect().bottom, dock: nav.getBoundingClientRect().top, fixed: getComputedStyle(nav).position === 'fixed' }
  })
  assert.ok(!positions.fixed || positions.save <= positions.dock + 1, `${label}: save covered by dock: ${JSON.stringify(positions)}`)
  return positions
}

// Check actual rendered foreground/background pairs, including translucent
// selection fills. Canvas resolves both RGB and newer CSS color syntaxes.
async function contrast(page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const rgba = color => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255]
    }
    const blend = (fg, bg) => [0, 1, 2].map(i => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1)
    const background = element => {
      const chain = []; for (let e = element; e; e = e.parentElement) chain.unshift(e)
      return chain.reduce((color, e) => blend(rgba(getComputedStyle(e).backgroundColor), color), [255, 255, 255, 1])
    }
    const luminance = color => color.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0)
    const samples = [...document.querySelectorAll('h1, .modern-overview-intro h2, .modern-overview-intro p, .modern-quick-actions button, nav.tabs .tab__short, nav.tabs .tab__full, .tools button span:not(.tab__mark), .personbar button, .tile__label, .tile__note, .display-presets__title, .display-presets__hint')]
    return samples.filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && e.textContent.trim()).map(e => {
      const style = getComputedStyle(e), bg = background(e), fg = blend(rgba(style.color), bg)
      const light = luminance(fg), dark = luminance(bg), ratio = (Math.max(light, dark) + .05) / (Math.min(light, dark) + .05)
      const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && parseInt(style.fontWeight) >= 700)
      return { text: e.textContent.trim().slice(0, 80), ratio, minimum: large ? 3 : 4.5, color: style.color, background: bg }
    })
  })
}

async function functional() {
  const { page, context } = await fresh(undefined, { interfaceStyle: 'classic' })
  try {
    const baseline = await data(page)
    const todayRows = () => page.locator('.today-card .today__row').evaluateAll(rows => rows.map(row => ({
      time: row.querySelector('.today__time')?.textContent,
      name: row.querySelector('.today__name')?.textContent,
      state: row.querySelector('.today__mark')?.getAttribute('aria-label'),
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))
    const originalToday = await todayRows()
    await go(page, { tool: 'Настройки', open: 'Текст и оформление' })
    await page.getByRole('button', { name: /^Современный/ }).click(); await isModern(page)
    await page.waitForTimeout(150); await unchanged(page, baseline)
    await page.reload(); await settle(page); await isModern(page)
    assert.equal((await data(page)).settings.interfaceStyle, 'modern')
    assert.deepEqual(await todayRows(), originalToday, 'Condensed today must preserve every course/time row exactly once')
    for (const title of [/Уже отмечено/, /Без ручной отметки/]) {
      const disclosure = page.locator('.today-card details').filter({ has: page.locator('summary').filter({ hasText: title }) })
      assert.equal(await disclosure.count(), 1)
      await disclosure.locator('summary').click()
      assert.ok(await disclosure.locator('.today__row').first().isVisible())
    }
    results.functional.push('Condensed today keeps each scheduled dose exactly once; completed/automatic groups can be expanded')
    await go(page, { tool: 'Настройки', open: 'Текст и оформление' })
    await page.getByRole('button', { name: 'Очень крупный', exact: true }).click(); await isModern(page)
    await page.reload(); await settle(page); await isModern(page)
    assert.equal((await data(page)).settings.textScale, 'xlarge')
    for (const mode of ['Компактный', 'Комфортный']) {
      await go(page, { tool: 'Настройки', open: 'Текст и оформление' })
      await page.getByRole('button', { name: new RegExp('^' + mode) }).click(); await isModern(page, false)
      await page.waitForTimeout(150); await unchanged(page, baseline)
    }
    results.functional.push('Modern selection survives reload; manual xlarge keeps modern; both classic presets restore classic; medical records and reminders unchanged')

    await go(page, { tool: 'Отчёт' })
    const category = page.locator('.report-category').first()
    assert.equal(await category.evaluate(e => getComputedStyle(e).whiteSpace), 'normal', 'Report category wraps on screen')
    await page.emulateMedia({ media: 'print' })
    assert.equal(await category.evaluate(e => getComputedStyle(e).whiteSpace), 'nowrap', 'Print keeps its prior category layout')
    await page.emulateMedia({ media: 'screen' })
    results.functional.push('Long report category wraps on screen; print retains its existing no-wrap behavior')

    await data(page, {
      interfaceStyle: 'modern', textScale: 'normal', density: 'normal',
      people: [{ id: 'p1', name: 'Леонид', deviceUser: 1 }, { id: 'p2', name: 'София', deviceUser: 2 }], activePerson: 'p2',
    })
    await page.reload(); await settle(page); await go(page, { tab: 'Обзор' })
    await page.locator('.modern-quick-actions').getByRole('button', { name: /давление/i }).click()
    assert.equal(await page.locator('.app').getAttribute('data-nav'), 'bp')
    await fillValue(page, 'Верхнее', '123'); await fillValue(page, 'Нижнее', '81')
    await page.getByRole('button', { name: 'Добавить', exact: true }).click()
    await page.getByText(/Записано: 123\/81/).waitFor()
    await go(page, { tab: 'Обзор' })
    await page.locator('.modern-quick-actions').getByRole('button', { name: /сахар/i }).click()
    assert.equal(await page.locator('.app').getAttribute('data-nav'), 'glucose')
    await fillValue(page, 'Сахар', '5.4'); await page.getByRole('button', { name: 'Натощак', exact: true }).click()
    await page.getByRole('button', { name: 'Добавить', exact: true }).click()
    await page.getByText('Записано: 5,4 ммоль/л', { exact: true }).waitFor()
    const changed = await data(page), added = changed.readings.filter(r => !baseline.readings.some(b => b.id === r.id))
    assert.equal(added.length, 2); assert.ok(added.every(r => r.person === 'p2' && r.user === 2), JSON.stringify(added))
    results.functional.push('Quick pressure/glucose actions save to the selected family member, including device-user binding')

    await data(page, { sections: { ...changed.settings.sections, bp: false, glucose: false }, trackGlucose: false })
    await page.reload(); await settle(page); await go(page, { tab: 'Обзор' })
    assert.equal(await page.locator('.modern-quick-actions').getByRole('button', { name: /давление|сахар/i }).count(), 0)
    assert.equal(await page.locator('nav.tabs').getByRole('button', { name: /Давление|Сахар/ }).count(), 0)
    results.functional.push('Hidden pressure/glucose sections also remove their quick actions')
  } catch (error) {
    await capture(page, 'functional-failure').catch(() => {})
    const state = await page.evaluate(() => ({
      nav: document.querySelector('.app')?.getAttribute('data-nav'),
      alerts: [...document.querySelectorAll('[role="alert"]')].filter(e => e.getClientRects().length && !e.closest('[aria-hidden="true"], [inert]')).map(e => e.textContent),
      fields: [...document.querySelectorAll('[role="spinbutton"], input')].map(e => ({ label: e.getAttribute('aria-label'), value: e.getAttribute('aria-valuenow') ?? e.value })),
      coarse: matchMedia('(pointer: coarse)').matches,
      status: [...document.querySelectorAll('[role="status"]')].map(e => e.textContent),
    }))
    console.error('Functional state:', JSON.stringify(state))
    const failedData = await data(page)
    console.error('Last records:', JSON.stringify(failedData.readings.filter(r => r.person === 'p2')))
    throw error
  } finally { await context.close() }
}

const profiles = []
for (const width of [320, 360]) for (const scale of ['normal', 'xlarge']) for (const theme of ['light', 'dark']) profiles.push({ width, scale, theme, touch: true })
for (const theme of ['light', 'dark']) profiles.push({ width: 1280, scale: 'normal', theme, touch: false })
const responsiveGaps = [{ width: 740, scale: 'normal', theme: 'light', touch: false }, { width: 1024, scale: 'normal', theme: 'dark', touch: true }]
profiles.push(...responsiveGaps)
const selectedProfiles = process.argv.includes('--recheck-layout')
  ? [...profiles.filter(profile => profile.width === 320 && profile.scale === 'xlarge'), ...responsiveGaps]
  : process.argv.includes('--responsive-gaps-only') ? responsiveGaps
    : process.argv.includes('--touch-only') ? profiles.filter(profile => profile.touch) : profiles

async function profileSweep(profile) {
  const name = `${profile.width}-${profile.scale}-${profile.theme}-${profile.touch ? 'touch' : 'mouse'}`
  const result = { ...profile, name, screens: [], contrast: [] }
  results.profiles.push(result)
  const { page, context } = await fresh(profile)
  try {
    await isModern(page)
    for (const screen of SCREENS) {
      try {
        await go(page, screen)
        const geometry = await inspectGeometry(page, screen.name)
        assert.equal(geometry.coarse, profile.touch, `${name}/${screen.name}: wrong pointer emulation`)
        assert.equal(geometry.touchPoints > 0, profile.touch, `${name}/${screen.name}: wrong touch emulation`)
        assert.ok(geometry.scrollWidth <= geometry.viewport + 1, `${name}/${screen.name}: horizontal overflow ${geometry.scrollWidth}/${geometry.viewport}`)
        for (const b of geometry.buttons) {
          assert.ok(b.height >= 47.5 && b.width >= 43.5, `${name}/${screen.name}: small nav hit target ${JSON.stringify(b)}`)
          assert.ok(b.left >= -1 && b.right <= geometry.viewport + 1, `${name}/${screen.name}: clipped nav target ${JSON.stringify(b)}`)
        }
        const save = await saveAboveDock(page, `${name}/${screen.name}`)
        result.screens.push({ ...geometry, save })
        if (['Обзор', 'Давление', 'Приём', 'Настройки', 'Настройки — экран'].includes(screen.name)) {
          const checks = await contrast(page)
          result.contrast.push({ screen: screen.name, checks })
          assert.ok(checks.length > 0, `${name}/${screen.name}: no contrast samples`)
          assert.deepEqual(checks.filter(c => c.ratio + .02 < c.minimum), [], `${name}/${screen.name}: insufficient text contrast`)
          const slug = { 'Обзор': 'overview', 'Давление': 'entry', 'Приём': 'intake', 'Настройки': 'settings', 'Настройки — экран': 'display' }[screen.name]
          await capture(page, `${name}-${slug}`)
        }
      } catch (error) {
        results.failures.push({ profile: name, screen: screen.name, error: error.message })
        if (/emulation/.test(error.message)) throw error
        await capture(page, `${name}-failure-${result.screens.length}`).catch(() => {})
      }
    }
    console.log(`${name}: ${result.screens.length}/${SCREENS.length} screens`)
  } finally { await context.close() }
}

try {
  if (!process.argv.includes('--screens-only') && !process.argv.includes('--responsive-gaps-only')) await functional()
  // Two independent browser contexts at a time keep the full matrix bounded
  // without mixing storage, focus, theme or selected family member.
  if (!process.argv.includes('--functional-only')) {
    for (let i = 0; i < selectedProfiles.length; i += 2) await Promise.all(selectedProfiles.slice(i, i + 2).map(profileSweep))
  }
  assert.deepEqual(results.failures, [], 'Modern screen failures')
  assert.deepEqual(results.errors, [], 'Application or console errors')
  console.log(`Modern interface: ${results.functional.length} functional scenarios; ${results.profiles.reduce((count, profile) => count + profile.screens.length, 0)} screen states passed`)
} catch (error) {
  results.failures.push({ fatal: error.message }); console.error(error); process.exitCode = 1
} finally {
  const filename = process.argv.includes('--recheck-layout') ? 'result-recheck'
    : process.argv.includes('--responsive-gaps-only') ? 'result-responsive'
      : process.argv.includes('--touch-only') ? 'result-touch' : 'result'
  writeFileSync(`${out}/${filename}.json`, JSON.stringify(results, null, 2))
  await browser.close()
}
