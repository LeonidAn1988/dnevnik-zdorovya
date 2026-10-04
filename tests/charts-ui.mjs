import { chromium } from 'playwright'
import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
const out='reviews/evidence/charts'; mkdirSync(out,{recursive:true})
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import {TrendChart,PulseChart,DayPartChart,GlucoseChart} from './src/ui/Charts';
const root=createRoot(document.getElementById('root'));
window.show=(data)=>root.render(<main className="stack" style={{padding:16}}><section className="card"><h2>Динамика давления</h2><TrendChart readings={data} targetSys={135} targetDia={85}/></section><section className="card"><h2>По времени суток</h2><DayPartChart readings={data}/></section><section className="card"><h2>Пульс</h2><PulseChart readings={data}/></section><section className="card"><h2>Динамика сахара</h2><GlucoseChart readings={data.map(r=>({...r,mmol:5.2+r.sys/100,context:'fasting'}))} targets={{low:3.9,fastingMax:6.1,postMealMax:7.8}}/></section></main>);window.show([]);`
const bundle=(await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic'})).outputFiles[0].text
const html=`<html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${readFileSync('src/app.css','utf8')}</style><body><div id="root"></div><script>${bundle.replaceAll('</script','<\\/script')}</script></body></html>`
const browser=await chromium.launch();const errors=[],checks=[]
try {
 for(const width of [320,360,768,1280]) for(const text of ['normal','xlarge']){
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:true});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://charts.test/**',r=>r.fulfill({contentType:'text/html',body:html}));await page.goto('https://charts.test');
  await page.evaluate(text=>document.documentElement.dataset.text=text,text);
  const data=[0,1,4,5].flatMap((offset,i)=>[7,14,21].map((hour,j)=>({id:`${i}-${j}`,ts:new Date(2026,9,1+offset,hour).getTime(),sys:112+i*6+j*4,dia:70+i*3+j,bpm:60+i*4+j})))
  // Empty -> populated must bind sizing to the same mounted container.
  await page.evaluate(data=>window.show(data),data);await page.waitForTimeout(120);
  const geometry=await page.evaluate(()=>[...document.querySelectorAll('svg')].map(svg=>{
   const b=svg.getBoundingClientRect();return {width:b.width,text:[...svg.querySelectorAll('text')].map(t=>({text:t.textContent,box:t.getBBox()})).map(({text,box})=>({text,x:box.x,y:box.y,right:box.x+box.width,bottom:box.y+box.height})),points:[...svg.querySelectorAll('circle')].map(c=>({x:+c.getAttribute('cx'),y:+c.getAttribute('cy')})),paths:[...svg.querySelectorAll('path')].map(p=>p.getAttribute('d'))}
  }));
  for(const g of geometry){assert.ok(g.points.every(p=>p.x>=0&&p.x<=g.width&&p.y>=0&&p.y<260),JSON.stringify({width,text,g}));assert.ok(g.text.every(t=>t.x>=-1&&t.right<=g.width+1&&t.y>=0&&t.bottom<=260),JSON.stringify({width,text,g}));assert.ok(g.paths.every(p=>(p.match(/M/g)||[]).length===2),'Missing-day gap must break every trend');}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Page overflow');
  await page.screenshot({path:`${out}/${width}-${text}.png`,fullPage:true});
  // Same-day readings use distinct time labels rather than repeated dates.
  await page.evaluate(data=>window.show(data.slice(0,3)),data);await page.waitForTimeout(80);
  for(const svg of await page.locator('svg').all()){const labels=await svg.locator('text').allTextContents();const times=labels.filter(t=>t.includes(':'));assert.ok(times.length>=2);assert.equal(new Set(times).size,times.length)}
  // One measurement remains inside the plot, daily summary coincides with it.
  await page.evaluate(data=>window.show(data.slice(0,1)),data);await page.waitForTimeout(80);
  const single=await page.evaluate(()=>[...document.querySelectorAll('svg')].map(svg=>[...svg.querySelectorAll('circle')].map(c=>+c.getAttribute('cx'))));
  assert.ok(single.every(xs=>xs.length>=2&&xs.every(x=>x===xs[0])));
  await page.evaluate(data=>window.show([{...data[0],ts:new Date(2026,9,5,0,10).getTime()}]),data);await page.waitForTimeout(80);
  assert.ok((await page.locator('.chart__period').allTextContents()).every(t=>t==='5 окт.'),'Midnight single reading must not invent previous day');
  const repeated=[{...data[0],ts:new Date(2025,9,1,7,0,10).getTime()},{...data[1],ts:new Date(2026,9,1,7,0,10).getTime()},{...data[2],ts:new Date(2026,9,1,7,0,50).getTime()}];
  await page.evaluate(data=>window.show(data),repeated);await page.waitForTimeout(80);
  const options=await page.locator('select').first().locator('option').allTextContents();assert.equal(new Set(options).size,3,'Years and seconds must disambiguate measurements');
  const dateBounds=await page.evaluate(()=>[...document.querySelectorAll('svg text')].map(t=>{const b=t.getBBox();return {x:b.x,right:b.x+b.width,width:t.closest('svg').getBoundingClientRect().width}}));
  assert.ok(dateBounds.every(b=>b.x>=-1&&b.right<=b.width+1),'Multi-year date labels must fit');
  checks.push({width,text,charts:geometry.length,emptyToData:true,gaps:true,sameDay:true,single:true});await context.close();
 }
 assert.deepEqual(errors,[]);writeFileSync(`${out}/checks.json`,JSON.stringify({checks,errors},null,2));console.log(`Charts: ${checks.length} touch layouts, dates, point bounds, gaps, empty→data and single measurement passed`)
}finally{await browser.close()}
