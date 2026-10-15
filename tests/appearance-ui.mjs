import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { FROZEN, seed, settleAny, go, goConceptRoute, SCREENS } from '../tools/visual.mjs'

const out = process.env.EVIDENCE_DIR ?? 'reviews/evidence/three-styles'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const results = { profiles: [], failures: [], errors: [] }
const full = process.argv.includes('--full')
const profiles = full
  ? ['journal','rhythm','clear'].flatMap(style => ['light','dark'].flatMap(theme => ['normal','xlarge'].map(scale => ({ style,theme,scale,width:360 }))))
  : ['journal','rhythm','clear'].flatMap(style => ['light','dark'].map(theme => ({ style,theme,scale:'normal',width:390 })))

export async function patch(page, fields) {
  await page.evaluate(async fields => {
    const db = await new Promise((resolve,reject) => { const q=indexedDB.open('omron-bp');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error) })
    const q=db.transaction('meta').objectStore('meta').get('settings')
    const current=await new Promise(resolve=>{q.onsuccess=()=>resolve(q.result)})
    const tx=db.transaction('meta','readwrite')
    tx.objectStore('meta').put({...current,...fields,guideOffered:true},'settings')
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})
    db.close()
  },fields)
  await page.reload({waitUntil:'domcontentloaded'})
  await page.locator('nav.tabs').waitFor()
}

try {
  for (const profile of profiles) {
    if (process.env.STYLE && profile.style !== process.env.STYLE) continue
    if (process.env.THEME && profile.theme !== process.env.THEME) continue
    if (process.env.SCALE && profile.scale !== process.env.SCALE) continue
    const context=await browser.newContext({viewport:{width:Number(process.env.WIDTH)||profile.width,height:844},hasTouch:true,locale:'ru-RU',colorScheme:profile.theme})
    const page=await context.newPage()
    page.on('pageerror',e=>results.errors.push({profile,error:String(e)}))
    await page.clock.install({time:new Date(FROZEN)})
    await page.goto(process.env.URL??'http://localhost:5199')
    await settleAny(page);await seed(page,FROZEN)
    await patch(page,{interfaceStyle:profile.style,theme:profile.theme,textScale:profile.scale,density:'normal'})
    const pages=full?SCREENS.filter(x=>!x.whose):[
      {name:'Сегодня',tab:'Обзор'},
      {name:'Аптечка',tab:'Аптечка'},
      {name:'Форма курса',tab:'Аптечка',section:'Курсы',add:true},
      {name:'Отчёт',tool:'Отчёт'},
    ]
    for (const screen of pages) {
      if (process.env.SCREEN && !screen.name.includes(process.env.SCREEN)) continue
      try {
        await go(page,screen)
        const dimensions=await page.evaluate(()=>({width:innerWidth,content:document.documentElement.scrollWidth,touch:navigator.maxTouchPoints}))
        assert.ok(dimensions.touch>0,'Touch is required')
        assert.ok(dimensions.content<=dimensions.width+1,'Horizontal overflow: '+JSON.stringify(dimensions))
        if(!full||['Обзор','Аптечка','Настройки — экран'].includes(screen.name))
          await page.screenshot({path:out+'/'+profile.style+'-'+profile.theme+'-'+profile.scale+'-'+screen.name+'.png'})
        results.profiles.push({...profile,screen:screen.name,...dimensions})
      } catch(e) {
        results.failures.push({...profile,screen:screen.name,error:String(e),nav:await page.locator('.app').getAttribute('data-nav').catch(()=>null),body:(await page.locator('body').innerText().catch(()=>'' )).slice(0,2400)})
        await page.screenshot({path:out+'/FAIL-'+profile.style+'-'+profile.theme+'-'+profile.scale+'-'+screen.name+'.png'}).catch(()=>{})
        console.log('FAIL',profile,screen.name,String(e).split('\n')[0])
      }
    }
    // A route to every core destination exists, including tiny-screen menu.
    if(!full) for(const route of ['bp','glucose','labs','intake','cabinet','memo','settings','sync','guide','notifications','overview']) {
      await goConceptRoute(page,route)
      assert.ok((await page.locator('.app').getAttribute('data-nav')).includes(route),route)
      if (route === 'notifications') await page.locator('dialog').getByRole('button', { name: /Назад/ }).click()
    }
    await context.close()
  }
} finally {await browser.close()}
writeFileSync(out+'/'+(full?'screens':'slices')+'.json',JSON.stringify(results,null,2))
console.log({profiles:results.profiles.length,failures:results.failures.length,errors:results.errors.length})
process.exitCode=results.failures.length||results.errors.length?1:0
