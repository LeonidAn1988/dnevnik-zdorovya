import assert from 'node:assert/strict'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { installWebPlatform, useIndexedDbFactory, DEFAULT_SETTINGS, saveSettings, loadSettings,
  putMeasurements, putRegimen, putLab, getAllMeasurements, getAllRegimens, getAllLabs, getAllTombstones, mergePeopleData } from './build/api.mjs'

export async function run() {
  installWebPlatform()
  const original = IDBObjectStore.prototype.put
  const settings = { ...DEFAULT_SETTINGS, people: [{ id: 'a', name: 'Первый' }, { id: 'b', name: 'Второй' }], activePerson: 'a' }
  const measurement = { id: 'reading', kind: 'bp', person: 'a', sys: 120, dia: 80, bpm: 70, ts: 10, user: 0, source: 'manual' }
  const regimen = { id: 'course', medicineId: 'box', person: 'a', times: ['08:00'], updatedAt: 5 }
  const lab = { id: 'lab', owner: 'a', name: 'Анализ', results: [] }
  const snapshot = async () => ({ settings: await loadSettings(), readings: await getAllMeasurements(), regimens: await getAllRegimens(), labs: await getAllLabs(), tombstones: await getAllTombstones() })
  for (const store of ['readings', 'regimens', 'labs', 'meta', 'tombstones']) for (const kind of ['throw', 'abort']) {
    useIndexedDbFactory(new IDBFactory())
    await saveSettings(settings)
    await putMeasurements([measurement, { ...measurement, id: 'remove' }])
    await putRegimen(regimen)
    await putLab(lab)
    // Initialize installation metadata before injecting failure in the commit.
    await mergePeopleData({ settings, measurements: [], regimens: [], labs: [], removed: [] })
    const before = await snapshot()
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === store) {
        if (kind === 'throw') throw new DOMException('Synthetic quota failure', 'QuotaExceededError')
        this.transaction.abort()
        return
      }
      return original.apply(this, args)
    }
    try {
      await assert.rejects(mergePeopleData({ settings: { ...settings, people: [settings.people[1]], activePerson: 'b', mergedPeople: { a: 'b' } }, measurements: [{ ...measurement, person: 'b' }], regimens: [{ ...regimen, person: 'b' }], labs: [{ ...lab, owner: 'b' }], removed: ['remove'] }))
    } finally { IDBObjectStore.prototype.put = original }
    assert.deepEqual(await snapshot(), before, `${store}/${kind}: identity and all records must roll back together`)
    const data = { settings: { ...settings, people: [settings.people[1]], activePerson: 'b', mergedPeople: { a: 'b' } }, measurements: [{ ...measurement, person: 'b' }], regimens: [{ ...regimen, person: 'b' }], labs: [{ ...lab, owner: 'b' }], removed: ['remove'] }
    await mergePeopleData(data)
    await mergePeopleData(data)
    const after = await snapshot()
    assert.equal(after.settings.activePerson, 'b')
    assert.deepEqual(after.readings.map(r => [r.id, r.person]), [['reading', 'b']])
    assert.deepEqual(after.regimens.map(r => [r.id, r.person]), [['course', 'b']])
    assert.equal(after.regimens[0].scheduleUpdatedAt, 5)
    assert.deepEqual(after.labs.map(r => [r.id, r.owner]), [['lab', 'b']])
    assert.equal(after.tombstones.filter(t => t.id === 'remove').length, 1)
    console.log(`  ok   atomic family identity: ${store}/${kind}; retry without duplicates`)
  }
  return 0
}
