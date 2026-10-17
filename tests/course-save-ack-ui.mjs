/** A successful write must not become a false failure or a duplicate on retry. */
import { build } from 'esbuild'
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
const source = `
import React from 'react';import{createRoot}from'react-dom/client';import App from'./src/App';
import{installPlatform}from'./src/platform/ports';import{webPlatform}from'./src/platform/web';
import{DEFAULT_SETTINGS,saveSettings,putMedicine}from'./src/db/store';
window.committed=false;window.writes=0;window.failedReads=0;window.armed=false;window.rejectCourse=false;window.rejectMedicine=false;window.medicineCommitted=false;window.medicineWrites=0;
installPlatform({...webPlatform,storage:{...webPlatform.storage,
 putRegimen:async(...args)=>{window.writes++;if(window.rejectCourse)await webPlatform.storage.deleteRegimen(args[0].id);await webPlatform.storage.putRegimen(...args);window.committed=true},
 putMedicine:async(...args)=>{if(window.rejectMedicine)await webPlatform.storage.deleteMedicine(args[0].id);await webPlatform.storage.putMedicine(...args);if(window.armed){window.medicineWrites++;window.medicineCommitted=true}},
 allMedicines:async()=>{if(window.medicineCommitted){window.failedReads++;throw Error('Synthetic medicine read failure after commit')}return webPlatform.storage.allMedicines()},
 allRegimens:async()=>{if(window.committed){window.failedReads++;throw Error('Synthetic read failure after commit')}return webPlatform.storage.allRegimens()}
}});
void Promise.all([saveSettings({...DEFAULT_SETTINGS,onboarded:true,guideOffered:true,interfaceStyle:'rhythm',people:[{id:'p',name:'Тест'}],activePerson:'p'}),putMedicine({id:'m',name:'Тестовый препарат',dose:'5 мг',left:10,expires:null})]).then(()=>createRoot(document.getElementById('root')).render(<App/>));`
const bundle = (await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.md': 'text', '.webp': 'dataurl' }, logLevel: 'error' })).outputFiles[0].text
const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true }), errors = []
page.setDefaultTimeout(8000); page.on('pageerror', e => errors.push(String(e)))
try {
  await page.route('**/*', r => /\/(drugs|supplements)\.json$/.test(r.request().url()) ? r.fulfill({json:{date:'2026-10-16',forms:[],makers:[],items:[]}}) : r.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script>' + bundle.replaceAll('</script', '<\\/script') + '</script>' }))
  await page.goto('https://course-save.invalid')
  await page.getByRole('button', { name: 'Добавить приём', exact: true }).click()
  await page.locator('.course-medicine-results button').filter({ hasText: 'Тестовый препарат' }).click()
  await page.getByRole('button', { name: /Утром.*08:00/ }).click()
  await page.getByRole('button', { name: 'Проверить назначение', exact: true }).evaluate(button => { button.click(); button.click() })
  await page.getByRole('form', { name: 'Проверка курса' }).waitFor()
  assert.equal(await page.locator('.app').getAttribute('data-nav'), 'cabinet/regimen/courseReview')
  await page.getByRole('button', { name: 'Добавить в расписание', exact: true }).evaluate(button => { button.click(); button.click() })
  await page.locator('.course-saved').waitFor()
  await page.locator('li.dose').filter({ has: page.getByText('Тестовый препарат', { exact: true }) }).waitFor()
  const result = await page.evaluate(async () => {
    const db = await new Promise(resolve => { const q = indexedDB.open('omron-bp'); q.onsuccess = () => resolve(q.result) })
    const records = await new Promise(resolve => { const q = db.transaction('regimens').objectStore('regimens').getAll(); q.onsuccess = () => resolve(q.result) }); db.close()
    return { writes: window.writes, failedReads: window.failedReads, records: records.length, person: records[0]?.person }
  })
  assert.deepEqual(result, { writes: 1, failedReads: 0, records: 1, person: 'p' }); assert.deepEqual(errors, [])
  await page.evaluate(() => { window.armed = true })
  await page.getByRole('button', { name: 'Добавить приём', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить новый препарат', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Новый препарат для курса', exact: true })
  await dialog.getByRole('combobox', { name: 'Название или поиск препарата', exact: true }).fill('Синтетический препарат 93765')
  await dialog.getByRole('button', { name: 'Продолжить с этим названием вручную', exact: true }).click()
  await dialog.getByRole('button', { name: 'Добавить в аптечку', exact: true }).evaluate(button => { button.click(); button.click() })
  await dialog.waitFor({ state: 'hidden' })
  assert.match(await page.locator('.course-medicine-name').innerText(), /Синтетический препарат 93765/)
  assert.equal(await page.evaluate(() => window.medicineWrites), 1)
  assert.equal(await page.evaluate(() => window.failedReads), 0)
  result.medicineWrites = 1
  // A tombstone arriving after the form opens must not produce phantom success.
  await page.evaluate(() => { window.rejectCourse = true })
  await page.getByRole('button', { name: /Утром.*08:00/ }).click()
  await page.getByRole('button', { name: 'Проверить назначение', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить в расписание', exact: true }).click()
  await page.getByRole('form', { name: 'Проверка курса' }).getByRole('alert').filter({ hasText: 'удалён на другом устройстве' }).waitFor()
  assert.equal(await page.locator('.course-saved').count(), 0)
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  assert.equal(await page.locator('li.dose').filter({ hasText: 'Синтетический препарат 93765' }).count(), 0)
  await page.evaluate(() => { window.rejectMedicine = true; window.medicineCommitted = false; window.committed = false })
  await page.getByRole('button', { name: 'Добавить приём', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить новый препарат', exact: true }).click()
  const failedDialog = page.getByRole('dialog', { name: 'Новый препарат для курса', exact: true })
  await failedDialog.getByRole('combobox', { name: 'Название или поиск препарата', exact: true }).fill('Удалённый синтетический препарат 94765')
  await failedDialog.getByRole('button', { name: 'Продолжить с этим названием вручную', exact: true }).click()
  await failedDialog.getByRole('button', { name: 'Добавить в аптечку', exact: true }).click()
  await failedDialog.getByRole('alert').filter({ hasText: 'удалён на другом устройстве' }).waitFor()
  assert.equal(await failedDialog.count(), 1)
  result.deletedObjectSavesRejected = true
  writeFileSync('reviews/evidence/journey-recovery/course-save-ack.json', JSON.stringify({ ...result, errors, outcome: 'double activation creates one course; post-commit read is not required for truthful success' }, null, 2) + '\n')
  console.log('Course commit: one review node, one write, visible success without post-commit read passed')
} finally { await browser.close() }
