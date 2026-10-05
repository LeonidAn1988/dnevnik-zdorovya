/** Independent calendar/quantity oracle: no production dose, rhythm or conversion helpers. */
import assert from 'node:assert/strict'
import * as api from './build/api.mjs'
export function run(){
 let failures=0,checks=0
 const check=(name,fn)=>{checks++;try{fn()}catch(e){failures++;console.log(`  FAIL ${name}: ${e.message}`)}}
 const date=(offset,h=0)=>new Date(2026,2,20+offset,h).getTime()
 let random=0x51a7;const rnd=n=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random%n}
 for(let trial=0;trial<240;trial++){
  const now=date(12), stock=rnd(200)+1, drops=[20,40,32][rnd(3)], unit=['piece','sachet','ml'][rnd(3)]
  const box={id:'box',name:'Тест',form:'',left:stock,leftAt:date(0),expires:null,stockUnit:unit,doseUnit:unit,dropsPerMl:drops}
  const specs=Array.from({length:1+rnd(3)},(_,i)=>({id:'r'+i,start:rnd(18),firstDays:1+rnd(15),secondDays:1+rnd(20),firstAmount:[0,.5,1,2][rnd(4)],secondAmount:[.25,.5,1,3][rnd(4)],firstTimes:['08:00','14:00','20:00'].slice(0,1+rnd(3)),secondTimes:['09:00','19:00'].slice(0,1+rnd(2)),on:1+rnd(4),off:rnd(3),drop:unit==='ml'&&rnd(2)===0}))
  const courses=specs.map(s=>api.dosing(box,{id:s.id,medicineId:box.id,person:'p'+s.id,since:date(s.start),planFrom:date(s.start),perTime:s.firstAmount,times:s.firstTimes,doseUnit:s.drop?'drop':unit,rhythm:s.off?{onDays:s.on,offDays:s.off,from:date(s.start)}:undefined,plan:[{perTime:s.firstAmount,times:s.firstTimes,days:s.firstDays},{perTime:s.secondAmount,times:s.secondTimes,days:s.secondDays}]}))
  const events=s=>{const result=[];for(let d=s.start;d<s.start+s.firstDays+s.secondDays;d++){
   if(s.off&&(d-s.start)%(s.on+s.off)>=s.on)continue
   const first=d-s.start<s.firstDays,amount=first?s.firstAmount:s.secondAmount
   if(amount===0)continue
   for(const time of first?s.firstTimes:s.secondTimes){const [h,m]=time.split(':').map(Number);result.push({ts:new Date(2026,2,20+d,h,m).getTime(),day:d,time,amount:amount/(s.drop?drops:1),dose:amount})}
  }return result}
  const all=specs.flatMap(events), used=all.filter(e=>e.ts>date(0)&&e.ts<=now).reduce((a,e)=>a+e.amount,0),left=Math.max(0,stock-used)
  const remaining=all.filter(e=>e.ts>now).reduce((a,e)=>a+e.amount,0)
  check(`case${trial} shared projected stock`,()=>assert(Math.abs(api.projectedLeft(box,courses,now)-left)<1e-6))
  check(`case${trial} total remaining course requirement`,()=>assert(Math.abs(api.needUntilEnd(courses,now)-remaining)<1e-8))
  const horizon=all.filter(e=>e.ts>now&&e.ts<date(19)).reduce((a,e)=>a+e.amount,0)
  check(`case${trial} seven calendar days remaining`,()=>assert(Math.abs(api.needForDays(courses,now,7)-horizon)<1e-8))
  const memo=api.buildMemo(courses,[],now)
  const expectedTotals=specs.map(spec=>events(spec).filter(e=>e.day>=12&&e.day<19).reduce((sum,e)=>sum+e.dose,0)).filter(n=>n>0)
  check(`case${trial} memo every course weekly doses`,()=>assert.deepEqual(memo.totals.map(t=>t.pieces),expectedTotals))
  check(`case${trial} memo all courses share current box availability`,()=>assert(memo.totals.every(t=>t.enough === (left+1e-6>=horizon))))
  let available=left, expectedDays=null
  const last=Math.max(...specs.map(s=>s.start+s.firstDays+s.secondDays))
  for(let d=12;d<last;d++){const consumption=all.filter(e=>e.day===d&&e.ts>now).reduce((sum,e)=>sum+e.amount,0);if(consumption>available+1e-6){expectedDays=d-12;break}available-=consumption}
  check(`case${trial} exact calendar depletion date`,()=>assert.equal(api.supplyDays(box,courses,now),expectedDays))
 }
 // Integer tenths form an independent exact sum before conversion to displayed mmol/l.
 for(let trial=0;trial<120;trial++){
  const values=Array.from({length:1+rnd(50)},()=>10+rnd(190)),sorted=[...values].sort((a,b)=>a-b),count=values.length
  const readings=values.map((v,i)=>({id:String(i),kind:'glucose',mmol:v/10,ts:date(i%5,8),context:i%2?'after-meal':'fasting',user:1,source:'manual'}))
  const summary=api.summarizeGlucose(readings,{low:3.9,fastingMax:7,postMealMax:10}),sum=values.reduce((a,b)=>a+b,0)
  check(`glucose${trial} independently summed mean`,()=>assert(Math.abs(summary.avg-sum/count/10)<1e-10))
  const mid=Math.floor(count/2),median=count%2?sorted[mid]/10:(sorted[mid-1]+sorted[mid])/20
  check(`glucose${trial} median`,()=>assert.equal(summary.median,median))
  check(`glucose${trial} classification partitions`,()=>assert.equal(summary.lowCount+summary.highCount+Math.round(summary.withinTarget*count),count))
  check(`glucose${trial} observations/count/days`,()=>assert(summary.count===count&&summary.days===Math.min(5,count)))
  for(const context of ['fasting','after-meal']){const subset=values.filter((v,i)=>(i%2?'after-meal':'fasting')===context);if(subset.length)check(`glucose${trial} ${context} mean`,()=>assert(Math.abs(summary.byContext[context].avg-subset.reduce((a,b)=>a+b,0)/subset.length/10)<1e-10))}
 }
 for(let trial=0;trial<120;trial++){
  const readings=Array.from({length:1+rnd(40)},(_,i)=>({id:String(i),kind:'bp',ts:date(i%5,i%2?20:8),sys:90+rnd(90),dia:50+rnd(60),bpm:i%3?50+rnd(50):0,user:1,ihb:i%4===0,mov:i%5===0}))
  const summary=api.summarize(readings,135,85),n=readings.length,sum=readings.reduce((a,r)=>a+r.sys,0),sum2=readings.reduce((a,r)=>a+r.sys*r.sys,0)
  check(`pressure${trial} exact integer mean`,()=>assert(Math.abs(summary.avgSys-sum/n)<1e-10))
  const expectedSd=n===1?0:Math.sqrt((sum2-sum*sum/n)/(n-1))
  check(`pressure${trial} independent sample variance formula`,()=>assert(Math.abs(summary.sdSys-expectedSd)<1e-8))
  const pulses=readings.filter(r=>r.bpm>0)
  check(`pressure${trial} unavailable pulse is excluded`,()=>assert(pulses.length?Math.abs(summary.avgBpm-pulses.reduce((a,r)=>a+r.bpm,0)/pulses.length)<1e-10:summary.avgBpm===null))
  check(`pressure${trial} target proportion`,()=>assert.equal(summary.withinTarget,readings.filter(r=>r.sys<135&&r.dia<85).length/n))
  const morning=readings.filter((r,i)=>i%2===0),evening=readings.filter((r,i)=>i%2!==0)
  check(`pressure${trial} morning minus evening`,()=>assert(evening.length?Math.abs(summary.morningEveningDelta-(morning.reduce((a,r)=>a+r.sys,0)/morning.length-evening.reduce((a,r)=>a+r.sys,0)/evening.length))<1e-10:summary.morningEveningDelta===null))
 }
 console.log(`  Независимые числовые проверки: ${checks}, ошибок: ${failures}`)
 return failures
}
