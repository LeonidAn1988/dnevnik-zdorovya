/** Synthetic destructive journeys ONLY for an independently installed audit package.
 * No launch/connect/ADB, no actual phone execution in this module.
 * Caller: await runFlows(realWebViewPage,{auditPackage,capture:async name=>...,results}).
 * results.checks/failures/skipped are appended; each case resets synthetic stores.
 */
import assert from 'node:assert/strict'
import { seed, settleAny, go, goConceptRoute } from './visual.mjs'

const PRODUCTION = 'io.github.leonidan1988.omronbp'
async function identity(page, auditPackage) {
  assert.ok(auditPackage && auditPackage !== PRODUCTION && /audit/i.test(auditPackage), 'Explicit isolated audit package required')
  const info = await page.evaluate(async () => {
    if (!window.Capacitor?.isNativePlatform?.()) throw Error('Real native WebView required')
    return window.Capacitor.nativePromise('App', 'getInfo', {})
  })
  assert.equal(info.id, auditPackage, 'Refusing seed: native package identity mismatch')
}
async function read(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const q=indexedDB.open('omron-bp');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error) })
    const get=(store,key)=>new Promise((resolve,reject)=>{const s=db.transaction(store).objectStore(store),q=key?s.get(key):s.getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)})
    const out={settings:await get('meta','settings'),measurements:await get('readings'),medicines:await get('medicines'),regimens:await get('regimens'),labs:await get('labs')};db.close();return out
  })
}
async function until(page,predicate,message) {
  for(let i=0;i<80;i++){const data=await read(page);if(predicate(data))return data;await page.waitForTimeout(100)}
  throw Error(message)
}
async function setup(page,auditPackage,{style='journal',meal,ended=false,course=false}={}) {
  await identity(page,auditPackage);await seed(page,Date.now())
  await page.evaluate(async ({style,meal,ended,course})=>{
    const now=Date.now(),day=new Date(now);day.setHours(0,0,0,0)
    const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('omron-bp');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)})
    const tx=db.transaction(['meta','medicines','regimens','readings','labs'],'readwrite')
    for(const s of ['medicines','regimens','readings','labs'])tx.objectStore(s).clear()
    tx.objectStore('meta').put({onboarded:true,guideOffered:true,interfaceStyle:style,theme:'light',textScale:'normal',density:'normal',trackGlucose:true,startTab:'overview',people:[{id:'p1',name:'Тест Анна',deviceUser:1},{id:'p2',name:'Тест Борис'}],activePerson:'p1',identityConfirmed:true,remindersOn:false,measureRemindOn:false,reminderPeople:[],mealTimers:[],glucoseTimers:[],notificationHistory:[]},'settings')
    tx.objectStore('medicines').put({id:'audit-med',name:'Тестовый препарат',dose:'',form:'Таблетки',stockUnit:'piece',doseUnit:'piece',left:30,leftAt:now,stockUpdatedAt:now,expires:null,perDay:null})
    if(course)tx.objectStore('regimens').put({id:'audit-course',medicineId:'audit-med',person:'p1',times:['00:00'],perTime:1,startedAt:+day-86400000,planFrom:+day-86400000,since:+day-86400000,updatedAt:now,scheduleUpdatedAt:now,bindingUpdatedAt:now,...(meal?{meal,mealMinutes:20}:{}),...(ended?{endsAt:+day-1}:{})})
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close()
  },{style,meal,ended,course})
  await page.reload({waitUntil:'domcontentloaded'});await settleAny(page);await page.locator('nav.concept-navigation').waitFor();await page.waitForTimeout(250)
}
async function number(page,label,value) {
  const input=page.getByRole('textbox',{name:new RegExp('^'+label)})
  if(await input.count())return input.first().fill(String(value))
  const spin=page.getByRole('spinbutton',{name:label,exact:true})
  const wheel=page.locator('.wheel').filter({has:spin})
  await wheel.locator('.wheel__item').filter({hasText:new RegExp('^'+String(value).replace('.','[.,]')+'$')}).click()
}
async function pick(page,label,name) {
  await page.getByRole('button',{name:new RegExp('^'+label)}).first().click()
  await page.locator('dialog[open]').getByRole('button',{name,exact:true}).click()
}
async function courseList(page) {
  await goConceptRoute(page,'cabinet')
  await page.getByRole('group',{name:'Разделы аптечки'}).getByRole('button',{name:/^Курсы/}).click()
}
async function newCourse(page) {
  await goConceptRoute(page,'overview');await page.getByRole('button',{name:'Добавить приём',exact:true}).click()
  await page.getByRole('searchbox',{name:'Найти препарат в аптечке'}).fill('Тестовый препарат')
  await page.locator('.course-medicine-results button').filter({hasText:'Тестовый препарат'}).click()
}
async function reviewSave(page) {
  await page.getByRole('button',{name:'Проверить назначение',exact:true}).click()
  await page.getByRole('form',{name:'Проверка курса',exact:true}).waitFor()
  await page.getByRole('button',{name:'Добавить в расписание',exact:true}).click()
}
async function doseRow(page) {
  await goConceptRoute(page,'intake')
  const expand=page.getByRole('button',{name:/^Показать весь день/})
  if(await expand.isVisible())await expand.click()
  const row=page.locator('li.dose').filter({hasText:'Тестовый препарат'}).first();await row.waitFor();return row
}

