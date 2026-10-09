/** Real App, disposable family and touch input. No production data/cloud. */
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { FROZEN, seed, settleAny, settle } from '../tools/visual.mjs'
const out = 'reviews/evidence/course-repeat'; mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const checks = [], errors = []
const day = offset => { const d = new Date(FROZEN); d.setDate(d.getDate() + offset); d.setHours(0,0,0,0); return +d }
const date = at => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
async function read(page) { return page.evaluate(async () => {
 const db = await new Promise(resolve => { const r = indexedDB.open('omron-bp'); r.onsuccess = () => resolve(r.result) })
 const all = store => new Promise(resolve => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result) })
 const result = { regimens: await all('regimens'), medicines: await all('medicines') }; db.close(); return result
}) }
try {
 for (const style of ['classic', 'modern']) {
  const scale = style === 'classic' ? 'normal' : 'xlarge'
  const context = await browser.newContext({ viewport: { width:360,height:800 }, hasTouch:true, locale:'ru-RU', timezoneId:'Europe/Moscow' })
  const page = await context.newPage(); page.setDefaultTimeout(7000); page.on('pageerror', e => errors.push(e.message))
  await page.route('https://api.github.com/**', r => r.fulfill({ contentType:'application/json',body:'[]' }))
  await page.clock.install({ time: new Date(FROZEN) }); await page.goto('http://localhost:5199'); await settleAny(page); await seed(page,FROZEN)
  await page.evaluate(async ({ now, start, end, scale, style }) => {
   const db = await new Promise(resolve => { const r=indexedDB.open('omron-bp'); r.onsuccess=()=>resolve(r.result) })
   const old = await new Promise(resolve => { const r=db.transaction('meta').objectStore('meta').get('settings'); r.onsuccess=()=>resolve(r.result) })
   await new Promise((resolve,reject) => {
    const tx = db.transaction(['medicines','regimens','meta'],'readwrite'); tx.objectStore('medicines').clear(); tx.objectStore('regimens').clear()
    for(const id of ['stopped','expired','staged']) tx.objectStore('medicines').put({ id,name:{stopped:'Прекращённый',expired:'Законченный',staged:'По этапам'}[id],dose:'',left:100,leftAt:now,expires:null,stockUnit:'piece' })
    const common = { person:'p2', since:start, startedAt:start, planFrom:start, times:['08:00','20:00'], perTime:1, meal:'before',mealMinutes:20,autoDeduct:true,taken:[start+8*3600000] }
    tx.objectStore('regimens').put({ ...common,id:'stopped',medicineId:'stopped',stoppedAt:end })
    tx.objectStore('regimens').put({ ...common,id:'expired',medicineId:'expired',endsAt:end })
    tx.objectStore('regimens').put({ ...common,id:'staged',medicineId:'staged',plan:[{days:2,perTime:2,times:['08:00','20:00']},{days:3,perTime:1,times:['08:00']}],rhythm:{onDays:2,offDays:1,from:start} })
    tx.objectStore('meta').put({ ...old,interfaceStyle:style,textScale:scale,guideOffered:true,people:[{id:'p1',name:'Анна',deviceUser:1},{id:'p2',name:'Борис',deviceUser:2}],activePerson:'p1' },'settings')
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)
   }); db.close()
  },{now:FROZEN,start:day(-9),end:day(-5),scale,style})
  await page.reload(); await settle(page)
  const open = async name => {
   await page.getByRole('button',{name:'Аптечка',exact:true}).click()
   await page.getByRole('group',{name:'Разделы аптечки'}).getByRole('button',{name:/^Курсы/}).click()
   let target=page.locator('.pill__open').filter({has:page.getByText(name,{exact:true})})
   if(name==='Прекращённый') target=target.filter({hasText:'Приём прекращён'})
   await target.click()
  }
  const save = () => page.getByRole('button',{name:/^Сохранить(?: правки)?$/}).click()
  const cancel = () => page.getByRole('button',{name:'Отмена',exact:true}).click()
  const snapshot = await read(page)
  await open('Прекращённый')
  await page.getByRole('group',{name:'Срок курса'}).getByRole('button',{name:'Ограничен',exact:true}).click()
  assert(await page.getByLabel('Курс, дней',{exact:true}).isVisible(),'Stopped course must display duration')
  await page.getByLabel('Курс, дней',{exact:true}).fill('10')
  await page.getByRole('group',{name:'Срок курса'}).scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/${style}-${scale}-stopped-duration.png`})
  await save(); await page.getByRole('button',{name:'Завести курс приёма',exact:true}).waitFor()
  let state=await read(page); const archived=state.regimens.find(r=>r.id==='stopped')
  assert.equal(archived.stoppedAt,day(-5)); assert.deepEqual(archived.taken,snapshot.regimens.find(r=>r.id==='stopped').taken)
  await open('Прекращённый'); await page.getByRole('button',{name:'Повторить курс',exact:true}).click()
  await page.getByRole('heading',{name:'Повтор курса',exact:true}).waitFor()
  assert.equal(await page.getByLabel('Принимаю с',{exact:true}).inputValue(),date(day(0)))
  assert.equal(await page.getByLabel('Курс, дней',{exact:true}).inputValue(),'10')
  assert.equal(await page.getByRole('group',{name:'Кто принимает'}).getByRole('button',{name:'Борис',exact:true}).getAttribute('aria-pressed'),'true')
  assert.equal(await page.getByRole('group',{name:'Условия приёма'}).getByRole('button',{name:'До еды',exact:true}).getAttribute('aria-pressed'),'true')
  assert.equal(await page.getByLabel('За сколько минут до еды',{exact:true}).inputValue(),'20')
  const beforeCancel=await read(page); await cancel(); assert.deepEqual(await read(page),beforeCancel,'Cancel must not write')
  await page.getByRole('button',{name:'Статус курса: Все',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Завершённые',exact:true}).click()
  await open('Прекращённый'); await page.getByRole('button',{name:'Повторить курс',exact:true}).click()
  await page.getByLabel('Курс, дней',{exact:true}).fill(''); await save()
  await page.getByText('Укажите срок курса: целое число дней от 1 до 365.',{exact:true}).waitFor(); assert.deepEqual(await read(page),beforeCancel)
  await page.getByLabel('Курс, дней',{exact:true}).fill('5.5'); await save(); assert.deepEqual(await read(page),beforeCancel)
  await page.getByLabel('Курс, дней',{exact:true}).fill('5'); await page.getByLabel('Принимаю с',{exact:true}).fill(''); await save(); assert.deepEqual(await read(page),beforeCancel)
  await page.getByLabel('Принимаю с',{exact:true}).fill(date(day(10)))
  assert(await page.getByText(new RegExp('Последний день —')).isVisible())
  await page.evaluate(()=>scrollTo(0,0))
  const touch=await page.evaluate(()=>({coarse:matchMedia('(pointer:coarse)').matches,points:navigator.maxTouchPoints}))
  await page.screenshot({path:`${out}/${style}-${scale}-repeat.png`})
  await page.getByLabel('Принимаю с',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/${style}-${scale}-repeat-duration.png`})
  assert.deepEqual(await page.evaluate(()=>({coarse:matchMedia('(pointer:coarse)').matches,points:navigator.maxTouchPoints})),touch)
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  await save(); await page.getByRole('button',{name:'Завести курс приёма',exact:true}).waitFor()
  assert(await page.getByRole('button',{name:'Статус курса: Все',exact:true}).isVisible(),'Saved repeat is visible outside finished filter')
  state=await read(page); assert.equal(state.regimens.length,4)
  const fresh=state.regimens.find(r=>!['stopped','expired','staged'].includes(r.id))
  assert.equal(fresh.planFrom,day(10)); assert.equal(fresh.endsAt,day(14)); assert.equal(fresh.person,'p2'); assert.equal(fresh.mealMinutes,20)
  for(const key of ['stoppedAt','history','historyState','intakeState','taken','untaken','foldedUntil']) assert.equal(fresh[key],undefined,key)
  assert.deepEqual(state.regimens.find(r=>r.id==='stopped'),archived); assert.deepEqual(state.medicines,snapshot.medicines)
  await open('Законченный'); await page.getByRole('group',{name:'Срок курса'}).getByRole('button',{name:'Бессрочно',exact:true}).click(); await save()
  await page.getByText(/Этот курс уже завершён/).waitFor(); assert.equal((await read(page)).regimens.find(r=>r.id==='expired').endsAt,day(-5))
  await page.getByRole('button',{name:'Повторить курс',exact:true}).click()
  assert.equal(await page.getByText(/Этот курс уже завершён/).count(),0,'Repeat clears previous form error')
  assert.equal(await page.getByLabel('Курс, дней',{exact:true}).inputValue(),'5'); await cancel()
  await open('По этапам'); await page.getByLabel('дней',{exact:true}).first().fill('4');await save()
  await page.getByText(/Этот курс уже завершён/).waitFor();assert.deepEqual((await read(page)).regimens.find(r=>r.id==='staged'),snapshot.regimens.find(r=>r.id==='staged'),'Stage-only historical end cannot expand across pause')
  await page.getByRole('button',{name:'Повторить курс',exact:true}).click()
  assert.equal(await page.getByLabel('Первый день первого этапа',{exact:true}).inputValue(),date(day(0)))
  await page.getByLabel('Первый день первого этапа',{exact:true}).fill('');await save();await page.getByText(/Проверьте дату начала/).waitFor()
  await page.getByLabel('Первый день первого этапа',{exact:true}).fill(date(day(2)))
  await save(); await page.getByRole('button',{name:'Завести курс приёма',exact:true}).waitFor()
  state=await read(page); const staged=state.regimens.find(r=>r.id!=='staged'&&r.medicineId==='staged')
  assert.equal(staged.endsAt,day(6)); assert.equal(staged.rhythm.from,day(2)); assert.equal(staged.plan[0].times.length,2); assert.equal(staged.plan[1].times.length,1)
  assert.deepEqual(state.regimens.find(r=>r.id==='staged'),snapshot.regimens.find(r=>r.id==='staged'))
  // Legacy long-term treatment must remain editable without shortening history.
  await page.evaluate(async ({start,end,stop}) => {
   const db=await new Promise(resolve=>{const r=indexedDB.open('omron-bp');r.onsuccess=()=>resolve(r.result)})
   const old=await new Promise(resolve=>{const r=db.transaction('regimens').objectStore('regimens').get('stopped');r.onsuccess=()=>resolve(r.result)})
   await new Promise(resolve=>{const tx=db.transaction('regimens','readwrite');tx.objectStore('regimens').put({...old,startedAt:start,planFrom:start,since:start,endsAt:end,stoppedAt:stop});tx.oncomplete=resolve});db.close()
  },{start:new Date(2024,0,1).getTime(),end:day(20),stop:day(-1)})
  await page.reload();await settle(page);await open('Прекращённый')
  assert(Number(await page.getByLabel('Курс, дней',{exact:true}).inputValue())>365)
  await save();await page.getByRole('button',{name:'Завести курс приёма',exact:true}).waitFor()
  assert.equal((await read(page)).regimens.find(r=>r.id==='stopped').endsAt,day(20))
  await open('Прекращённый');await page.getByRole('button',{name:'Повторить курс',exact:true}).click()
  assert.equal(await page.getByLabel('Курс, дней',{exact:true}).inputValue(),'','Repeat long legacy treatment requires an explicit length')
  await save();await page.getByText('Укажите срок курса: целое число дней от 1 до 365.',{exact:true}).waitFor();await cancel()
  checks.push({style,scale,stoppedDuration:true,cancelNoWrite:true,invalidDurationBlocked:true,emptyDateSafe:true,futureStart:true,oldHistoryPreserved:true,stockUntouched:true,expiredNotResurrected:true,stagesAndRhythm:true,longHistoryEditable:true})
  console.log('ok',style,scale); await context.close()
 }
 assert.deepEqual(errors,[]); writeFileSync(`${out}/checks.json`,JSON.stringify({checks,errors},null,2)+'\n')
}finally{await browser.close()}
