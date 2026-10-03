import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mergeRegimen, mergeDiary, mergeChangedAnything, emptyMergeLog, accumulateMergeLog,
  foldHistory, historyTotal, changeIntake, toJson, parseJson, splitBox, dosings, snoozeIsRelevant,
  fillMissingFromCopy } from './build/api.mjs'

const course = fields => ({ id: 'r1', medicineId: 'm1', person: 'p1', times: ['08:00'], perTime: 1, ...fields })
const merged = (a,b) => mergeRegimen(a,b) ?? a
const day = n => new Date(2026, 5, n, 8).getTime()
const now = new Date(2026, 9, 3, 12).getTime()
const blank = { measurements: [], medicines: [], regimens: [], labs: [], tombstones: [], people: [] }

export function run() {
  let failures = 0
  const test = (name, check) => {
    try { check(); console.log(`  ok   ${name}`) }
    catch (error) { failures++; console.log(`  FAIL ${name} — ${error.message}`) }
  }
  test('R01/R07: журнал сохраняет анализы и незнакомые удаления', () => {
    const delta = mergeDiary(blank, { ...blank, labs: [{id:'l', owner:'p1', name:'ТТГ', results:[]}], tombstones:[{id:'never-seen',kind:'measurement',at:10}] })
    const log = emptyMergeLog(); accumulateMergeLog(log,delta.log)
    assert.equal(log.addedLabs,1); assert.equal(log.changedTombstones,1)
    assert.equal(mergeChangedAnything(log),true)
    const gravesOnly = mergeDiary(blank,{...blank,tombstones:delta.tombstones})
    assert.equal(mergeChangedAnything(gravesOnly.log),true)
    assert.equal(mergeChangedAnything(mergeDiary(gravesOnly,{...blank,tombstones:delta.tombstones}).log),false)
  })
  test('R02: намеренное очищение всех полей не возвращает старое расписание', () => {
    const old = course({ meal:'before', rhythm:{kind:'weekdays',days:[1]}, plan:{kind:'constant'}, planFrom:day(1), endsAt:day(30), updatedAt:10 })
    const clear = course({ times:undefined, perTime:undefined, updatedAt:20 })
    for (const result of [merged(old,clear),merged(clear,old)])
      for (const key of ['times','perTime','meal','rhythm','plan','planFrom','endsAt']) assert.equal(result[key],undefined,key)
  })
  test('R02: старый формат не возвращает расписание, но свежий владелец сохраняется', () => {
    const modern = course({ times:undefined,perTime:undefined,updatedAt:20,scheduleUpdatedAt:20 })
    const legacy = splitBox({id:'m1',name:'Тест',owner:'p2',perDay:1,updatedAt:30},'p2').regimen
    for (const result of [merged(modern,legacy),merged(legacy,modern)]) {
      assert.equal(result.person,'p2'); assert.equal(result.times,undefined)
      assert.equal(result.scheduleUpdatedAt,20)
      const edit = course({times:['10:00'],updatedAt:25,scheduleUpdatedAt:25})
      assert.deepEqual(merged(result,edit).times,['10:00'])
    }
  })
  test('R08: повторная отметка побеждает старую отмену независимо от других правок', () => {
    const taken = changeIntake(course({}),day(1),true,100)
    const cancel = changeIntake(taken,day(1),false,101)
    const retake = changeIntake(cancel,day(1),true,102)
    for (const result of [merged(retake,{...cancel,updatedAt:999}),merged({...cancel,updatedAt:999},retake)]) {
      assert.deepEqual(result.taken,[day(1)]); assert.deepEqual(result.untaken,[])
    }
    const sameClock = changeIntake(cancel,day(1),true,100)
    assert.equal(sameClock.intakeState[day(1)].at,102)
  })
  test('R02: первая отметка новой сборкой не обновляет версию старого расписания', () => {
    const old = course({updatedAt:100})
    const clear = course({times:undefined,perTime:undefined,updatedAt:200,scheduleUpdatedAt:200})
    const tapped = {...changeIntake(old,day(1),true,300),updatedAt:300}
    assert.equal(tapped.scheduleUpdatedAt,100)
    assert.equal(merged(clear,tapped).times,undefined)
    const folded = {...foldHistory(old,now),updatedAt:400}
    assert.equal(merged(clear,folded).times,undefined)
  })
  test('R09: независимые старые отметки складываются, общие не удваиваются', () => {
    const a = foldHistory(changeIntake(changeIntake(course({since:day(1)}),day(1),true,100),day(2),true,101),now)
    const b = foldHistory(changeIntake(changeIntake(course({since:day(1)}),day(2),true,101),day(3),true,102),now)
    const c = foldHistory(changeIntake(course({since:day(1)}),day(4),true,103),now)
    const ab = merged(a,b)
    assert.equal(historyTotal(ab).taken,3)
    assert.equal(historyTotal(merged(ab,a)).taken,3)
    assert.equal(historyTotal(merged(merged(a,b),c)).taken,4)
    assert.deepEqual(merged(merged(a,b),c).intakeState,merged(a,merged(b,c)).intakeState)
    const restored = parseJson(toJson({ ...blank,regimens:[ab],settings:null })).regimens[0]
    assert.equal(historyTotal(merged(restored,a)).taken,3)
    const cancel = changeIntake(a,day(1),false,200)
    assert.equal(historyTotal(merged(ab,cancel)).taken,2)
    const retake = changeIntake(cancel,day(1),true,201)
    assert.equal(historyTotal(merged(merged(ab,cancel),retake)).taken,3)
  })
  test('R09: разные границы старых итогов не уменьшают известный итог', () => {
    const a = course({foldedUntil:day(3),history:{'2026-06':{planned:2,taken:1}}})
    const b = course({foldedUntil:day(5),history:{'2026-06':{planned:1,taken:1}}})
    const known = foldHistory(changeIntake(a,day(4),true,100),now)
    const result = merged(known,b)
    assert.equal(historyTotal(known).taken,2)
    assert.equal(historyTotal(result).taken,2)
    assert.equal(historyTotal(merged(result,b)).taken,2)
    assert.equal(historyTotal(fillMissingFromCopy(known,b)).taken,2)
  })
  test('R09: Москва и Нью-Йорк не удваивают назначения одного календарного дня', () => {
    const script = `import {foldHistory} from './tests/build/api.mjs'; console.log(JSON.stringify(foldHistory({id:'r1',medicineId:'m1',person:'p1',times:['08:00'],since:Date.parse('2026-07-01T00:00:00+03:00')},Date.parse('2026-10-03T12:00:00Z'))))`
    const fold = tz => JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,TZ:tz},encoding:'utf8'}))
    const a=fold('Europe/Moscow'), b=fold('America/New_York')
    assert.equal(a.history['2026-07'].planned,31)
    assert.equal(b.history['2026-07'].planned,31)
    assert.equal(merged(a,b).history['2026-07'].planned,31)
    assert.equal(merged(b,a).history['2026-07'].planned,31)
  })
  test('R09: legacy в разных поясах сохраняет отдельную отметку после своей границы', () => {
    const untilMoscow=Date.parse('2026-07-02T00:00:00+03:00'), untilNewYork=Date.parse('2026-07-02T00:00:00-04:00')
    const stamp=Date.parse('2026-07-02T02:00:00+03:00')
    const a=course({foldedUntil:untilMoscow,historyState:{version:1,legacy:{'2026-07':[{planned:1,taken:1,until:untilMoscow,untilDay:'2026-07-02'}]},planned:{}}})
    const b=course({foldedUntil:untilNewYork,historyState:{version:1,legacy:{'2026-07':[{planned:1,taken:1,until:untilNewYork,untilDay:'2026-07-02'}]},planned:{}}})
    const known=foldHistory(changeIntake(a,stamp,true,100),now)
    assert.equal(known.history['2026-07'].taken,2)
    assert.equal(merged(known,b).history['2026-07'].taken,2)
    assert.equal(fillMissingFromCopy(known,b).history['2026-07'].taken,2)
  })
  test('R09: общий приём на границе месяцев не дублирует legacy итог другого пояса', () => {
    const until=Date.parse('2026-08-01T00:00:00-04:00'), stamp=Date.parse('2026-07-31T20:00:00-04:00')
    const legacy=course({foldedUntil:until,historyState:{version:1,legacy:{'2026-07':[{planned:1,taken:1,until,untilDay:'2026-08-01'}]},planned:{}}})
    const raw=course({taken:[stamp]})
    const result=merged(legacy,raw)
    assert.equal(historyTotal(result).taken,1)
    assert.equal(result.history['2026-07'].taken,1)
    assert.equal(historyTotal(merged(result,raw)).taken,1)
  })
  test('R21: отложенный последний приём остаётся до отметки или удаления курса', () => {
    const stamp = new Date(2026,9,3,8).getTime()
    const midnight = new Date(2026,9,3).getTime()
    const box = {id:'m1',name:'Тест',form:'tablet',perPack:30,packs:1}
    const regimen = course({})
    const input = {medicines:dosings([box],[regimen]),subjects:[],labs:[],regimens:[regimen],now,options:{repeat:false,personOf:()=> 'p1'}}
    const key = {kind:'dose',day:midnight,slot:'08:00',person:'p1'}
    assert.equal(snoozeIsRelevant(input,key),true)
    assert.equal(snoozeIsRelevant({...input,medicines:dosings([box],[changeIntake(regimen,stamp,true,now)])},key),false)
    assert.equal(snoozeIsRelevant({...input,medicines:[]},key),false)
    assert.equal(snoozeIsRelevant(input,{...key,person:'p2'}),false)
  })
  return failures
}