export async function runFlows(page,{auditPackage,capture,results={}}={}) {
  await identity(page,auditPackage)
  results.checks??=[];results.failures??=[];results.skipped??=[]
  page.setDefaultTimeout(9000)
  const execute=async(name,fixture,action)=>{
    if(process.env.FLOW && !name.match(process.env.FLOW))return
    const at=new Date().toISOString()
    try{await setup(page,auditPackage,fixture);const detail=await action();await capture?.(name);results.checks.push({name,at,native:true,detail});console.log('PASS',name)}
    catch(error){const failure={name,at,native:true,error:String(error.stack||error),nav:await page.locator('.app').getAttribute('data-nav').catch(()=>null)};results.failures.push(failure);await capture?.('FAIL-'+name).catch(()=>{});console.log('FAIL',name,String(error).split('\n')[0])}
  }
  await execute('01-bp-save-delete-undo',{},async()=>{
    await goConceptRoute(page,'bp');await number(page,'Верхнее','123');await number(page,'Нижнее','81');await number(page,'Пульс','72')
    await page.getByRole('button',{name:'Добавить',exact:true}).click();let d=await until(page,d=>d.measurements.length===1,'BP not saved');const record=d.measurements[0];assert.equal(record.sys,123);assert.equal(record.dia,81);assert.equal(record.person,'p1')
    await page.getByRole('button',{name:/^Изменить измерение от/}).click();await page.getByRole('button',{name:'Удалить запись',exact:true}).click();await until(page,d=>d.measurements.length===0,'BP not deleted');await page.getByRole('button',{name:'Вернуть',exact:true}).click();d=await until(page,d=>d.measurements.length===1,'BP undo failed');assert.equal(d.measurements[0].id,'restored:'+record.id);assert.deepEqual({...d.measurements[0],id:record.id,updatedAt:record.updatedAt},record);return{recordId:record.id,writeDeleteUndo:true}
  })
  await execute('02-glucose-save-delete-undo',{},async()=>{
    await goConceptRoute(page,'glucose');await number(page,'Сахар','5,4');await page.getByRole('button',{name:'Натощак',exact:true}).click();await page.getByRole('button',{name:/^Добавить$/,exact:true}).click()
    let d=await until(page,d=>d.measurements.length===1,'Glucose not saved');const record=d.measurements[0];assert.equal(record.mmol,5.4);assert.equal(record.context,'fasting');assert.equal(record.person,'p1')
    await page.getByRole('button',{name:/^Изменить замер от/}).click();await page.getByRole('button',{name:'Удалить запись',exact:true}).click();await until(page,d=>!d.measurements.length,'Glucose not deleted');await page.getByRole('button',{name:'Вернуть',exact:true}).click();d=await until(page,d=>d.measurements.length===1,'Glucose undo failed');assert.equal(d.measurements[0].id,'restored:'+record.id);assert.deepEqual({...d.measurements[0],id:record.id,updatedAt:record.updatedAt},record);return{writeDeleteUndo:true}
  })
  for(const style of ['journal','rhythm','clear']){
    await execute('03-course-existing-'+style,{style},async()=>{
      await newCourse(page);await page.getByRole('group',{name:'Кто принимает'}).getByRole('button',{name:'Тест Борис',exact:true}).click();await page.getByRole('button',{name:/Утро.*08:00/}).click()
      await page.getByRole('group',{name:'Срок курса',exact:true}).getByRole('button',{name:'Ограничен',exact:true}).click();await number(page,'Курс, дней','6')
      await page.getByRole('button',{name:'Проверить назначение',exact:true}).click();await page.getByRole('form',{name:'Проверка курса',exact:true}).waitFor();assert.equal((await read(page)).regimens.length,0);assert.match(await page.locator('.course-review').innerText(),/Тест Борис/)
      await page.getByRole('button',{name:'Добавить в расписание',exact:true}).click();const d=await until(page,d=>d.regimens.length===1,'Course not saved');assert.equal(d.regimens[0].person,'p2');assert.equal(d.regimens[0].medicineId,'audit-med');assert.equal(d.medicines.length,1);return{style,owner:'p2',reviewBeforeWrite:true}
    })
    await execute('04-course-nested-new-'+style,{style},async()=>{
      await goConceptRoute(page,'overview');await page.getByRole('button',{name:'Добавить приём',exact:true}).click();await page.getByRole('button',{name:'Добавить новый препарат',exact:true}).click()
      const dialog=page.getByRole('dialog',{name:'Новый препарат для курса',exact:true});const name='Синтетический аудит '+style
      await dialog.getByRole('combobox',{name:'Название или поиск препарата',exact:true}).fill(name);await dialog.getByRole('button',{name:'Продолжить с этим названием вручную',exact:true}).click();await dialog.getByRole('button',{name:'Добавить в аптечку',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal((await read(page)).regimens.length,0)
      await page.getByRole('button',{name:'По потребности',exact:true}).click();await page.getByRole('button',{name:'Проверить назначение',exact:true}).click();assert.match(await page.locator('.course-review').innerText(),/Плановых напоминаний не будет/);await page.getByRole('button',{name:'Сохранить приём',exact:true}).click()
      const d=await until(page,d=>d.regimens.length===1,'Nested course not saved');assert.equal(d.medicines.length,2);assert.equal(d.medicines.find(m=>m.id===d.regimens[0].medicineId)?.name,name);assert.equal(d.regimens[0].times,undefined);return{style,nestedMedicineAndAsNeeded:true}
    })
  }
  await execute('05-review-cancel-keeps-database',{},async()=>{
    await newCourse(page);await page.getByRole('button',{name:/Утро.*08:00/}).click();await page.getByRole('button',{name:'Проверить назначение',exact:true}).click();await page.getByRole('form',{name:'Проверка курса'}).waitFor();await page.getByRole('button',{name:'Отмена',exact:true}).click();assert.equal((await read(page)).regimens.length,0);assert.equal(await page.locator('.app').getAttribute('data-nav'),'overview');return{cancelled:true}
  })
  await execute('06-dose-mark-undo',{course:true},async()=>{
    let row=await doseRow(page);await row.locator('[data-dose-action=mark]').first().click();let d=await until(page,d=>d.regimens[0].taken?.length===1,'Dose not marked');const planned=d.regimens[0].taken[0];row=await doseRow(page);await row.getByRole('button',{name:'убрать отметку',exact:true}).click();d=await until(page,d=>!d.regimens[0].taken?.length,'Dose undo failed');assert.equal(d.regimens[0].intakeState[String(planned)].taken,false);return{markUndo:true}
  })
  await execute('07-before-food-timer-cancel',{course:true,meal:'before'},async()=>{
    const row=await doseRow(page);await row.locator('[data-dose-action=mark]').first().click();await until(page,d=>d.settings.mealTimers?.some(t=>t.kind==='eat'&&!t.cancelledAt),'Before-food timer not saved');await page.getByRole('button',{name:'Отменить таймер',exact:true}).first().click();await until(page,d=>d.settings.mealTimers?.every(t=>t.cancelledAt),'Timer cancel not persisted');return{timer:'eat',cancelled:true,deliveryTested:false}
  })
  await execute('08-after-food-timer-cancel',{course:true,meal:'after'},async()=>{
    const row=await doseRow(page);await row.getByRole('button',{name:/^Закончил есть/}).click();await until(page,d=>d.settings.mealTimers?.some(t=>t.kind==='dose'&&!t.cancelledAt),'After-food timer not saved');await page.getByRole('button',{name:'Отменить таймер',exact:true}).first().click();await until(page,d=>d.settings.mealTimers?.every(t=>t.cancelledAt),'Timer cancel not persisted');return{timer:'dose',cancelled:true,deliveryTested:false}
  })
  await execute('09-glucose-timer-cancel',{},async()=>{
    await goConceptRoute(page,'glucose');await page.getByRole('button',{name:'Напомнить померить сахар через 2 часа',exact:true}).click();const d=await until(page,d=>d.settings.glucoseTimers?.some(t=>!t.cancelledAt),'Glucose timer missing');assert.equal(d.settings.glucoseTimers[0].dueAt-d.settings.glucoseTimers[0].startedAt,7200000);await page.getByRole('button',{name:'Отменить напоминание',exact:true}).click();await until(page,d=>d.settings.glucoseTimers.every(t=>t.cancelledAt),'Glucose timer cancel failed');return{twoHours:true,cancelled:true,deliveryTested:false}
  })
  await execute('10-course-stop',{course:true},async()=>{
    await courseList(page);await page.locator('.pill__open').filter({hasText:'Тестовый препарат'}).click();await page.getByRole('button',{name:'Больше не принимаю',exact:true}).click();await until(page,d=>!!d.regimens[0].stoppedAt,'Course not stopped');assert.equal((await read(page)).regimens.length,1);return{historyRetained:true}
  })
  await execute('11-course-repeat',{course:true,ended:true},async()=>{
    await courseList(page);const filter=page.getByRole('button',{name:/^Какие курсы|^Состояние курсов/});if(await filter.count()){await filter.first().click();await page.locator('dialog[open]').getByRole('button',{name:'Все',exact:true}).click()}
    await page.locator('.pill__open').filter({hasText:'Тестовый препарат'}).click();await page.getByRole('button',{name:'Повторить курс',exact:true}).click();await reviewSave(page);const d=await until(page,d=>d.regimens.length===2,'Repeat not saved');assert.ok(d.regimens.find(r=>r.id==='audit-course').endsAt<Date.now());const created=d.regimens.find(r=>r.id!=='audit-course');assert.equal(created.taken,undefined);return{originalRetained:true,newCourse:true}
  })
  await execute('12-lab-create-result-delete',{},async()=>{
    await goConceptRoute(page,'labs');await page.getByRole('button',{name:'Добавить анализ',exact:true}).click();await page.getByLabel('Что сдаём',{exact:true}).fill('Аудит ТТГ');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await until(page,d=>d.labs.length===1,'Lab not saved');await page.getByRole('button',{name:'Записать результат',exact:true}).click();await page.getByLabel('Число',{exact:true}).fill('2,1');await page.getByRole('button',{name:'Записать',exact:true}).click();const d=await until(page,d=>d.labs[0]?.results.length===1,'Lab result not saved');assert.equal(d.labs[0].results[0].values[0],2.1);await page.getByRole('button',{name:'Изменить',exact:true}).click();await page.getByLabel('Что сдаём',{exact:true}).blur();await page.waitForTimeout(500);await page.getByRole('button',{name:'Удалить анализ',exact:true}).click();await page.getByRole('button',{name:'Удалить',exact:true}).click();await until(page,d=>!d.labs.length,'Lab not deleted');return{createResultDelete:true}
  })
  await execute('13-person-add-rename',{},async()=>{
    await go(page,{tool:'Настройки',open:'Люди'});await page.getByRole('button',{name:'Добавить человека',exact:true}).click();await page.getByLabel('Имя',{exact:true}).fill('Тест Вера');await page.getByLabel('Имя',{exact:true}).blur();const d=await until(page,d=>d.settings.people.some(p=>p.name==='Тест Вера'),'Person rename not persisted');assert.equal(d.settings.people.length,3);assert.equal(d.settings.activePerson,d.settings.people.find(p=>p.name==='Тест Вера').id);return{addRename:true}
  })
  await execute('14-owner-switch-and-sticky',{},async()=>{
    await goConceptRoute(page,'bp');await pick(page,'Чей дневник','Тест Борис');await until(page,d=>d.settings.activePerson==='p2','Owner switch not persisted');await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));const header=await page.locator('.concept-header').boundingBox();assert.ok(header&&header.y>=-1&&header.y<100);assert.match(await page.locator('.concept-header').innerText(),/Тест Борис/);return{ownerVisibleAfterScroll:true}
  })
  await execute('15-settings-appearance-screen',{},async()=>{
    await go(page,{tool:'Настройки',open:'Текст и оформление'});const theme=page.getByRole('button',{name:/^Тёмная$/});assert.equal(await theme.count(),1,'Theme UI not located; selector must be checked, not skipped');await theme.click();await until(page,d=>d.settings.theme==='dark','Dark theme not persisted');await page.reload({waitUntil:'domcontentloaded'});await settleAny(page);assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');return{themePersistsReload:true}
  })
  results.skipped.push({name:'onboarding',reason:'Not included: audited saved-data journeys start from explicit synthetic seed; fresh native onboarding requires separate scenario.'})
  return results
}
