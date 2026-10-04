/** Actual touch / native notifications; disposable .review package only. */
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {writeFileSync} from 'node:fs'
import {connect,patchSettings,capture,geometry,goPhone,adb,OUT,PACKAGE} from './device_review.mjs'
import {seed} from './visual.mjs'
import {seedEvolution,evolutionData} from './evolution-scenarios.mjs'
const {browser,page:p}=await connect(),checks=[],errors=[]
const check=(name,data={})=>{checks.push({name,...data});console.log(`ok ${name}`)}
p.on('pageerror',e=>errors.push(String(e)))
let ratio=1,inset=0
const bridge=(await build({stdin:{contents:"import {LocalNotifications} from '@capacitor/local-notifications';window.reviewNative=LocalNotifications;",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',logLevel:'error'})).outputFiles[0].text
const inject=()=>p.addScriptTag({content:bridge})
async function tap(l){await l.evaluate(e=>e.scrollIntoView({block:'center'}));await p.waitForTimeout(200);const b=await l.boundingBox();assert(b);adb('shell','input','tap',`${Math.round((b.x+b.width/2)*ratio)}`,`${Math.round(inset+(b.y+b.height/2)*ratio)}`);await p.waitForTimeout(450)}
async function snap(n){assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await capture(p,n,true);check(n,await geometry(p))}
try {
 const g=await geometry(p);ratio=g.dpr;adb('shell','uiautomator','dump','/data/local/tmp/omron-review-bounds.xml');const xml=adb('exec-out','cat','/data/local/tmp/omron-review-bounds.xml').toString();adb('shell','rm','/data/local/tmp/omron-review-bounds.xml');inset=await p.evaluate(xml=>{const d=new DOMParser().parseFromString(xml,'text/xml'),n=[...d.querySelectorAll('node')].find(n=>n.getAttribute('class')==='android.webkit.WebView');return Number(n.getAttribute('bounds').match(/\d+/g)[1])},xml)
 check('isolated package and real touch',{package:PACKAGE,dpr:ratio,inset,touch:g.touch,width:g.width,height:g.height})
 for(const scale of ['normal','xlarge'])for(const theme of ['light','dark']) {
  const prefix=`${scale}-${theme}`,now=Date.now();await seed(p,now);await seedEvolution(p,now,{textScale:scale,theme,reminderSound:'silent'})
  await goPhone(p,{tab:'Аптечка',section:'Запасы',open:'Пепсан · тест'});await snap(`${prefix}-card`);await tap(p.locator('summary',{hasText:'Подробности препарата'}));assert(await p.getByText('Тестовый производитель',{exact:true}).isVisible());check(`${prefix}: physical details disclosure`)
  await tap(p.getByRole('button',{name:'Курс приёма',exact:true}));await snap(`${prefix}-stages`);assert.equal(await p.locator('details .card').count(),2);await p.locator('details .card').first().evaluate(e=>e.scrollIntoView({block:'start'}));await snap(`${prefix}-stage-fields`);await tap(p.getByLabel('За сколько минут до еды',{exact:true}));await p.waitForTimeout(500);await capture(p,`${prefix}-keyboard`,false);adb('shell','input','keyevent','4');await tap(p.getByRole('button',{name:'Сохранить',exact:true}).first());assert.equal((await evolutionData(p,'regimens')).find(x=>x.id==='before').mealMinutes,20);check(`${prefix}: physical course save and keyboard Back`)
  await goPhone(p,{tab:'Приём'});await tap(p.locator('.dose').filter({hasText:'Пепсан · тест'}).first().getByRole('button',{name:'Принял',exact:true}));await tap(p.getByRole('button',{name:/Таймер до еды/}).first());await tap(p.getByRole('button',{name:/Закончил есть/}).first());await snap(`${prefix}-timers`)
  let s=await evolutionData(p);assert.equal(s.mealTimers.length,2);assert.deepEqual(s.mealTimers.map(t=>(t.dueAt-t.startedAt)/60000).sort((a,b)=>a-b),[20,30]);assert.equal(await p.getByRole('button',{name:'Таймер запущен',exact:true}).count(),2);check(`${prefix}: physical 20/30 minute timers, duplicate buttons disabled`)
  assert.equal(await p.locator('.dose').filter({hasText:'Капли · тест'}).first().locator('.dose__late').count(),0);assert(await p.getByRole('button',{name:'Отменить таймер',exact:true}).first().evaluate(e=>e.getBoundingClientRect().height>=48));check(`${prefix}: interval wait has no overdue badge; cancel target ≥48px`)
  await inject();await p.waitForTimeout(700);const pending=await p.evaluate(async()=> (await window.reviewNative.getPending()).notifications.filter(n=>n.extra?.kind==='timer'));assert.equal(pending.length,2);check(`${prefix}: both timers scheduled in Android; silent mode selected`,{pending,sound:(await evolutionData(p)).reminderSound})
  await tap(p.getByRole('button',{name:/Уведомления/}));await snap(`${prefix}-history`);adb('shell','input','keyevent','4');await p.waitForTimeout(400);assert.equal(await p.locator('dialog[open]').count(),0);check(`${prefix}: physical native Back closes history`)
  await tap(p.getByRole('button',{name:'Отменить таймер',exact:true}).first());await p.waitForTimeout(600);assert.equal((await evolutionData(p)).mealTimers.filter(t=>!t.cancelledAt).length,1);check(`${prefix}: cancelled timer removed from native queue`)
 }
 // A deliberately short synthetic timer checks actual native delivery; real course intervals above remain 20/30min.
 let s=await evolutionData(p),t=s.mealTimers.find(t=>!t.cancelledAt);const dueAt=Date.now()+6000
 await patchSettings(p,{mealTimers:[{...t,startedAt:Date.now(),dueAt}],notificationHistory:[],reminderSound:'silent'});await inject();await p.waitForTimeout(2000)
 const channels=await p.evaluate(async()=> (await window.reviewNative.listChannels()).channels),silent=channels.find(c=>c.id==='omron-meds-v2-silent');assert(silent);assert.equal(silent.vibration,false);assert(!silent.sound);check('native silent channel: no sound or vibration',{silent})
 await p.waitForTimeout(9000)
 let delivered=[];for(let i=0;i<4;i++){delivered=await p.evaluate(async()=> (await window.reviewNative.getDeliveredNotifications()).notifications);if(delivered.some(n=>n.id===Number(t.id)))break;await p.waitForTimeout(5000)}
 assert(delivered.some(n=>n.id===Number(t.id)),'synthetic silent timer reached Android notification shade');check('silent timer delivered by Android',{delivered:delivered.filter(n=>n.id===Number(t.id))})
 await goPhone(p,{tab:'Приём'});await tap(p.getByRole('button',{name:/Уведомления/}));assert(await p.getByRole('dialog').getByText(/Анна.*Капли · тест/).count());await snap('delivered-history');check('delivered timer visible in local history with owner')
 assert.equal(errors.length,0)
} finally {
 try{await p.evaluate(async()=>{const a=window.reviewNative;if(!a)return;const n=(await a.getPending()).notifications;if(n.length)await a.cancel({notifications:n.map(n=>({id:n.id}))});const d=(await a.getDeliveredNotifications()).notifications;if(d.length)await a.removeDeliveredNotifications({notifications:d})})}catch(e){errors.push(String(e))}
 writeFileSync(`${OUT}evolution.json`,JSON.stringify({at:new Date().toISOString(),package:PACKAGE,checks,errors},null,2));await browser.close()
}
