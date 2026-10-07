/** Actual App, disposable touch browser profiles and a fake notification port.
 * No device bridge, real accounts, user browser profile or physical phone.
 */
import { chromium } from 'playwright'
import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { FROZEN, seed, settleAny, settle, go } from '../tools/visual.mjs'

const out = 'reviews/evidence/settings-ui'
const latestChange = readFileSync('CHANGELOG.md','utf8').split(/^## \d+\.\d+\.\d+[^\n]*\n/m)[1].match(/^- (.+)$/m)[1].replaceAll('**','')
mkdirSync(out, { recursive: true })
const sounds = [
  { id: 'system', name: 'Как у телефона', hint: 'обычный звук уведомления' },
  { id: 'myagkiy', name: 'Мягкий', hint: 'два негромких удара' },
  { id: 'kolokolchik', name: 'Колокольчик', hint: 'слышно даже вполуха' },
  { id: 'pereliv', name: 'Перелив', hint: 'длиннее и ниже — если высокие звуки плохо слышны' },
]
const source = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './src/App';
import {installPlatform} from './src/platform/ports';
import {webPlatform} from './src/platform/web';
const w = window;
const config = () => JSON.parse(sessionStorage.getItem('testConfig') || '{}');
w.calls=[];
w.cloudLists=0;
w.reminderQueue=[];
installPlatform({...webPlatform, cloud:{...webPlatform.cloud,
 list:async()=>{
   if(!config().race) return webPlatform.cloud.list();
   if(++w.cloudLists===1) return new Promise((resolve,reject)=>{w.resolveCloud=resolve;w.rejectCloud=reject});
   return [];
 },
 upload:async(...args)=>{if(!config().race) return webPlatform.cloud.upload(...args)},
 remove:async(...args)=>{if(!config().race) return webPlatform.cloud.remove(...args)}
}, backup:{...webPlatform.backup,
 canReadSources:()=>true, sources:async()=>[], target:async()=>config().target || null,
 readSource:async()=>null, write:async()=>'ok', isSupported:()=>true
}, reminders:{...webPlatform.reminders,
 isSupported:()=>true, permission:async()=>config().permission || 'granted',
 requestPermission:async()=>'granted', sounds:()=>${JSON.stringify(sounds)}, schedule:async(items,sound,keep)=>{w.reminderQueue=items;w.keepDeferred=keep;},
 exactTiming:async()=>config().exact ?? true,
 isQuietModeOn:async()=>config().quiet ?? false,canBypassQuietMode:async()=>!config().quiet,
 isBatteryRestricted:async()=>config().battery ?? false,
 health:async()=>({scheduled:28,until:Date.now()+7*86400000,channelOff:!!config().channelOff}),
 preview:async(id)=>{w.calls.push('preview:'+id)},
 previewLoop:async(id)=>{
   w.calls.push('start:'+id);
   if(config().deferLoop) await new Promise(resolve=>{w.resolveLoop=resolve});
   return async()=>{w.calls.push('stop:'+id)};
 },
 openSoundSettings:async()=>{w.calls.push('sound-settings');return 'channel'}
}});
createRoot(document.getElementById('root')).render(<App/>);
`
const bundle = (await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true,
  write: false, format: 'iife', jsx: 'automatic', logLevel: 'error', loader: { '.md': 'text' } })).outputFiles[0].text
const html = `<html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${readFileSync('src/app.css', 'utf8')}</style></head><body><div id="root"></div><script>${bundle.replaceAll('</script', '<\\/script')}</script></body></html>`

async function database(page, operation, fields = {}) {
  return page.evaluate(async ({ operation, fields }) => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('omron-bp'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const read = (store, key) => new Promise((resolve, reject) => { const s = db.transaction(store).objectStore(store); const r = key ? s.get(key) : s.getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    if (operation === 'read') {
      const result = { settings: await read('meta', 'settings'), regimens: await read('regimens'), measurements: await read('readings') }
      db.close(); return result
    }
    const settings = await read('meta', 'settings')
    await new Promise((resolve, reject) => {
      const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put({ ...settings, ...fields }, 'settings')
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error)
    }); db.close()
  }, { operation, fields })
}
async function patch(page, fields, config = {}) {
  await page.evaluate(config => sessionStorage.setItem('testConfig', JSON.stringify(config)), config)
  await database(page, 'patch', fields)
  await page.reload({ waitUntil: 'domcontentloaded' }); await settle(page)
}
const records = [], checks = [], errors = [], expectedNetworkErrors = []
async function measure(page, name, profile) {
  await page.waitForTimeout(100)
  const record = await page.evaluate(() => {
    const app = document.querySelector('.app')
    const scope = [...app.children].filter(e => e.classList.contains('stack')).at(-1) || app
    const visible = el => {
      if (el.closest('[inert],[hidden],.sr-only,[aria-hidden="true"],script,style,header,nav')) return false
      for (let p = el; p && p !== app; p = p.parentElement) {
        const style = getComputedStyle(p)
        if (style.display === 'none' || style.visibility === 'hidden') return false
        if (p.tagName === 'DETAILS' && !p.open && !p.querySelector(':scope > summary')?.contains(el)) return false
      }
      return !!el.getClientRects().length
    }
    const walk = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT), chunks = []
    let node; while (node = walk.nextNode()) if (node.textContent.trim() && visible(node.parentElement)) chunks.push(node.textContent.trim())
    const text = chunks.join(' ').replace(/\s+/g, ' ')
    const overflow = [...scope.querySelectorAll('*')].filter(visible).filter(el => {
      const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1)
    }).map(el => ({ tag: el.tagName, text: el.textContent.trim().slice(0, 100) }))
    return { words: (text.match(/[\p{L}\p{N}]+(?:[’'\-][\p{L}\p{N}]+)*/gu) || []).length,
      documentHeight: document.documentElement.scrollHeight, contentHeight: Math.round(scope.getBoundingClientRect().height),
      controls: [...scope.querySelectorAll('button,input,select,textarea,summary,a[href]')].filter(visible).length,
      nav: app.dataset.nav, overflow, text }
  })
  assert.deepEqual(record.overflow, [], `${profile}/${name}: overflow`)
  await page.screenshot({ path: `${out}/${profile}-${name}.png`, fullPage: true })
  records.push({ profile, name, ...record })
}
async function expand(page, text) { await page.locator('summary', { hasText: text }).click() }
async function root(page) { await go(page, { tool: 'Настройки' }) }
async function open(page, title) { await go(page, { tool: 'Настройки', open: title }) }
const calls = page => page.evaluate(() => window.calls)
const check = text => { checks.push(text); console.log(`ok ${text}`) }
const browser = await chromium.launch()
try {
  for (const scale of ['normal', 'xlarge']) for (const theme of ['light', 'dark']) {
    const profile = `${scale}-${theme}`
    const context = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, locale: 'ru-RU' })
    const page = await context.newPage()
    page.setDefaultTimeout(6000)
    page.on('pageerror', e => errors.push({ profile, text: String(e) }))
    page.on('console', m => {
      if (!['warning', 'error'].includes(m.type())) return
      const event = { profile, text: m.text(), url: m.location().url }
      if (event.url.startsWith('https://cloud-api.yandex.net/') && /status of 503/.test(event.text)) expectedNetworkErrors.push(event)
      else errors.push(event)
    })
    await page.route('http://settings-ux.invalid/**', r => r.fulfill({ contentType: 'text/html', body: html }))
    await page.route('https://api.github.com/**', r => r.fulfill({ contentType: 'application/json', body: '[]' }))
    await page.route('https://cloud-api.yandex.net/**', r => r.fulfill({ status: 503, body: 'test offline' }))
    await page.clock.install({ time: new Date(FROZEN) })
    await page.goto('http://settings-ux.invalid', { waitUntil: 'domcontentloaded' }); await settleAny(page); await seed(page, FROZEN)
    const plan = { times: ['08:00', '20:00'], days: null, from: FROZEN }
    await patch(page, { textScale: scale, theme, guideOffered: true, remindersOn: true, measureRemindOn: true,
      people: [{ id: 'p1', name: 'Анна', deviceUser: 1, measurePlan: plan, targets: { sys: 135, dia: 85 } },
        { id: 'p2', name: 'Борис', deviceUser: 2, targets: { sys: 125, dia: 80 } }], activePerson: 'p1' })
    await root(page)
    assert.deepEqual(await page.locator('.settings__group > h2').allTextContents(), ['Для вас', 'Данные', 'Другое'])
    const rowSizes = await page.locator('.settings__root .pill__open').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height))
    assert.ok(rowSizes.every(height => height >= 44))
    await measure(page, 'root-family', profile)
    await page.locator('.pill__open', { hasText: 'Как пользоваться' }).click()
    await page.getByRole('heading', { name: 'Как пользоваться', exact: true }).waitFor()
    assert.match(await page.locator('.app').getAttribute('data-nav'), /settings\/guide$/)
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    assert.equal(await page.locator('.settings__group').count(), 3)
    await page.locator('header button', { hasText: 'Справка' }).click()
    await page.getByRole('heading', { name: 'Как пользоваться', exact: true }).waitFor()
    check(`${profile}: grouped root; all rows ≥44px; help from settings, Back and header help`)

    await open(page, 'Цели давления и сахара')
    await page.getByRole('button', { name: 'Чей дневник: Анна', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Борис', exact: true }).click()
    assert.equal(await page.getByRole('textbox', { name: 'Верхнее', exact: true }).inputValue(), '125')
    await page.getByRole('textbox', { name: 'Верхнее', exact: true }).fill('123')
    await page.getByRole('textbox', { name: 'Нижнее', exact: true }).focus()
    let saved = await database(page, 'read')
    assert.equal(saved.settings.people.find(p => p.id === 'p2').targets.sys, 123)
    assert.equal(saved.settings.people.find(p => p.id === 'p1').targets.sys, 135)
    await measure(page, 'targets-boris', profile)
    await open(page, ['Люди', 'Анна'])
    const before = await database(page, 'read')
    assert.equal(await page.getByRole('button', { name: 'Добавить время', exact: true }).isVisible(), false)
    await measure(page, 'person-default', profile)
    await expand(page, 'Часы для новых курсов')
    await page.getByRole('button', { name: 'Добавить время', exact: true }).click()
    await page.getByLabel('Время', { exact: true }).last().fill('15:30')
    await page.getByLabel('Название', { exact: true }).last().fill('Днём')
    await page.getByRole('heading', { name: 'Анна', exact: true }).click()
    saved = await database(page, 'read')
    assert.equal(saved.settings.people.find(p => p.id === 'p1').intakeSlots.at(-1).time, '15:30')
    assert.deepEqual(saved.regimens, before.regimens)
    await measure(page, 'person-times-expanded', profile)
    check(`${profile}: direct person choice on targets; only chosen targets saved; new-course times persisted; existing regimens unchanged`)

    await open(page, 'Копии и восстановление')
    await measure(page, 'backup-default', profile)
    assert.equal(await page.getByRole('button', { name: 'Удалить все измерения', exact: true }).isVisible(), false)
    await expand(page, 'Удалить все измерения')
    await page.getByRole('button', { name: 'Удалить все измерения', exact: true }).click()
    await page.getByRole('button', { name: 'Отмена', exact: true }).click()
    assert.deepEqual((await database(page, 'read')).measurements, saved.measurements)
    await open(page, 'Версия и обновления')
    await measure(page, 'about-default', profile)
    assert.equal(await page.getByText('Не заменяет обращение к врачу.', { exact: false }).isVisible(), true)
    await expand(page, 'Оценка показателей и ограничения')
    await expand(page, 'Что нового в версии')
    await page.getByText(latestChange, { exact: true }).waitFor()
    await measure(page, 'about-expanded', profile)
    check(`${profile}: deletion remains behind disclosure + confirmation; Cancel keeps data; limitations and current changes accessible`)

    // Global reminder settings must show another person's plan even when the active diary has none.
    await patch(page, { people: [{ id: 'p1', name: 'Анна', deviceUser: 1 },
      { id: 'p2', name: 'Борис', deviceUser: 2, measurePlan: plan }], activePerson: 'p1', remindersOn: false, measureRemindOn: true })
    await open(page, 'Напоминания')
    assert.equal(await page.getByText('Нет расписания измерений', { exact: true }).evaluate(el => !!el.closest('[inert]')), true)
    await page.getByText(/^Борис: /).waitFor()
    await measure(page, 'reminders-other-person-plan', profile)
    check(`${profile}: family schedule shown for the person with a plan, even when another diary is active`)

    await open(page, 'Семейный обмен')
    await measure(page, 'family-default', profile)
    assert.equal(await page.getByText('Файлы обмена на Диске не закрыты паролем.', { exact: false }).isVisible(), true)
    assert.equal(await page.getByRole('button', { name: 'Выбрать свой файл', exact: true }).isVisible(), false)
    await expand(page, 'Другое облако: обмен файлами')
    await page.getByRole('button', { name: 'Выбрать свой файл', exact: true }).waitFor()
    await measure(page, 'family-alternative-expanded', profile)
    await page.getByRole('textbox', { name: 'Общий ключ семьи', exact: true }).fill('synthetic-valid-format-key-0123456789')
    await page.getByRole('button', { name: 'Подключить отправку на Диск', exact: true }).click()
    await page.getByText('Диск ответил 503', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => localStorage.getItem('omron.yandex-token')), null)
    assert.equal(await page.getByRole('textbox', { name: 'Общий ключ семьи', exact: true }).inputValue(), 'synthetic-valid-format-key-0123456789')
    check(`${profile}: family alternatives disclosed; privacy visible before connecting; failed connection keeps entered key`)

    if (profile === 'normal-light') {
      const keyA = 'synthetic-valid-format-key-A-0123456789'
      const keyB = 'synthetic-valid-format-key-B-0123456789'
      for (const late of ['reject', 'resolve']) {
        await page.evaluate(() => localStorage.removeItem('omron.yandex-token'))
        await patch(page, {}, { race: true })
        await open(page, 'Семейный обмен')
        await page.getByRole('textbox', { name: 'Общий ключ семьи', exact: true }).fill(keyA)
        await page.getByRole('button', { name: 'Подключить отправку на Диск', exact: true }).click()
        await page.waitForFunction(() => !!window.resolveCloud)
        await page.getByRole('button', { name: 'Назад', exact: true }).click()
        await open(page, 'Семейный обмен')
        await page.getByRole('textbox', { name: 'Общий ключ семьи', exact: true }).fill(keyB)
        await page.getByRole('button', { name: 'Подключить отправку на Диск', exact: true }).click()
        await page.getByRole('button', { name: 'Отключить Яндекс.Диск', exact: true }).waitFor()
        assert.equal(await page.evaluate(() => localStorage.getItem('omron.yandex-token')), keyB)
        await page.evaluate(late => late === 'reject' ? window.rejectCloud(new Error('late A')) : window.resolveCloud([]), late)
        await page.waitForTimeout(100)
        assert.equal(await page.evaluate(() => localStorage.getItem('omron.yandex-token')), keyB)
        assert.equal(await page.getByRole('button', { name: 'Отключить Яндекс.Диск', exact: true }).count(), 1)
        await page.getByRole('button', { name: 'Отключить Яндекс.Диск', exact: true }).click()
        assert.equal(await page.evaluate(() => localStorage.getItem('omron.yandex-token')), null)
      }
      check(`${profile}: older connect failure/success cannot disconnect or replace a newer connection`)
    }

    // Comparable single-person defaults, matching the earlier settings audit.
    await patch(page, { people: [{ id: 'p1', name: 'Я', deviceUser: 1 }], measurePlan: plan, activePerson: 'p1', remindersOn: true })
    await root(page); await measure(page, 'root-solo', profile)
    await open(page, 'Напоминания'); await measure(page, 'reminders-both-on', profile)
    await expand(page, 'Звук:'); await expand(page, 'Если напоминания не приходят')
    await measure(page, 'reminders-expanded', profile)
    await patch(page, { remindersOn: false, measureRemindOn: true })
    await root(page)
    assert.match(await page.locator('.pill__open', { hasText: 'Напоминания' }).textContent(), /измерения включены/)
    await open(page, 'Напоминания')
    await page.getByRole('button', { name: 'Проверить громкость', exact: true }).waitFor()
    assert.equal(await page.getByRole('checkbox', { name: /^Повторять/ }).evaluate(el => !!el.closest('[inert]')), true)
    await measure(page, 'reminders-measurement-only', profile)
    await expand(page, 'Звук:')
    await page.getByRole('radio', { name: /^Мягкий/ }).check()
    assert.deepEqual(await calls(page), [], 'choosing sound does not play it')
    await page.getByRole('button', { name: 'Послушать: Мягкий', exact: true }).click()
    assert.deepEqual(await calls(page), ['preview:myagkiy'])
    await page.getByRole('button', { name: 'Проверить громкость', exact: true }).click()
    await page.getByRole('button', { name: 'Остановить звук', exact: true }).waitFor()
    assert.deepEqual(await calls(page), ['preview:myagkiy', 'start:myagkiy'], 'React must not call stop as a state updater')
    await page.getByRole('button', { name: 'Остановить звук', exact: true }).click()
    assert.deepEqual(await calls(page), ['preview:myagkiy', 'start:myagkiy', 'stop:myagkiy'])
    await page.getByRole('button', { name: 'Проверить громкость', exact: true }).click()
    await page.getByRole('button', { name: 'Остановить звук', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    assert.equal((await calls(page)).filter(c => c === 'stop:myagkiy').length, 2)
    check(`${profile}: measurement-only summary and sound controls; repeat is medication-only; explicit preview; loop survives start and stops on Stop/leave`)

    await patch(page, {}, { deferLoop: true })
    await open(page, 'Напоминания')
    await page.getByRole('button', { name: 'Проверить громкость', exact: true }).click()
    await page.waitForFunction(() => !!window.resolveLoop)
    await page.getByRole('button', { name: 'Назад', exact: true }).click()
    await page.evaluate(() => window.resolveLoop())
    await page.waitForFunction(() => window.calls.includes('stop:myagkiy'))
    assert.deepEqual(await calls(page), ['start:myagkiy', 'stop:myagkiy'])
    await patch(page, {}, { deferLoop: true })
    await open(page, 'Напоминания')
    await page.getByRole('button', { name: 'Проверить громкость', exact: true }).click()
    await page.waitForFunction(() => !!window.resolveLoop)
    await page.getByRole('checkbox', { name: /^Напоминать измерить давление/ }).uncheck()
    await page.evaluate(() => window.resolveLoop())
    await page.waitForFunction(() => window.calls.includes('stop:myagkiy'))
    assert.deepEqual(await calls(page), ['start:myagkiy', 'stop:myagkiy'])
    check(`${profile}: late loop resolution after leaving or disabling all reminders is cancelled`)

    await patch(page, { measureRemindOn: true }, { permission: 'denied' })
    await open(page, 'Напоминания')
    await page.getByText('Напоминания выключены телефоном', { exact: true }).waitFor()
    await measure(page, 'reminders-denied', profile)
    await patch(page, {}, { exact: false, quiet: true, battery: true, channelOff: true })
    await open(page, 'Напоминания')
    for (const text of ['Точное время не разрешено', 'Сейчас включён режим «Не беспокоить»', 'Напоминания выключены в настройках телефона', 'Телефон ограничивает работу приложения']) await page.getByText(text, { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Если напоминания не приходят', exact: true }).count(), 0)
    await measure(page, 'reminders-warnings', profile)
    await patch(page, { people: [{ id: 'p1', name: 'Я', deviceUser: 1 }], measurePlan: null })
    await open(page, 'Напоминания')
    await page.getByText('Нет расписания измерений', { exact: true }).waitFor()
    check(`${profile}: measure-only revoked permission, channel, quiet and exact-time warnings; missing plan explained`)

    // Real App scheduling and local persistence for self + daughter, excluding spouse.
    await page.evaluate(async now => {
      const db=await new Promise(r=>{const q=indexedDB.open('omron-bp');q.onsuccess=()=>r(q.result)})
      const settings=await new Promise(r=>{const q=db.transaction('meta').objectStore('meta').get('settings');q.onsuccess=()=>r(q.result)})
      const day=new Date(now);day.setHours(0,0,0,0)
      await new Promise((resolve,reject)=>{
        const tx=db.transaction(['meta','medicines','regimens','labs'],'readwrite')
        for(const store of ['medicines','regimens','labs'])tx.objectStore(store).clear()
        const people=[{id:'self',name:'Леонид'},{id:'daughter',name:'Дочь'},{id:'spouse',name:'Супруга'}].map(p=>({...p,measurePlan:{times:['16:00'],days:null,from:day.getTime()}}))
        for(const [i,p] of people.entries()) {
          tx.objectStore('medicines').put({id:'box-'+p.id,name:'Препарат '+p.name,stockUnit:'piece',doseUnit:'piece',left:2,leftAt:now,expires:null})
          tx.objectStore('regimens').put({id:'course-'+p.id,medicineId:'box-'+p.id,person:p.id,times:['09:00','14:00'],perTime:1,since:day.getTime(),startedAt:day.getTime()})
          tx.objectStore('labs').put({id:'lab-'+p.id,name:'Анализ '+p.name,owner:p.id,results:[],schedule:{due:day.getTime(),time:'15:00'}})
        }
        // Shared pack forecast must include spouse's consumption, even when she's muted.
        tx.objectStore('medicines').put({id:'shared',name:'Общий запас',stockUnit:'piece',doseUnit:'piece',left:10,leftAt:now,expires:null})
        tx.objectStore('regimens').put({id:'shared-self',medicineId:'shared',person:'self',times:['14:00'],perTime:1,since:day.getTime()})
        tx.objectStore('regimens').put({id:'shared-spouse',medicineId:'shared',person:'spouse',times:['14:00'],perTime:4,since:day.getTime()})
        const timers=people.map((p,i)=>({id:String(19200001+i),person:p.id,regimenId:'course-'+p.id,medicineName:'Препарат '+p.name,kind:'dose',startedAt:now,dueAt:now+30*60000}))
        tx.objectStore('meta').put({...settings,people,activePerson:'self',reminderPeople:undefined,mealTimers:timers,notificationHistory:[],remindersOn:true,measureRemindOn:true},'settings')
        tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)
      });db.close()
    },FROZEN)
    await page.evaluate(()=>sessionStorage.setItem('testConfig','{}'))
    await page.reload({waitUntil:'domcontentloaded'});await settle(page)
    await open(page,'Напоминания')
    const audience=page.getByRole('group',{name:'Чьи напоминания получать'})
    assert.equal(await audience.getByRole('checkbox').count(),3)
    assert((await audience.locator('label').evaluateAll(rows=>rows.map(e=>e.getBoundingClientRect().height))).every(h=>h>=48))
    await audience.getByRole('checkbox',{name:'Супруга',exact:true}).uncheck()
    await page.waitForFunction(()=>window.reminderQueue.length>0 && window.reminderQueue.every(r=>r.person!=='spouse' && !r.body.includes('Препарат Супруга')))
    const queue=await page.evaluate(()=>window.reminderQueue)
    for(const kind of ['dose','measure','lab','timer']) {
      assert(queue.some(r=>r.kind===kind && r.person==='self'),kind+' self')
      assert(queue.some(r=>r.kind===kind && r.person==='daughter'),kind+' daughter')
      assert(!queue.some(r=>r.kind===kind && r.person==='spouse'),kind+' spouse')
    }
    assert(queue.some(r=>r.kind==='stock' && r.body.includes('Общий запас') && r.body.includes('2 дн.')))
    const deferred=queue.find(r=>r.kind==='dose'&&r.person==='self')
    assert.equal(await page.evaluate(r=>window.keepDeferred({...r,person:'spouse'}),deferred),false)
    assert.equal(await page.evaluate(r=>window.keepDeferred(r),deferred),true)
    assert.deepEqual((await database(page,'read')).settings.reminderPeople,['self','daughter'])
    await measure(page,'reminder-audience',profile)
    await page.reload({waitUntil:'domcontentloaded'});await settle(page);await open(page,'Напоминания')
    assert.equal(await page.getByRole('group',{name:'Чьи напоминания получать'}).getByRole('checkbox',{name:'Супруга',exact:true}).isChecked(),false)
    await patch(page,{activePerson:'spouse'})
    await page.waitForFunction(()=>window.reminderQueue.length>0&&window.reminderQueue.every(r=>r.person!=='spouse'))
    await open(page,'Напоминания')
    const group=page.getByRole('group',{name:'Чьи напоминания получать'})
    await group.getByRole('checkbox',{name:'Леонид',exact:true}).uncheck()
    await group.getByRole('checkbox',{name:'Дочь',exact:true}).uncheck()
    await page.waitForFunction(()=>window.reminderQueue.length===0)
    await page.getByText(/^Никто не выбран\./).waitFor()
    assert(await page.getByText('Нет расписания измерений',{exact:true}).evaluate(e=>!!e.closest('[inert]')))
    await measure(page,'reminder-audience-none',profile)
    await group.getByRole('button',{name:'Все',exact:true}).click()
    await page.waitForFunction(()=>window.reminderQueue.some(r=>r.kind==='timer'&&r.person==='spouse'))
    assert.equal((await database(page,'read')).settings.reminderPeople,undefined)
    await patch(page,{people:[{id:'self',name:'Леонид'}],activePerson:'self',reminderPeople:[]})
    await open(page,'Напоминания')
    await page.getByRole('group',{name:'Чьи напоминания получать'}).getByRole('button',{name:'Все',exact:true}).click()
    await page.waitForFunction(()=>window.reminderQueue.length>0)
    check(`${profile}: self + daughter, spouse muted for dose/measure/lab/timer/stock; deferred cancelled; shared-stock consumption retained; persisted; active diary independent; nobody/all`)
    await context.close()
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
  writeFileSync(`${out}/integration.json`, JSON.stringify({ at: new Date().toISOString(), checks, records, errors, expectedNetworkErrors,
    physicalPhoneUsed: false, platform: 'actual React App + mocked native reminder/file ports in isolated Chromium' }, null, 2) + '\n')
}
