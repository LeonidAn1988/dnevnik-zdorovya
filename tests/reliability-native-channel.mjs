// Real reminder adapter, synthetic Android bridge. No device or personal data.
// getPending deliberately omits channelId, matching the Android implementation.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pending = new Map()
const channels = new Map()
const deleted = []
const writes = []
let pendingCalls = 0
let failPending = () => false
let failSchedule = false
let action
const oldChannel = 'omron-meds-v2-system'
const newChannel = 'omron-meds-v2-myagkiy'
const snoozeId = 20_000_123
const previewId = 40_000_001

globalThis.reliabilityNotifications = {
  getDeliveredNotifications: async () => ({ notifications: [] }),
  removeDeliveredNotifications: async () => {},
  listChannels: async () => ({ channels: [...channels.values()] }),
  deleteChannel: async ({ id }) => { deleted.push(id); channels.delete(id) },
  registerActionTypes: async () => {},
  checkExactNotificationSetting: async () => ({ exact_alarm: 'granted' }),
  getPending: async () => {
    if (failPending(++pendingCalls)) throw new Error('synthetic getPending failure')
    return { notifications: [...pending.values()].map(({ channelId, ...rest }) => rest) }
  },
  cancel: async ({ notifications }) => notifications.forEach(n => pending.delete(n.id)),
  schedule: async ({ notifications }) => {
    if (failSchedule) throw new Error('synthetic schedule failure')
    writes.push(notifications)
    notifications.forEach(n => pending.set(n.id, n))
  },
  addListener: async (_event, handler) => { action = handler; return { remove() {} } },
}
globalThis.reliabilitySettings = {
  createMedsChannel: async ({ id }) => { channels.set(id, { id }); return { bypassDnd: false } },
}
const result = await build({
  stdin: {
    contents: "export { capacitorReminders } from './src/platform/capacitor/reminders'",
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true, write: false, format: 'esm', logLevel: 'error',
  plugins: [{ name: 'synthetic-bridge', setup(builder) {
    builder.onResolve({ filter: /^@capacitor\// }, args => ({ path: args.path, namespace: 'bridge' }))
    builder.onLoad({ filter: /.*/, namespace: 'bridge' }, args => ({
      contents: args.path === '@capacitor/local-notifications'
        ? 'export const LocalNotifications = globalThis.reliabilityNotifications'
        : 'export const registerPlugin = () => globalThis.reliabilitySettings',
      loader: 'js',
    }))
  } }],
})
const { capacitorReminders: reminders } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
reminders.onAction(() => {})
const day = new Date(2026, 9, 18).getTime()
const regular = {
  id: 123, title: 'Synthetic dose', body: 'Synthetic only',
  kind: 'dose', day, slot: '08:00', person: 'synthetic-person',
  at: Date.now() + 60_000, markable: true,
}
const reset = () => {
  pending.clear(); channels.clear(); deleted.length = 0; writes.length = 0
  pendingCalls = 0; failPending = () => false; failSchedule = false
}
const baseline = async () => {
  reset()
  await reminders.schedule([regular], 'system', () => true)
  pendingCalls = 0; writes.length = 0; deleted.length = 0
}

await baseline()
action({ actionId: 'snooze', notification: pending.get(regular.id) })
await new Promise(resolve => setImmediate(resolve))
assert.ok(pending.has(snoozeId), 'snooze created by real adapter')
const beforeSnooze = pending.get(snoozeId)
await reminders.schedule([regular], 'myagkiy', () => true)
assert.ok(channels.has(oldChannel), 'pending snooze retains its existing channel')
assert.ok(channels.has(newChannel), 'normal reminders use the new channel')
assert.deepEqual(pending.get(snoozeId), beforeSnooze, 'sound change preserves snooze time, owner and content')
assert.equal(pending.get(regular.id).channelId, newChannel)
console.log('PASS: snooze survives sound change without channelId in getPending')

await baseline()
await reminders.preview('system')
assert.ok(pending.has(previewId))
await reminders.schedule([regular], 'myagkiy', () => true)
assert.ok(channels.has(oldChannel), 'pending sound preview retains its channel')
pending.delete(previewId) // synthetic delivery
await reminders.schedule([regular], 'myagkiy', () => true)
assert.ok(!channels.has(oldChannel), 'unused channel is eventually cleaned up')
console.log('PASS: preview survives; unused old channel is cleaned up later')

await baseline()
failPending = call => call === 1
await assert.rejects(reminders.schedule([regular], 'myagkiy', () => true))
assert.equal(writes.length, 0, 'failed alarm inventory prevents new scheduling')
assert.ok(channels.has(oldChannel), 'failed inventory keeps existing channel')
assert.equal(pending.get(regular.id).channelId, oldChannel)
await reminders.schedule([regular], 'myagkiy', () => true)
assert.equal(pending.get(regular.id).channelId, newChannel, 'retry replaces normal reminders after inventory recovers')
console.log('PASS: transient inventory failure preserves delivery and a retry recovers')

await baseline()
failPending = () => true
await assert.rejects(reminders.schedule([regular], 'myagkiy', () => true))
assert.equal(writes.length, 0, 'unknown alarm count prevents new alarms')
assert.ok(channels.has(oldChannel), 'persistent failure preserves existing delivery channel')
assert.equal(pending.get(regular.id).channelId, oldChannel)
console.log('PASS: persistent inventory failure leaves existing alarms deliverable')

await baseline()
failPending = call => call === 2
await reminders.schedule([regular], 'myagkiy', () => true)
assert.equal(writes.length, 1)
assert.equal(pending.get(regular.id).channelId, newChannel)
assert.ok(channels.has(oldChannel), 'unknown state during cleanup preserves old channels')
assert.ok(channels.has(pending.get(regular.id).channelId),
  'failed cleanup inventory must not invalidate successfully scheduled alarms')
console.log('PASS: cleanup inventory failure leaves successfully replaced alarms usable')

await baseline()
failSchedule = true
await assert.rejects(reminders.schedule([regular], 'myagkiy', () => true))
assert.equal(writes.length, 0)
assert.equal(pending.get(regular.id).channelId, oldChannel)
assert.ok(channels.has(oldChannel), 'failed native replacement keeps old delivery channel')
console.log('PASS: failed native replacement preserves the existing alarm channel')
