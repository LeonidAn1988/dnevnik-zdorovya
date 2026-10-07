import { chromium } from 'playwright'
import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
const out='reviews/evidence/ux-modes/wheels';mkdirSync(out,{recursive:true})
const source=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {WheelField} from './src/ui/WheelField';function Demo(){const [v,setV]=useState('120');const [p,setP]=useState('72');return <main className="card"><WheelField label="Верхнее" value={v} onChange={setV} min={40} max={250} start={120}/><WheelField label="Пульс" value={p} onChange={setP} min={30} max={220} start={70} axis="x"/></main>}createRoot(document.getElementById('root')).render(<Demo/>);`
const js=(await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'tsx'},bundle:true,format:'iife',write:false,jsx:'automatic',logLevel:'error'})).outputFiles[0].text
const browser=await chromium.launch(),checks=[]
try {
 const page=await browser.newPage({viewport:{width:360,height:800},hasTouch:true,reducedMotion:'reduce'})
 await page.route('https://wheel-scale.invalid/**',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><html><head><style>${readFileSync('src/app.css','utf8')}</style></head><body><div id="root"></div><script>${js}</script></body></html>`}))
 await page.goto('https://wheel-scale.invalid');await page.getByRole('spinbutton',{name:'Верхнее'}).press('ArrowDown')
 for(const scale of [100,131.25,200,100]) {
  await page.evaluate(scale=>document.documentElement.style.fontSize=scale+'%',scale)
  await page.waitForTimeout(350)
  const metrics=await page.locator('.wheel').evaluateAll(ws=>ws.map(w=>{
   const sel=w.querySelector('[data-selected="true"]'),list=w.querySelector('.wheel__list'),marker=w.querySelector('.wheel__marker');const a=sel.getBoundingClientRect(),b=list.getBoundingClientRect(),c=marker.getBoundingClientRect();const horizontal=w.classList.contains('wheel--x');const cs=getComputedStyle(sel);const ctx=document.createElement('canvas').getContext('2d');ctx.font=`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;const text=ctx.measureText(sel.textContent);
   return {value:list.getAttribute('aria-valuenow'),centerError:horizontal?Math.abs(a.left+a.width/2-b.left-b.width/2):Math.abs(a.top+a.height/2-b.top-b.height/2),step:horizontal?a.width:a.height,marker:horizontal?c.width:c.height,ink:horizontal?text.width:text.actualBoundingBoxAscent+text.actualBoundingBoxDescent}
  }))
  assert.deepEqual(metrics.map(m=>m.value),['121','72'])
  for(const m of metrics){assert.ok(m.centerError<1,JSON.stringify(m));assert.equal(m.step,m.marker);assert.ok(m.ink<=m.step,JSON.stringify(m));assert.ok(m.step>=44)}
  checks.push({scale,metrics});await page.screenshot({path:`${out}/${scale}.png`,fullPage:true})
 }
 await page.evaluate(()=>{
  const wheel=document.querySelector('.wheel--y .wheel__list')
  wheel.scrollTop+=48;wheel.dispatchEvent(new Event('scroll'))
  document.documentElement.style.fontSize='200%'
 })
 await page.waitForTimeout(400)
 assert.equal(await page.getByRole('spinbutton',{name:'Верхнее'}).getAttribute('aria-valuenow'),'121','Resizing during a pending scroll must not reinterpret the value using the old row height')
 checks.push({resizeDuringScroll:'preserves 121'})
 // A previous gesture is still waiting for its 120 ms debounce when a user
 // explicitly selects a number. During the new smooth animation its offset
 // is intermediate, so the old timer must never emit it as the chosen value.
 const gesture=await browser.newPage({viewport:{width:360,height:800},hasTouch:true,reducedMotion:'no-preference'})
 await gesture.route('https://wheel-scale.invalid/**',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><html><head><style>${readFileSync('src/app.css','utf8')}</style></head><body><div id="root"></div><script>${js}</script></body></html>`}))
 await gesture.goto('https://wheel-scale.invalid')
 const spin=gesture.getByRole('spinbutton',{name:'Верхнее'})
 await gesture.waitForTimeout(400)
 await spin.evaluate(node=>{node.scrollTop+=48;node.dispatchEvent(new Event('scroll'))})
 await gesture.waitForTimeout(70)
 await spin.press('PageDown')
 assert.equal(await spin.getAttribute('aria-valuenow'),'130')
 await gesture.waitForTimeout(90)
 assert.equal(await spin.getAttribute('aria-valuenow'),'130','An old scroll settle cannot override an explicit keyboard selection during smooth scrolling')
 await gesture.waitForTimeout(500)
 assert.equal(await spin.getAttribute('aria-valuenow'),'130')
 checks.push({explicitSelectionDuringPendingScroll:'preserves 130 during and after animation'})
 await gesture.close()
 console.log('Wheel geometry: values preserved, centered and legible at 100%, 131.25%, 200% and back');writeFileSync(`${out}/result.json`,JSON.stringify(checks,null,2))
} finally {await browser.close()}
