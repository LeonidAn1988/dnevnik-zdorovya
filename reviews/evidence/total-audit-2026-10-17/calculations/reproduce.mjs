import { build } from 'esbuild'
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
const root=process.cwd(), out=root+'/reviews/evidence/total-audit-2026-10-17/calculations'
await build({entryPoints:['tests/api.ts'],bundle:true,format:'esm',outfile:'/private/tmp/omron-total-calculations-api.mjs',external:['fake-indexeddb'],logLevel:'error'})
const api=await import('/private/tmp/omron-total-calculations-api.mjs')
const day=(n,h=0)=>new Date(2026,9,n,h).getTime(), results={}
const box={id:'m',name:'Синтетический препарат',stockUnit:'ml',doseUnit:'ml',left:10,leftAt:day(16),packSize:20,expires:null}
const incompatible={id:'r',medicineId:'m',person:'p',since:day(16),times:['08:00'],perTime:1,doseUnit:'piece'}
results.incompatibleRefill={confirmedBefore:box.left,projectedBefore:api.projectedLeft(box,[api.dosing(box,incompatible)],day(17,12)),afterRefill:api.addPack(box,[api.dosing(box,incompatible)],day(17,12))}
const source=`import React from 'react';import{createRoot}from'react-dom/client';import{RegimenForm}from'./src/ui/RegimenForm';import{MedicineForm}from'./src/ui/MedicineForm';
window.saved=[];window.show=(kind)=>createRoot(document.getElementById('root')).render(kind==='medicine'?<MedicineForm medicine={${JSON.stringify(box)}} onSave={async x=>{window.saved.push(x)}} onCancel={()=>{}}/>:<RegimenForm medicines={[${JSON.stringify({...box,stockUnit:'piece',doseUnit:'piece'})}]} medicineId="m" people={[{id:'p',name:'Тест'}]} activePerson="p" intakeSlots={[{time:'08:00',title:'Утром'}]} onSave={async x=>{window.saved.push(x)}} onCancel={()=>{}} onAddMedicine={()=>{}}/>);`
const bundle=(await build({stdin:{contents:source,resolveDir:root,loader:'tsx'},bundle:true,format:'iife',write:false,jsx:'automatic',loader:{'.md':'text','.webp':'dataurl'},logLevel:'error'})).outputFiles[0].text
const browser=await chromium.launch()
try{
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,timezoneId:'Europe/Moscow'});page.setDefaultTimeout(8000)
 await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div><script>'+bundle.replaceAll('</script','<\\/script')+'</script>'}))
 await page.goto('https://isolated-calculations.invalid');await page.evaluate(()=>window.show('regimen'))
 await page.getByRole('button',{name:'По потребности',exact:true}).click()
 await page.getByLabel('В день',{exact:true}).fill('-2')
 await page.getByRole('button',{name:'Сохранить',exact:true}).click()
 const saved=await page.evaluate(()=>window.saved)
 results.negativeDailyUI={savedCount:saved.length,savedCourse:saved[0]}
 if(saved[0]){const x={...saved[0],id:'r',since:day(16),startedAt:day(16),planFrom:day(16)};const b={...box,stockUnit:'piece',doseUnit:'piece'};results.negativeDailyUI.stockAfterOneDay=api.projectedLeft(b,[api.dosing(b,x)],day(17,12));results.negativeDailyUI.needForWeek=api.needForDays([api.dosing(b,x)],day(17,12),7)}
 await page.reload();await page.evaluate(()=>window.show('medicine'))
 results.medicineFields=await page.locator('input').evaluateAll(inputs=>inputs.map(x=>({label:document.querySelector('label[for="'+x.id+'"]')?.textContent,aria:x.getAttribute('aria-label'),value:x.value})))
 await page.getByRole('textbox',{name:/^Осталось/}).fill('-5')
 await page.getByRole('button',{name:'Сохранить',exact:true}).click()
 results.negativeStockUI={saved:await page.evaluate(()=>window.saved)}
 await page.reload();await page.evaluate(()=>window.show('medicine'))
 await page.getByRole('button',{name:'В упаковке, мл: увеличить',exact:true}).click()
 results.packNudge={shown:await page.getByLabel('В упаковке, мл',{exact:true}).inputValue()}
 await page.getByRole('button',{name:'Сохранить',exact:true}).click()
 results.packNudge.saved=await page.evaluate(()=>window.saved)
 await page.reload();await page.evaluate(()=>window.show('medicine'))
 await page.getByLabel('В упаковке, мл',{exact:true}).fill('2,5')
 await page.getByRole('button',{name:'Сохранить',exact:true}).click()
 results.decimalPackUI={saved:await page.evaluate(()=>window.saved)}
}catch(e){results.browserError=String(e)}finally{await browser.close()}
writeFileSync(out+'/reproduction.json',JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2))
