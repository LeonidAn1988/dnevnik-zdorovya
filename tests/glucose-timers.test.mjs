import {createGlucoseTimer,glucoseTimerReminder,glucoseTimerEntry,toJson,parseJson} from './build/api.mjs'
export function run(){
 let failures=0;const check=(name,ok)=>{console.log(`  ${ok?'ok  ':'FAIL'} ${name}`);if(!ok)failures++}
 const now=new Date(2026,9,25,1,30).getTime(),a=createGlucoseTimer('p1',now,[])
 check('ровно два прошедших часа, включая перевод часов',a.dueAt-now===7200000)
 check('двойное нажатие не создаёт второй таймер',createGlucoseTimer('p1',now+1,[a])===a)
 const b=createGlucoseTimer('p2',now,[a]);check('у другого человека отдельный ID',b.id!==a.id&&b.person==='p2')
 check('отмена допускает новый таймер',createGlucoseTimer('p1',now+1,[{...a,cancelledAt:now}]).id!==a.id)
 const r=glucoseTimerReminder(a,'Я');check('уведомление открывает сахар нужного человека',r.kind==='glucose'&&r.person==='p1'&&r.at===a.dueAt&&!r.markable&&r.body.includes('Я'))
 check('запись ленты имеет тот же срок и владельца',glucoseTimerEntry(a).at===a.dueAt&&glucoseTimerEntry(a).person==='p1')
 const json=toJson({measurements:[],medicines:[],regimens:[],labs:[],tombstones:[],settings:{people:[{id:'p1',name:'Я'}],glucoseTimers:[a]}})
 check('локальный таймер не попадает в экспорт',JSON.parse(json).settings.people[0].id==='p1'&&!JSON.parse(json).settings.glucoseTimers)
 const incoming=JSON.parse(json);incoming.settings.glucoseTimers=[a];check('чужой таймер не восстанавливается из импортированной копии',!parseJson(JSON.stringify(incoming)).settings.glucoseTimers)
 return failures
}
