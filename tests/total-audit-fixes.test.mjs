/** Regression checks use independent expected values and real IndexedDB transactions. */
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { installWebPlatform, useIndexedDbFactory, platform, DEFAULT_SETTINGS, toJson, parseImportFile, mergeDiary, dosing, projectedLeft, addPack } from './build/api.mjs'
export async function run() {
  installWebPlatform(); useIndexedDbFactory(new IDBFactory())
  const store=platform().storage, settings={...DEFAULT_SETTINGS,people:[{id:'p',name:'Тест'}]}
  await store.saveSettings(settings)
  const reading={id:'bp',person:'p',kind:'bp',ts:new Date(2026,9,17,8).getTime(),sys:120,dia:80,bpm:70,user:0,source:'manual',ihb:false,mov:false}
  await store.putMeasurements([reading]); await store.deleteMeasurement(reading.id)
  await assert.rejects(store.putMeasurements([{...reading,sys:135}],true,true),/уже удалено/)
  await assert.rejects(store.putMeasurements([{...reading,id:'new'},reading],true,true),/уже удалено/)
  assert.equal((await store.allMeasurements()).length,0,'A rejected batch rolls back every row')
  const lab={id:'l',owner:'p',name:'Анализ',results:[],ts:reading.ts}
  await store.putLab(lab);await store.deleteLab(lab.id)
  await assert.rejects(store.putLab({...lab,name:'Правка'},true,true),/удалён/)
  assert.equal((await store.allLabs()).length,0)
  // Bulk re-imports keep their existing skip-deleted contract.
  await store.putMeasurements([reading]);await store.putLab(lab)
  assert.equal((await store.allMeasurements()).length,0);assert.equal((await store.allLabs()).length,0)
  console.log('  ok   deleted user edits reject and roll back; bulk imports skip deleted rows')

  await store.restoreMeasurement(reading)
  const restored=(await store.allMeasurements())[0]
  assert.deepEqual({...restored,id:reading.id,updatedAt:undefined},{...reading,updatedAt:undefined})
  const edited={...restored,sys:125};await store.putMeasurements([edited])
  await store.restoreMeasurement(reading)
  assert.equal((await store.allMeasurements()).length,1);assert.equal((await store.allMeasurements())[0].sys,125)
  const snapshot=await store.readDiary(settings)
  const parsed=parseImportFile('family.json',toJson({...snapshot,settings}))
  assert.equal(parsed.tombstones.filter(x=>x.kind==='lab').length,1,'Lab deletion survives export/import')
  const peer={measurements:[reading],medicines:[],regimens:[],labs:[lab],people:settings.people,tombstones:snapshot.tombstones}
  const received=mergeDiary(peer,{...parsed,people:parsed.settings.people})
  assert.deepEqual(received.measurements.map(x=>x.id),['restored:bp']);assert.equal(received.labs.length,0)
  const echoed=mergeDiary(snapshot,received)
  assert.equal(echoed.measurements.length,1);assert.equal(echoed.measurements[0].sys,125)
  await store.deleteMeasurement(restored.id)
  await assert.rejects(store.restoreMeasurement(reading),/уже удалена/)
  const final=mergeDiary(await store.readDiary(settings),received)
  assert.equal(final.measurements.length,0,'Later deletion of restored row wins over stale peer')
  console.log('  ok   undo survives peer round-trip once, preserves edits, and respects later deletion')

  const now=new Date(2026,9,18,12).getTime(),box={id:'m',name:'Проба',dose:'',left:10,leftAt:now-86400000,expires:null,stockUnit:'ml',doseUnit:'ml'}
  const negative=dosing(box,{id:'r',medicineId:'m',perDay:-2,since:now-86400000,person:'p'})
  assert.equal(projectedLeft(box,[negative],now),null,'Negative consumption cannot grow stock')
  assert.equal(projectedLeft({...box,left:-5},[],now),null,'Negative stock is not a valid projection')
  const incompatible=dosing(box,{id:'r',medicineId:'m',perDay:1,doseUnit:'piece',since:now-86400000,person:'p'})
  assert.equal(projectedLeft(box,[incompatible],now),null)
  assert.throws(()=>addPack(box,[incompatible],now,20),/единицы/)
  assert.equal(addPack({...box,left:null},[],now,20).left,20,'First purchase with no previous known stock remains possible')
  assert.equal(addPack({...box,leftAt:now},[],now,20).left,30)
  console.log('  ok   invalid quantities do not increase stock; incompatible units cannot silently discard known stock')
  return 0
}
