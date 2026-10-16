/** The real App must keep the identity dialog alive during a failed commit. */
import { build } from 'esbuild'
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
const source = `
import React from 'react';import{createRoot}from'react-dom/client';import App from'./src/App';
import{installPlatform}from'./src/platform/ports';import{webPlatform}from'./src/platform/web';
import{DEFAULT_SETTINGS,saveSettings,loadSettings}from'./src/db/store';
window.failMerge=true;window.mergeCalls=0;
installPlatform({...webPlatform,storage:{...webPlatform.storage,mergePeopleData:async data=>{
 window.mergeCalls++;if(window.failMerge){await new Promise((resolve,reject)=>{window.rejectMerge=()=>reject(Error('Synthetic storage failure'));window.mergePending=true})}
 return webPlatform.storage.mergePeopleData(data)
}}});
window.readSettings=loadSettings;
void saveSettings({...DEFAULT_SETTINGS,onboarded:true,guideOffered:true,interfaceStyle:'rhythm',people:[{id:'local',name:'Я'},{id:'winner',name:'Мама'}],activePerson:'local'}).then(()=>createRoot(document.getElementById('root')).render(<App/>));`
const bundle = (await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.md': 'text' }, logLevel: 'error' })).outputFiles[0].text
const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true }), errors = []
page.on('pageerror', error => errors.push(String(error))); page.setDefaultTimeout(8000)
try {
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script>' + bundle.replaceAll('</script', '<\\/script') + '</script>' }))
  await page.goto('https://family-identity.invalid')
  const dialog = page.getByRole('dialog', { name: 'Этот телефон чей' })
  await dialog.getByRole('button', { name: /^Мама/ }).click()
  await page.waitForFunction(() => window.mergePending)
  assert.equal(await dialog.isVisible(), true, 'Busy operation must not unmount the dialog')
  await dialog.getByRole('status').filter({ hasText: 'Объединяю' }).waitFor()
  await page.evaluate(() => window.rejectMerge())
  await dialog.getByRole('alert').filter({ hasText: 'Не удалось сохранить объединение' }).waitFor()
  assert.equal((await page.evaluate(() => window.readSettings())).people.length, 2)
  await page.evaluate(() => { window.failMerge = false })
  await dialog.getByRole('button', { name: 'Повторить объединение', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  const saved = await page.evaluate(() => window.readSettings())
  assert.deepEqual(saved.people.map(p => p.id), ['winner']); assert.equal(saved.activePerson, 'winner')
  assert.equal(await page.evaluate(() => window.mergeCalls), 2); assert.deepEqual(errors, [])
  writeFileSync('reviews/evidence/journey-recovery/family-identity-ui.json', JSON.stringify({ checks: ['dialog survives pending commit', 'storage error remains visible', 'failed merge keeps identity', 'retry persists winner and closes dialog'], errors }, null, 2) + '\n')
  console.log('Family identity: pending -> visible error -> retry -> persisted success passed')
} finally { await browser.close() }
