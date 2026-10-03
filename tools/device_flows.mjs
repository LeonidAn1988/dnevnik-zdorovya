/** Native interaction checks in the isolated review package only. */
import { writeFileSync } from 'node:fs'
import { connect, patchSettings, capture, geometry, goPhone, adb, OUT, PACKAGE } from './device_review.mjs'
import { seed } from './visual.mjs'
const { browser, page } = await connect()
const findings = []
const record = (name,data) => { findings.push({name,...data}); writeFileSync(`${OUT}flows.json`,JSON.stringify(findings,null,2)); console.log(name,JSON.stringify(data)) }
try {
  await seed(page,Date.now()); await patchSettings(page,{textScale:'normal',theme:'light',remindersOn:false})
  const initial=await geometry(page)
  const physicalHeight=Number(adb('shell','wm','size').toString().match(/(\d+)x(\d+)/)[2])
  const topOffset=physicalHeight-initial.viewport.height*initial.dpr
  const tap=async locator=>{
    await locator.evaluate(el=>el.scrollIntoView({block:'center'})); await page.waitForTimeout(300)
    const r=await locator.boundingBox(); if(!r)throw new Error('Control not visible')
    adb('shell','input','tap',String(Math.round((r.x+r.width/2)*initial.dpr)),String(Math.round(topOffset+(r.y+r.height/2)*initial.dpr)))
    await page.waitForTimeout(600)
  }
  await goPhone(page,{name:'Screen settings',tool:'Настройки',open:'Текст и оформление'})
  const settingsBefore=await page.locator('.app').getAttribute('data-nav')
  adb('shell','input','keyevent','4'); await page.waitForTimeout(600)
  record('settings-native-back',{before:settingsBefore,after:await page.locator('.app').getAttribute('data-nav')})

  await goPhone(page,{name:'Cabinet',tab:'Аптечка'})
  await tap(page.locator('.cabinet__add'))
  await page.waitForTimeout(1500)
  await capture(page,'native-new-medicine',true)
  const formMetrics=await geometry(page)
  const name=page.locator('input[role=combobox]').first()
  await name.fill('Ревью — пробный препарат')
  await page.waitForTimeout(500)
  await capture(page,'keyboard-medicine',false)
  const keyboardMetrics=await geometry(page)
  adb('shell','input','keyevent','4'); await page.waitForTimeout(800)
  const afterKeyboard=await geometry(page)
  record('medicine-keyboard',{openedForm:formMetrics,keyboard:keyboardMetrics,afterBack:afterKeyboard,draft:await name.inputValue()})
  adb('shell','input','keyevent','4'); await page.waitForTimeout(500)
  record('medicine-native-back',{after:await page.locator('.app').getAttribute('data-nav')})

  await goPhone(page,{name:'Labs',tab:'Обзор',open:'Анализы'})
  const fixture=await page.evaluate(()=>{
    const c=document.createElement('canvas'); c.width=2400;c.height=1800;const g=c.getContext('2d');g.fillStyle='#fafafa';g.fillRect(0,0,c.width,c.height);g.fillStyle='#222';g.font='40px sans-serif';
    for(let y=90;y<1750;y+=100)g.fillText('РЕВЬЮ: тестовый бланк, синтетические данные',80,y)
    return c.toDataURL('image/png').split(',')[1]
  })
  await page.locator('input[type=file]').first().setInputFiles({name:'review-blank.png',mimeType:'image/png',buffer:Buffer.from(fixture,'base64')})
  await page.waitForTimeout(2300)
  const photos=await page.evaluate(async()=>{
    const db=await new Promise(r=>{const q=indexedDB.open('omron-bp');q.onsuccess=()=>r(q.result)});
    const values=await new Promise(r=>{const q=db.transaction('labPhotos').objectStore('labPhotos').getAll();q.onsuccess=()=>r(q.result)});db.close();
    return values.map(p=>({labId:p.labId,width:p.width,height:p.height,bytes:p.bytes,type:p.blob.type,actualBytes:p.blob.size}))
  })
  await tap(page.locator('.photo-thumb').first()); await capture(page,'photo-open',false)
  const photoBefore=await page.locator('.app').getAttribute('data-nav')
  adb('shell','input','keyevent','4');await page.waitForTimeout(600);await capture(page,'photo-after-native-back',false)
  record('photo-native-back',{photos,before:photoBefore,after:await page.locator('.app').getAttribute('data-nav'),labsStillOpen:await page.locator('h2',{hasText:'Анализы'}).count()>0,photoStillOpen:await page.locator('.photo-view').count()>0})

  await goPhone(page,{name:'Labs',tab:'Обзор',open:'Анализы'})
  await tap(page.locator('button',{hasText:'Добавить снимок'}).first())
  await capture(page,'camera-source-prompt',false)
  adb('shell','input','keyevent','4');await page.waitForTimeout(800)
  record('camera-prompt-cancel',{nav:await page.locator('.app').getAttribute('data-nav'),busy:await page.locator('button',{hasText:'Готовим снимок'}).count()>0,photos:await page.locator('.photo-thumb').count()})

  await goPhone(page,{name:'Report',tool:'Отчёт'})
  await tap(page.locator('button',{hasText:'Печать или сохранение в PDF'}))
  await capture(page,'native-print',false)
  const focus=adb('shell','dumpsys','window').toString().split('\n').filter(s=>s.includes('mCurrentFocus')).join('\n')
  record('native-print-open',{focus})
  adb('shell','input','keyevent','4');await page.waitForTimeout(800)

  for(const theme of ['dark','light']) {
    await patchSettings(page,{theme})
    await goPhone(page,{name:'BP',tab:'Давление'});await capture(page,`theme-${theme}-pressure`,false)
  }
  const times=[]
  for(let i=0;i<3;i++){
    await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('nav.tabs');await page.waitForTimeout(300)
    times.push(await page.evaluate(()=>({navigation:performance.getEntriesByType('navigation').map(e=>({domContentLoaded:e.domContentLoadedEventEnd,load:e.loadEventEnd})),paint:performance.getEntriesByType('paint').map(e=>({name:e.name,start:e.startTime})),heap:performance.memory?.usedJSHeapSize})))
  }
  record('warm-reload-performance',{samples:times,limitation:'Diagnostic build, warm WebView reload; not cold-start/low-end/field performance'})
  record('app-private-memory',{info:adb('shell','dumpsys','meminfo',PACKAGE).toString().split('\n').filter(s=>s.includes('TOTAL PSS:')||s.includes('TOTAL RSS:')||s.includes('WebViews:')).join('\n')})
} finally { await browser.close() }
