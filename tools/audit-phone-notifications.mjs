// Native notification delivery/open probes. Synthetic audit package ONLY.
import {_android} from 'playwright'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {writeFileSync} from 'node:fs'
const pkg='io.github.leonidan1988.omronbp.audit', serial='JUP0223908000381'
const adb=(...args)=>execFileSync('adb',['-s',serial,...args],{encoding:'utf8'})
const out=(process.env.AUDIT_OUT||'reviews/evidence/total-audit-2026-10-17')+'/phone-notifications.json'
const result={package:pkg,method:'Actual Android silent notification, native shade tap; no artificial startup delay',cases:[],failures:[]}
let device,page
async function connect(){device=(await _android.devices()).find(d=>d.serial()===serial);page=await(await device.webView({pkg})).page();assert.equal((await page.evaluate(()=>Capacitor.Plugins.App.getInfo())).id,pkg);await page.locator('nav.tabs').waitFor()}
async function invoke(name,args={}){return page.evaluate(({name,args})=>Capacitor.nativePromise('LocalNotifications',name,args),{name,args})}
try{
 adb('shell','am','start','-n',pkg+'/io.github.leonidan1988.omronbp.MainActivity')
 await connect()
 adb('shell','pm','grant',pkg,'android.permission.POST_NOTIFICATIONS')
 await invoke('createChannel',{id:'audit-silent',name:'Тихая проверка аудита',importance:2,visibility:0,vibration:false,sound:''})
 for(const [index,mode]of ['warm','recreated-activity','recreated-activity'].entries()){
  const title=`Проверка аудита ${index+1}`,id=2000000000+index
  try{
   await page.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('omron-bp');q.onsuccess=()=>r(q.result)});const s=await new Promise(r=>{const q=db.transaction('meta').objectStore('meta').get('settings');q.onsuccess=()=>r(q.result)});const tx=db.transaction('meta','readwrite');tx.objectStore('meta').put({...s,startTab:'overview',activePerson:'p1',people:[{id:'p1',name:'Аудит Анна'},{id:'p2',name:'Аудит Борис'}],trackGlucose:true,remindersOn:false,measureRemindOn:false,reminderPeople:[],mealTimers:[],glucoseTimers:[]},'settings');await new Promise(r=>tx.oncomplete=r);db.close()})
   await page.reload();await page.locator('nav.tabs').waitFor();await page.waitForTimeout(400)
   const before=await page.locator('.app').getAttribute('data-nav')
   await invoke('schedule',{notifications:[{id,title,body:'Тест: открыть сахар второго человека. Принимать ничего не нужно.',channelId:'audit-silent',extra:{kind:'glucose',slot:'audit',day:Date.now(),person:'p2'}}]})
   await page.waitForTimeout(900)
   const delivered=await invoke('getDeliveredNotifications');assert.ok(delivered.notifications.some(n=>n.id===id),'Not delivered')
   adb('shell','input','keyevent','3');await page.waitForTimeout(350)
   let coldVerified=false
   if(mode==='recreated-activity'){
    await page.evaluate(()=>{void Capacitor.nativePromise('App','exitApp',{}).catch(()=>{})})
    await new Promise(r=>setTimeout(r,700));await device.close();device=null
   }

   adb('shell','cmd','statusbar','expand-notifications')
   await new Promise(r=>setTimeout(r,500))
   adb('shell','uiautomator','dump','/data/local/tmp/omron-audit-ui.xml')
   const xml=adb('shell','cat','/data/local/tmp/omron-audit-ui.xml')
   adb('shell','rm','/data/local/tmp/omron-audit-ui.xml')
   const node=xml.match(new RegExp('<node[^>]*text="'+title+'"[^>]*>'))?.[0]
   assert.ok(node,'Audit notification not visible in shade')
   const b=node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/).slice(1).map(Number)
   adb('shell','input','tap',String(Math.round((b[0]+b[2])/2)),String(Math.round((b[1]+b[3])/2)))
   if(mode==='recreated-activity')await connect()
   await page.waitForTimeout(1200)
   const after=await page.locator('.app').getAttribute('data-nav')
   const active=await page.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('omron-bp');q.onsuccess=()=>r(q.result)});return new Promise(r=>{const q=db.transaction('meta').objectStore('meta').get('settings');q.onsuccess=()=>{r(q.result.activePerson);db.close()}})})
   result.cases.push({mode,id,before,delivered:true,coldVerified,activityExitRequested:mode==='recreated-activity',after,active,correct:after==='glucose'&&active==='p2'})
   console.log(mode,after,active)
   await invoke('removeDeliveredNotifications',{notifications:[{id}]})
  }catch(e){result.failures.push({mode,error:String(e)});console.log('FAIL',mode,String(e));adb('shell','am','start','-n',pkg+'/io.github.leonidan1988.omronbp.MainActivity');if(!device)await connect()}
  writeFileSync(out,JSON.stringify(result,null,2)+'\n')
 }
}finally{if(device){await invoke('removeAllDeliveredNotifications').catch(()=>{});await invoke('deleteChannel',{id:'audit-silent'}).catch(()=>{});await device.close()}writeFileSync(out,JSON.stringify(result,null,2)+'\n')}
