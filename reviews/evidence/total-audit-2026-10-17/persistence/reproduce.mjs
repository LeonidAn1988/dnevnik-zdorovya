import { build } from 'esbuild'
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
const source = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{installPlatform}from'./src/platform/ports';import{webPlatform}from'./src/platform/web';
import * as db from './src/db/store';import{mergeDiary}from'./src/logic/merge';
import{useFamilySync}from'./src/ui/useFamilySync';
window.db=db;window.merge=mergeDiary;window.events=[];
let hold=false;let token=null;
const storage={...webPlatform.storage,putTombstones:async rows=>{if(hold){hold=false;window.pending=true;await new Promise(resolve=>window.release=resolve)}return webPlatform.storage.putTombstones(rows)}};
const peer=JSON.stringify({format:'omron-bp/v7',measurements:[],medicines:[],regimens:[],labs:[{id:'peer-lab',name:'Peer synthetic lab',owner:'p1',results:[],updatedAt:2}],tombstones:[],settings:{people:[{id:'p1',name:'Synthetic'}]}});
const cloud={token:()=>token,setToken:value=>{token=value||null},canDownload:()=>true,list:async()=>[{name:'дневник-peer-abc123.json',modified:2,size:500}],download:async()=>peer,upload:async(name,content)=>window.upload=JSON.parse(content),remove:async()=>{}};
installPlatform({...webPlatform,storage,cloud,backup:{...webPlatform.backup,canReadSources:()=>false}});
const initial={...db.DEFAULT_SETTINGS,people:[{id:'p1',name:'Synthetic'}],activePerson:'p1',onboarded:true};
function Harness(){const[settings,setSettings]=useState(initial);const family=useFamilySync({ready:true,settings,onSettings:setSettings,onChanged:async p=>{window.events.push('changed');if(p)setSettings(s=>({...s,people:p}))}});window.sync=()=>{hold=true;return family.cloud.connect('A'.repeat(24))};window.busy=family.busy;return <output>{String(family.busy)}</output>}
void db.saveSettings(initial).then(()=>createRoot(document.getElementById('root')).render(<Harness/>));`
const bundle=(await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',logLevel:'error'})).outputFiles[0].text
const browser=await chromium.launch(),context=await browser.newContext({hasTouch:true}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div><script>'+bundle.replaceAll('</script','<\\/script')+'</script>'}));
try {
await page.goto('https://audit-persistence.invalid');await page.waitForFunction(()=>!!window.sync);
const result={};
result.silentDeletedSaves=await page.evaluate(async()=>{
 const lab={id:'deleted-lab',name:'Synthetic lab',owner:'p1',results:[]};
 await window.db.putLab(lab);await window.db.deleteLab(lab.id);await window.db.putLab({...lab,note:'unsaved user edit'});
 const reading={id:'deleted-reading',kind:'bp',ts:100,user:0,source:'manual',person:'p1',sys:120,dia:80,pulse:60};
 await window.db.putMeasurements([reading]);await window.db.deleteMeasurement(reading.id);await window.db.putMeasurements([{...reading,sys:150}]);
 return {labPromiseResolved:true,labPresent:(await window.db.getAllLabs()).some(x=>x.id===lab.id),measurementPromiseResolved:true,measurementPresent:(await window.db.getAllMeasurements()).some(x=>x.id===reading.id)};
});
assert.equal(result.silentDeletedSaves.labPresent,false);assert.equal(result.silentDeletedSaves.measurementPresent,false);
result.undo=await page.evaluate(async()=>{
 const reading={id:'undo-reading',kind:'bp',ts:100,user:0,source:'manual',person:'p1',sys:120,dia:80,pulse:60};
 await window.db.putMeasurements([reading]);await window.db.deleteMeasurement(reading.id);
 const peerGrave=(await window.db.getAllTombstones()).find(x=>x.id===reading.id);await window.db.restoreMeasurement(reading);
 const own={measurements:await window.db.getAllMeasurements(),medicines:[],regimens:[],labs:[],tombstones:await window.db.getAllTombstones(),people:[]};
 const peer={measurements:[],medicines:[],regimens:[],labs:[],tombstones:[peerGrave],people:[]};
 return {presentAfterUndo:own.measurements.some(x=>x.id===reading.id),presentAfterPeerMerge:window.merge(own,peer).measurements.some(x=>x.id===reading.id)};
});assert.equal(result.undo.presentAfterUndo,true);assert.equal(result.undo.presentAfterPeerMerge,false);
await page.evaluate(async()=>{await window.db.putMedicine({id:'local-med',name:'Before local edit',dose:'',left:10,expires:null});window.sync().then(value=>window.done=value)});
await page.waitForFunction(()=>window.pending);
const before=await page.evaluate(async()=>{await window.db.putMedicine({id:'local-med',name:'New local edit',dose:'',left:6,expires:null,leftAt:Date.now(),stockUpdatedAt:Date.now()});return(await window.db.getAllMedicines()).find(x=>x.id==='local-med')});
await page.evaluate(()=>window.release());await page.waitForFunction(()=>window.done!==undefined&&!window.busy);
const after=await page.evaluate(async()=>({local:(await window.db.getAllMedicines()).find(x=>x.id==='local-med'),uploaded:window.upload.medicines.find(x=>x.id==='local-med'),events:window.events}));
result.finalReadRace={before,after};assert.equal(before.left,6);assert.equal(after.local.left,10);assert.equal(after.uploaded.left,10);assert.deepEqual(errors,[]);
writeFileSync('reviews/evidence/total-audit-2026-10-17/persistence/reproduction.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close()}
