/** Physical Android audit. Strict package guard: never seed the personal diary. */
import { _android } from 'playwright'
import {mkdirSync,writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {seed,go,SCREENS,settleAny} from './visual.mjs'
export const pkg='io.github.leonidan1988.omronbp.audit'
const out=process.env.AUDIT_OUT||'reviews/evidence/total-audit-2026-10-17'
const shots=process.env.AUDIT_SHOTS||'/private/tmp/omron-total-audit/screens'
mkdirSync(out,{recursive:true});mkdirSync(shots,{recursive:true})
const devices=await _android.devices(),device=devices.find(d=>d.serial()==='JUP0223908000381')
assert.ok(device,'Physical audit phone required')
const page=await(await device.webView({pkg})).page();page.setDefaultTimeout(8000)
assert.equal((await page.evaluate(()=>window.Capacitor.Plugins.App.getInfo())).id,pkg)
export async function patch(page,fields){
 await page.evaluate(async fields=>{const db=await new Promise((r,j)=>{const q=indexedDB.open('omron-bp');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)});const st=await new Promise(r=>{const q=db.transaction('meta').objectStore('meta').get('settings');q.onsuccess=()=>r(q.result)});const tx=db.transaction('meta','readwrite');tx.objectStore('meta').put({...st,...fields,guideOffered:true},'settings');await new Promise((r,j)=>{tx.oncomplete=r;tx.onerror=()=>j(tx.error)});db.close()},fields)
 await page.reload({waitUntil:'domcontentloaded'});await page.locator('nav.tabs').waitFor()
}
const mode=process.argv[2]||'screens'
const results={sourceCommit:process.env.SOURCE_COMMIT||'60db05d31ddb6f28cbf6090abbe748da9c3d2410',device:'Huawei MNA-LX9 Android15',package:pkg,method:'Playwright Android WebView on physical phone; no viewport emulation',profiles:[],failures:[],errors:[]}
page.on('pageerror',e=>results.errors.push(String(e)))
const save=()=>writeFileSync(`${out}/phone-${mode}.json`,JSON.stringify(results,null,2)+'\n')
const capture=async(name)=>{await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:`${shots}/${name.replaceAll('/','-')}.png`});return `${shots}/${name}.png`}
try{
 await settleAny(page)
 if(mode==='flows'){
  const {runFlows}=await import('./audit-phone-flows.mjs');await runFlows(page,{auditPackage:pkg,capture,results})
 }else{
  await capture('first-launch')
  await seed(page,Date.now())
  const styles=(process.env.STYLES||'journal,rhythm,clear,classic,modern').split(',')
  const combos=process.env.QUICK_EXTRA?[['dark','normal'],['light','xlarge']]:process.env.QUICK?[['light','normal'],['dark','xlarge']]:[['light','normal'],['dark','normal'],['light','xlarge'],['dark','xlarge']]
  for(const style of styles)for(const [theme,scale] of combos){
   await patch(page,{interfaceStyle:style,theme,textScale:scale,density:'normal'})
   for(const [index,screen]of SCREENS.filter(s=>!s.whose && (!process.env.SCREEN_FILTER || new RegExp(process.env.SCREEN_FILTER).test(s.name))).entries()){
    const id=`${style}-${theme}-${scale}-${String(index).padStart(2,'0')}`
    try{
     await go(page,screen)
     const geometry=await page.evaluate(()=>({width:innerWidth,height:innerHeight,content:document.documentElement.scrollWidth,touch:navigator.maxTouchPoints,nav:document.querySelector('.app').dataset.nav,overwide:[...document.querySelectorAll('button,input,select,textarea')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&e.checkVisibility()&&(r.left < -1||r.right>innerWidth+1)}).map(e=>({tag:e.tagName,text:(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,90)}))}))
     await capture(id)
     assert.ok(geometry.touch>0);assert.ok(geometry.content<=geometry.width+1,`Overflow ${geometry.content}/${geometry.width}`)
     results.profiles.push({style,theme,scale,screen:screen.name,id,...geometry})
    }catch(e){results.failures.push({style,theme,scale,screen:screen.name,id,error:String(e),nav:await page.locator('.app').getAttribute('data-nav').catch(()=>null)});await capture('FAIL-'+id).catch(()=>{});console.log('FAIL',id,screen.name,String(e).split('\n')[0]);await page.reload({waitUntil:'domcontentloaded'});await page.locator('nav.tabs').waitFor()}
    save()
   }
   console.log('PROFILE',style,theme,scale,results.profiles.length,'passed',results.failures.length,'failed')
  }
 }
}finally{save();await device.close()}
console.log({passed:results.profiles.length,failures:results.failures.length,errors:results.errors.length})
