/** Synthetic data shared by browser and isolated Android QA. */
export async function seedEvolution(page,now,patch={}) {
  await page.evaluate(async ({now,patch})=>{
    const db=await new Promise(r=>{const q=indexedDB.open('omron-bp');q.onsuccess=()=>r(q.result)})
    const old=await new Promise(r=>{const q=db.transaction('meta').objectStore('meta').get('settings');q.onsuccess=()=>r(q.result)})
    const start=new Date(now);start.setHours(0,0,0,0)
    const boxes=[
      {id:'s',name:'Пепсан · тест',dose:'10 г в саше',form:'Гель для приема внутрь',stockUnit:'sachet',doseUnit:'sachet',packSize:30,left:58,leftAt:start.getTime(),expires:null,maker:'Тестовый производитель',inn:'Тестовое вещество'},
      {id:'m',name:'Капли · тест',dose:'',form:'Раствор для приема внутрь',stockUnit:'ml',doseUnit:'ml',packSize:10,left:10,leftAt:start.getTime(),expires:null,dropsPerMl:40},
      {id:'reserve',name:'Резерв без курса',dose:'',form:'Таблетки',stockUnit:'piece',doseUnit:'piece',left:0,leftAt:now,expires:null},
    ]
    const courses=[
      {id:'before',medicineId:'s',person:'p1',times:['08:00','20:00'],perTime:1,doseUnit:'sachet',since:start.getTime(),planFrom:start.getTime(),startedAt:start.getTime(),meal:'before',mealMinutes:20,plan:[{perTime:1,times:['08:00','20:00'],days:14},{perTime:1,times:['08:00'],days:30}]},
      {id:'after',medicineId:'m',person:'p1',times:['08:00'],perTime:20,doseUnit:'drop',since:start.getTime(),meal:'after',mealMinutes:30},
      {id:'shared',medicineId:'m',person:'p2',times:['20:00'],perTime:1,doseUnit:'ml',since:start.getTime()},
    ]
    await new Promise((r,j)=>{const tx=db.transaction(['meta','medicines','regimens'],'readwrite');tx.objectStore('medicines').clear();tx.objectStore('regimens').clear();boxes.forEach(b=>tx.objectStore('medicines').put(b));courses.forEach(c=>tx.objectStore('regimens').put(c));tx.objectStore('meta').put({...old,people:[{id:'p1',name:'Анна',deviceUser:1},{id:'p2',name:'Борис',deviceUser:2}],activePerson:'p1',guideOffered:true,remindersOn:false,measureRemindOn:false,supplyWarningDays:7,expiryWarningDays:7,mealTimers:[],notificationHistory:[],...patch},'settings');tx.oncomplete=r;tx.onerror=()=>j(tx.error)})
    db.close()
  },{now,patch})
  await page.reload({waitUntil:'domcontentloaded'})
  await page.locator('.app').waitFor()
}
export async function evolutionData(page,store='meta') {
  return page.evaluate(async store=>{const db=await new Promise(r=>{const q=indexedDB.open('omron-bp');q.onsuccess=()=>r(q.result)});const data=await new Promise(r=>{const q=db.transaction(store).objectStore(store)[store==='meta'?'get':'getAll'](...(store==='meta'?['settings']:[]));q.onsuccess=()=>r(q.result)});db.close();return data},store)
}
