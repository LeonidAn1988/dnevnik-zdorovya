import assert from 'node:assert/strict'
import { IDBFactory, IDBObjectStore, IDBCursor } from 'fake-indexeddb'
import { installWebPlatform, useIndexedDbFactory, platform, DEFAULT_SETTINGS } from './build/api.mjs'
export async function run() {
 installWebPlatform(); useIndexedDbFactory(new IDBFactory()); const s=platform().storage
 const settings={...DEFAULT_SETTINGS,people:[{id:'person',name:'Local'}],activePerson:'person',theme:'dark'}
 await s.saveSettings(settings)
 const lab={id:'lab',name:'Local lab',owner:'person',results:[],updatedAt:10}
 const photo={id:'photo',labId:'lab',day:1,blob:new Blob(['fixture']),width:1,height:1,bytes:7}
 const med={id:'med',name:'Local',left:6,leftAt:20,dose:'',expires:null,updatedAt:20}
 await s.putLab(lab,false);await s.putLabPhoto(photo);await s.putMedicine(med,false)
 const incoming={measurements:[{id:'reading',kind:'bp',ts:1,person:'person',sys:120,dia:80,bpm:70,user:0,source:'manual'}],medicines:[{...med,left:99,updatedAt:1},{...med,id:'new-med'}],regimens:[],labs:[{...lab,id:'new-lab'}],tombstones:[{id:'lab',kind:'lab',at:15,by:'peer'}],settings:{people:settings.people,activePerson:'person',targetSys:125},skipped:0}
 const snapshot=async()=>({diary:await s.readDiary(settings),settings:await s.loadSettings(),photos:await s.labPhotos('lab')})
 const before=await snapshot()
 for(const store of ['readings','medicines','labs','meta']) {
  const original=IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put=function(...args){if(this.name===store)throw new Error('Injected '+store);return original.apply(this,args)}
  try{await assert.rejects(s.restoreBackup(incoming,settings),/Injected/)}finally{IDBObjectStore.prototype.put=original}
  assert.deepEqual(await snapshot(),before)
 }
 const del=IDBCursor.prototype.delete
 IDBCursor.prototype.delete=function(){throw new Error('Injected photo cascade')}
 try{await assert.rejects(s.restoreBackup(incoming,settings),/Injected photo/)}finally{IDBCursor.prototype.delete=del}
 assert.deepEqual(await snapshot(),before)
 console.log('  ok   failed restore rolls back readings, medicines, labs, settings, graves and photos')
 await s.putMeasurements([{...incoming.measurements[0],id:'a-recent',ts:100}],false)
 const done=await s.restoreBackup(incoming,settings)
 assert.deepEqual(done.measurements.map(m=>m.ts),[1,100]);
 assert.equal(done.added,1);assert.equal(done.addedMedicines,1);assert.equal(done.settingsRestored,true)
 assert.equal(done.medicines.find(x=>x.id==='med').left,6);assert.equal((await s.loadSettings()).targetSys,125);assert.equal((await s.loadSettings()).theme,'dark')
 assert.deepEqual(done.tombstones.find(t=>t.id==='lab'),incoming.tombstones[0]);assert.equal((await s.labPhotos('lab')).length,0)
 const repeat=await s.restoreBackup(incoming,settings);assert.equal(repeat.added,0);assert.equal(repeat.addedMedicines,0)
 console.log('  ok   successful restore preserves current stock/device theme and source deletion metadata; retry is idempotent')
 await assert.rejects(s.putLabPhoto(photo),/удалён/)
 await assert.rejects(s.putLabPhoto({...photo,labId:'missing'}),/удалён/)
 await s.putLab({...lab,id:'live'},false);await s.putLabPhoto({...photo,id:'live-photo',labId:'live'})
 IDBCursor.prototype.delete=function(){throw new Error('Injected delete photo')}
 try{await assert.rejects(s.deleteLab('live'),/Injected delete photo/)}finally{IDBCursor.prototype.delete=del}
 assert.ok((await s.allLabs()).some(l=>l.id==='live'));assert.equal((await s.labPhotos('live')).length,1)
 await s.deleteLab('live');assert.equal((await s.labPhotos('live')).length,0)
 console.log('  ok   late photo rejected; parent/photo deletion is atomic')
 return 0
}
