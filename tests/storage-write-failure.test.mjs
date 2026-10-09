import assert from 'node:assert/strict'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { installWebPlatform, useIndexedDbFactory, putMedicine, putRegimen, getAllMedicines, getAllRegimens } from './build/api.mjs'

/** Rejection must settle even when put throws inside an IDB success callback. */
export async function run() {
  installWebPlatform()
  useIndexedDbFactory(new IDBFactory())
  const original = IDBObjectStore.prototype.put
  for (const [store, save, read, item] of [
    ['medicines', putMedicine, getAllMedicines, { id: 'm1', name: 'Тест', dose: '', left: 10, expires: null }],
    ['regimens', putRegimen, getAllRegimens, { id: 'r1', medicineId: 'm1', person: 'p1', times: ['08:00'], perTime: 1 }],
  ]) {
    for (const failure of ['throw', 'abort']) {
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === store) {
          if (failure === 'throw') throw new DOMException('Injected quota failure', 'QuotaExceededError')
          this.transaction.abort()
          return
        }
        return original.apply(this, args)
      }
      let timeout
      try {
        await assert.rejects(Promise.race([
          save(item),
          new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Storage write hung')), 1000) }),
        ]), error => failure === 'throw' ? error.name === 'QuotaExceededError' : error.name === 'AbortError')
        assert.deepEqual(await read(), [], 'A failed write must not persist a partial object')
      } finally {
        clearTimeout(timeout)
        IDBObjectStore.prototype.put = original
      }
    }
    await save(item)
    assert.equal((await read()).length, 1, 'Retry works after the failure')
    console.log(`  ok   ${store}: synchronous failure and transaction abort reject; retry succeeds`)
  }
  return 0
}
