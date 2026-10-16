/** Real hook + real IndexedDB; deferred fake cloud only. No real family key. */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
const source = `
import React,{StrictMode,useState} from 'react';import{createRoot}from'react-dom/client';
import{installPlatform}from'./src/platform/ports';import{webPlatform}from'./src/platform/web';
import{DEFAULT_SETTINGS,saveSettings,getAllMedicines,getAllTombstones,getAllLabs,getInstallId,putMedicine}from'./src/db/store';
import{useFamilySync,describeMerge}from'./src/ui/useFamilySync';import{emptyMergeLog}from'./src/logic/merge';import{installSuffix}from'./src/logic/yandex';
const fixture=window.fixture;let token=null,held=false;
window.calls=[];window.uploads=[];window.removals=[];window.completedUploads=[];
const peer=key=>'дневник-peer-'+(key==='A'?'aaa111':'bbb222')+'.json';
const diary=key=>JSON.stringify({format:'omron-bp/v7',measurements:[],medicines:[{id:'remote-'+key,name:'Synthetic '+key,dose:'',left:3,expires:null}],regimens:[],labs:[],tombstones:[],settings:{people:[{id:'person-'+key,name:'Synthetic '+key}]}});
const cloud={token:()=>token,setToken:value=>{token=value||null},canDownload:()=>true,
 list:async()=>{const key=token?.[0];window.calls.push(['list',key]);window.listCounts??={};window.listCounts[key]=(window.listCounts[key]||0)+1;if(key==='A'&&fixture==='switch-list'&&window.listCounts[key]===2){await new Promise(resolve=>{window.releasePending=resolve;window.pending='list'})}if(key==='B'&&fixture==='invalid-reconnect')throw Error('Synthetic B validation failure');const suffix=installSuffix(await getInstallId());return [{name:'дневник-Old'+key+'-'+suffix+'.json',modified:1,size:100},{name:peer(key),modified:2,size:100}]},
 download:async name=>{const key=token?.[0];window.calls.push(['download',key,name]);if(key==='A'&&!held&&['switch-download','disconnect-download','late-error','invalid-reconnect','pending-download'].includes(fixture)){held=true;await new Promise((resolve,reject)=>{window.releasePending=()=>fixture==='late-error'?reject(Error('Synthetic late A error')):resolve();window.pending='download'})}return diary(key)},
 upload:async(name,text)=>{const key=token?.[0];if(!key)throw Error('Synthetic disconnected');window.uploads.push({key,name,diary:JSON.parse(text)});if(key==='A'&&!held&&['switch-upload','pending-upload','same-token-upload','return-token-upload','late-upload-error'].includes(fixture)){held=true;await new Promise((resolve,reject)=>{window.releasePending=()=>fixture==='late-upload-error'?reject(Error('Synthetic late upload error')):resolve();window.pending='upload'})}window.completedUploads.push({key,name,diary:JSON.parse(text)})},
 remove:async name=>{window.removals.push({key:token?.[0],name})}};
const backup={...webPlatform.backup,canReadSources:()=>fixture.startsWith('sources'),sources:async()=>{window.sourceCalls=(window.sourceCalls||0)+1;if(window.sourceFailure)throw Error('Synthetic source failure');if(window.holdSources)await new Promise(resolve=>{window.releaseSource=resolve;window.pending='sources'});return[]}};
installPlatform({...webPlatform,kind:'native',cloud,backup});
window.addLocal=(id='local-new')=>putMedicine({id,name:'Synthetic new local medicine',dose:'',left:9,expires:null});
const initial={...DEFAULT_SETTINGS,people:[{id:'local-person',name:'Synthetic local'}],activePerson:'local-person',onboarded:true};
function Harness(){const[settings,setSettings]=useState(initial);const family=useFamilySync({ready:!fixture.startsWith('sources'),settings,onSettings:setSettings,onChanged:async people=>{if(people)setSettings(s=>({...s,people}))}});window.actions={connect:family.cloud.connect,disconnect:family.cloud.disconnect,sync:family.syncNow};window.state={busy:family.busy,connected:family.cloud.connected,error:family.cloud.error,lastAt:family.lastAt,people:settings.people,log:family.lastLog,unreadable:family.unreadable};return <output>{JSON.stringify(window.state)}</output>}
window.readDiary=async()=>({medicines:await getAllMedicines(),tombstones:await getAllTombstones(),labs:await getAllLabs()});
window.summary=fields=>describeMerge({...emptyMergeLog(),...fields});
void saveSettings(initial).then(()=>createRoot(document.getElementById('root')).render(<StrictMode><Harness/></StrictMode>));`
const bundle=(await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',logLevel:'error'})).outputFiles[0].text
const browser=await chromium.launch(),checks=[],failures=[]
const scenarios=['switch-list','switch-download','disconnect-download','late-error','invalid-reconnect','switch-upload','pending-download','pending-upload','same-token-upload','return-token-upload','late-upload-error']
try{for(const scenario of scenarios){
 const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true}),page=await ctx.newPage(),errors=[]
 page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(String(e)))
 await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div><script>window.fixture='+JSON.stringify(scenario)+'</script><script>'+bundle.replaceAll('</script','<\\/script')+'</script>'}))
 try{
  await page.goto('https://sync-session.invalid');await page.waitForFunction(()=>!!window.actions)
  await page.evaluate(()=>{window.actions.connect('A'.repeat(24)).then(result=>window.doneA=result)})
  // Mock keys are reduced to A/B, while connect still receives valid tokens.
  // The adapter records only synthetic values, never production credentials.
  await page.waitForFunction(()=>!!window.pending)
  if(['same-token-upload','return-token-upload'].includes(scenario))await page.evaluate(()=>window.addLocal())
  if(scenario==='disconnect-download')await page.evaluate(()=>window.actions.disconnect())
  else if(scenario==='same-token-upload')await page.evaluate(()=>{window.actions.connect('A'.repeat(24)).then(result=>window.doneB=result)})
  else await page.evaluate(()=>{window.actions.connect('B'.repeat(24)).then(result=>window.doneB=result)})
  if(!['disconnect-download','same-token-upload'].includes(scenario))await page.waitForFunction(()=>window.calls.some(c=>c[0]==='list'&&c[1]==='B'))
  if(['same-token-upload','return-token-upload'].includes(scenario)){
   if(scenario==='return-token-upload'){
    await page.waitForFunction(async()=> (await window.readDiary()).medicines.some(m=>m.id==='remote-B'))
    await page.evaluate(()=>{window.actions.connect('A'.repeat(24)).then(result=>window.doneC=result)})
   }
   await page.waitForTimeout(150)
   assert.equal(await page.evaluate(()=>window.uploads.filter(u=>u.key==='A').length),1,'Same-account write cannot overtake old PUT')
   await page.evaluate(()=>window.addLocal('local-during-queue'))
  }
  if(scenario==='pending-upload'){
   await page.waitForFunction(async()=> (await window.readDiary()).medicines.some(m=>m.id==='remote-B'))
   assert.equal(await page.evaluate(()=>window.uploads.filter(u=>u.key==='B').length),0,'A different token may share the same Disk: B must wait for old PUT')
  }
  if(scenario!=='pending-download')await page.evaluate(()=>window.releasePending())
  await page.waitForFunction(()=>window.doneA!==undefined&&!window.state.busy)
  const data=await page.evaluate(async()=>({state:window.state,diary:await window.readDiary(),uploads:window.uploads,removals:window.removals,doneA:window.doneA}))
  if(['switch-upload','pending-upload','same-token-upload','return-token-upload','late-upload-error'].includes(scenario)){
   assert.ok(data.diary.medicines.some(m=>m.id==='remote-A'),'Already imported local data is retained')
   assert.ok(!data.removals.some(r=>r.key==='B'&&r.name.includes('-OldA-')),'Old cycle must not delete from the new account')
  }else{
   assert.ok(!data.diary.medicines.some(m=>m.id==='remote-A'),'Late old-account data must not be applied')
   assert.ok(!data.uploads.some(u=>u.key==='B'&&u.diary.medicines.some(m=>m.id==='remote-A')),'Late old-account data must not be uploaded to the new account')
  }
  if(['switch-list','switch-download','late-error','switch-upload','pending-download','pending-upload','return-token-upload','late-upload-error'].includes(scenario)){
   assert.ok(data.diary.medicines.some(m=>m.id==='remote-B'),'New connection receives its own current cycle')
   assert.equal(data.state.connected,true);assert.equal(data.state.error,null)
  }else if(scenario==='same-token-upload'){
   assert.equal(data.state.connected,true);assert.equal(data.state.error,null)
  }else if(scenario==='disconnect-download'){
   assert.equal(data.state.connected,false);assert.equal(data.state.error,null);assert.equal(data.uploads.length,0)
  }else{assert.equal(data.state.connected,false);assert.match(data.state.error,/B validation failure/)}
  if(scenario==='pending-download'){
   await page.evaluate(()=>window.releasePending());await page.waitForTimeout(100)
   if(scenario==='pending-download')assert.ok(!(await page.evaluate(()=>window.readDiary())).medicines.some(m=>m.id==='remote-A'),'Late delivery after B completed is ignored')
  }
  if(['same-token-upload','return-token-upload'].includes(scenario)){
   const completed=await page.evaluate(()=>window.completedUploads.filter(u=>u.key==='A'))
   assert.equal(completed.length,2,'Both A writes eventually complete in order')
   assert.ok(!completed[0].diary.medicines.some(m=>m.id==='local-new'))
   assert.ok(completed[1].diary.medicines.some(m=>m.id==='local-new'),'The final server copy retains the newer local record')
   assert.ok(completed[1].diary.medicines.some(m=>m.id==='local-during-queue'),'Edits while waiting for old PUT are included in the next copy')
   if(scenario==='return-token-upload')assert.equal(await page.evaluate(()=>window.uploads.filter(u=>u.key==='B').length),0,'Cancelled B waiter never starts its PUT')
  }
  assert.equal(data.doneA,false,'Old connect result must not confirm a changed connection');assert.deepEqual(errors,[])
  checks.push(scenario);console.log('ok',scenario)
 }catch(error){failures.push({scenario,error:String(error),errors});console.log('FAIL',scenario,String(error).split('\n')[0])}finally{await ctx.close()}
}
for(const scenario of ['sources-lock','sources-error']){
 const ctx=await browser.newContext({hasTouch:true}),page=await ctx.newPage(),errors=[]
 page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(String(error)))
 await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div><script>window.fixture='+JSON.stringify(scenario)+'</script><script>'+bundle.replaceAll('</script','<\\/script')+'</script>'}))
 try{
  await page.goto('https://sync-session.invalid');await page.waitForFunction(()=>!!window.actions)
  if(scenario==='sources-lock'){
   const before=await page.evaluate(()=>window.sourceCalls)
   await page.evaluate(()=>{window.holdSources=true;window.actions.sync().then(()=>window.sourceDone=true);window.actions.sync()})
   await page.waitForFunction(()=>!!window.releaseSource)
   assert.equal(await page.evaluate(()=>window.sourceCalls),before+1,'Lock is acquired before source lookup')
   await page.evaluate(()=>window.releaseSource());await page.waitForFunction(()=>window.sourceDone&&!window.state.busy)
  }else{
   await page.evaluate(()=>{window.sourceFailure=true;return window.actions.sync()})
   await page.waitForFunction(()=>!window.state.busy&&window.state.unreadable.length>0)
   assert.match(await page.evaluate(()=>window.state.unreadable.join()),/Synthetic source failure/)
   await page.evaluate(()=>{window.sourceFailure=false;return window.actions.sync()})
   await page.waitForFunction(()=>!window.state.busy)
  }
  assert.deepEqual(errors,[]);checks.push(scenario);console.log('ok',scenario)
 }catch(error){failures.push({scenario,error:String(error),errors});console.log('FAIL',scenario,String(error).split('\n')[0])}finally{await ctx.close()}
}
const ctx=await browser.newContext(),page=await ctx.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div><script>window.fixture="summary"</script><script>'+bundle.replaceAll('</script','<\\/script')+'</script>'}));await page.goto('https://sync-session.invalid');await page.waitForFunction(()=>!!window.summary)
for(const [fields,expected] of [[{addedLabs:1},'анализов: 1'],[{updatedLabs:2},'анализов: 2'],[{addedRegimens:1},'курсов: 1'],[{updatedRegimens:2},'курсов: 2'],[{updatedMedicines:1},'препаратов: 1'],[{changedTombstones:1},'учтено удалений: 1'],[{removed:1,changedTombstones:1},'удалено: 1']]){
 const text=await page.evaluate(fields=>window.summary(fields),fields)
 try{assert.equal(text,expected);checks.push({fields,text})}catch(error){failures.push({fields,error:String(error)});console.log('FAIL summary',fields)}
}await ctx.close()
}finally{await browser.close()}
mkdirSync('reviews/evidence/family-sync-session',{recursive:true});writeFileSync('reviews/evidence/family-sync-session/checks.json',JSON.stringify({checks,failures},null,2));console.log({checks:checks.length,failures:failures.length});process.exitCode=failures.length?1:0
