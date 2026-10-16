/** Render parity and actual control geometry, not just scrollWidth. Synthetic profiles only. */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { seed, settleAny, goConceptRoute } from '../tools/visual.mjs'

const out = process.env.EVIDENCE_DIR || 'reviews/evidence/render-fidelity/current'
mkdirSync(out, { recursive: true })
const now = new Date('2026-10-15T07:55:00+03:00').getTime()
const browser = await chromium.launch(), results = { checks: [], failures: [], errors: [] }
const profiles = ['journal','rhythm','clear'].flatMap(style => ['light','dark'].flatMap(theme => [
  {style,theme,width:390,scale:'normal',touch:true}, {style,theme,width:320,scale:'xlarge',touch:true},
  {style,theme,width:900,scale:'normal',touch:true}, {style,theme,width:1280,scale:'normal',touch:false},
])).filter(p=>(!process.env.STYLE||p.style===process.env.STYLE)&&(!process.env.WIDTH||p.width===Number(process.env.WIDTH))&&(!process.env.THEME||p.theme===process.env.THEME))
async function storage(page, profile, stress = false) {
  await page.evaluate(async ({profile,now,stress}) => {
    const db = await new Promise(r => { const q=indexedDB.open('omron-bp');q.onsuccess=()=>r(q.result) })
    const settings = await new Promise(r=>{const q=db.transaction('meta').objectStore('meta').get('settings');q.onsuccess=()=>r(q.result)})
    const tx=db.transaction(['meta','medicines','regimens','readings','labs'],'readwrite')
    for(const name of ['medicines','regimens','readings','labs'])tx.objectStore(name).clear()
    tx.objectStore('meta').put({...settings,guideOffered:true,sections:{...settings.sections,intake:true},interfaceStyle:profile.style,theme:profile.theme,textScale:profile.scale,density:'normal',nudgesUntil:{backup:now+86400000,reminders:now+86400000},people:[{id:'p1',name:stress?'Анна Александровна Длиннофамильная':'Анна'},{id:'p2',name:'Олег'}],activePerson:'p1'},'settings')
    const count=stress?12:2
    for(let i=0;i<count;i++){
      const id='reference-'+i
      tx.objectStore('medicines').put({id,name:stress?'Очень длинное название препарата с подробным составом и дополнением '+i:i===0?'Препарат А':'Препарат Б',dose:'',left:i===0?6:8,leftAt:now,expires:new Date('2027-10-15').getTime(),stockUnit:'piece',doseUnit:'piece',form:stress?'Таблетки с длительным описанием формы выпуска':'Таблетки',maker:stress?'Производитель с очень длинным полным наименованием':'',packSize:20,updatedAt:now})
      tx.objectStore('regimens').put({id:'r-'+id,medicineId:id,person:'p1',times:['08:00'],perTime:1,since:now-86400000,startedAt:now,endsAt:now+5*86400000,meal:'before',mealMinutes:20,...(i>0?{stoppedAt:now-86400000}:{}),updatedAt:now})
    }
    await new Promise((r,j)=>{tx.oncomplete=r;tx.onerror=()=>j(tx.error)});db.close()
  },{profile,now,stress})
  await page.reload();await page.locator('nav.tabs').waitFor();await page.evaluate(()=>document.fonts.ready)
}
async function searchGeometry(page) {
 for(const input of await page.locator('.cabinet__search input,.concept-search input').all()){
  assert.ok(await input.evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),icon=e.parentElement.querySelector('svg').getBoundingClientRect();return r.left+parseFloat(s.paddingLeft)>=icon.right+4}),'Search text starts after the icon')
  await input.fill('Препарат');await input.fill('')
 }
}
async function snap(page, prefix, name) { await page.evaluate(()=>scrollTo(0,0)); await page.screenshot({path:`${out}/${prefix}-${name}.png`,fullPage:false}) }
try {
 for(const profile of profiles){
  const prefix=`${profile.style}-${profile.theme}-${profile.width}-${profile.scale}`
  const context=await browser.newContext({viewport:{width:profile.width,height:844},hasTouch:profile.touch,locale:'ru-RU',timezoneId:'Europe/Moscow',reducedMotion:'reduce',colorScheme:profile.theme})
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>{results.errors.push({profile,error:String(e)});console.log('PAGEERROR',String(e))})
  try{
   await page.clock.install({time:new Date(now)})
   await page.goto(process.env.URL||'http://localhost:5199');await settleAny(page);await seed(page,now);await storage(page,profile)
   await goConceptRoute(page,'overview')
   const geometry=await page.locator('li.dose').filter({has:page.locator('[data-dose-action=mark]')}).first().evaluate(row=>{
    const body=row.querySelector('.dose__body').getBoundingClientRect(),button=row.querySelector('[data-dose-action=mark]').getBoundingClientRect()
    return{bodyWidth:body.width,overlap:Math.max(0,Math.min(body.right,button.right)-Math.max(body.left,button.left))*Math.max(0,Math.min(body.bottom,button.bottom)-Math.max(body.top,button.top))}
   })
   assert.ok(geometry.bodyWidth>=100,JSON.stringify(geometry));assert.equal(geometry.overlap,0)
   const firstMark=page.locator('[data-dose-action=mark]').first();await firstMark.scrollIntoViewIfNeeded()
   assert.equal(await firstMark.evaluate(b=>{const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))}),true)
   const shortcuts=await page.locator('.modern-quick-actions').boundingBox(),plan=await page.locator('.concept-intake .intake--concept').first().boundingBox();assert.ok(shortcuts.y>=plan.y+plan.height-1)
   if(profile.style==='clear')assert.equal(await page.locator('.intake--focus').count(),1)
   if(profile.style==='rhythm'){assert.ok(await page.locator('.dose__symbol').count()>0);if(profile.theme==='light')assert.equal(await page.locator('.concept-header .filterbtn svg').evaluate(e=>getComputedStyle(e).color),'rgb(255, 255, 255)','Person chevron stays readable on blue/navy header')}
   if(profile.width>=900)assert.equal(await page.locator('.app').evaluate(e=>getComputedStyle(e).getPropertyValue('--bottom-tabs-height').trim()),'0px')
   await searchGeometry(page)
   if(profile.style==='clear'&&profile.width===1280)assert.ok((await page.locator('.concept-stock-preview').boundingBox()).y<700,'Desktop Clear stock follows the compact plan within the first viewport')
   const heading=page.locator('.concept-page-heading h1');if(await heading.count())assert.ok(await heading.evaluate(e=>e.getBoundingClientRect().height<parseFloat(getComputedStyle(e).lineHeight)*1.5),'Single word title does not break across lines')
   if(profile.style==='clear'){const day=await page.locator('.concept-day-link').boundingBox();assert.ok(day.y<shortcuts.y)}
   await snap(page,prefix,'today')
   await goConceptRoute(page,'cabinet')
   await page.getByRole('searchbox',{name:'Найти в аптечке'}).waitFor()
   assert.equal(await page.locator('.stock-row').count(),2)
   assert.match(await page.locator('.stock-row').first().innerText(),/На курс нужно\s*6/)
   assert.match(await page.locator('.stock-row').first().innerText(),/Хватит до конца курса/)
   assert.match(await page.locator('.stock-row').nth(1).innerText(),/Курс завершён/)
   await searchGeometry(page)
   assert.deepEqual(await page.locator('.stock-row__open').evaluateAll(rows=>rows.flatMap(row=>{const a=row.querySelector('.stock-row__icon').getBoundingClientRect(),b=row.querySelector('.stock-row__content').getBoundingClientRect();return a.right>b.left?[{icon:a.right,text:b.left}]:[]})),[],'Stock icon never overlaps medicine text')
   await snap(page,prefix,'cabinet')
   if(profile.width===390 && profile.theme==='light'){
    await page.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('omron-bp');q.onsuccess=()=>r(q.result)});const tx=db.transaction('regimens','readwrite'),st=tx.objectStore('regimens');const q=st.get('r-reference-0');q.onsuccess=()=>st.put({...q.result,times:['08:00','10:00']});await new Promise(r=>tx.oncomplete=r);db.close()})
    await page.reload();await page.locator('nav.tabs').waitFor();await goConceptRoute(page,'overview')
    if(profile.style==='clear'){assert.match(await page.locator('.intake--focus .intake__meal h3').innerText(),/08:00/);assert.deepEqual(await page.locator('.concept-rest-day .dose__time').allTextContents(),['10:00'],'Later same-meal dose keeps its actual time in the rest of the day')}
    await page.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('omron-bp');q.onsuccess=()=>r(q.result)});const tx=db.transaction('meta','readwrite'),st=tx.objectStore('meta');const q=st.get('settings');q.onsuccess=()=>st.put({...q.result,sections:{...q.result.sections,intake:false}},'settings');await new Promise(r=>tx.oncomplete=r);db.close()})
    await page.reload();await page.locator('nav.tabs').waitFor();await goConceptRoute(page,'overview');assert.equal(await page.locator('.modern-quick-actions').count(),1,'Measurements remain accessible when the medicine plan is hidden')
   }
   await storage(page,profile,true);await goConceptRoute(page,'overview');await page.getByRole('button',{name:'Добавить приём',exact:true}).click()
   const rows=page.locator('.course-medicine-results .sheet__row');await rows.first().waitFor()
   const bad=await rows.evaluateAll(rows=>rows.flatMap(row=>{const box=row.getBoundingClientRect(),text=row.querySelector('.sheet__name').getBoundingClientRect();return text.top<box.top-1||text.bottom>box.bottom+1||text.right>box.right+1?[{button:{top:box.top,bottom:box.bottom},text:{top:text.top,bottom:text.bottom}}]:[]}))
   assert.deepEqual(bad,[],'Picker text remains inside its own actual clickable row')
   await snap(page,prefix,'picker')
   await rows.first().click()
   await page.getByRole('button',{name:/Утром.*08:00/}).click()
   await page.evaluate(()=>scrollTo(0,900))
   const action=page.locator('.form-actions--top button').first();await action.scrollIntoViewIfNeeded()
   assert.equal(await action.evaluate(b=>{const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))}),true)
   await page.getByRole('button',{name:'Проверить назначение',exact:true}).click();await page.getByRole('form',{name:'Проверка курса'}).waitFor()
   assert.equal(await page.evaluate(()=>scrollY),0)
   await page.getByRole('button',{name:'Отмена',exact:true}).click();await page.locator('.app[data-nav=overview]').waitFor()
   await page.getByRole('button',{name:'Настройки',exact:true}).first().click()
   await page.locator('.pill__open').filter({hasText:'Текст и оформление'}).click()
   const previews=await page.locator('.appearance-choice').evaluateAll(cards=>cards.map(card=>{const p=card.querySelector('.appearance-preview').getBoundingClientRect(),t=card.querySelector('.appearance-preview__title').getBoundingClientRect(),name=card.querySelector('strong').getBoundingClientRect();return{contained:t.right<=p.right+1,overlap:Math.max(0,Math.min(t.right,name.right)-Math.max(t.left,name.left))*Math.max(0,Math.min(t.bottom,name.bottom)-Math.max(t.top,name.top))}}))
   assert.ok(previews.every(p=>p.contained&&p.overlap===0),JSON.stringify(previews))
   await snap(page,prefix,'appearance')
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
   results.checks.push({...profile,geometry,pickerRows:await rows.count().catch(()=>0),previews})
  }catch(error){results.failures.push({profile,error:String(error),nav:await page.locator('.app').getAttribute('data-nav').catch(()=>null)});await page.screenshot({path:`${out}/FAIL-${prefix}.png`,fullPage:false}).catch(()=>{});console.log('FAIL',prefix,String(error))}
  finally{await context.close()}
 }
}finally{await browser.close()}
writeFileSync(`${out}/result.json`,JSON.stringify(results,null,2)+'\n');console.log({profiles:results.checks.length,failures:results.failures.length,errors:results.errors.length});process.exitCode=results.failures.length||results.errors.length?1:0
