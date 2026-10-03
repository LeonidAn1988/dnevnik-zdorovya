import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useBackup } from '../src/ui/useBackup'
import { useReminders } from '../src/ui/useReminders'
import { Entry } from '../src/ui/Entry'
import { GlucoseEntry } from '../src/ui/Glucose'
import { Labs } from '../src/ui/Labs'
import { Tour } from '../src/ui/Tour'
import { DEFAULT_SETTINGS } from '../src/db/store'
import { installPlatform } from '../src/platform/ports'
import { webPlatform } from '../src/platform/web'
import { dosings } from '../src/logic/regimen'

const w = window as any
const root = createRoot(document.getElementById('root')!)
const deferred = () => { let resolve: any, reject: any; const promise = new Promise<any>((r,j) => {resolve=r;reject=j}); return {promise,resolve,reject} }
const permission = deferred()
const addition = deferred()
let exact = false
w.writes=[]; w.file=null;w.graves=[];w.graveReads=0;w.failGraves=false;w.readFailureAt=Infinity;w.savedFiles=[];w.sharedFiles=[]; w.reminderCalls=[]; w.pending=[]; w.additions=[]
w.resolvePermission=()=>permission.resolve('granted')
w.resolveAddition=()=>addition.resolve()
w.grantExact=()=>{exact=true;window.dispatchEvent(new Event('reminder-permissions-changed'))}
const fake: any = {
  ...webPlatform,
  storage: {...webPlatform.storage,allTombstones:async()=>{w.graveReads++;if(w.failGraves||w.graveReads===w.readFailureAt)throw new Error('test tombstone read failure');return w.graves},requestDurability:async()=>true},
  files: {...webPlatform.files,canShare:()=>true,save:async(_name:string,content:string)=>{w.savedFiles.push(JSON.parse(content));return true},share:async(_name:string,content:string)=>{w.sharedFiles.push(JSON.parse(content));return true}},
  backup: {...webPlatform.backup,isSupported:()=>true,target:async()=>'backup.json',write:(content:string)=>new Promise(r=>w.writes.push({content,complete:()=>{w.file=JSON.parse(content);r('ok')}}))},
  reminders: {isSupported:()=>true,onAction:()=>()=>{},exactTiming:async()=>exact,permission:()=>{w.reminderCalls.push('permission');return permission.promise},schedule:async(wanted:any[],_sound:any,keep:any)=>{w.reminderCalls.push('schedule');w.pending=wanted;w.lastExact=exact;if(w.stopKey)w.snoozeRelevant=keep(w.stopKey)},cancelAll:async()=>{w.reminderCalls.push('cancelAll');w.pending=[]}},
}
installPlatform(fake)
const m=(sys:number)=>({id:'m1',kind:'bp',person:'p',user:1,source:'manual',ts:Date.now()-1000,sys,dia:80,bpm:70})
const noMedicines: any[]=[]
function BackupHarness() {
  const [items,setItems]=useState([m(120)])
  const [labs,setLabs]=useState<any[]>([])
  const [regimens,setRegimens]=useState<any[]>([])
  const [s,ss]=useState({...DEFAULT_SETTINGS,people:[{id:'p',name:'Test'}],activePerson:'p'})
  w.edit=()=>setItems([m(130)]);w.refresh=()=>setItems(old=>[...old]); w.addGrave=()=>{w.graves=[{id:'deleted-elsewhere',kind:'measurement',at:10}];setItems(old=>[...old])}; w.editSetting=()=>ss(old=>({...old,targetSys:123}))
  w.addLab=()=>setLabs([{id:'l',name:'ТТГ',owner:'p',results:[]}])
  w.addRegimen=()=>setRegimens([{id:'r',medicineId:'med',person:'p',times:['08:00']}])
  w.settings=s; w.backup=useBackup(items as any,noMedicines,regimens,labs,s as any,ss as any,true)
  return null
}
function ReminderHarness() {
  const [enabled,se]=useState(true); w.disable=()=>se(false)
  useReminders({medicines:dosings([{id:'med',name:'Medicine',form:'tablet',perPack:30,packs:1} as any],[{id:'reg',medicineId:'med',person:'p',times:['08:00'],perTime:1}]),subjects:[],labs:[],regimens:[],enabled,people:[{id:'p',name:'Test'}],sound:'system',repeat:true,ready:true,onOpen:()=>{},onTaken:()=>{}})
  return null
}
function StopReminderHarness() {
  const day = new Date(); day.setHours(0,0,0,0)
  const [regimens,setRegimens] = useState<any[]>([{id:'reg',medicineId:'med',person:'p',times:['08:00'],perTime:1,endsAt:day.getTime()}])
  w.stopKey={kind:'dose',day:day.getTime(),slot:'08:00'}
  w.stopCourse=()=>setRegimens(old=>old.map(r=>({...r,stoppedAt:Date.now(),scheduleUpdatedAt:Date.now()})))
  useReminders({medicines:dosings([{id:'med',name:'Medicine',left:20,expires:null,dose:''}],regimens),subjects:[],labs:[],regimens,enabled:true,people:[{id:'p',name:'Test'}],sound:'system',repeat:false,ready:true,onOpen:()=>{},onTaken:()=>{}})
  return null
}
w.runStopReminder=()=>root.render(<StopReminderHarness/>)
function DraftHarness({kind}: {kind:'bp'|'glucose'}) {
  const [person,sp]=useState('p1');w.person=sp
  const onAdd=async(reading:any)=>{w.additions.push({...reading,person});await addition.promise}
  return kind==='bp' ? <Entry key={person} draftKey={`test:${person}`} user={1} onAdd={onAdd}/> : <GlucoseEntry key={person} draftKey={`test:${person}`} user={1} targets={{fastingMax:7,postMealMax:10,low:3.9}} onAdd={onAdd}/>
}
function LabHarness() {
  const [items,setItems]=useState([{id:'l1',name:'Первый',owner:'p1',unit:'мг',results:[]},{id:'l2',name:'Второй',owner:'p1',unit:'ммоль',results:[]}])
  const onSave=async(next:any)=>{const d=deferred();w.labSave=d;w.labNext=next;await d.promise;setItems(old=>old.map(t=>t.id===next.id?next:t))}
  return <Labs labs={items} regimens={[]} person="p1" personName="Test" now={Date.now()} onSave={onSave} onDelete={()=>{}} onAddPhoto={async()=>{}} onDeletePhoto={async()=>{}} onBack={()=>{}}/>
}
function TourHarness() {
  const [show,ss]=useState(false); const [tab,st]=useState(false)
  return <div className="app"><nav className="tabs"><button aria-current="page">Раздел</button></nav>{!tab&&<button onClick={()=>ss(true)}>Начать</button>}{show&&<Tour tour={{key:'test',title:'Тест',steps:[{title:'Шаг',text:'Тест',tab:'bp',target:'target'}]} as any} onTab={()=>st(true)} onClose={()=>ss(false)}/>}<div data-tour="target">Цель</div></div>
}
w.runBackup=()=>root.render(<BackupHarness/>);w.runReminder=()=>root.render(<ReminderHarness/>)
w.runDraft=(kind:'bp'|'glucose')=>root.render(<DraftHarness kind={kind}/>)
w.runLabs=()=>root.render(<LabHarness/>);w.runTour=()=>root.render(<TourHarness/>)
