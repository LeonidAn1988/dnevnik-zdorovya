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
  check('повтор факта одной дозы не создаёт второй таймер и не сдвигает интервал',()=>{const t=api.createMealTimer(course,box.name,'eat',day(1,8),[],day(1,8),day(1,7));assert.equal(api.createMealTimer(course,box.name,'eat',day(1,8)+1000,[t],day(1,8)+1000,day(1,7)).id,t.id);assert.equal(api.createMealTimer(course,box.name,'eat',day(1,9),[t],day(1,8),day(1,7)).id,t.id)})
  check('во время еды сохраняется в копии, календаре и напоминании без интервала',()=>{const c={...course,meal:'during',mealMinutes:undefined},d=api.dosing(box,c);const restored=api.parseJson(api.toJson({measurements:[],medicines:[box],regimens:[c],labs:[],tombstones:[],settings:null}));assert.equal(restored.regimens[0].meal,'during');assert.match(api.buildCalendar([d],now),/во время еды/);assert.match(api.doseLine(d,null,now),/во время еды/);assert.equal(api.createMealTimer(c,box.name,'eat',now,[]),null)})
  check('после еды уведомление не имеет кнопки автоотметки',()=>{const t=api.createMealTimer({...course,meal:'after',mealMinutes:30},box.name,'dose',day(1,9),[]);assert.equal(t.dueAt,day(1,9)+30*60000);assert.equal(api.timerReminder(t).markable,false);assert.equal(course.taken,undefined)})
  check('двойной тап после еды сохраняет один таймер данной дозы',()=>{const c={...course,meal:'after',mealMinutes:30},t=api.createMealTimer(c,box.name,'dose',day(1,9),[],day(1,9),day(1,8));assert.equal(api.createMealTimer(c,box.name,'dose',day(1,9)+1000,[t],day(1,9)+1000,day(1,8)).id,t.id)})
  check('таймеры и история локальны и не уезжают на другой телефон',()=>{const data=JSON.parse(api.toJson({measurements:[],medicines:[box],regimens:[course],labs:[],tombstones:[],settings:{...api.DEFAULT_SETTINGS,mealTimers:[timer],notificationHistory:[{id:'x',at:now,title:'x',body:'x',kind:'timer'}]}}));assert.equal(data.settings.mealTimers,undefined);assert.equal(data.settings.notificationHistory,undefined)})
  check('этапы и интервал еды переживают копию',()=>{const restored=api.parseJson(api.toJson({measurements:[],medicines:[box],regimens:[course],labs:[],tombstones:[],settings:null}));assert.deepEqual(restored.regimens[0].plan,course.plan);assert.equal(restored.regimens[0].mealMinutes,20);assert.equal(restored.medicines[0].stockUnit,'sachet')})
  check('поиск по форме и отдельно по дозировке',()=>{const items=[{n:'А',v:[[0,['10 мг']]]}];assert.equal(api.searchHits(items,'гель',[],8,'form',['Гель']).length,1);assert.equal(api.searchHits(items,'10 мг',[],8,'dose',[]).length,1)})
  check('история обычного приёма сохраняет владельца',()=>assert.equal(api.doseEntries([dosing],day(1,9))[0].person,'p'))
  const shared={...box,left:30,leftAt:now,stockUpdatedAt:now}, plannedA=day(1,18),plannedB=day(1,20)
  const plain={...course,plan:undefined,times:['18:00','20:00']}
  const slots=[api.dosing(shared,plain)]
  const earlyA=api.markTakenAt(shared,plain,slots,plannedA,day(1,10)).box
  const earlyB=api.markTakenAt(shared,plain,slots,plannedB,day(1,11)).box
  check('два телефона списывают разные будущие дозы из одного запаса',()=>{
    for(const [a,b] of [[earlyA,earlyB],[earlyB,earlyA]]) {
      const merged=api.mergeMedicine(a,b)?.next??a
      assert.equal(merged.left,28)
      assert.equal(Object.keys(merged.manualDeductions).length,2)
      assert.equal((api.mergeMedicine(merged,a)?.next??merged).left,28)
      assert.equal((api.mergeMedicine(merged,b)?.next??merged).left,28)
    }
  })
  check('одна ранняя отметка на двух телефонах списывается один раз',()=>assert.equal((api.mergeMedicine(earlyA,{...earlyA,leftAt:day(1,11)})?.next??earlyA).left,29))
  check('новый ручной пересчёт не получает старое раннее списание повторно',()=>{
    const counted=api.setLeft(earlyB,40,day(1,12))
    assert.equal((api.mergeMedicine(earlyA,counted)?.next??counted).left,40)
  })
  check('прошедшая доза уже учтена расчётом свежего телефона',()=>{
    const late=api.markTakenAt(shared,plain,slots,plannedB,day(1,21)).box
    assert.equal(late.left,28)
    assert.equal((api.mergeMedicine(earlyA,late)?.next??late).left,28)
  })
  check('свежий телефон ещё не знает второй курс, его расход не теряется',()=>{
    const a={...plain,id:'a',times:['18:00']}, b={...plain,id:'b',person:'p2',times:['20:00']}
    const x=api.markTakenAt(shared,a,[api.dosing(shared,a)],plannedA,day(1,10)).box
    const y=api.markTakenAt(shared,b,[api.dosing(shared,b)],plannedB,day(1,21)).box
    for(const [own,other] of [[x,y],[y,x]]) {
      const merged=api.mergeMedicine(own,other)?.next??own
      assert.equal(merged.left,28)
      assert.equal((api.mergeMedicine(merged,x)?.next??merged).left,28)
    }
  })
  check('поздняя отметка старого запаса не отменяет новый пересчёт',()=>{
    const counted=api.setLeft(shared,40,day(1,12))
    const stale=api.markTakenAt(shared,plain,slots,plannedA,day(1,13)).box
    for(const [own,other] of [[counted,stale],[stale,counted]]) assert.equal((api.mergeMedicine(own,other)?.next??own).left,40)
  })
  check('журнал расхода переживает копию',()=>{
    const restored=api.parseJson(api.toJson({measurements:[],medicines:[earlyA],regimens:[plain],labs:[],tombstones:[],settings:null}))
    assert.equal(restored.medicines[0].stockLedgerVersion,2)
    assert.deepEqual(restored.medicines[0].manualDeductions,earlyA.manualDeductions)
  })
  check('первый общий запас без даты тоже сохраняет обе ранние отметки',()=>{
    const undated={...shared,leftAt:undefined,stockUpdatedAt:undefined}
    const x=api.markTakenAt(undated,plain,[api.dosing(undated,plain)],plannedA,day(1,10)).box
    const y=api.markTakenAt(undated,plain,[api.dosing(undated,plain)],plannedB,day(1,11)).box
    assert.equal((api.mergeMedicine(x,y)?.next??x).left,28)
  })
  check('старый неполный журнал не объявляется полным и не удваивает расход',()=>{
    const anchor=day(1,7), c={...plain,times:['08:00','20:00']}, baseline={...shared,leftAt:anchor,stockUpdatedAt:anchor}
    const old={...baseline,left:28,leftAt:day(1,21),manualDeductions:{[`r:${day(1,20)}`]:0}}
    const migrated=api.markTakenAt(old,c,[api.dosing(old,c)],day(2,8),day(2,9)).box
    const complete=api.markTakenAt(baseline,c,[api.dosing(baseline,c)],day(2,8),day(2,9)).box
    assert.equal(migrated.stockLedgerVersion,undefined);assert.equal(migrated.left,27);assert.equal(complete.left,27)
    for(const [a,b] of [[migrated,complete],[complete,migrated]]) {
      const merged=api.mergeMedicine(a,b)?.next??a
      assert.equal(merged.left,27);assert.equal(merged.stockLedgerVersion,undefined)
      assert.equal((api.mergeMedicine(merged,a)?.next??merged).left,27)
      assert.equal(api.projectedLeft(merged,[api.dosing(merged,c)],day(2,21)),26)
    }
  })
  check('подписки телефона: все по умолчанию, явный выбор и никто',()=>{
    const s={people:[{id:'self'},{id:'daughter'},{id:'spouse'}]}
    assert.deepEqual(api.reminderPeopleOf(s),['self','daughter','spouse'])
    assert.deepEqual(api.reminderPeopleOf({...s,reminderPeople:['self','daughter']}),['self','daughter'])
    assert.deepEqual(api.reminderPeopleOf({...s,reminderPeople:[]}),[])
    assert.deepEqual(api.reminderPeopleOf({...s,reminderPeople:['removed','old'],mergedPeople:{old:'daughter'}}),['daughter'])
    assert.deepEqual(api.reminderPeopleOf({...s,reminderPeople:['self'],people:[...s.people,{id:'new'}]}),['self'])
  })
  check('подписки телефона не экспортируются и не импортируются с чужой копией',()=>{
    const snapshot={measurements:[],medicines:[],regimens:[],labs:[],tombstones:[],settings:{...api.DEFAULT_SETTINGS,reminderPeople:['self']}}
    const data=JSON.parse(api.toJson(snapshot));assert.equal(data.settings.reminderPeople,undefined)
    data.settings.reminderPeople=['spouse'];assert.equal(api.parseJson(JSON.stringify(data)).settings.reminderPeople,undefined)
  })
  return failures
}
