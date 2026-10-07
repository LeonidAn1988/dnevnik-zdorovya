/** Deletion through the actual App; disposable touch browser + local IndexedDB.
 * Run directly: node tests/person-delete-ui.mjs. No server, account or device.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { FROZEN, go, settle } from '../tools/visual.mjs'

const source = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './src/App';
import {DEFAULT_SETTINGS} from './src/db/store';
import {installPlatform} from './src/platform/ports';
import {webPlatform} from './src/platform/web';
import {personDeletionBlockers} from './src/ui/People';
window.testBlockers=personDeletionBlockers;
installPlatform({...webPlatform,storage:{...webPlatform.storage,
 allMeasurements:async()=>{
   if(window.rejectReads) throw new Error('Не удалось проверить записи. Повторите попытку.');
   return webPlatform.storage.allMeasurements();
 }
},reminders:{...webPlatform.reminders,isSupported:()=>false}});
(async()=>{
 const fixture=window.fixture;
 await webPlatform.storage.allMeasurements();
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('omron-bp');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
 await new Promise((resolve,reject)=>{
   const tx=db.transaction(['readings','regimens','medicines','labs','meta'],'readwrite');
   for(const store of ['readings','regimens','medicines','labs']) for(const item of fixture[store]||[]) tx.objectStore(store).put(item);
   tx.objectStore('meta').put({...DEFAULT_SETTINGS,onboarded:true,guideOffered:true,trackGlucose:true,
     people:[{id:'p1',name:'Анна',deviceUser:1},{id:'p2',name:'Борис',deviceUser:2}],activePerson:'p2',...fixture.settings},'settings');
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
 });
 db.close();
 createRoot(document.getElementById('root')).render(<App/>);
})();
`
const bundle = (await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true,
  write: false, format: 'iife', jsx: 'automatic', logLevel: 'error', loader: { '.md': 'text' } })).outputFiles[0].text
const html = `<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${readFileSync('src/app.css', 'utf8')}</style></head><body><div id="root"></div><script>${bundle.replaceAll('</script', '<\\/script')}</script></body></html>`
const lab = { id: 'l2', owner: 'p2', name: 'ТТГ', results: [{ id: 'result2', day: FROZEN, values: [2.1] }], updatedAt: FROZEN }
const bp = { id: 'b2', person: 'p2', user: 2, kind: 'bp', ts: FROZEN, sys: 120, dia: 80, bpm: 60, source: 'manual', ihb: false, mov: false }
const glucose = { id: 'g2', person: 'p2', user: 2, kind: 'glucose', ts: FROZEN, mmol: 5.2, context: 'fasting', source: 'manual' }
const regimen = { id: 'r2', medicineId: 'm2', person: 'p2', since: FROZEN - 86400000, stoppedAt: FROZEN - 1000,
  times: ['08:00'], perTime: 1, taken: [FROZEN - 3600000], updatedAt: FROZEN }
const medicine = { id: 'm2', name: 'Препарат', packSize: 30, left: 20, perDay: null, updatedAt: FROZEN }
let checks = 0
const passed = (name) => { checks += 1; console.log(`ok ${name}`) }
const errors = []
const browser = await chromium.launch()

async function setup(fixture = {}) {
  const context = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, locale: 'ru-RU' })
  await context.addInitScript((fixture) => { window.fixture = fixture }, fixture)
  const page = await context.newPage()
  page.setDefaultTimeout(6000)
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.route('**/*', (route) => route.request().url().startsWith('http://person-delete.invalid')
    ? route.fulfill({ contentType: 'text/html', body: html })
    : route.fulfill({ contentType: 'application/json', body: '[]' }))
  await page.clock.install({ time: new Date(FROZEN) })
  await page.goto('http://person-delete.invalid')
  await settle(page)
  await go(page, { tool: 'Настройки', open: ['Люди', fixture.openName ?? 'Борис'] })
  return { context, page }
}

