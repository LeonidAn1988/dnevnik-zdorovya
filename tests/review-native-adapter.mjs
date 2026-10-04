// Regression tests against the real TypeScript Android adapter.
// Only the Capacitor bridge is substituted. No Android device or real notifications.
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import assert from 'node:assert/strict'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pending = new Map()
const cancelled = []
const scheduled = []
const delivered = new Map()
const removedDelivered = []
let action
globalThis.nativeReviewNotifications = {
  getDeliveredNotifications: async () => ({ notifications: [...delivered.values()] }),
  removeDeliveredNotifications: async ({notifications}) => { for(const item of notifications){removedDelivered.push(item.id);delivered.delete(item.id)} },
  listChannels: async () => ({ channels: [] }),
  deleteChannel: async () => {},
  registerActionTypes: async () => {},
  checkExactNotificationSetting: async () => ({ exact_alarm: 'granted' }),
  getPending: async () => ({ notifications: [...pending.values()] }),
  cancel: async ({ notifications }) => {
    for (const item of notifications) { cancelled.push(item.id); pending.delete(item.id) }
  },
  schedule: async ({ notifications }) => {
    for (const item of notifications) { scheduled.push(item); pending.set(item.id, item) }
  },
  addListener: async (_name, fn) => { action = fn; return { remove() {} } },
}
globalThis.nativeReviewSettings = { createMedsChannel: async () => ({ bypassDnd: false }) }
const result = await build({
  stdin: {
    contents: `export { capacitorReminders } from './src/platform/capacitor/reminders'; export { buildReminders, snoozeIsRelevant } from './src/logic/reminders'; export { splitBox } from './src/logic/split'; export { dosing } from './src/logic/regimen';`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true, write: false, format: 'esm', logLevel: 'error',
  plugins: [{ name: 'fake-capacitor-bridge', setup(builder) {
    builder.onResolve({ filter: /^@capacitor\// }, (args) => ({ path: args.path, namespace: 'bridge' }))
    builder.onLoad({ filter: /.*/, namespace: 'bridge' }, (args) => ({
      contents: args.path === '@capacitor/local-notifications'
        ? 'export const LocalNotifications = globalThis.nativeReviewNotifications'
        : 'export const registerPlugin = () => globalThis.nativeReviewSettings',
      loader: 'js',
    }))
  } }],
})
const { capacitorReminders, buildReminders, snoozeIsRelevant, splitBox, dosing } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
const { box, regimen } = splitBox({ id: 'synthetic', name: 'Тест', dose: '', left: 30, perDay: null, expires: null, times: ['08:00'], perTime: 1 }, 'p1')
const doses = [dosing(box, regimen)]
const at = (h, m = 0) => new Date(2026, 9, 3, h, m).getTime()
const day = at(0)
const originalNow = Date.now
Date.now = () => at(8, 1)
capacitorReminders.onAction(() => {})

for (const [label, repeat, current, step, shouldCancel] of [
  ['control: repeat on, before final repeat', true, at(8, 1), 0, false],
  ['repeat off, after original notification', false, at(8, 1), 0, false],
  ['repeat on, after final repeat', true, at(8, 46), 3, false],
]) {
  pending.clear(); cancelled.length = 0; scheduled.length = 0
  Date.now = () => current
  const before = buildReminders(doses, at(7), { repeat })
  const original = before.find((item) => item.day === day && item.step === step)
  assert.ok(original?.markable)
  await capacitorReminders.schedule(before,'system',()=>true)
  action({ actionId: 'snooze', notification: {
    ...original, channelId: 'omron-meds-v2-system',
    extra: { kind: original.kind, day: original.day, slot: original.slot, person: original.person },
  } })
  await new Promise((resolve) => setImmediate(resolve))
  const snoozeId = 20_000_000 + original.id % 20_000_000
  assert.ok(pending.has(snoozeId), 'snooze was initially scheduled')
  const snoozeExact = pending.get(snoozeId).isExactNotification
  const after = buildReminders(doses, current, { repeat })
  const todaySlot = after.some((item) => item.day === day && item.slot === '08:00')
  await capacitorReminders.schedule(after, 'system', key=>snoozeIsRelevant({medicines:doses,subjects:[],labs:[],regimens:[regimen],now:current,options:{repeat}},key))
  assert.equal(cancelled.includes(snoozeId), shouldCancel, 'snooze survives rebuild until the dose is taken')
  console.log(JSON.stringify({ label, futureReminders: after.length, todaySlot, snoozeExact,
    snoozeInitiallyScheduled: true, snoozeCancelledOnRebuild: cancelled.includes(snoozeId),
    snoozeStillPending: pending.has(snoozeId) }))
  await capacitorReminders.schedule([], 'system', () => false)
  assert.equal(pending.has(snoozeId), false, 'irrelevant snooze is removed')
}
pending.clear();delivered.clear();removedDelivered.length=0
const notification = person => ({id:person==='spouse'?20_000_123:20_000_124,title:'Тест',body:'Тест',channelId:'omron-meds-v2-system',extra:{kind:'dose',day,slot:'08:00',person}})
const spouse=notification('spouse'),self=notification('self')
delivered.set(spouse.id,spouse);delivered.set(self.id,self)
await capacitorReminders.schedule([],'system',key=>key.person==='self')
assert(!delivered.has(spouse.id),'delivered spouse snooze removed when muted')
assert(delivered.has(self.id),'selected person delivered snooze retained')
action({actionId:'snooze',notification:spouse})
await new Promise(r=>setImmediate(r))
assert(!pending.has(spouse.id),'stale muted action cannot schedule again')
action({actionId:'snooze',notification:self})
await new Promise(r=>setImmediate(r))
assert(pending.has(self.id),'selected person can still snooze')
await capacitorReminders.cancelAll()
action({actionId:'snooze',notification:self})
await new Promise(r=>setImmediate(r))
assert(!pending.has(self.id),'cancel-all disables stale snooze actions')
console.log('ok Native audience: delivered snooze removed, stale action rejected, selected person retained, cancel-all respected')
Date.now = originalNow
