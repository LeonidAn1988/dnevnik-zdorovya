import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { FROZEN, seed, settleAny, settle, goConceptRoute } from '../tools/visual.mjs'

const out='reviews/evidence/three-styles'
mkdirSync(out,{recursive:true})
const browser=await chromium.launch()
const results={checks:[],errors:[],failures:[]}
async function data(page,patch) {
  return page.evaluate(async patch=>{
    const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('omron-bp');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)})
    const read=(store,key)=>new Promise(resolve=>{const q=key?db.transaction(store).objectStore(store).get(key):db.transaction(store).objectStore(store).getAll();q.onsuccess=()=>resolve(q.result)})
    if(patch) {
      const settings=await read('meta','settings'),tx=db.transaction('meta','readwrite')
      tx.objectStore('meta').put({...settings,...patch},'settings')
      await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})
    }
    const value={settings:await read('meta','settings')}
    for(const store of ['readings','medicines','regimens','labs'])value[store]=await read(store)
    db.close();return value
  },patch)
}
async function display(page) {
  await page.getByRole('button',{name:'Настройки',exact:true}).first().click()
  await page.locator('.pill__open').filter({hasText:'Текст и оформление'}).click()
}
async function apply(page,style) {
  const title={journal:'Живой дневник',rhythm:'Ритм',clear:'Ясно'}[style]
  await page.locator('.appearance-choice').filter({hasText:title}).click()
  await page.getByRole('button',{name:'Применить оформление',exact:true}).click()
  await page.waitForFunction(style=>document.documentElement.dataset.interface===style,style)
}
async function backTwice(page) {
  await page.getByRole('button',{name:'Назад',exact:true}).first().click()
  await page.getByRole('button',{name:'Назад',exact:true}).first().click()
}
async function fillNumber(page,label,value) {
  const field=page.getByRole('textbox',{name:new RegExp('^'+label)})
  if(await field.count())await field.fill(value)
  else await page.locator('.wheel').filter({has:page.getByRole('spinbutton',{name:label,exact:true})}).locator('.wheel__item').filter({hasText:new RegExp('^'+value+'$')}).click()
}
try {
  for(const style of ['journal','rhythm','clear'])for(const stress of [false,true]) for(const theme of ['light','dark']) {
    if(process.env.STYLE&&process.env.STYLE!==style)continue
    if(process.env.THEME&&process.env.THEME!==theme)continue
    if(process.env.SCALE&&process.env.SCALE!==(stress?'xlarge':'normal'))continue
    const profile={style,width:stress?320:390,scale:stress?'xlarge':'normal',theme}
    const context=await browser.newContext({viewport:{width:profile.width,height:844},hasTouch:true,locale:'ru-RU',colorScheme:profile.theme})
    const page=await context.newPage();page.setDefaultTimeout(8000)
    page.on('pageerror',error=>results.errors.push({profile,error:String(error)}))
    try {
      await page.clock.install({time:new Date(FROZEN)})
      await page.goto('http://localhost:5199');await settleAny(page);await seed(page,FROZEN)
      await data(page,{interfaceStyle:style,theme:profile.theme,textScale:profile.scale,density:stress?'roomy':'normal',guideOffered:true,people:[{id:'p1',name:'Тестовый пользователь',deviceUser:1},{id:'p2',name:'Тестовый родственник',deviceUser:2}]})
      await page.evaluate(async now=>{
        const db=await new Promise(resolve=>{const q=indexedDB.open('omron-bp');q.onsuccess=()=>resolve(q.result)})
        const tx=db.transaction(['medicines','regimens'],'readwrite')
        for(const [id,time,meal,mealMinutes] of [['a','08:00','before',20],['b','08:00',undefined,undefined],['later','11:00',undefined,undefined]]){
          tx.objectStore('medicines').put({id:'appearance-'+id,name:'Проверка '+id,dose:'',inn:'',maker:'Тестовый завод',form:'Таблетки',kind:0,packSize:20,perDay:null,stockUnit:'piece',doseUnit:'piece',left:20,expires:null})
          tx.objectStore('regimens').put({id:'appearance-'+id,medicineId:'appearance-'+id,person:'p1',times:[time],perTime:1,since:new Date(now).setHours(0,0,0,0),meal,mealMinutes})
        }
        await new Promise(resolve=>{tx.oncomplete=resolve});db.close()
      },FROZEN)
      await page.reload();await settle(page)
      // Startup folds legacy intake history asynchronously after navigation
      // appears. Compare the stable diary, not its pre-migration fixture.
      await page.waitForFunction(async()=>{
        const db=await new Promise(resolve=>{const q=indexedDB.open('omron-bp');q.onsuccess=()=>resolve(q.result)})
        const items=await new Promise(resolve=>{const q=db.transaction('regimens').objectStore('regimens').getAll();q.onsuccess=()=>resolve(q.result)})
        db.close();return items.every(r=>r.legacySchedule||r.scheduleUpdatedAt!==undefined)
      })
      await page.getByRole('button',{name:'Чей дневник: Тестовый пользователь',exact:true}).click()
      await page.getByRole('dialog',{name:'Чей дневник',exact:true}).getByRole('button',{name:/Тестовый родственник/}).click()
      assert.equal((await data(page)).settings.activePerson,'p2')
      await page.getByRole('button',{name:'Чей дневник: Тестовый родственник',exact:true}).click()
      await page.getByRole('dialog',{name:'Чей дневник',exact:true}).getByRole('button',{name:'Тестовый пользователь',exact:true}).click()
      assert.equal((await data(page)).settings.activePerson,'p1')
      const baseline=await data(page)
      await display(page)
      const other=style==='journal'?'rhythm':'journal'
      await page.locator('.appearance-choice').filter({hasText:other==='journal'?'Живой дневник':'Ритм'}).click()
      assert.equal((await data(page)).settings.interfaceStyle,style,'Preview does not save')
      await page.getByRole('button',{name:'Отменить просмотр'}).click()
      assert.equal((await data(page)).settings.interfaceStyle,style)
      await apply(page,other)
      const changed=await data(page)
      for(const key of ['readings','medicines','regimens','labs'])assert.deepEqual(changed[key],baseline[key])
      for(const key of ['textScale','density','activePerson','theme','remindersOn'])assert.deepEqual(changed.settings[key],baseline.settings[key])
      results.checks.push({...profile,check:'preview/cancel/apply preserve medical data and independent settings'})
      await backTwice(page)
      await goConceptRoute(page,'cabinet')
      await page.getByRole('group',{name:'Разделы аптечки'}).getByRole('button',{name:/Курсы/}).click()
      await page.getByRole('button',{name:'Завести курс приёма',exact:true}).click()
      await page.getByRole('searchbox',{name:'Найти препарат в аптечке'}).fill('Конкор')
      await page.locator('.course-medicine-results button').filter({hasText:'Конкор'}).first().click()
      await page.getByLabel('Принимаю с',{exact:true}).fill('2026-08-20')
      const path=await page.locator('.app').getAttribute('data-nav')
      await display(page);await apply(page,style);await backTwice(page)
      assert.equal(await page.locator('.app').getAttribute('data-nav'),path,'Return to the same course node')
      assert.equal(await page.getByLabel('Принимаю с',{exact:true}).inputValue(),'2026-08-20')
      assert.ok((await page.locator('.course-medicine-name').innerText()).includes('Конкор'))
      assert.equal((await data(page)).regimens.length,baseline.regimens.length,'Draft does not save itself')
      results.checks.push({...profile,check:'course draft survives the real settings route and style change'})
      await page.getByRole('button',{name:'Отмена',exact:true}).click()
      await goConceptRoute(page,'labs')
      await page.getByRole('button',{name:'Добавить анализ',exact:true}).click()
      await page.getByLabel('Что сдаём').fill('Тестовый анализ оформления')
      await page.getByLabel('Единица измерения — не обязательно').fill('ед.')
      await display(page);await apply(page,other);await backTwice(page)
      assert.equal(await page.getByLabel('Что сдаём').inputValue(),'Тестовый анализ оформления')
      assert.equal(await page.getByLabel('Единица измерения — не обязательно').inputValue(),'ед.')
      assert.equal((await data(page)).labs.length,baseline.labs.length)
      await page.getByRole('button',{name:'Отмена',exact:true}).click()
      await page.getByRole('button',{name:'Добавить анализ',exact:true}).click()
      assert.equal(await page.getByLabel('Что сдаём').inputValue(),'','Cancel clears the draft')
      await page.getByRole('button',{name:'Отмена',exact:true}).click()
      results.checks.push({...profile,check:'lab draft survives settings; explicit Cancel clears it'})
      await display(page);await apply(page,style);await backTwice(page)
      await goConceptRoute(page,'overview')
      const dose=page.locator('li.dose').filter({has:page.getByText('Проверка a',{exact:true})})
      await dose.getByRole('button',{name:'Принял',exact:true}).evaluate(button=>{button.click();button.click()})
      await dose.getByRole('button',{name:'убрать отметку',exact:true}).waitFor()
      let marked=await data(page)
      assert.equal(marked.regimens.find(r=>r.id==='appearance-a').taken.length,1)
      assert.equal(marked.medicines.find(m=>m.id==='appearance-a').left,19,'Double tap deducts once')
      assert.equal(marked.regimens.find(r=>r.id==='appearance-a').person,'p1')
      assert.equal(marked.settings.mealTimers.filter(t=>t.regimenId==='appearance-a'&&!t.cancelledAt).length,1)
      await dose.getByRole('button',{name:'Отменить таймер',exact:true}).click()
      const plain=page.locator('li.dose').filter({has:page.getByText('Проверка b',{exact:true})})
      await plain.getByRole('button',{name:'Принял',exact:true}).focus()
      await page.keyboard.press('Enter')
      await plain.getByRole('button',{name:'убрать отметку',exact:true}).waitFor()
      await page.waitForFunction(()=>document.activeElement?.classList.contains('dose__undo'))
      await plain.getByRole('button',{name:'убрать отметку',exact:true}).click()
      await dose.getByRole('button',{name:'убрать отметку',exact:true}).click()
      await dose.getByRole('button',{name:'Принял',exact:true}).waitFor()
      marked=await data(page)
      assert.equal(marked.regimens.find(r=>r.id==='appearance-a').taken.length,0)
      assert.equal(marked.settings.mealTimers.filter(t=>t.regimenId==='appearance-a'&&!t.cancelledAt).length,0)
      results.checks.push({...profile,check:'simultaneous dose group: double tap, correct owner, meal timer and Undo'})
      await goConceptRoute(page,'intake')
      assert.equal(await page.locator('.concept-rest-day:not([open])').count(),0,'Full day does not conceal a group')
      if(stress){
        await page.locator('.concept-navigation__sections').click()
        await page.keyboard.press('Escape')
        await page.locator('.concept-sections').waitFor({state:'detached'})
        await page.locator('.concept-navigation__sections').click()
        await page.locator('.concept-sections').getByRole('button',{name:'Закрыть',exact:true}).click()
      }
      await goConceptRoute(page,'bp')
      await fillNumber(page,'Верхнее','128');await fillNumber(page,'Нижнее','78')
      await page.locator('[data-tour=bp-entry]').getByRole('button',{name:'Добавить',exact:true}).click()
      await page.waitForFunction(async count=>{
        const db=await new Promise(resolve=>{const q=indexedDB.open('omron-bp');q.onsuccess=()=>resolve(q.result)})
        const size=await new Promise(resolve=>{const q=db.transaction('readings').objectStore('readings').count();q.onsuccess=()=>resolve(q.result)})
        db.close();return size===count+1
      },baseline.readings.length)
      const saved=await data(page)
      assert.equal(saved.readings.length,baseline.readings.length+1)
      assert.ok(saved.readings.some(r=>r.sys===128&&r.dia===78&&r.source==='manual'&&r.person==='p1'))
      results.checks.push({...profile,check:'touch measurement saved at the stress text size'})
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow')
      await page.screenshot({path:out+'/flow-'+style+'-'+profile.scale+'-'+theme+'.png'})
      await page.reload();await settle(page)
      assert.equal((await data(page)).settings.interfaceStyle,style)
      assert.equal((await data(page)).readings.length,saved.readings.length)
      results.checks.push({...profile,check:'reload keeps the selected appearance and saved measurement'})
    } catch(error) {
      results.failures.push({profile,error:String(error),nav:await page.locator('.app').getAttribute('data-nav').catch(()=>null),overflow:await page.evaluate(()=>({width:innerWidth,content:document.documentElement.scrollWidth,items:[...document.querySelectorAll('body *')].filter(el=>{const r=el.getBoundingClientRect();return !el.closest('.wheel,.daystrip')&&r.width>0&&(r.right>innerWidth+1||r.left< -1)}).map(el=>({tag:el.tagName,classes:el.className,text:el.textContent?.slice(0,150),bounds:JSON.stringify(el.getBoundingClientRect())})).slice(0,30)}))})
      writeFileSync(out+'/flows-in-progress.json',JSON.stringify(results,null,2))
      await page.screenshot({path:out+'/FAIL-flow-'+style+'-'+profile.scale+'-'+theme+'.png'}).catch(()=>{})
      console.log('FAIL',profile,String(error).split('\n')[0])
    } finally {await context.close()}
  }
} finally {await browser.close()}
writeFileSync(out+'/flows.json',JSON.stringify(results,null,2))
console.log({checks:results.checks.length,failures:results.failures.length,errors:results.errors.length})
process.exitCode=results.failures.length||results.errors.length?1:0
