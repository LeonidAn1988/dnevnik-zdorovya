// Physical phone probes. Only synthetic audit package may be mutated.
import {_android} from 'playwright'
import {seed,go,settleAny} from './visual.mjs'
import {execFileSync} from 'node:child_process'
import {mkdirSync,writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
const pkg='io.github.leonidan1988.omronbp.audit',serial='JUP0223908000381',out='reviews/evidence/reliability/phone'
mkdirSync(out,{recursive:true})
const adb=(...args)=>execFileSync('adb',['-s',serial,...args],{encoding:'utf8'})
const pause=ms=>new Promise(r=>setTimeout(r,ms))
const result={package:pkg,cases:[],failures:[],limits:['No reboot or two-hour wall-clock timer','Huawei ScreenReader present; TalkBack not installed; spoken output not verified']}
let device,page,idle=false
async function connect(){device=(await _android.devices()).find(d=>d.serial()===serial);page=await(await device.webView({pkg})).page();page.setDefaultTimeout(10000);assert.equal((await page.evaluate(()=>Capacitor.Plugins.App.getInfo())).id,pkg);await settleAny(page)}
const invoke=(method,args={})=>page.evaluate(({method,args})=>Capacitor.nativePromise('LocalNotifications',method,args),{method,args})
async function setup(style='rhythm',textScale='normal'){
 await seed(page,Date.now());await page.evaluate(async({style,textScale})=>{const db=await new Promise(r=>{const q=indexedDB.open('omron-bp');q.onsuccess=()=>r(q.result)});const t=db.transaction('meta','readwrite');t.objectStore('meta').put({onboarded:true,guideOffered:true,identityConfirmed:true,people:[{id:'p1',name:'Аудит Анна'},{id:'p2',name:'Аудит Борис'}],activePerson:'p1',interfaceStyle:style,textScale,theme:'dark',trackGlucose:true,startTab:'overview',remindersOn:false,reminderPeople:[],measureRemindOn:false},'settings');await new Promise(r=>t.oncomplete=r);db.close()},{style,textScale});await page.reload({waitUntil:'domcontentloaded'});await page.locator('nav.tabs').waitFor();await pause(400)
}
async function run(name,fn){if(process.env.PROBE&&!new RegExp(process.env.PROBE).test(name))return;try{const detail=await fn();result.cases.push({name,...detail});console.log('PASS',name)}catch(e){result.failures.push({name,error:String(e)});console.log('FAIL',name,String(e));}writeFileSync(out+'/result.json',JSON.stringify(result,null,2))}
try{
 await connect();adb('shell','pm','grant',pkg,'android.permission.POST_NOTIFICATIONS')
 for(const style of ['journal','rhythm','clear'])for(const scale of ['normal','xlarge'])await run('focus-'+style+'-'+scale,async()=>{
  await setup(style,scale);await go(page,{tab:'Давление'});await page.getByRole('button',{name:'Добавить',exact:true}).click();const spin=page.getByRole('spinbutton',{name:'Верхнее',exact:true});assert.equal(await spin.evaluate(e=>e===document.activeElement),true)
  adb('shell','input','keyevent','19');await pause(350);assert.equal(await spin.getAttribute('aria-valuenow'),'121');adb('shell','input','keyevent','20');await pause(350);assert.equal(await spin.getAttribute('aria-valuenow'),'120');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:out+'/'+style+'-'+scale+'.png'});return{focus:true,physicalKeys:true,noHorizontalOverflow:true}
 })
 for(const mode of ['process-death','doze'])await run(mode,async()=>{
  if(!device){adb('shell','am','start','-n',pkg+'/io.github.leonidan1988.omronbp.MainActivity');await connect()}
  await setup();await invoke('createChannel',{id:'audit-reliability',name:'Тест надёжности',importance:3,visibility:0,vibration:false,sound:''})
  const id=2000000000+(Date.now()%1000000),title='Проверка надёжности '+mode,due=Date.now()+20000
  const exact=(await invoke('checkExactNotificationSetting')).exact_alarm==='granted'
  await invoke('schedule',{notifications:[{id,title,body:'Тест уведомления. Принимать ничего не нужно.',channelId:'audit-reliability',extra:{kind:'glucose',slot:'audit',day:Date.now(),person:'p2'},isExactNotification:exact,isExactMandatory:false,schedule:{at:new Date(due).toISOString(),allowWhileIdle:true}}]})
  result.scheduledIds??=[];result.scheduledIds.push(id);
  const oldPid=adb('shell','pidof',pkg).trim();adb('shell','input','keyevent','3');await device.close();device=null;await pause(300)
  let processGone=false,idleState=null
  if(mode==='process-death'){
   adb('shell','am','crash',pkg);await pause(1500)
   try{processGone=adb('shell','pidof',pkg).trim()!==oldPid}catch{processGone=true}
   assert.ok(processGone,'Original process must be gone before delivery')
  }else{
   adb('shell','input','keyevent','223');adb('shell','dumpsys','battery','unplug');idle=true
   const response=adb('shell','dumpsys','deviceidle','force-idle');assert.match(response,/idle/i)
   idleState=adb('shell','dumpsys','deviceidle').split('\n').filter(l=>/mState=|mLightState=/.test(l)).map(l=>l.trim());assert.ok(idleState.some(l=>l.includes('mState=IDLE')))
  }
  let deliveredAt=null
  for(let i=0;i<50;i++){const dump=adb('shell','dumpsys','notification');if(Date.now()>=due&&dump.split('Historical notifications')[0].split('\n').some(l=>l.includes('NotificationRecord(')&&l.includes('pkg='+pkg)&&l.includes('id='+id))){deliveredAt=Date.now();break}await pause(1000)}
  const stateAtDelivery=idle?adb('shell','dumpsys','deviceidle').split('\n').filter(l=>/mState=/.test(l)).map(l=>l.trim()):null
  if(idle){adb('shell','dumpsys','deviceidle','unforce');adb('shell','dumpsys','battery','reset');idle=false;adb('shell','input','keyevent','224');adb('shell','wm','dismiss-keyguard')}
  assert.ok(deliveredAt,'No actual delivered notification within 50 seconds')
  // Delivery is checked independently of opening: waking/connect can itself
  // remove an obsolete synthetic notification via the real relevance rules.
  const detail={exact,due,deliveredAt,delayMs:deliveredAt-due,processGone,idleState,stateAtDelivery,openingNotTested:true}
  adb('shell','cmd','statusbar','collapse');adb('shell','am','start','-n',pkg+'/io.github.leonidan1988.omronbp.MainActivity');await connect()
  await invoke('removeDeliveredNotifications',{notifications:[{id}]});return detail
 })
}finally{
 if(idle){adb('shell','dumpsys','deviceidle','unforce');adb('shell','dumpsys','battery','reset');adb('shell','input','keyevent','224')}
 try{if(!device){adb('shell','am','start','-n',pkg+'/io.github.leonidan1988.omronbp.MainActivity');await connect()}await invoke('cancel',{notifications:(result.scheduledIds??[]).map(id=>({id}))});await invoke('removeAllDeliveredNotifications');await invoke('deleteChannel',{id:'audit-reliability'})}catch(e){result.cleanupError=String(e)}
 if(device)await device.close();writeFileSync(out+'/result.json',JSON.stringify(result,null,2));process.exitCode=result.failures.length?1:0
}
