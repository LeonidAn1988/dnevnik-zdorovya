import {build} from 'esbuild'
import {chromium} from 'playwright'
import {writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
const source=`import React from 'react';import{createRoot}from'react-dom/client';import App from './src/App';import{installPlatform}from'./src/platform/ports';import{webPlatform}from'./src/platform/web';import * as db from './src/db/store';
let held=false;window.db=db;installPlatform(webPlatform);window.start=async()=>{const settings={...db.DEFAULT_SETTINGS,onboarded:true,people:[{id:'p1',name:'First'},{id:'p2',name:'Second'}],activePerson:'p1'};await db.saveSettings(settings);await db.putMedicine({id:'med',name:'Test',dose:'',left:50,leftAt:Date.now()-86400000,expires:null,unit:'табл.'});for(const person of ['p1','p2'])await db.putRegimen({id:'course-'+person,medicineId:'med',person,since:Date.now()-86400000,times:['07:00','08:00','09:00'],perTime:1,autoSpend:false});installPlatform({...webPlatform,reminders:{...webPlatform.reminders,isSupported:()=>true,onAction:handler=>{window.action=handler;return()=>{}}},storage:{...webPlatform.storage,loadSettings:async()=>{if(!held){held=true;await new Promise(r=>window.release=r)}return webPlatform.storage.loadSettings()}}});createRoot(document.getElementById('root')).render(<App/>)};`;
const js=(await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.md':'text','.webp':'dataurl'},logLevel:'error'})).outputFiles[0].text
const browser=await chromium.launch(),results=[]
try{for(const day of ['2026-03-29','2026-10-25'])for(const mode of ['cold','warm']){
 const ctx=await browser.newContext({timezoneId:'Europe/Berlin',hasTouch:true}),page=await ctx.newPage()
 await page.clock.install({time:new Date(day+'T10:00:00Z')});await page.route('https://dst.invalid/**',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('https://dst.invalid');await page.addScriptTag({content:js});await page.evaluate(()=>window.start());await page.waitForFunction(()=>window.release&&window.action)
 if(mode==='warm'){await page.evaluate(()=>window.release());await page.locator('nav.tabs').waitFor()}
 await page.evaluate(day=>window.action({kind:'taken',day:new Date(day+'T00:00:00').getTime(),slot:'08:00',person:'p2'}),day)
 if(mode==='cold')await page.evaluate(()=>window.release())
 await page.waitForTimeout(700)
 const actual=await page.evaluate(async()=>Object.fromEntries((await window.db.getAllRegimens()).map(r=>[r.person,(r.taken??[]).map(t=>new Date(t).getHours()+':'+String(new Date(t).getMinutes()).padStart(2,'0'))])))

 assert.deepEqual(actual,{p1:[],p2:['8:00']});results.push({day,mode,actual});await ctx.close()
}writeFileSync('reviews/evidence/reliability/reminder-dst.json',JSON.stringify(results,null,2));console.log('PASS 4 cold/warm DST taken actions, correct person and slot')}
finally{await browser.close()}
