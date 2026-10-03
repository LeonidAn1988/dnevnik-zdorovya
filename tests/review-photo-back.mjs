// The application's real back handler, seeded in an isolated touch browser.
// capacitorNav.back() invokes this same onBack handler on the phone.
import { chromium } from 'playwright'
import { FROZEN, seed, settleAny, settle, go } from '../tools/visual.mjs'
import assert from 'node:assert/strict'
const browser = await chromium.launch({headless:true})
try {
  const context = await browser.newContext({viewport:{width:360,height:780},hasTouch:true,locale:'ru-RU'})
  const page = await context.newPage()
  await page.clock.install({time:new Date(FROZEN)})
  await page.goto('http://localhost:5199')
  await settleAny(page)
  await seed(page,FROZEN)
  await page.evaluate(async()=>{
    const canvas = document.createElement('canvas');canvas.width=10;canvas.height=10
    const blob = await new Promise(r=>canvas.toBlob(r,'image/png'))
    const db = await new Promise(r=>{const q=indexedDB.open('omron-bp');q.onsuccess=()=>r(q.result)})
    await new Promise((r,j)=>{const tx=db.transaction('labPhotos','readwrite');tx.objectStore('labPhotos').put({id:'synthetic-review-photo',labId:'l1',day:Date.now(),blob,bytes:blob.size,width:10,height:10});tx.oncomplete=r;tx.onerror=j})
    db.close()
  })
  await page.reload()
  await settle(page)
  await go(page,{tab:'Обзор',open:'Анализы'})
  await page.locator('.photo-thumb').first().click()
  assert.equal(await page.locator('.photo-view').count(),1)
  await page.locator('.photo-view').getByRole('button',{name:'Закрыть',exact:true}).click()
  assert.equal(await page.locator('.photo-view').count(),0)
  assert.ok((await page.locator('h2').allTextContents()).some(t=>t.startsWith('Анализы')))
  await page.locator('.photo-thumb').first().click()
  assert.equal(await page.locator('.photo-view').count(),1)
  const before = await page.locator('h2').allTextContents()
  await page.evaluate(()=>window.dispatchEvent(new PopStateEvent('popstate',{state:{omron:0}})))
  await page.waitForTimeout(200)
  const after = await page.locator('h2').allTextContents()
  const labsStillOpen=after.some(t=>t.startsWith('Анализы'))
  assert.equal(labsStillOpen,true)
  console.log(JSON.stringify({controlCloseButtonKeepsLabs:true,before,after,photoStillOpen:await page.locator('.photo-view').count()>0,labsStillOpen}))
} finally { await browser.close() }