const deletionBanner = (page) => page.locator('details').filter({ has: page.locator('summary', { hasText: 'Удалить человека' }) }).locator('.banner--critical')

async function requestDeletion(page) {
  await page.locator('summary', { hasText: 'Удалить человека' }).click()
  await page.getByRole('button', { name: 'Удалить человека', exact: true }).click()
}

async function db(page, write = null) {
  return page.evaluate(async (write) => {
    const database = await new Promise((resolve, reject) => { const r = indexedDB.open('omron-bp'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    if (write) await new Promise((resolve, reject) => {
      const tx = database.transaction(write.store, 'readwrite')
      tx.objectStore(write.store).put(write.item)
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error)
    })
    const read = (store, key) => new Promise((resolve, reject) => {
      const req = key ? database.transaction(store).objectStore(store).get(key) : database.transaction(store).objectStore(store).getAll()
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error)
    })
    const result = { settings: await read('meta', 'settings'), readings: await read('readings'), labs: await read('labs'), regimens: await read('regimens') }
    database.close(); return result
  }, write)
}

try {
  for (const scale of ['normal', 'xlarge']) {
    const { page, context } = await setup({ labs: [lab], settings: { textScale: scale } })
    await requestDeletion(page)
    assert.match(await deletionBanner(page).innerText(), /Нельзя удалить: Борис/)
    assert.match(await deletionBanner(page).innerText(), /Анализы и их снимки: 1/)
    assert.equal(await page.getByRole('button', { name: 'Удалить', exact: true }).count(), 0)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    await page.screenshot({ path: `/tmp/omron-person-delete-${scale}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Вернуться', exact: true }).click()
    const saved = await db(page)
    assert.equal(saved.settings.people.length, 2)
    assert.equal(saved.labs[0].owner, 'p2')
    passed(`lab-only deletion blocked; owner and profile preserved; touch ${scale}`)
    await context.close()
  }

  for (const [name, fixture, expected] of [
    ['manual BP and glucose', { readings: [bp, glucose] }, ['Измерения давления: 1', 'Измерения сахара: 1']],
    ['legacy device readings', { readings: [{ ...bp, person: undefined }, { ...glucose, person: undefined }] }, ['Измерения давления: 1', 'Измерения сахара: 1']],
    ['completed course and intake history', { regimens: [regimen], medicines: [medicine] }, ['Курсы приёма и их история: 1']],
  ]) {
    const { page, context } = await setup(fixture)
    await requestDeletion(page)
    const text = await deletionBanner(page).innerText()
    for (const label of expected) assert.ok(text.includes(label), `${name}: ${label}`)
    assert.equal(await page.getByRole('button', { name: 'Удалить', exact: true }).count(), 0)
    const saved = await db(page)
    assert.equal(saved.settings.people.length, 2)
    assert.ok(saved.readings.every((r) => !r.person || r.person === 'p2'))
    assert.ok(saved.regimens.every((r) => r.person === 'p2'))
    passed(`${name}: deletion blocked, no reassignment`)
    await context.close()
  }

  // The rendered form is empty, then a record arrives without a React refresh.
  // This exercises the real handler independently of the visible UI guard.
  for (const [store, item, label] of [
    ['labs', lab, 'Анализы и их снимки: 1'],
    ['readings', bp, 'Измерения давления: 1'],
    ['readings', glucose, 'Измерения сахара: 1'],
    ['regimens', regimen, 'Курсы приёма и их история: 1'],
  ]) {
    const { page, context } = await setup()
    await requestDeletion(page)
    await db(page, { store, item })
    await page.getByRole('button', { name: 'Удалить', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Человек не удалён.' }).waitFor()
    assert.ok((await page.getByRole('alert').filter({ hasText: 'Человек не удалён.' }).innerText()).includes(label))
    assert.ok(!(await deletionBanner(page).innerText()).includes('нет связанных записей'))
    const saved = await db(page)
    assert.equal(saved.settings.people.length, 2)
    assert.equal(saved.settings.activePerson, 'p2')
    assert.equal(saved[store].find((r) => r.id === item.id)[store === 'labs' ? 'owner' : 'person'], 'p2')
    passed(`fresh handler guard: ${store}/${item.kind ?? 'record'} arrived after confirmation opened`)
    await context.close()
  }

  {
    const { page, context } = await setup()
    await requestDeletion(page)
    await page.evaluate(() => { window.rejectReads = true })
    await page.getByRole('button', { name: 'Удалить', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Не удалось проверить записи' }).waitFor()
    assert.equal((await db(page)).settings.people.length, 2)
    assert.equal(await page.getByRole('button', { name: 'Удалить', exact: true }).isEnabled(), true)
    passed('database read failure preserves person and permits retry')
    await context.close()
  }

  {
    const { page, context } = await setup({ settings: { reminderPeople: ['p1', 'p2'], people: [{ id: 'p1', name: 'Анна', deviceUser: 1 }, { id: 'p2', name: 'Борис' }] } })
    await page.locator('summary', { hasText: 'Память тонометра' }).click()
    assert.ok(await page.getByText('С прибора записи не загружаются. Давление можно записывать вручную.').isVisible())
    const coverage = await page.evaluate(() => {
      const p = { id: 'p2', name: 'Борис', deviceUser: 2, measurePlan: { times: ['08:00'], days: null, from: 0 } }
      const settings = { mergedPeople: { old: 'p2' }, mealTimers: [{ person: 'p2', cancelledAt: 1 }], glucoseTimers: [{ person: 'old' }], notificationHistory: [{ person: 'p2' }, { kind: 'stock' }] }
      const blockers = window.testBlockers(p, [{ kind: 'bp', person: 'p1', user: 2 }, { kind: 'glucose', person: 'old', user: 1 }], [{ person: 'old', stoppedAt: 1 }], [{ owner: 'old' }], settings)
      return Object.fromEntries(blockers.map(({ label, count }) => [label, count]))
    })
    assert.deepEqual(coverage, {
      'Измерения сахара': 1, 'Курсы приёма и их история': 1, 'Анализы и их снимки': 1,
      'Расписание измерений давления': 1, 'Таймеры еды и приёма': 1, 'Таймеры измерения сахара': 1, 'Записи в истории уведомлений': 1,
    })
    passed('blocker coverage includes redirects, intake history, personal plan and timers; explicit owner wins over device slot')
    await requestDeletion(page)
    assert.match(await deletionBanner(page).innerText(), /Удалить профиль «Борис»\?/)
    await page.getByRole('button', { name: 'Удалить', exact: true }).click()
    await page.getByRole('heading', { name: 'Люди', exact: true }).waitFor()
    const saved = await db(page)
    assert.deepEqual(saved.settings.people.map((p) => p.id), ['p1'])
    assert.equal(saved.settings.activePerson, 'p1')
    assert.deepEqual(saved.settings.reminderPeople, ['p1'])
    passed('empty profile deleted by handler; active profile and reminder selection updated; manual BP wording correct')
    await context.close()
  }

  {
    const { page, context } = await setup({ openName: 'Борис', settings: { people: [{ id: 'p1', name: 'Борис', deviceUser: 1 }, { id: 'p2', name: 'Борис', deviceUser: 2 }] } })
    await requestDeletion(page)
    assert.match(await deletionBanner(page).innerText(), /Удалить профиль «Борис \(кнопка [12]\)»\?/)
    passed('namesake confirmation identifies device slot')
    await context.close()
  }

  {
    const { page, context } = await setup({ settings: { people: [{ id: 'p2', name: 'Борис' }] } })
    assert.equal(await page.locator('summary', { hasText: 'Удалить человека' }).count(), 0)
    passed('last person cannot be deleted')
    await context.close()
  }
  assert.deepEqual(errors, [])
  console.log(`${checks}/${checks} person deletion checks passed`)
} finally {
  await browser.close()
}
