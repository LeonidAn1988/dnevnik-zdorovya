/** Test notification routing and snooze with real Android bridge, review app only. */
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { connect, patchSettings, goPhone, adb, OUT } from './device_review.mjs'
const {browser,page}=await connect()
const results=[]
const record=(name,data)=>{if(name==='native-open-person'&&data.actual!==data.expected)throw new Error('Notification opened wrong person');if(name==='native-snooze-rebuild'&&!data.after.some(n=>n.id===data.snoozeId))throw new Error('Snooze was lost');results.push({name,...data});writeFileSync(`${OUT}notifications.json`,JSON.stringify(results,null,2));console.log(name,JSON.stringify(data))}
try {
  await patchSettings(page,{remindersOn:false,remindersRepeat:false,people:[{id:'p1',name:'Ревью 1',deviceUser:1},{id:'p2',name:'Ревью 2',deviceUser:2}],activePerson:'p1'})
  await goPhone(page,{name:'Reminders',tool:'Настройки',open:'Напоминания'})
  const code=await build({stdin:{contents:`
    import { LocalNotifications } from '@capacitor/local-notifications';
    import { capacitorReminders } from './src/platform/capacitor/reminders';
    import { buildReminders, snoozeIsRelevant } from './src/logic/reminders';
    import { splitBox } from './src/logic/split'; import { dosing } from './src/logic/regimen';
    window.reviewNotifications={native:LocalNotifications,port:capacitorReminders,buildReminders,snoozeIsRelevant,splitBox,dosing};
  `,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',logLevel:'error'})
  await page.addScriptTag({content:code.outputFiles[0].text})
  record('permissions',await page.evaluate(async()=>({display:await reviewNotifications.port.permission(),exact:await reviewNotifications.port.exactTiming(),health:await reviewNotifications.port.health('system')})))
  const setup=await page.evaluate(async()=>{
    const api=reviewNotifications;const day=new Date().setHours(0,0,0,0);const n=new Date();const slot=`${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;
    window.reviewReminder={id:123456,kind:'dose',day,slot,at:Date.now()+3600000,person:'p2',title:'РЕВЬЮ: второй дневник',body:'Тестовый переход, реальные данные отсутствуют',details:'Тестовый переход',markable:true,step:0};
    await api.port.schedule([window.reviewReminder],'system');await api.native.cancel({notifications:[{id:123456}]});
    await api.native.schedule({notifications:[{id:123456,title:reviewReminder.title,body:reviewReminder.body,largeBody:reviewReminder.details,channelId:'omron-meds-v2-system',actionTypeId:'omron-dose',extra:{kind:'dose',slot,day,person:'p2'}}]});
    return {slot,day};
  })
  async function tapNotification(title,action) {
    adb('shell','cmd','statusbar','expand-notifications');await page.waitForTimeout(700)
    const file='/data/local/tmp/omron-review-ui.xml'
    adb('shell','uiautomator','dump',file)
    const xml=adb('exec-out','cat',file).toString();adb('shell','rm',file)
    const target=await page.evaluate(({xml,title,action})=>{
      const doc=new DOMParser().parseFromString(xml,'text/xml');const nodes=[...doc.querySelectorAll('node')];
      const own=nodes.find(n=>n.getAttribute('text')===title);if(!own)return null;
      let chosen=own;
      if(action){let ancestor=own.parentElement;chosen=null;while(ancestor){const n=[...ancestor.querySelectorAll('node')].find(n=>n.getAttribute('text')?.toLowerCase()===action.toLowerCase());if(n){chosen=n;break}ancestor=ancestor.parentElement}}
      if(!chosen)return {missingAction:true};const b=chosen.getAttribute('bounds').match(/\d+/g).map(Number);return {x:Math.round((b[0]+b[2])/2),y:Math.round((b[1]+b[3])/2)}
    },{xml,title,action})
    if(!target||target.missingAction)throw new Error(`Own test notification/action not found: ${title}/${action??'open'}`)
    adb('shell','input','tap',String(target.x),String(target.y));await page.waitForTimeout(1000)
  }
  await tapNotification('РЕВЬЮ: второй дневник')
  record('native-open-person',{expected:'p2',actual:await page.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('omron-bp');q.onsuccess=()=>r(q.result)});const v=await new Promise(r=>{const q=db.transaction('meta').objectStore('meta').get('settings');q.onsuccess=()=>r(q.result)});db.close();return v.activePerson}),nav:await page.locator('.app').getAttribute('data-nav')})
  await page.evaluate(async()=>{
    const api=reviewNotifications;const delivered=await api.native.getDeliveredNotifications();await api.native.removeDeliveredNotifications(delivered);
    await api.native.schedule({notifications:[{id:123457,title:'РЕВЬЮ: отложить',body:'Только тестовое уведомление',largeBody:'Только тестовое уведомление',channelId:'omron-meds-v2-system',actionTypeId:'omron-dose',extra:{kind:'dose',slot:reviewReminder.slot,day:reviewReminder.day,person:'p2'}}]});
  })
  await tapNotification('РЕВЬЮ: отложить','Отложить 15 мин')
  const before=await page.evaluate(async()=> (await reviewNotifications.native.getPending()).notifications.map(n=>({id:n.id,extra:n.extra})))
  await page.evaluate(async()=>{
    const api=reviewNotifications;const {box,regimen}=api.splitBox({id:'native-test-dose',name:'Ревью',dose:'',left:30,perDay:null,expires:null,times:[reviewReminder.slot],perTime:1},'p2');
    const reminders=api.buildReminders([api.dosing(box,regimen)],Date.now(),{repeat:false,personOf:()=> 'p2',personName:()=> 'Ревью 2'});
    window.reviewPlan={medicines:[api.dosing(box,regimen)],subjects:[],labs:[],regimens:[regimen],now:Date.now(),options:{repeat:false,personOf:()=> 'p2'}};
    await api.port.schedule(reminders,'system',key=>api.snoozeIsRelevant(window.reviewPlan,key));
  })
  const after=await page.evaluate(async()=> (await reviewNotifications.native.getPending()).notifications.map(n=>({id:n.id,extra:n.extra})))
  record('native-snooze-rebuild',{snoozeId:20123457,before:before.filter(n=>n.id>=20000000),after:after.filter(n=>n.id>=20000000),futureCount:after.length})
  await page.evaluate(async()=>reviewNotifications.port.schedule([], 'system', () => false))
  const removed=await page.evaluate(async()=>!(await reviewNotifications.native.getPending()).notifications.some(n=>n.id===20123457))
  if(!removed)throw new Error('Cancelled dose kept snooze')
  record('irrelevant-snooze-removed',{removed})
} finally {
  // Clear test app notifications/alarms; leave the user's installed diary alone.
  await page.evaluate(async()=>{if(!window.reviewNotifications)return;const api=reviewNotifications;await api.port.cancelAll();const delivered=await api.native.getDeliveredNotifications();await api.native.removeDeliveredNotifications(delivered)}).catch(()=>{})
  adb('shell','cmd','statusbar','collapse')
  await browser.close()
}
