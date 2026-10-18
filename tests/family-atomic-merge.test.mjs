import assert from 'node:assert/strict'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { installWebPlatform, useIndexedDbFactory, platform, DEFAULT_SETTINGS } from './build/api.mjs'

export async function run() {
  installWebPlatform();useIndexedDbFactory(new IDBFactory())
  const store=platform().storage, settings={...DEFAULT_SETTINGS,people:[{id:'p1',name:'Первый'}]}
  await store.saveSettings(settings)
  const med={id:'m',name:'Старое',left:10,dose:'',expires:null,updatedAt:1,leftAt:1,stockUpdatedAt:1}
  await store.putMedicine(med,false)
  const stale=await store.readDiary(settings)
  const incoming={...stale,labs:[{id:'lab',name:'Анализ',owner:'p1',results:[],updatedAt:2}],people:[...settings.people,{id:'p2',name:'Второй'}]}
  await store.putMedicine({...med,name:'Свежая правка',left:6,updatedAt:10,leftAt:10,stockUpdatedAt:10},false)
  const merged=await store.mergeFamily(incoming,settings)
  assert.equal(merged.medicines[0].left,6);assert.equal(merged.medicines[0].name,'Свежая правка')
  let current=await store.readDiary(settings)
  assert.equal(current.medicines[0].left,6);assert.equal(current.labs.length,1);assert.equal(current.people.length,2)
  console.log('  ok   atomic merge retains a committed local edit; coherent upload snapshot includes it')

  const untouched=JSON.stringify(current)
  assert.equal(await store.mergeFamily({...incoming,labs:[{id:'cancel',name:'cancel',owner:'p1',results:[]}]},settings,()=>false),null)
  assert.equal(JSON.stringify(await store.readDiary(settings)),untouched)
  const original=IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put=function(...args){if(this.name==='labs')throw new DOMException('Injected quota','QuotaExceededError');return original.apply(this,args)}
  try{await assert.rejects(store.mergeFamily({...incoming,medicines:[{...med,left:99,updatedAt:99,stockUpdatedAt:99}]},settings),/Injected quota/)}finally{IDBObjectStore.prototype.put=original}
  assert.equal(JSON.stringify(await store.readDiary(settings)),untouched)
  console.log('  ok   cancellation writes nothing; failure rolls back every store and people')

  await store.putLabPhoto({id:'photo',labId:'lab',data:'data:image/jpeg;base64,AA==',bytes:1,addedAt:1})
  const grave={id:'lab',kind:'lab',at:42,by:'peer'}
  await store.mergeFamily({measurements:[],medicines:[],regimens:[],labs:[],tombstones:[grave]},settings)
  current=await store.readDiary(settings)
  assert.equal(current.labs.length,0);assert.deepEqual(current.tombstones.find(x=>x.id==='lab'),grave);assert.equal((await store.labPhotos('lab')).length,0)
  // A write queued concurrently with merge must not be overwritten by its stale input.
  await Promise.all([store.mergeFamily(incoming,settings),store.putMedicine({...med,left:4,name:'Последнее',updatedAt:100,stockUpdatedAt:100,leftAt:100},false)])
  assert.equal((await store.readDiary(settings)).medicines[0].left,4)
  console.log('  ok   tombstone metadata preserved, photos cascaded, concurrent final local write retained')
  return 0
}
