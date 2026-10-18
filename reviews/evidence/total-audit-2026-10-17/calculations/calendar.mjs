import { build } from 'esbuild';import {writeFileSync} from 'node:fs'
await build({entryPoints:['tests/api.ts'],bundle:true,format:'esm',outfile:'/private/tmp/omron-total-calendar-api.mjs',external:['fake-indexeddb'],logLevel:'error'})
const a=await import('/private/tmp/omron-total-calendar-api.mjs'),out=process.cwd()+'/reviews/evidence/total-audit-2026-10-17/calculations',results={}
const box={id:'b',name:'Тест',left:100,expires:null}
process.env.TZ='Europe/Moscow';const day=(n,h=0)=>new Date(2026,9,n,h).getTime()
const r={id:'r',medicineId:'b',person:'p',times:['08:00'],perTime:1,since:day(17),startedAt:day(17),endsAt:day(22),rhythm:{onDays:2,offDays:1,from:day(17)}}
const cal=a.buildCalendar([a.dosing(box,r)],day(17,7)).replaceAll('\r\n ','')
const dates=cal.match(/RDATE;VALUE=DATE-TIME:([^\r]+)/)?.[1].split(',')||[]
results.boundedCycle={courseEnd:'2026-10-22',expectedDates:['20261017T080000','20261018T080000','20261020T080000','20261021T080000'],dtstart:cal.match(/DTSTART:([^\r]+)/)?.[1],rdateCount:dates.length,first:dates.slice(0,7),last:dates.at(-1),datesAfterCourse:dates.filter(d=>d.slice(0,8)>'20261022').length}
writeFileSync(out+'/bounded-cycle.ics',cal)
process.env.TZ='Europe/Berlin';const march=(n,h=0)=>new Date(2026,2,n,h).getTime()
const dst={...r,endsAt:undefined,since:march(27),startedAt:march(27),rhythm:{onDays:2,offDays:1,from:march(27)}}
const dstCal=a.buildCalendar([a.dosing(box,dst)],march(27,7)).replaceAll('\r\n ','');const dstDates=dstCal.match(/RDATE;VALUE=DATE-TIME:([^\r]+)/)?.[1].split(',')||[]
// March29 is off with 2on1off; choose 3on1off so transition day is planned.
const dst2={...dst,rhythm:{onDays:3,offDays:1,from:march(27)}}
const dstCal2=a.buildCalendar([a.dosing(box,dst2)],march(27,7)).replaceAll('\r\n ','');const dstDates2=dstCal2.match(/RDATE;VALUE=DATE-TIME:([^\r]+)/)?.[1].split(',')||[]
results.dstCycle={expectedTransitionTime:'20260329T080000',actualTransitionDate:dstDates2.find(d=>d.startsWith('20260329')),firstDates:dstDates2.slice(0,5)}
const monday={...dst,rhythm:{weekdays:[1]}};const mondayCal=a.buildCalendar([a.dosing(box,monday)],march(28,9)).replaceAll('\r\n ','');results.dstWeeklyStart={expected:'20260330T080000',actual:mondayCal.match(/DTSTART:([^\r]+)/)?.[1]};
writeFileSync(out+'/dst-cycle.ics',dstCal2);writeFileSync(out+'/calendar.json',JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2))
