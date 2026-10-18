import { build } from 'esbuild'
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const source=`import React from 'react';import{createRoot}from'react-dom/client';import App from './src/App';import{installPlatform}from'./src/platform/ports';import{webPlatform}from'./src/platform/web';import * as db from './src/db/store';
installPlatform(webPlatform);window.db=db;
void(async()=>{await db.saveSettings({...db.DEFAULT_SETTINGS,onboarded:true,people:[{id:'p1',name:'Synthetic'}],activePerson:'p1'});await db.putLab({id:'lab-with-photo',name:'Synthetic lab',owner:'p1',results:[]});await db.putLabPhoto({id:'photo1',labId:'lab-with-photo',day:1,blob:new Blob(['synthetic'],{type:'image/png'}),width:1,height:1,bytes:9});createRoot(document.getElementById('root')).render(<App/>);})();`;
const bundle=(await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,loader:{'.md':'text','.webp':'dataurl'},format:'iife',jsx:'automatic',logLevel:'error',plugins:[{name:'observe',setup(b){b.onLoad({filter:/\/src\/App.tsx$/},({path})=>({contents:readFileSync(path,'utf8').replace('  if (showOnboarding) {','  window.__audit = { ready, restore: handleRestore };\n  if (showOnboarding) {'),loader:'tsx'}))}}]})).outputFiles[0].text;
const browser=await chromium.launch(),ctx=await browser.newContext({hasTouch:true}),page=await ctx.newPage();try{
await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('https://audit-restore.invalid');await page.addScriptTag({content:bundle});await page.waitForFunction(()=>window.__audit?.ready);
const result=await page.evaluate(async()=>{
 const snapshot=async()=>({readings:await window.db.getAllMeasurements(),medicines:await window.db.getAllMedicines(),labs:await window.db.getAllLabs(),photos:await window.db.getLabPhotos('lab-with-photo'),settings:await window.db.loadSettings(),graves:await window.db.getAllTombstones()});
 const before=await snapshot(), original=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(...args){if(this.name==='labs') throw new DOMException('Injected disk full','QuotaExceededError');return original.apply(this,args)};
 let error;try{await window.__audit.restore({measurements:[{id:'imported-reading',kind:'bp',person:'p1',ts:1,sys:120,dia:80,bpm:70,user:0,source:'manual'}],medicines:[{id:'imported-med',name:'Import',dose:'',left:10,expires:null}],regimens:[],labs:[{id:'fail-lab',name:'Fail',owner:'p1',results:[]}],settings:null,skipped:0,tombstones:[]})}catch(e){error=String(e)}finally{IDBObjectStore.prototype.put=original}
 return {before,after:await snapshot(),error};
});writeFileSync('reviews/evidence/reliability/restore-rollback.json',JSON.stringify(result,null,2));assert.match(result.error,/Injected disk full/);assert.deepEqual(result.after,result.before,'Failed restore must leave all data unchanged');console.log('PASS App restore rollback');
}finally{await browser.close()}
