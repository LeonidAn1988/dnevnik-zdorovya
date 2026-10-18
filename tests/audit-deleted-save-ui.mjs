import {build} from 'esbuild'
import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {goConceptRoute} from '../tools/visual.mjs'
const source=`import React from'react';import{createRoot}from'react-dom/client';import App from'./src/App';import{installPlatform}from'./src/platform/ports';import{webPlatform}from'./src/platform/web';import * as db from'./src/db/store';
installPlatform({...webPlatform,storage:{...webPlatform.storage,putMeasurements:async(...args)=>{if(window.rejectSave)await webPlatform.storage.deleteMeasurement(args[0][0].id);return webPlatform.storage.putMeasurements(...args)},putLab:async(...args)=>{if(window.rejectSave)await webPlatform.storage.deleteLab(args[0].id);return webPlatform.storage.putLab(...args)}}});window.db=db;
void(async()=>{await db.saveSettings({...db.DEFAULT_SETTINGS,onboarded:true,guideOffered:true,identityConfirmed:true,interfaceStyle:'journal',trackGlucose:true,people:[{id:'p',name:'Тест'}],activePerson:'p'});await db.putMeasurements([{id:'b',kind:'bp',person:'p',ts:Date.now(),sys:120,dia:80,bpm:70,user:0,source:'manual'},{id:'g',kind:'glucose',person:'p',ts:Date.now(),mmol:5.5,context:'fasting',user:0,source:'manual'}]);await db.putLab({id:'l',name:'Тестовый анализ',owner:'p',results:[]});createRoot(document.getElementById('root')).render(<App/>);})();`
const bundle=(await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.md':'text','.webp':'dataurl'},logLevel:'error'})).outputFiles[0].text
const browser=await chromium.launch(),checks=[],failures=[]
try{for(const kind of ['bp','glucose','labs']){const page=await browser.newPage({hasTouch:true,viewport:{width:390,height:844}}),errors=[];page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(String(e)));try{
 await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('https://deleted-save.invalid');await page.addScriptTag({content:bundle});await page.locator('nav.tabs').waitFor();await goConceptRoute(page,kind)
 if(kind==='labs'){await page.getByRole('button',{name:'Изменить',exact:true}).click();await page.getByLabel('Что сдаём',{exact:true}).fill('Правка анализа')}
 else{await page.getByRole('button',{name:kind==='bp'?/^Изменить измерение от/:/^Изменить замер от/}).click();await page.locator('.editrow').getByLabel('Примечание',{exact:true}).fill('Сохранить мой черновик')}
 await page.evaluate(()=>window.rejectSave=true);await page.getByRole('button',{name:'Сохранить',exact:true}).click()
 if(kind==='labs'){await page.getByText(/Не удалось сохранить.*Анализ уже удалён/).waitFor();assert.equal(await page.getByLabel('Что сдаём',{exact:true}).inputValue(),'Правка анализа');assert.equal((await page.evaluate(()=>window.db.getAllLabs())).length,0)}
 else{await page.locator('.editrow').getByRole('alert').filter({hasText:/Измерение уже удалено/}).waitFor();assert.equal(await page.locator('.editrow').getByLabel('Примечание',{exact:true}).inputValue(),'Сохранить мой черновик');assert.equal((await page.evaluate(()=>window.db.getAllMeasurements())).some(x=>x.kind===kind),false)}
 assert.deepEqual(errors,[]);checks.push(kind);console.log('ok',kind,'deleted save rejected, draft retained')
 }catch(e){failures.push({kind,error:String(e),errors,body:(await page.locator('body').innerText()).slice(-2500)});console.log('FAIL',kind,String(e))}finally{await page.close()}}
}finally{await browser.close();writeFileSync('reviews/evidence/total-audit-fixes/deleted-save.json',JSON.stringify({checks,failures},null,2));process.exitCode=failures.length?1:0}
