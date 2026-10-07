/** Real App in disposable touch contexts. No phone, cloud account or real data. */
import { chromium } from 'playwright'
import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { seed, settleAny, settle, FROZEN, go } from '../tools/visual.mjs'
const out = 'reviews/evidence/ux-modes/checks'
mkdirSync(out, {recursive:true})
const source = `import React from 'react';import {createRoot} from 'react-dom/client';
import App from './src/App';import {installPlatform} from './src/platform/ports';import {webPlatform} from './src/platform/web';
window.permission='prompt';window.answer='denied';window.requests=0;window.failWrite=false;
installPlatform({...webPlatform,storage:{...webPlatform.storage,putMeasurements:async(...args)=>{if(window.failWrite)throw new Error('Synthetic storage failure');return webPlatform.storage.putMeasurements(...args)}},
reminders:{...webPlatform.reminders,isSupported:()=>true,permission:async()=>window.permission,requestPermission:async()=>{window.requests++;window.permission=window.answer;return window.answer},schedule:async()=>{},exactTiming:async()=>true,health:async()=>({scheduled:10,until:Date.now()+7*86400000,channelOff:false})}});
createRoot(document.getElementById('root')).render(<App/>);`
const js = (await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',logLevel:'error',loader:{'.md':'text'}})).outputFiles[0].text
const html=`<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${readFileSync('src/app.css','utf8')}</style></head><body><div id="root"></div><script>${js.replaceAll('</script','<\\/script')}</script></body></html>`
const checks=[],errors=[],geometry=[]
async function data(page, patch) {
 return page.evaluate(async patch=>{
  const db=await new Promise((r,j)=>{const q=indexedDB.open('omron-bp');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)})
  const read=(store,key)=>new Promise(r=>{const st=db.transaction(store).objectStore(store);const q=key?st.get(key):st.getAll();q.onsuccess=()=>r(q.result)})
  const settings=await read('meta','settings')
  if(patch) await new Promise(r=>{const tx=db.transaction('meta','readwrite');tx.objectStore('meta').put({...settings,...patch},'settings');tx.oncomplete=r})
  const result={settings:await read('meta','settings'),measurements:await read('readings'),regimens:await read('regimens'),medicines:await read('medicines'),labs:await read('labs')};db.close();return result
 },patch)
}
const browser=await chromium.launch()
async function fresh(width=360) {
 const context=await browser.newContext({viewport:{width,height:800},hasTouch:true,locale:'ru-RU'})
 const page=await context.newPage();page.setDefaultTimeout(6000)
 page.on('pageerror',e=>errors.push(String(e)))
 await page.route('https://ux-modes.invalid/**',r=>r.fulfill({contentType:'text/html',body:html}))
 await page.route('https://api.github.com/**',r=>r.fulfill({contentType:'application/json',body:'[]'}))
 await page.clock.install({time:new Date(FROZEN)})
 await page.goto('https://ux-modes.invalid');await settleAny(page)
 return {page,context}
}
async function fillValue(page,label,value) {
 const input=page.getByRole('textbox',{name:new RegExp('^'+label)})
 if(await input.count()) return input.fill(value)
 try { await page.locator('.wheel').filter({has:page.getByRole('spinbutton',{name:label,exact:true})}).locator('.wheel__item').filter({hasText:new RegExp('^'+value.replace('.',',')+'$')}).click() }
 catch(e) { console.log('fill failure',label,await page.locator('.app').getAttribute('data-nav'),await page.locator('[role=spinbutton]').evaluateAll(xs=>xs.map(x=>x.outerHTML.slice(0,220))),await page.locator('input').evaluateAll(xs=>xs.map(x=>x.outerHTML.slice(0,220))),errors);throw e }
}
async function readValue(page,label) {
 const input=page.getByRole('textbox',{name:new RegExp('^'+label)})
 return await input.count()?input.inputValue():((await page.getByRole('spinbutton',{name:label,exact:true}).getAttribute('aria-valuenow'))??'')
}
async function photo(page,name) {
 const m=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}))
 assert.ok(m.scrollWidth<=m.width+1,`${name}: horizontal overflow ${JSON.stringify(m)}`)
 geometry.push({name,...m});await page.screenshot({path:`${out}/${name}.png`,fullPage:true})
 await page.screenshot({path:`${out}/${name}-viewport.png`})
}
try {
 const {page,context}=await fresh()
 await page.getByRole('checkbox',{name:/Давление записи/}).uncheck()
 await page.getByRole('checkbox',{name:/Лекарства расписание/}).uncheck()
 await page.getByRole('checkbox',{name:/Сахар крови/}).check()
 await page.getByRole('button',{name:'Дальше',exact:true}).click()
 assert.equal(await page.getByRole('button',{name:/Комфортный/}).getAttribute('aria-pressed'),'true')
 assert.deepEqual(await page.evaluate(()=>[document.documentElement.dataset.text,document.documentElement.dataset.density]),['large','roomy'])
 await photo(page,'onboarding-comfortable')
 await page.getByRole('button',{name:/Компактный/}).click()
 await page.getByRole('button',{name:'Готово',exact:true}).click();await settle(page)
 assert.equal(await page.locator('.app').getAttribute('data-nav'),'glucose')
 const first=await data(page);assert.equal(first.settings.textScale,'normal');assert.equal(first.settings.density,'compact')
 assert.equal(await page.locator('.chips button[aria-pressed="true"]').count(),0,'Meal context must not be guessed')
 checks.push('New diary: comfortable default; compact chosen; glucose-only opens glucose; no guessed context')
 await context.close()

 const active=await fresh();const p=active.page
 await seed(p,FROZEN);await data(p,{guideOffered:true,textScale:'normal',density:'normal'});await p.reload();await settle(p)
 const baseline=await data(p)
 // Retain an in-progress blood pressure entry while changing presentation.
 await go(p,{tab:'Давление'});await fillValue(p,'Верхнее','128')
 await go(p,{tool:'Настройки',open:'Текст и оформление'})
 assert.equal(await p.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Текст и оформление')
 for(const name of ['Комфортный','Компактный']) {
  await p.getByRole('button',{name:new RegExp(`^${name}`)}).click()
  await photo(p,`display-${name==='Комфортный'?'comfortable':'compact'}`)
  const saved=await data(p)
  for(const key of ['measurements','regimens','medicines','labs']) assert.deepEqual(saved[key],baseline[key],`${key} unaffected by presentation`)
  for(const key of ['people','activePerson','sections','startTab','reminderPeople']) assert.deepEqual(saved.settings[key],baseline.settings[key],`${key} unaffected by presentation`)
 }
 await p.getByRole('button',{name:'Очень крупный',exact:true}).click()
 assert.equal(await p.locator('.display-presets__choice[aria-pressed="true"]').count(),0)
 await p.reload();await settle(p)
 const manual=await data(p);assert.equal(manual.settings.textScale,'xlarge');assert.equal(manual.settings.density,'compact')
 await go(p,{tab:'Давление'});assert.equal(await readValue(p,'Верхнее'),'','Drafts intentionally end with page reload')
 await fillValue(p,'Верхнее','128')
 await go(p,{tool:'Настройки',open:'Текст и оформление'});await p.getByRole('button',{name:/^Комфортный/}).click()
 await go(p,{tab:'Давление'});assert.equal(await readValue(p,'Верхнее'),'128')
 checks.push('Presets preserve records, people, sections, reminder audience and in-session input; manual settings survive reload; settings focus announced')

 // Denied permission never turns the setting on; retry granting it succeeds.
 await go(p,{tab:'Приём'})
 await p.getByRole('button',{name:'Включить напоминания',exact:true}).click()
 await p.getByRole('alert').filter({hasText:'Уведомления не разрешены'}).waitFor()
 assert.equal((await data(p)).settings.remindersOn,false)
 await p.evaluate(()=>window.answer='granted')
 await p.getByRole('button',{name:'Включить напоминания',exact:true}).click()
 await p.getByRole('button',{name:'Включить напоминания',exact:true}).waitFor({state:'hidden'})
 assert.equal((await data(p)).settings.remindersOn,true);assert.equal(await p.evaluate(()=>window.requests),2)
 checks.push('Intake nudge: permission denied leaves reminders off; grant enables them')

 // A failed save must keep the form and explain the failure at the action.
 await go(p,{tab:'Давление'});await fillValue(p,'Нижнее','82')
 await p.evaluate(()=>window.failWrite=true)
 await p.getByRole('button',{name:'Добавить',exact:true}).click()
 assert.match(await p.locator('form [role="alert"]').innerText(),/Не удалось сохранить/)
 assert.equal(await readValue(p,'Верхнее'),'128')
 assert.equal((await data(p)).measurements.length,baseline.measurements.length)
 await photo(p,'bp-storage-error')
 await go(p,{tab:'Сахар'});await fillValue(p,'Сахар','6.2')
 await p.getByRole('button',{name:'Добавить',exact:true}).click()
 assert.match(await p.locator('form [role="alert"]').innerText(),/Выберите момент/)
 await p.getByRole('button',{name:'Ночью',exact:true}).click()
 await p.getByRole('button',{name:'Добавить',exact:true}).click()
 assert.match(await p.locator('form [role="alert"]').innerText(),/Не удалось сохранить/)
 assert.equal(await readValue(p,'Сахар'),'6.2')
 await p.evaluate(()=>window.failWrite=false)
 await p.getByRole('button',{name:'Добавить',exact:true}).click()
 await p.getByText('Записано: 6,2 ммоль/л',{exact:true}).waitFor()
 const newReadings=(await data(p)).measurements.filter(r=>!baseline.measurements.some(b=>b.id===r.id))
 assert.equal(newReadings.length,1);assert.equal(newReadings[0].context,'night');assert.equal(newReadings[0].mmol,6.2)
 assert.equal(await p.locator('.chips button[aria-pressed="true"]').count(),0)
 checks.push('BP/glucose: failed writes preserve input; glucose requires explicit meal context and resets after save')

 await go(p,{tab:'Обзор'})
 assert.equal(await p.locator('.overview-charts[open]').count(),0)
 await p.getByText('Графики давления и пульса',{exact:true}).click()
 assert.equal(await p.getByRole('heading',{name:'Динамика давления',exact:true}).isVisible(),true)
 await photo(p,'overview-expanded')
 await active.context.close()
 assert.deepEqual(errors,[])
 console.log(checks.join('\n'));writeFileSync(`${out}/result.json`,JSON.stringify({checks,geometry,errors},null,2))
} finally {await browser.close()}
