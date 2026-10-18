import {build} from 'esbuild';import {writeFileSync} from 'node:fs'
await build({entryPoints:['tests/api.ts'],bundle:true,format:'esm',outfile:'/private/tmp/omron-fixes-oracle-api.mjs',external:['fake-indexeddb'],logLevel:'error'})
const api=await import('/private/tmp/omron-fixes-oracle-api.mjs');let state=7371,checks=0;const failures=[]
const rand=n=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state%n},equal=(name,actual,expected)=>{checks++;if(Math.abs(actual-expected)>1e-6||actual===null!== (expected===null))failures.push({name,actual,expected})}
for(const tz of ['Europe/Moscow','Europe/Berlin','America/New_York','Australia/Lord_Howe','Asia/Kathmandu']){
 process.env.TZ=tz
 for(let trial=0;trial<100;trial++){
  const baseMonth=trial%2?2:9,day=(n,h=0)=>new Date(2026,baseMonth,n,h).getTime(),nowDay=12+rand(22),now=day(nowDay,rand(24)),leftAt=day(1,rand(24)),left=40+rand(100),coef=20+rand(25)
  const box={id:'m',name:'synthetic',left,leftAt,expires:null,stockUnit:'ml',doseUnit:'ml',dropsPerMl:coef}
  const specs=Array.from({length:1+rand(3)},(_,i)=>({id:'r'+i,start:1+rand(10),stageDays:2+rand(12),end:20+rand(20),stop:rand(3)===0?day(12+rand(24),rand(24)):undefined,amountA:rand(4),amountB:(1+rand(4))/2,aTimes:[8,14,20].slice(0,1+rand(3)),bTimes:[9,19].slice(0,1+rand(2)),drops:rand(2)===1,on:1+rand(4),off:rand(3)}))
  const courses=specs.map(s=>api.dosing(box,{id:s.id,medicineId:'m',person:s.id,since:day(s.start),startedAt:day(s.start),planFrom:day(s.start),endsAt:day(s.end),stoppedAt:s.stop,doseUnit:s.drops?'drop':'ml',times:s.aTimes.map(h=>String(h).padStart(2,'0')+':00'),rhythm:s.off?{onDays:s.on,offDays:s.off,from:day(s.start)}:undefined,plan:[{days:s.stageDays,perTime:s.amountA,times:s.aTimes.map(h=>String(h).padStart(2,'0')+':00')},{days:null,perTime:s.amountB,times:s.bTimes.map(h=>String(h).padStart(2,'0')+':00')}]}))
  const events=[]
  for(const s of specs)for(let d=s.start;d<=s.end;d++){
   if(s.off&&(d-s.start)%(s.on+s.off)>=s.on)continue
   const first=d-s.start<s.stageDays,amount=(first?s.amountA:s.amountB)/(s.drops?coef:1);if(!amount)continue
   for(const h of first?s.aTimes:s.bTimes){const ts=day(d,h);if(s.stop!==undefined&&ts>=s.stop)continue;events.push({ts,amount})}
  }
  const used=events.filter(e=>e.ts>leftAt&&e.ts<=now).reduce((n,e)=>n+e.amount,0)
  equal(`${tz}:${trial}:projectedLeft`,api.projectedLeft(box,courses,now),Math.max(0,left-used))
  equal(`${tz}:${trial}:needUntilEnd`,api.needUntilEnd(courses,now),events.filter(e=>e.ts>now).reduce((n,e)=>n+e.amount,0))
  equal(`${tz}:${trial}:needForDays`,api.needForDays(courses,now,7),events.filter(e=>e.ts>now&&e.ts<day(nowDay+7)).reduce((n,e)=>n+e.amount,0))
 }
}
writeFileSync('reviews/evidence/total-audit-fixes/oracle.json',JSON.stringify({checks,failures,coverage:'500 independently enumerated finite courses scenarios, 1-3 shared courses, future starts, finite ends, stop mid-day, dose and frequency changes, pauses, ml/drop, 5 timezones near DST; valid inputs'},null,2)+'\n');console.log(JSON.stringify({checks,failures},null,2));process.exitCode=failures.length?1:0
