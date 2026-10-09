import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {mkdirSync,writeFileSync} from 'node:fs'
import {FROZEN,seed,settleAny,settle} from '../tools/visual.mjs'
const out='reviews/evidence/course-medicine';mkdirSync(out,{recursive:true})
const browser=await chromium.launch(),checks=[],errors=[]
async function db(page){return page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('omron-bp');r.onsuccess=()=>resolve(r.result)});const read=store=>new Promise(resolve=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>resolve(r.result)});const v={medicines:await read('medicines'),regimens:await read('regimens')};db.close();return v})}
async function fresh(style,scale,count,width=360){
 const context=await browser.newContext({viewport:{width,height:800},hasTouch:true,locale:'ru-RU',timezoneId:'Europe/Moscow'}),page=await context.newPage();page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));await page.route('https://api.github.com/**',r=>r.fulfill({contentType:'application/json',body:'[]'}));await page.route('**/drugs.json',r=>r.fulfill({json:{date:'2026-10-09',forms:['Таблетки','Капсулы'],makers:['Тестовый завод'],items:[{n:'Конкор',i:'Бисопролол',v:[[0,['5 мг'],[30]],[1,['10 мг'],[30]]],m:[0]}]}}));await page.route('**/supplements.json',r=>r.fulfill({json:{date:'2026-10-09',forms:[],makers:[],items:[]}}));await page.clock.install({time:new Date(FROZEN)});await page.goto('http://localhost:5199');await settleAny(page);await seed(page,FROZEN)
 await page.evaluate(async({style,scale,count,now})=>{const db=await new Promise(resolve=>{const r=indexedDB.open('omron-bp');r.onsuccess=()=>resolve(r.result)});const old=await new Promise(resolve=>{const r=db.transaction('meta').objectStore('meta').get('settings');r.onsuccess=()=>resolve(r.result)});await new Promise(resolve=>{const tx=db.transaction(['meta','medicines','regimens'],'readwrite');tx.objectStore('medicines').clear();tx.objectStore('regimens').clear();for(let i=0;i<count;i++)tx.objectStore('medicines').put({id:`m${i}`,name:i<2?'Конкор':`Препарат ${i}`,dose:i===0?'5 мг':i===1?'10 мг':'',inn:i<2?'Бисопролол':`Вещество ${i}`,maker:i===0?'Мерк':'Тестовый завод',form:'Таблетки',stockUnit:'piece',doseUnit:'piece',left:30,leftAt:now,expires:null});tx.objectStore('meta').put({...old,interfaceStyle:style,textScale:scale,theme:scale==='xlarge'?'dark':'light',guideOffered:true,people:[{id:'p1',name:'Анна',deviceUser:1},{id:'p2',name:'Борис',deviceUser:2}],activePerson:'p1'},'settings');tx.oncomplete=resolve});db.close()},{style,scale,count,now:FROZEN});await page.reload();await settle(page);await page.getByRole('button',{name:'Аптечка',exact:true}).click();await page.getByRole('group',{name:'Разделы аптечки'}).getByRole('button',{name:/^Курсы/}).click();await page.getByRole('button',{name:'Завести курс приёма',exact:true}).click();return{context,page}
}
const search=page=>page.getByRole('searchbox',{name:'Найти препарат в аптечке',exact:true})
const add=page=>page.getByRole('button',{name:'Добавить новый препарат',exact:true})
const dialog=page=>page.getByRole('dialog',{name:'Новый препарат для курса',exact:true})
const name=page=>dialog(page).getByRole('combobox',{name:'Название или поиск препарата',exact:true})
async function snap(page,label){const before=await page.evaluate(()=>({coarse:matchMedia('(pointer:coarse)').matches,touch:navigator.maxTouchPoints}));await page.screenshot({path:`${out}/${label}.png`,animations:'disabled'});assert.deepEqual(await page.evaluate(()=>({coarse:matchMedia('(pointer:coarse)').matches,touch:navigator.maxTouchPoints})),before);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))}
try{
 for(const [style,scale,width] of [['classic','normal',360],['modern','xlarge',320]]){
  const {context,page}=await fresh(style,scale,12,width)
  const original=await db(page);const results=page.getByRole('region',{name:'Препараты в аптечке',exact:true})
  assert.equal(await results.getByRole('button').count(),11);await results.getByRole('button',{name:'Показать ещё (2)',exact:true}).click();assert.equal(await results.getByRole('button').count(),12)
  await search(page).press('Enter');assert.deepEqual(await db(page),original,'Enter in search must not save a course')
  await search(page).fill('мерк');assert.equal(await results.getByRole('button').count(),1);assert.match(await results.textContent(),/Конкор.*5 мг.*Мерк/s)
  await search(page).fill('бисопролол');assert.equal(await results.getByRole('button').count(),2)
  await search(page).fill('10 мг');await results.getByRole('button').click();assert.equal(await page.locator('.course-medicine-name').textContent(),'Конкор 10 мг');assert(await page.locator('.course-medicine-choice').evaluate(el=>el===document.activeElement))
  await page.getByRole('group',{name:'Кто принимает'}).getByRole('button',{name:'Борис',exact:true}).click()
  await page.getByRole('button',{name:'Утром 08:00',exact:true}).click()
  await page.getByRole('group',{name:'Условия приёма'}).getByRole('button',{name:'До еды',exact:true}).click();await page.getByLabel('За сколько минут до еды',{exact:true}).fill('20')
  await page.getByRole('group',{name:'Срок курса'}).getByRole('button',{name:'Ограничен',exact:true}).click();await page.getByLabel('Курс, дней',{exact:true}).fill('14')
  await page.locator('.course-medicine-choice').click();await search(page).press('Enter');assert.deepEqual(await db(page),original,'Enter with a valid course and empty search must not save');await search(page).fill('Новый для курса');await page.getByText('В вашей аптечке совпадений нет.',{exact:true}).waitFor()
  await snap(page,`${style}-${scale}-search`)
  await add(page).click();await dialog(page).waitFor();assert.equal(await name(page).inputValue(),'Новый для курса');assert.equal(await page.locator('form form').count(),0)
  await snap(page,`${style}-${scale}-dialog`)
  await dialog(page).getByRole('button',{name:'Отмена',exact:true}).click();await dialog(page).waitFor({state:'hidden'});assert(await add(page).evaluate(el=>el===document.activeElement),'Closing the stock dialog returns focus to its trigger');assert.deepEqual(await db(page),original)
  assert.equal(await page.getByLabel('Курс, дней',{exact:true}).inputValue(),'14');assert.equal(await page.getByLabel('За сколько минут до еды',{exact:true}).inputValue(),'20')
  await add(page).click();await dialog(page).waitFor()
  // Native nested choice: Back first closes the release form sheet, then the stock form.
  await name(page).fill('Конкор');await dialog(page).getByRole('listbox',{name:'Препараты из реестра'}).getByRole('button').first().click();await dialog(page).locator('.field').filter({hasText:'Как написано на упаковке'}).getByRole('button').click()
  assert.equal(await page.locator('dialog[open]').count(),2)
  await page.goBack();await page.waitForFunction(()=>document.querySelectorAll('dialog[open]').length===1);assert(await dialog(page).isVisible())
  await page.goBack();await dialog(page).waitFor({state:'hidden'});assert(await page.getByRole('heading',{name:'Новый курс приёма',exact:true}).isVisible());assert.deepEqual(await db(page),original)
  await add(page).click();await name(page).fill('Новый для курса')
  await page.evaluate(()=>{window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='medicines')throw new DOMException('Injected','QuotaExceededError');return window.originalPut.apply(this,args)}})
  await dialog(page).getByRole('button',{name:'Добавить в аптечку',exact:true}).click();await dialog(page).getByRole('alert').filter({hasText:'Не удалось сохранить'}).waitFor();assert.deepEqual(await db(page),original)
  await page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalPut})
  await dialog(page).getByRole('button',{name:'Добавить в аптечку',exact:true}).click();await dialog(page).waitFor({state:'hidden'})
  const added=await db(page);assert.equal(added.regimens.length,0,'Adding stock must not submit course');assert.equal(added.medicines.length,13)
  const box=added.medicines.find(m=>m.name==='Новый для курса');assert(box)
  assert.equal(await page.locator('.course-medicine-name').textContent(),'Новый для курса');assert.equal(await search(page).count(),0,'New selection collapses stock results');assert.equal(await page.getByLabel('Курс, дней',{exact:true}).inputValue(),'14')
  assert.equal(await page.getByRole('group',{name:'Кто принимает'}).getByRole('button',{name:'Борис',exact:true}).getAttribute('aria-pressed'),'true')
  await page.getByText('Препарат добавлен в аптечку. Завершите настройку и сохраните курс.',{exact:true}).waitFor();await page.evaluate(()=>scrollTo(0,0));await snap(page,`${style}-${scale}-selected`)
  await page.evaluate(()=>{window.originalCoursePut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='regimens')throw new DOMException('Injected course failure','QuotaExceededError');return window.originalCoursePut.apply(this,args)}})
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByRole('alert').filter({hasText:'Не удалось сохранить'}).waitFor();assert.equal((await db(page)).regimens.length,0);assert.equal(await page.locator('.course-medicine-name').textContent(),'Новый для курса');await page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalCoursePut})
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByRole('button',{name:'Завести курс приёма',exact:true}).waitFor();const final=await db(page);assert.equal(final.regimens.length,1);const r=final.regimens[0];assert.equal(r.medicineId,box.id);assert.equal(r.person,'p2');assert.equal(r.mealMinutes,20);assert.deepEqual(r.times,['08:00']);assert.equal(new Date(r.endsAt).getDate(),28)
  checks.push({style,scale,width,searchCriteria:true,similarPacks:true,cancelPreserves:true,nestedBack:true,failedWritePreserves:true,medicineOnlySave:true,courseSave:true});await context.close()
 }
 for(const count of [0,1]){
  const {context,page}=await fresh('classic','normal',count)
  assert(await search(page).isVisible());assert(await add(page).isVisible());await search(page).fill('Единственный новый');await add(page).click();await dialog(page).getByRole('button',{name:'Добавить в аптечку',exact:true}).click();await dialog(page).waitFor({state:'hidden'});assert.equal((await db(page)).medicines.length,count+1);assert.equal((await db(page)).regimens.length,0);assert.equal(await page.locator('.course-medicine-name').textContent(),'Единственный новый');checks.push({count,emptyOrSingleStock:true});await context.close()
 }
 {
  const {context,page}=await fresh('modern','normal',1,1280)
  await page.getByRole('button',{name:'Утром 08:00',exact:true}).click()
  await page.getByText('Курс по этапам: доза и число приёмов',{exact:true}).click();await page.getByRole('button',{name:'Добавить этап',exact:true}).click();await page.getByRole('button',{name:'Добавить этап',exact:true}).click()
  const stages=page.locator('details .card.stack');await stages.nth(0).getByLabel('дней',{exact:true}).fill('14');await stages.nth(1).getByLabel('дней',{exact:true}).fill('30');await stages.nth(1).getByRole('button',{name:'Вечером 19:00',exact:true}).click()
  await search(page).fill('Новый сироп');await add(page).click();await dialog(page).waitFor();await dialog(page).getByLabel('Как написано на упаковке',{exact:true}).fill('Сироп');await snap(page,'desktop-dialog')
  await page.keyboard.press('Escape');await dialog(page).waitFor({state:'hidden'});assert.equal(await stages.nth(0).getByLabel('дней',{exact:true}).inputValue(),'14');assert.equal(await stages.nth(1).getByLabel('дней',{exact:true}).inputValue(),'30')
  await add(page).click();assert.equal(await dialog(page).getByLabel('Как написано на упаковке',{exact:true}).inputValue(),'Сироп');await dialog(page).getByRole('button',{name:'Добавить в аптечку',exact:true}).click();await dialog(page).waitFor({state:'hidden'});assert.equal(await page.getByRole('combobox',{name:/^Единица приёма/}).inputValue(),'ml');assert.equal(await stages.nth(1).getByRole('button',{name:'Вечером 19:00',exact:true}).getAttribute('aria-pressed'),'true');assert.equal((await db(page)).regimens.length,0)
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByRole('button',{name:'Завести курс приёма',exact:true}).waitFor();const saved=(await db(page)).regimens[0];assert.deepEqual(saved.plan,[{perTime:1,times:['08:00'],days:14},{perTime:1,times:['08:00','19:00'],days:30}]);assert.equal(saved.doseUnit,'ml');checks.push({desktop:true,stagePreservation:true,escapePreserves:true,unitInference:true});await context.close()
 }
 assert.deepEqual(errors,[]);writeFileSync(`${out}/checks.json`,JSON.stringify({checks,errors},null,2)+'\n');console.log(JSON.stringify(checks))
}finally{await browser.close()}
