/**
 * Статистика для отчёта врачу — на наборе, посчитанном руками.
 *
 * Пять измерений: 120/80, 130/85, 140/90, 150/95, 160/100. Среднее по
 * систолическому 140, по диастолическому 90; выборочное стандартное отклонение
 * систолического — sqrt(1000/4) ≈ 15,81; в цели 135/85 — ровно одно из пяти.
 */
import { describe, summarize, filterByPeriod, dailyAverages, movingAverage, glucoseMovingAverage, summarizeGlucose } from './build/api.mjs'

const ДЕНЬ = 24 * 60 * 60 * 1000
const база = Date.UTC(2026, 7, 1, 9, 0, 0)
const bp = (i, sys, dia, bpm = 60 + i) => ({
  id: `r${i}`, kind: 'bp', ts: база + i * ДЕНЬ, sys, dia, bpm, ihb: i === 2, mov: false, user: 1,
})
const ряд = [bp(0, 120, 80), bp(1, 130, 85), bp(2, 140, 90), bp(3, 150, 95), bp(4, 160, 100)]

export function run() {
  let failures = 0
  const check = (name, condition, detail = '') => {
    if (condition) console.log(`  ok   ${name}`)
    else {
      console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`)
      failures++
    }
  }
  const близко = (a, b, eps = 0.02) => Math.abs(a - b) < eps

  const d = describe([120, 130, 140, 150, 160])
  check('среднее', d.avg === 140)
  check('минимум и максимум', d.min === 120 && d.max === 160)
  check('стандартное отклонение', близко(d.sd, 15.81), String(d.sd))
  check('пустой ряд — null', describe([]) === null)

  const s = summarize(ряд, 135, 85)
  check('число измерений', s.count === 5)
  check('средние', s.avgSys === 140 && s.avgDia === 90)
  check('крайние', s.minSys === 120 && s.maxSys === 160 && s.minDia === 80 && s.maxDia === 100)
  check('доля в цели — ровно одно из пяти', s.withinTarget === 0.2)
  check('нерегулярный пульс посчитан', s.ihbCount === 1)
  check('первая и последняя дата', s.firstTs === ряд[0].ts && s.lastTs === ряд[4].ts)
  // Дней наблюдения, а не измерений: три подряд снятых замера в один вечер —
  // это один день, и среднее по ним не описывает месяц. Без этой цифры
  // «145/92» по трём записям читается как приговор за весь период.
  check('дней столько же, сколько измерений — они в разные дни', s.days === 5)
  const залп = [bp(0, 120, 80), { ...bp(0, 130, 85), id: 'z2', ts: база + 60_000 }, { ...bp(0, 140, 90), id: 'z3', ts: база + 120_000 }]
  const сводкаЗалпа = summarize(залп, 135, 85)
  check('три замера подряд — один день наблюдения', сводкаЗалпа.count === 3 && сводкаЗалпа.days === 1)
  check('без измерений — null', summarize([], 135, 85) === null)

  check('период «всё» ничего не режет', filterByPeriod(ряд, 'all').length === 5)
  check('период отбирает не больше исходного', filterByPeriod(ряд, '7d').length <= 5)

  const дни = dailyAverages(ряд)
  check('по дню на измерение', дни.length === 5)
  const сглаж = movingAverage(дни, 7)
  check('скользящее среднее последней точки — среднее всех', сглаж.length === 5 && сглаж[4].sys === 140)
  check('первая точка — она сама', сглаж[0].sys === 120 && сглаж[0].dia === 80)
  // Окно в два дня: последняя точка — среднее двух последних, 155/97,5.
  const окно2 = movingAverage(дни, 2)
  check('окно в два дня берёт только две точки', окно2[4].sys === 155 && окно2[4].dia === 97.5)
  check('окно у сахара работает так же', glucoseMovingAverage([{ ts: база, mmol: 4, count: 1 }, { ts: база + ДЕНЬ, mmol: 6, count: 1 }], 7)[1].mmol === 5)

  const g = summarizeGlucose(
    [
      { id: 'g1', kind: 'glucose', ts: база, mmol: 5.5, context: 'fasting', user: 1, source: 'manual' },
      { id: 'g2', kind: 'glucose', ts: база + ДЕНЬ, mmol: 11, context: 'after-meal', user: 1, source: 'manual' },
    ],
    { fastingMax: 7, postMealMax: 10, low: 3.9 },
  )
  check('сахар: обе записи учтены', g !== null && g.count === 2)

  check('сахар: медиана двух значений и два дня', g.median === 8.25 && g.days === 2)
  check('сахар: моменты замера не смешиваются', g.byContext.fasting.avg === 5.5 && g.byContext['after-meal'].avg === 11)
  const mixed = summarizeGlucose([12, 4, 6, 8, 10].map((mmol,i) => ({id:`x${i}`,kind:'glucose',ts:база+i*60000,mmol,context:i<2?'fasting':'after-meal'})), {fastingMax:7,postMealMax:10,low:3.9})
  check('сахар: общая средняя, медиана и день на несортированном ряду', mixed.avg === 8 && mixed.median === 8 && mixed.days === 1)
  check('сахар: отдельные средние по моментам', mixed.byContext.fasting.avg === 8 && mixed.byContext['after-meal'].avg === 8)
  check('сахар: пустой ряд без придуманных средних', summarizeGlucose([], {fastingMax:7,postMealMax:10,low:3.9}) === null)
  const shuffled = summarize([ряд[3],ряд[0],ряд[4],ряд[1],ряд[2]],135,85)
  check('даты диапазона не зависят от порядка записей', shuffled.firstTs===ряд[0].ts&&shuffled.lastTs===ряд[4].ts)
  const shuffledG = summarizeGlucose([{kind:'glucose',ts:3,mmol:5,context:'fasting'},{kind:'glucose',ts:1,mmol:6,context:'fasting'},{kind:'glucose',ts:2,mmol:7,context:'fasting'}],{low:3.9,fastingMax:7,postMealMax:10})
  check('даты сахара — настоящий минимум/максимум времени',shuffledG.firstTs===1&&shuffledG.lastTs===3)
  // Enumerate calendar days independently of elapsed milliseconds; tested in all DST zones.
  const points = Array.from({length:100},(_,i)=>({ts:new Date(2026,2,1+i).getTime(),sys:i===0?200:i,dia:i,bpm:null,count:1}))
  const windows = movingAverage(points,7)
  check('семидневное окно всегда содержит семь календарных дат весной',windows.every((p,i)=>Math.abs(p.sys-points.slice(Math.max(0,i-6),i+1).reduce((sum,r)=>sum+r.sys,0)/Math.min(7,i+1))<1e-8))
  const autumn = Array.from({length:100},(_,i)=>({ts:new Date(2026,8,1+i).getTime(),mmol:i,count:1}))
  check('семидневное окно сахара — семь дат осенью',glucoseMovingAverage(autumn,7).every((p,i)=>Math.abs(p.mmol-autumn.slice(Math.max(0,i-6),i+1).reduce((sum,r)=>sum+r.mmol,0)/Math.min(7,i+1))<1e-8))
  const savedNow=Date.now
  try{
    Date.now=()=>new Date(2026,10,14,23).getTime()
    const now=Date.now(),future=[{ts:now,value:120},{ts:now+31*86400000,value:200}]
    check('ограниченный прошедший период исключает будущие записи',filterByPeriod(future,'7d').length===1&&filterByPeriod(future,'30d').length===1&&filterByPeriod(future,'90d').length===1)
    check('всё время сохраняет доступ к будущим записям для исправления',filterByPeriod(future,'all').length===2)
  }finally{Date.now=savedNow}
  return failures
}
