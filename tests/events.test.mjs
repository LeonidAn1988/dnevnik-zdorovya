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

  return failures
}
