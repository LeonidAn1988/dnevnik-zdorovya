/** Physical touch and Android bridge checks, synthetic .review package only. */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { connect, patchSettings, capture, geometry, goPhone, adb, OUT, PACKAGE } from './device_review.mjs'
import { seed } from './visual.mjs'

const { browser, page } = await connect()
const checks = [], errors = []
const save = () => writeFileSync(`${OUT}settings.json`, JSON.stringify({ at: new Date().toISOString(), package: PACKAGE, checks, errors }, null, 2) + '\n')
const check = (name, data = {}) => { checks.push({ name, ...data }); save(); console.log(`ok ${name}`) }
page.on('pageerror', e => errors.push(String(e)))
let inset = 0, ratio = 1
const bridge = (await build({ stdin: { contents: "import {LocalNotifications} from '@capacitor/local-notifications';window.reviewNative=LocalNotifications;", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', logLevel: 'error' })).outputFiles[0].text
async function tap(locator) {
  await locator.evaluate(el => el.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(200)
  const box = await locator.boundingBox(); assert.ok(box)
  adb('shell', 'input', 'tap', String(Math.round((box.x + box.width / 2) * ratio)), String(Math.round(inset + (box.y + box.height / 2) * ratio)))
  await page.waitForTimeout(500)
}
async function back() { adb('shell', 'input', 'keyevent', '4'); await page.waitForTimeout(500) }
async function open(title) { await goPhone(page, { tool: 'Настройки' }); await tap(page.locator('.pill__open', { hasText: title })) }
async function snapshot(name) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, name)
  const metrics = await geometry(page)
  await capture(page, name, true)
  check(`${name}: native screenshot, no horizontal overflow`, metrics)
}
async function pending() { return page.evaluate(async () => (await window.reviewNative.getPending()).notifications.map(n => ({ id: n.id, kind: n.extra?.kind }))) }
async function clearPreview() {
  await page.evaluate(async () => {
    const api = window.reviewNative
    const pending = (await api.getPending()).notifications.filter(n => n.id >= 40000001)
    if (pending.length) await api.cancel({ notifications: pending.map(n => ({ id: n.id })) })
    const delivered = (await api.getDeliveredNotifications()).notifications.filter(n => n.id >= 40000001)
    if (delivered.length) await api.removeDeliveredNotifications({ notifications: delivered })
  })
}
try {
  const meta = await geometry(page)
  ratio = meta.dpr
  // Read only the synthetic review app's native WebView bounds.
  adb('shell', 'uiautomator', 'dump', '/data/local/tmp/omron-review-bounds.xml')
  const xml = adb('exec-out', 'cat', '/data/local/tmp/omron-review-bounds.xml').toString()
  adb('shell', 'rm', '/data/local/tmp/omron-review-bounds.xml')
  inset = await page.evaluate(xml => {
    const doc = new DOMParser().parseFromString(xml, 'text/xml')
    const node = [...doc.querySelectorAll('node')].find(n => n.getAttribute('class') === 'android.webkit.WebView')
    return node ? Number(node.getAttribute('bounds').match(/\d+/g)[1]) : 0
  }, xml)
  check('native environment and touch mapping', { ua: await page.evaluate(() => navigator.userAgent), dpr: ratio, inset, width: meta.width, height: meta.height, touch: meta.touch, coarse: meta.coarse })

  for (const scale of process.argv.includes('--notifications-only') ? [] : ['normal', 'xlarge']) for (const theme of ['light', 'dark']) {
    const prefix = `${scale}-${theme}`
    await seed(page, Date.now())
    await patchSettings(page, { textScale: scale, theme, guideOffered: true, remindersOn: false, measureRemindOn: false,
      people: [{ id: 'p1', name: 'Ревью 1', deviceUser: 1 }, { id: 'p2', name: 'Ревью 2', deviceUser: 2 }], activePerson: 'p1' })
    await goPhone(page, { tool: 'Настройки' })
    await snapshot(`${prefix}-root`)
    const rows = await page.locator('.settings__root .pill__open').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height))
    assert.ok(rows.every(h => h >= 44))
    await tap(page.locator('.pill__open', { hasText: 'Как пользоваться' }))
    await page.getByRole('heading', { name: 'Как пользоваться', exact: true }).waitFor()
    await back()
    assert.equal(await page.locator('.settings__group').count(), 3)
    check(`${prefix}: physical tap opens settings help, native Back returns, root targets >=44px`)

    await open('Текст и оформление')
    await snapshot(`${prefix}-display`)
    await back()
    assert.equal(await page.locator('.settings__group').count(), 3)
    await open('Люди')
    await tap(page.locator('.pill__open', { hasText: 'Ревью 1' }))
    await snapshot(`${prefix}-person`)
    await tap(page.locator('summary', { hasText: 'Часы для новых курсов' }))
    await page.getByRole('button', { name: 'Добавить время', exact: true }).waitFor()
    await snapshot(`${prefix}-person-times`)
    await tap(page.locator('summary', { hasText: 'Удалить человека' }))
    await page.getByRole('button', { name: 'Удалить человека', exact: true }).waitFor({ state: 'visible' })
    assert.equal(await page.getByRole('button', { name: 'Удалить', exact: true }).count(), 0)
    await back(); await back()

    await open('Цели давления и сахара')
    await tap(page.getByRole('button', { name: 'Чей дневник: Ревью 1', exact: true }))
    await snapshot(`${prefix}-person-sheet`)
    await back()
    assert.equal(await page.locator('dialog[open]').count(), 0)
    check(`${prefix}: native Back closes person sheet`)
    await open('Копии и восстановление')
    await snapshot(`${prefix}-backup`)
    await tap(page.locator('summary', { hasText: 'Удалить все измерения' }))
    await tap(page.getByRole('button', { name: 'Удалить все измерения', exact: true }))
    await tap(page.getByRole('button', { name: 'Отмена', exact: true }))
    const count = await page.evaluate(async () => {
      const db = await new Promise(resolve => { const r = indexedDB.open('omron-bp'); r.onsuccess = () => resolve(r.result) })
      const count = await new Promise(resolve => { const r = db.transaction('readings').objectStore('readings').count(); r.onsuccess = () => resolve(r.result) })
      db.close(); return count
    })
    assert.equal(count, 45)
    check(`${prefix}: physical Cancel keeps all45 synthetic measurements`)
    await open('Семейный обмен'); await snapshot(`${prefix}-family`)
    await tap(page.locator('summary', { hasText: 'Другое облако: обмен файлами' }))
    await snapshot(`${prefix}-family-alternative`)
    await open('Версия и обновления'); await snapshot(`${prefix}-version`)
    await tap(page.locator('summary', { hasText: 'Что нового в версии' }))
    await snapshot(`${prefix}-version-expanded`)
  }

  // Native keyboard must leave the target field and bottom controls reachable.
  if (!process.argv.includes('--notifications-only')) {
  await patchSettings(page, { textScale: 'xlarge', theme: 'light' })
  await open('Цели давления и сахара')
  await tap(page.getByRole('textbox', { name: 'Верхнее', exact: true }))
  await page.waitForTimeout(400)
  const keyboard = await geometry(page)
  await capture(page, 'xlarge-keyboard-targets', false)
  assert.ok(keyboard.active?.includes('numfield__input'))
  await back()
  await page.getByRole('heading', { name: 'Целевое давление', exact: true }).waitFor()
  check('native keyboard Back keeps targets screen', keyboard)
  }

  // Real Android notification bridge, only the isolated package.
  const plan = { times: ['08:00', '20:00'], days: null, from: Date.now() }
  await patchSettings(page, { textScale: 'normal', theme: 'light', remindersOn: false, measureRemindOn: true,
    people: [{ id: 'p1', name: 'Ревью 1', deviceUser: 1 }, { id: 'p2', name: 'Ревью 2', deviceUser: 2, measurePlan: plan }], activePerson: 'p1' })
  await page.addScriptTag({ content: bridge })
  await open('Напоминания')
  await page.getByRole('button', { name: 'Проверить громкость', exact: true }).waitFor()
  await page.getByText(/^Ревью 2: /).waitFor()
  assert.equal(await page.getByText('Нет расписания измерений', { exact: true }).evaluate(el => !!el.closest('[inert]')), true)
  const scheduled = await pending()
  assert.ok(scheduled.some(n => n.kind === 'measure'))
  check('native measurement-only settings and family scheduler agree', { scheduled: scheduled.length, measure: scheduled.filter(n => n.kind === 'measure').length })
  for (const scale of ['normal', 'xlarge']) for (const theme of ['light', 'dark']) {
    if (scale !== 'normal' || theme !== 'light') {
      await patchSettings(page, { textScale: scale, theme })
      await page.addScriptTag({ content: bridge })
      await open('Напоминания')
      await page.getByRole('button', { name: 'Проверить громкость', exact: true }).waitFor()
    }
    const prefix = `${scale}-${theme}`
    await snapshot(`${prefix}-measurement-only`)
    await tap(page.locator('summary', { hasText: 'Звук:' }))
    await snapshot(`${prefix}-sounds`)
    await page.getByRole('button', { name: 'Проверить громкость', exact: true }).evaluate(el => el.scrollIntoView({ block: 'center' }))
    await snapshot(`${prefix}-volume-controls`)
    const quietAction = page.getByRole('button', { name: 'Разрешить звучать в тихом режиме', exact: true })
    if (await quietAction.count()) {
      await quietAction.evaluate(el => el.scrollIntoView({ block: 'center' }))
      await snapshot(`${prefix}-quiet-warning`)
    }
  }
  await clearPreview()
  await tap(page.getByRole('button', { name: 'Проверить громкость', exact: true }))
  await page.getByRole('button', { name: 'Остановить звук', exact: true }).waitFor()
  assert.ok((await pending()).some(n => n.id >= 40000001))
  await tap(page.getByRole('button', { name: 'Остановить звук', exact: true }))
  assert.equal((await pending()).filter(n => n.id >= 40000001).length, 0)
  check('real Android volume preview scheduled and stopped')
  await tap(page.getByRole('button', { name: 'Проверить громкость', exact: true }))
  await page.getByRole('button', { name: 'Остановить звук', exact: true }).waitFor()
  await back()
  assert.equal((await pending()).filter(n => n.id >= 40000001).length, 0)
  check('native Back cancels actual preview notifications')
  await clearPreview()
  assert.deepEqual(errors, [])
  save()
} catch (error) {
  checks.push({ name: 'interrupted', error: String(error), nav: await page.locator('.app').getAttribute('data-nav') })
  save(); throw error
} finally {
  try {
    await page.addScriptTag({ content: bridge })
    const remaining = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open('omron-bp'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error)
      })
      const settings = await new Promise((resolve, reject) => {
        const r = db.transaction('meta').objectStore('meta').get('settings'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error)
      })
      await new Promise((resolve, reject) => {
        const tx = db.transaction('meta', 'readwrite')
        tx.objectStore('meta').put({ ...settings, remindersOn: false, measureRemindOn: false }, 'settings')
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error)
      })
      db.close()
      const api = window.reviewNative
      const pending = (await api.getPending()).notifications
      if (pending.length) await api.cancel({ notifications: pending.map(n => ({ id: n.id })) })
      const delivered = (await api.getDeliveredNotifications()).notifications
      if (delivered.length) await api.removeDeliveredNotifications({ notifications: delivered })
      return { pending: (await api.getPending()).notifications.length, delivered: (await api.getDeliveredNotifications()).notifications.length }
    })
    assert.deepEqual(remaining, { pending: 0, delivered: 0 })
    check('isolated notifications cleaned and future schedules disabled', remaining)
  } catch (error) {
    checks.push({ name: 'cleanup failed', error: String(error) }); save(); throw error
  } finally {
    await browser.close()
    adb('shell', 'am', 'force-stop', PACKAGE)
  }
}
