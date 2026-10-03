// Actual React hook + actual Android reminder adapter, with a fake native bridge.
// Read-only product review; no real device, account, or notification.
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const contents = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { useReminders } from './src/ui/useReminders';
import { capacitorReminders } from './src/platform/capacitor/reminders';
import { installPlatform } from './src/platform/ports';
import { splitBox } from './src/logic/split';
import { dosing } from './src/logic/regimen';
Date.now = () => new Date(2026, 9, 3, 7, 0).getTime();
const { box, regimen } = splitBox({ id:'synthetic', name:'Тест', dose:'', left:30, perDay:null, expires:null, times:['08:00'], perTime:1 },'p1');
installPlatform({kind:'native', reminders:capacitorReminders});
const props = { medicines:[dosing(box,regimen)], subjects:[], labs:[], regimens:[regimen], enabled:true, people:[{id:'p1',name:'Тест'}], sound:'system', repeat:false, ready:true, onOpen(){}, onTaken(){} };
function Test({sound='system'}) { useReminders({...props,sound}); return <span>test</span> }
const rootNode = createRoot(document.getElementById('root'));
rootNode.render(<Test/>);
window.grantExact = async () => { await capacitorReminders.requestExactTiming(); document.dispatchEvent(new Event('visibilitychange')); };
window.changeSound = () => rootNode.render(<Test sound='myagkiy'/>);
`
const result = await build({ stdin:{ contents, resolveDir:root, loader:'tsx' }, bundle:true, write:false, format:'iife', logLevel:'error', plugins:[{ name:'fake-bridge', setup(builder) {
  builder.onResolve({filter:/^@capacitor\//}, args => ({path:args.path, namespace:'bridge'}))
  builder.onLoad({filter:/.*/,namespace:'bridge'},args => ({contents:args.path === '@capacitor/local-notifications' ? 'export const LocalNotifications = window.nativeReviewNotifications' : 'export const registerPlugin = () => window.nativeReviewSettings',loader:'js'}))
} }] })
const browser = await chromium.launch({headless:true})
try {
  const page = await browser.newPage({hasTouch:true})
  await page.route('https://review.invalid/**', route => route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}))
  await page.goto('https://review.invalid/')
  await page.evaluate(() => {
    window.reviewGrant = false
    window.reviewSchedules = []
    window.reviewPending = []
    window.nativeReviewSettings = {createMedsChannel:async()=>({bypassDnd:false})}
    window.nativeReviewNotifications = {
      checkPermissions:async()=>({display:'granted'}),
      checkExactNotificationSetting:async()=>({exact_alarm:window.reviewGrant?'granted':'denied'}),
      changeExactNotificationSetting:async()=>{window.reviewGrant=true;return {exact_alarm:'granted'}},
      getDeliveredNotifications:async()=>({notifications:[]}), removeDeliveredNotifications:async()=>{},
      listChannels:async()=>({channels:[]}), deleteChannel:async()=>{}, registerActionTypes:async()=>{},
      getPending:async()=>({notifications:window.reviewPending}), cancel:async()=>{},
      schedule:async({notifications})=>{window.reviewSchedules.push(notifications);window.reviewPending=notifications},
      addListener:async()=>({remove(){}}),
    }
  })
  await page.addScriptTag({content:result.outputFiles[0].text})
  await page.waitForFunction(()=>window.reviewSchedules.length===1)
  await page.evaluate(()=>window.grantExact())
  await page.waitForFunction(()=>window.reviewSchedules.length===2)
  const evidence = await page.evaluate(()=>({permissionGranted:window.reviewGrant, scheduleCalls:window.reviewSchedules.length, pendingCount:window.reviewPending.length, pendingUsesExact:window.reviewPending.every(n=>n.isExactNotification===true), visibilityState:document.visibilityState}))
  assert.equal(evidence.permissionGranted,true)
  assert.equal(evidence.scheduleCalls,2)
  assert.equal(evidence.pendingUsesExact,true)
  await page.evaluate(()=>window.changeSound())
  await page.waitForFunction(()=>window.reviewSchedules.length===3)
  const control = await page.evaluate(()=>({scheduleCalls:window.reviewSchedules.length,pendingUsesExact:window.reviewPending.every(n=>n.isExactNotification===true)}))
  assert.equal(control.pendingUsesExact,true)
  console.log(JSON.stringify({afterGrant:evidence,controlAfterSoundChange:control}))
} finally { await browser.close() }
