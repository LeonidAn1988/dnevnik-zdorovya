import assert from 'node:assert/strict'
import{chromium}from'playwright';import{mkdirSync,writeFileSync}from'node:fs'
import{FROZEN,seed,settleAny,settle,go}from'../tools/visual.mjs'
const out='reviews/evidence/three-styles';mkdirSync(out,{recursive:true})
const browser=await chromium.launch(),checks=[],failures=[]
try{for(const style of['journal','rhythm','clear'])for(const theme of['light','dark']){
 if(process.env.STYLE&&process.env.STYLE!==style)continue
 if(process.env.THEME&&process.env.THEME!==theme)continue
 const ctx=await browser.newContext({viewport:{width:320,height:844},hasTouch:true,colorScheme:theme,locale:'ru-RU'}),p=await ctx.newPage()
 await p.clock.install({time:new Date(FROZEN)});await p.goto('http://localhost:5199');await settleAny(p);await seed(p,FROZEN)
 await p.evaluate(async({style,theme})=>{const db=await new Promise(r=>{const q=indexedDB.open('omron-bp');q.onsuccess=()=>r(q.result)});const st=await new Promise(r=>{const q=db.transaction('meta').objectStore('meta').get('settings');q.onsuccess=()=>r(q.result)});await new Promise(r=>{const tx=db.transaction('meta','readwrite');tx.objectStore('meta').put({...st,interfaceStyle:style,theme,textScale:'xlarge',density:'roomy',guideOffered:true},'settings');tx.oncomplete=r});db.close()},{style,theme})
 await p.reload();await settle(p)
 const contrast=await p.evaluate(()=>{
  const node=document.createElement('i');document.body.append(node)
  const rgb=key=>{node.style.color='var('+key+')';return getComputedStyle(node).color.match(/[\d.]+/g).slice(0,3).map(Number)}
  const luminance=channels=>channels.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0)
  const pairs=[['--text-primary','--page',4.5],['--text-secondary','--page',4.5],['--placeholder','--field',4.5],['--accent-text','--page',4.5],['--accent-ink','--accent',4.5],['--border-strong','--surface',3],['--appearance-focus','--page',3],['--appearance-disabled-text','--appearance-disabled',4.5]]
  const result=pairs.map(([fg,bg,min])=>{const a=luminance(rgb(fg)),b=luminance(rgb(bg));return{fg,bg,min,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}});node.remove();return result
 })
 for(const pair of contrast)if(pair.ratio<pair.min)failures.push({style,theme,contrast:pair})
 checks.push({style,theme,contrast})
 // 200% text (32px instead of 16px), independent of the user's 131.25% preset.
 await p.evaluate(()=>document.documentElement.style.fontSize='32px')
 for(const screen of[{name:'Сегодня',tab:'Обзор'},{name:'Аптечка',tab:'Аптечка'},{name:'Форма курса',tab:'Аптечка',section:'Курсы',add:true},{name:'Давление',tab:'Давление'}]){
  try{await go(p,screen);const size=await p.evaluate(()=>({width:innerWidth,content:document.documentElement.scrollWidth,font:getComputedStyle(document.documentElement).fontSize}));assert.ok(size.content<=size.width+1,JSON.stringify(size));checks.push({style,theme,text:'200%',screen:screen.name,...size})}catch(error){failures.push({style,theme,screen:screen.name,error:String(error),overflow:await p.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>{const r=el.getBoundingClientRect();return !el.closest('.wheel,.daystrip')&&r.width>0&&(r.right>innerWidth+1||r.left< -1)}).map(el=>({class:el.className,text:el.textContent?.slice(0,100),width:el.getBoundingClientRect().width})).slice(0,30))});await p.screenshot({path:out+'/FAIL-200-'+style+'-'+theme+'-'+screen.name+'.png'})}
 }
 await go(p,{tool:'Отчёт'})
 await p.emulateMedia({media:'print'})
 assert.equal(await p.locator('.concept-report-insights').isVisible(),false,'Screen-only charts stay out of printed report')
 assert.ok(await p.locator('.report-facts').count()>0,'The actual doctor report remains available')
 assert.equal(await p.evaluate(()=>getComputedStyle(document.documentElement).fontSize),'16px','Print resets screen text scale')
 checks.push({style,theme,print:true})
 await ctx.close()
}}finally{await browser.close()}
writeFileSync(out+'/accessibility.json',JSON.stringify({checks,failures},null,2));console.log({checks:checks.length,failures});process.exitCode=failures.length?1:0
