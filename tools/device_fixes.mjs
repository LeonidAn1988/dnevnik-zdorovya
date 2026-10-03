/** Native checks confined to the isolated .review package and synthetic diary. */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { connect, patchSettings, capture, geometry, goPhone, adb, OUT } from './device_review.mjs'
import { seed, settleAny } from './visual.mjs'
const {browser,page}=await connect()
const checks=[]
try {
  await settleAny(page);await seed(page,Date.now());await patchSettings(page,{textScale:'normal',theme:'light',remindersOn:false})
  const initial=await geometry(page)
  const physicalHeight=Number(adb('shell','wm','size').toString().match(/(\d+)x(\d+)/)[2])
  const offset=physicalHeight-initial.viewport.height*initial.dpr
  const tap=async locator=>{
    await locator.evaluate(el=>el.scrollIntoView({block:'center'}));await page.waitForTimeout(250)
    const box=await locator.boundingBox();assert.ok(box)
    adb('shell','input','tap',String(Math.round((box.x+box.width/2)*initial.dpr)),String(Math.round(offset+(box.y+box.height/2)*initial.dpr)))
    await page.waitForTimeout(700)
  }
  await goPhone(page,{tab:'Аптечка'})
  await tap(page.locator('.cabinet__add'));await page.waitForTimeout(800)
  const form=await page.evaluate(()=>({nav:document.querySelector('.app')?.dataset.nav,viewportHeight:visualViewport.height,headingY:document.querySelector('h2')?.getBoundingClientRect().y,firstChoiceY:document.querySelector('[aria-label="Форма выпуска"]')?.getBoundingClientRect().y,activeTag:document.activeElement?.tagName,scrollY}))
  assert.ok(form.headingY>=0);assert.ok(form.viewportHeight>=initial.viewport.height-5)
  await capture(page,'new-medicine-heading',false);checks.push({name:'R27 native opening keeps heading visible and keyboard closed',...form})
  adb('shell','input','keyevent','4');await page.waitForTimeout(400)
  await goPhone(page,{tab:'Обзор',open:'Анализы'})
  await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=10;canvas.height=10
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))
    const db=await new Promise(resolve=>{const q=indexedDB.open('omron-bp');q.onsuccess=()=>resolve(q.result)})
    await new Promise((resolve,reject)=>{const tx=db.transaction('labPhotos','readwrite');tx.objectStore('labPhotos').put({id:'fixed-photo',labId:'l1',day:Date.now(),blob,bytes:blob.size,width:10,height:10});tx.oncomplete=resolve;tx.onerror=reject});db.close()
  })
  await page.reload();await goPhone(page,{tab:'Обзор',open:'Анализы'})
  await tap(page.locator('.photo-thumb').first());assert.equal(await page.locator('.photo-view').count(),1)
  adb('shell','input','keyevent','4');await page.waitForTimeout(600)
  assert.equal(await page.locator('.photo-view').count(),0)
  assert.ok(await page.locator('h2',{hasText:'Анализы'}).count()>0)
  await capture(page,'photo-back-keeps-labs',false);checks.push({name:'R23 native Back closes photo and keeps Labs',nav:await page.locator('.app').getAttribute('data-nav')})
  writeFileSync(`${OUT}fixes.json`,JSON.stringify({at:new Date().toISOString(),checks},null,2))
  console.log(JSON.stringify(checks))
} finally {await browser.close()}
