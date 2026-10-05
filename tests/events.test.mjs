/**
 * События и сравнение «до и после».
 *
 * Здесь приложение ближе всего подходит к черте интерпретации, поэтому две
 * защиты проверяются жёстче остального: средних не бывает без числа измерений,
 * и на малой выборке средних не бывает вовсе.
 */
import { medicineEvents, compareAround, comparable, COMPARE_DAYS, COMPARE_MIN } from './build/api.mjs'

const ДЕНЬ = 24 * 60 * 60 * 1000
const сейчас = new Date(2026, 8, 10, 12, 0, 0).getTime()
// Календарные сутки назад: на миллисекундах фикстура уезжает на соседний
// день в зоне с переводом часов.
const день = (n) => {
  const d = new Date(сейчас)
  d.setDate(d.getDate() - n)
  d.setHours(9, 0, 0, 0)
  return d.getTime()
}

export function run() {
  let failures = 0
  const check = (name, condition, detail = '') => {
    if (condition) console.log(`  ok   ${name}`)
    else {
      console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`)
      failures++
    }
  }
  const изм = (n, sys, dia) => ({ id: `r${n}-${sys}`, kind: 'bp', ts: день(n), sys, dia, bpm: 70, user: 1 })

  // ── события из аптечки ──
  const мед = { id: 'm1', name: 'Конкор', since: день(20), dose: '', times: ['08:00'], perTime: 1, left: null, perDay: null, expires: null, taken: [] }
  const события = medicineEvents([мед], сейчас)
  check('начало приёма стало событием', события.length === 1 && /Начали принимать Конкор/.test(события[0].title))
  check('день события — день заведения', события[0].day === new Date(день(20)).setHours(0, 0, 0, 0))
  check('без даты начала событий нет', medicineEvents([{ ...мед, since: undefined, taken: [] }], сейчас).length === 0)

  // Смена дозы по схеме: этап в семь дней, потом другая доза.
  const сСхемой = { ...мед, since: день(20), planFrom: день(20), plan: [{ perTime: 1, days: 7 }, { perTime: 1.5, days: null }] }
  const сСменой = medicineEvents([сСхемой], сейчас)
  check('смена дозы стала событием', сСменой.some((e) => /доза 1 → 1½/.test(e.title)), сСменой.map((e) => e.title).join(' | '))
  check('события идут от свежих к старым', сСменой[0].day >= сСменой[сСменой.length - 1].day)
  check('идентификаторы устойчивы', medicineEvents([сСхемой], сейчас).map((e) => e.id).join() === сСменой.map((e) => e.id).join())

  // ── сравнение ──
  const ряд = [
    ...Array.from({ length: 10 }, (_, i) => изм(20 + i, 150, 95)),   // до
    ...Array.from({ length: 10 }, (_, i) => изм(1 + i, 130, 80)),    // после
  ]
  // Событие 11 дней назад, окно — две недели по каждую сторону.
  // «До» — это [25 дней назад, 11 дней назад): туда попадают записи 20–25 дней
  // назад, то есть шесть. «После» — все десять свежих.
  const сравн = compareAround(ряд, день(11))
  check('обе стороны посчитаны', сравн.before.count === 6 && сравн.after.count === 10, `${сравн.before.count}/${сравн.after.count}`)
  check('средние по сторонам', сравн.before.avgSys === 150 && сравн.after.avgSys === 130)
  check('окно по умолчанию две недели', сравн.days === COMPARE_DAYS)
  check('сравнивать есть что', comparable(сравн) === true)

  // Малая выборка: средних быть не должно.
  const мало = compareAround([изм(15, 150, 95), изм(2, 120, 80), изм(3, 122, 82)], день(10))
  check('на малой выборке средних нет', мало.before.avgSys === null && мало.after.avgSys === null)
  check('но число измерений известно', мало.before.count === 1 && мало.after.count === 2)
  check('и сравнивать нечего', comparable(мало) === false)
  check('порог назван явно', COMPARE_MIN === 5)

  // День события относится к «после».
  const вДень = compareAround([изм(0, 120, 80)], день(0))
  check('день события — это «после»', вДень.after.count === 1 && вДень.before.count === 0)

  const springStart=new Date(2026,2,25).getTime(), springChange=new Date(2026,2,30).getTime()
  const eventSpring=medicineEvents([{...мед,since:springStart,planFrom:springStart,plan:[{perTime:1,days:5},{perTime:2,days:null}]}],new Date(2026,2,30,12).getTime())
  check('событие смены дозы весной ровно одно и в полночь',eventSpring.filter(e=>e.title.includes('доза')).length===1&&eventSpring.find(e=>e.title.includes('доза')).day===springChange)
  const autumnStart=new Date(2026,9,21).getTime(), autumnChange=new Date(2026,9,25).getTime()
  const eventAutumn=medicineEvents([{...мед,since:autumnStart,planFrom:autumnStart,plan:[{perTime:1,days:4},{perTime:2,days:null}]}],new Date(2026,9,26,12).getTime())
  check('осенняя смена дозы не дублируется',eventAutumn.filter(e=>e.title.includes('доза')).length===1&&eventAutumn.find(e=>e.title.includes('доза')).day===autumnChange)
  for(const month of [2,9]){
    const start=new Date(2026,month,23).getTime()
    const points=Array.from({length:14},(_,i)=>({...изм(i,100,60),ts:new Date(2026,month,23+i).getTime()}))
    points.push({...изм(99,200,100),ts:new Date(2026,month,37,0,30).getTime()})
    const comparison=compareAround(points,start)
    check(`14 календарных дат сравнения через DST месяц${month}`,comparison.after.count===14&&comparison.after.avgSys===100)
  }
  return failures
}
