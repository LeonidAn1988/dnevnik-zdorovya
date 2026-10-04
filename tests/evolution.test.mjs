import assert from 'node:assert/strict'
import * as api from './build/api.mjs'
export async function run() {
  let failures=0
  const check=(name,fn)=>{try{fn(); console.log(`  ok   ${name}`)}catch(e){failures++;console.log(`  FAIL ${name}: ${e.message}`)}}
  const day=(n,h=0)=>new Date(2026,0,n,h).getTime(), now=day(1)
  const box={id:'b',name:'Саше',form:'Гель для приема внутрь',dose:'4 мг + 3 г',stockUnit:'sachet',doseUnit:'sachet',left:58,leftAt:now,expires:null}
  const course={id:'r',medicineId:'b',person:'p',since:now,planFrom:now,perTime:1,times:['08:00','20:00'],meal:'before',mealMinutes:20,plan:[{perTime:1,times:['08:00','20:00'],days:14},{perTime:1,times:['08:00'],days:30}]}
  const dosing=api.dosing(box,course)
  check('14 дней × 2 + 30 дней × 1 = 58 саше',()=>assert.equal(api.needUntilEnd([dosing],now),58))
  check('на 15-й день только один приём',()=>assert.deepEqual(api.dosesOn(dosing,day(15),now).map(s=>s.time),['08:00']))
  check('на 45-й день курс закончен',()=>assert.equal(api.dosesOn(dosing,day(45),day(45)).length,0))
  check('58 саше хватает до конца; покупки не нужны',()=>{assert(api.enoughForCourse(box,[dosing],now));assert.equal(api.restockList([{box,intakes:[dosing]}],now).length,0)})
  check('напоминания второго этапа не содержат вечер',()=>assert.deepEqual(api.buildReminders([dosing],day(15),{repeat:false,horizonDays:1}).map(r=>r.slot),['08:00']))
  check('календарь содержит ровно 58 назначений с корректным концом',()=>{const cal=api.buildCalendar([dosing],now);assert.equal((cal.match(/BEGIN:VEVENT/g)||[]).length,58);assert.equal(api.countCalendarEvents([dosing],now),58)})
  check('старый gel сохраняет граммы; новый Pepsan выбирает саше',()=>{assert.equal(api.packUnit({form:box.form}),'г');assert.deepEqual(api.newMedicineUnits('Пепсан-Р',box.form),{stockUnit:'sachet',doseUnit:'sachet'})})
  check('undefined курса не затирает явную единицу запаса',()=>assert.equal(api.toPackUnits(api.dosing(box,{...course,doseUnit:undefined}),1),1))
  const liquid={...box,stockUnit:'ml',doseUnit:'ml',left:10,dropsPerMl:40,form:'Раствор для приема внутрь'}
  const a=api.dosing(liquid,{...course,id:'a',plan:undefined,times:['08:00'],doseUnit:'ml',endsAt:day(2)})
  const b=api.dosing(liquid,{...course,id:'b',plan:undefined,times:['08:00'],perTime:20,doseUnit:'drop',endsAt:day(2)})
  check('общий расход мл + капли складывается в мл',()=>assert.equal(api.needUntilEnd([a,b],now),3))
  check('для новых капель коэффициент обязателен',()=>assert(Number.isNaN(api.toPackUnits({...liquid,doseUnit:'drop',dropsPerMl:undefined},20))))
  check('несовместимые единицы не записывают NaN в запас',()=>assert.throws(()=>api.markTakenAt(liquid,{...course,doseUnit:'g'},[a],day(1,8),day(1,9)),/единицы/))
  check('ошибка другого курса сохраняет известный остаток общей упаковки',()=>{assert.throws(()=>api.markTakenAt(liquid,a,[a,{...b,doseUnit:'g'}],day(1,8),day(1,9)),/единицы/);assert.equal(liquid.left,10)})
  check('дробные остатки и новая упаковка не округляются до целых',()=>{assert.equal(api.setLeft(liquid,0.4,now).left,0.4);assert.equal(api.addPack({...liquid,left:0},[],now,2.5).left,2.5)})
  check('покупки без курса отсутствуют',()=>assert.equal(api.restockList([{box:{...box,left:0},intakes:[]}],now).length,0))
  const timer=api.createMealTimer(course,box.name,'eat',day(1,8),[])
  check('таймер до еды отсчитывается от факта приёма',()=>assert.equal(timer.dueAt,day(1,8)+20*60000))
  check('повторное нажатие для того же факта не дублирует таймер',()=>assert.equal(api.createMealTimer(course,box.name,'eat',day(1,8)+1000,[timer],day(1,8)).id,timer.id))
  check('после еды уведомление не имеет кнопки автоотметки',()=>{const t=api.createMealTimer({...course,meal:'after',mealMinutes:30},box.name,'dose',day(1,9),[]);assert.equal(t.dueAt,day(1,9)+30*60000);assert.equal(api.timerReminder(t).markable,false);assert.equal(course.taken,undefined)})
  check('двойной тап после еды сохраняет один таймер данной дозы',()=>{const c={...course,meal:'after',mealMinutes:30},t=api.createMealTimer(c,box.name,'dose',day(1,9),[],day(1,9),day(1,8));assert.equal(api.createMealTimer(c,box.name,'dose',day(1,9)+1000,[t],day(1,9)+1000,day(1,8)).id,t.id)})
  check('таймеры и история локальны и не уезжают на другой телефон',()=>{const data=JSON.parse(api.toJson({measurements:[],medicines:[box],regimens:[course],labs:[],tombstones:[],settings:{...api.DEFAULT_SETTINGS,mealTimers:[timer],notificationHistory:[{id:'x',at:now,title:'x',body:'x',kind:'timer'}]}}));assert.equal(data.settings.mealTimers,undefined);assert.equal(data.settings.notificationHistory,undefined)})
  check('этапы и интервал еды переживают копию',()=>{const restored=api.parseJson(api.toJson({measurements:[],medicines:[box],regimens:[course],labs:[],tombstones:[],settings:null}));assert.deepEqual(restored.regimens[0].plan,course.plan);assert.equal(restored.regimens[0].mealMinutes,20);assert.equal(restored.medicines[0].stockUnit,'sachet')})
  check('поиск по форме и отдельно по дозировке',()=>{const items=[{n:'А',v:[[0,['10 мг']]]}];assert.equal(api.searchHits(items,'гель',[],8,'form',['Гель']).length,1);assert.equal(api.searchHits(items,'10 мг',[],8,'dose',[]).length,1)})
  check('история обычного приёма сохраняет владельца',()=>assert.equal(api.doseEntries([dosing],day(1,9))[0].person,'p'))
  return failures
}
