import assert from 'node:assert/strict'
import { chromium } from '/Users/leonidanchevskiy/Claude_Projects/omron/node_modules/playwright/index.mjs'
import { seed, FROZEN, settleAny, settle, go } from '/Users/leonidanchevskiy/Claude_Projects/omron/tools/visual.mjs'
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, locale: 'ru-RU' })
const page = await context.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))
await page.clock.install({ time: new Date(FROZEN) })
await page.route('**/src/ble/session.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
export class PairingRequiredError extends Error {}
export const isBluetoothSupported = () => true;
export const isBluetoothEnabled = async () => true;
export const isCancellation = () => false;
const device = { id: 'synthetic-only', name: 'SYNTHETIC', disconnect() {} };
export const getKnownDevices = async () => [device];
export const pickDevice = async () => device;
export const inspectDevice = async () => {};
export const pairDevice = async () => {};
export const downloadRecords = async () => ({ records: [{ user:1, date:new Date(Date.now()-3*86400000), sys:120, dia:80, bpm:70, ihb:false, mov:false }] });
export const downloadGlucoseRecords = async () => ({records:[]});
export const pickGlucoseMeter = async () => device;
` }))
await page.goto('http://localhost:5199')
await settleAny(page)
await seed(page, FROZEN)
await page.evaluate(async () => {
  const db = await new Promise(r => { const q=indexedDB.open('omron-bp'); q.onsuccess=()=>r(q.result) })
  await new Promise(r => { const tx=db.transaction('readings','readwrite'); tx.objectStore('readings').clear(); tx.oncomplete=r })
  const s = await new Promise(r => { const q=db.transaction('meta').objectStore('meta').get('settings'); q.onsuccess=()=>r(q.result) })
  s.textScale='xlarge'
  await new Promise(r => { const tx=db.transaction('meta','readwrite'); tx.objectStore('meta').put(s,'settings'); tx.oncomplete=r })
  db.close()
})
await page.reload()
await settle(page)
await go(page,{tool:'Отчёт'})
assert.equal(await page.getByRole('button',{name:'Печать или сохранение в PDF'}).count(),1)
console.log(JSON.stringify({case:'meds/labs without measurements', text: await page.locator('.chart__empty').allTextContents(), printButtons: await page.getByRole('button',{name:'Печать или сохранение в PDF'}).count()}))
await page.screenshot({path:'reviews/evidence/fixes/report-without-measurements.png',fullPage:true})
await go(page,{tool:'Прибор'})
await page.getByRole('button',{name:/Выгрузить измерения|Подключить и выгрузить|Выгрузить/}).first().click()
await page.getByText('Сверьте дату последнего измерения',{exact:true}).waitFor({timeout:5000})
assert.equal(await page.getByText('Часы тонометра сбиты',{exact:true}).count(),0)
console.log(JSON.stringify({case:'correct measurement from three days ago', falseClockWarning:await page.getByText('Часы тонометра сбиты',{exact:true}).count(), warning:await page.locator('.banner').allTextContents()}))
await page.screenshot({path:'reviews/evidence/fixes/clock-neutral-copy.png',fullPage:true})
assert.deepEqual(errors,[])
console.log(JSON.stringify({errors}))
await browser.close()
