import {build} from 'esbuild'
import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import percySnapshot from '@percy/playwright'

const output=await build({entryPoints:['tests/update-harness.tsx'],bundle:true,write:false,format:'iife',logLevel:'error',jsx:'automatic',loader:{'.md':'text'},plugins:[
 {name:'test-installed-version',setup(build){build.onLoad({filter:/\/ui\/version.ts$/},({path})=>({contents:readFileSync(path,'utf8').replace(/export const ВЕРСИЯ = .*/,"export const ВЕРСИЯ = '0.43.0'"),loader:'ts'}));build.onLoad({filter:/\.md\?raw$/},({path})=>({contents:readFileSync(path.replace(/\?raw$/,''),'utf8'),loader:'text'}))}}
]})
const release=version=>({tag_name:`v${version}`,draft:false,prerelease:false,published_at:'2026-10-03T12:00:00Z',body:'- **Новая версия заметна сразу.** Обновление доступно на главном экране.\n- Семейный обмен сохраняет анализы и независимые отметки приёма.',assets:[{name:`dnevnik-zdorovya_v${version}_2026-10-03.apk`,state:'uploaded',size:100,browser_download_url:`https://github.com/LeonidAn1988/dnevnik-zdorovya/releases/download/v${version}/app.apk`}]})
const browser=await chromium.launch({headless:true})
const checks=[];const out='reviews/evidence/update';mkdirSync(out,{recursive:true})
async function test(name,run){const context=await browser.newContext({viewport:{width:360,height:780},hasTouch:true,locale:'ru-RU'});const page=await context.newPage();let listing=[release('0.44.0'),release('0.45.0'),{...release('0.46.0'),assets:[]}];let tagged=release('0.45.0');let status=200;const requests=[];const errors=[];page.on('pageerror',e=>errors.push(String(e)))
 await page.route('https://api.github.com/**',async route=>{const url=route.request().url();requests.push(url);const body=url.includes('/releases?')?listing:tagged;await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)})})
 await page.route('https://update.invalid/**',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('https://update.invalid/');await page.addStyleTag({content:readFileSync('src/app.css','utf8')});await page.addScriptTag({content:output.outputFiles[0].text})
 try{await run(page,{setTagged:v=>tagged=v,setStatus:v=>status=v,requests});assert.deepEqual(errors,[]);checks.push(name);console.log(`ok ${name}`)}finally{await context.close()}}
try{
 await test('Предлагается 0.45 вместо latest 0.44; два нажатия устанавливают точный тег один раз',async(page,{requests})=>{
  await page.evaluate(()=>window.start());await page.getByRole('heading',{name:'Доступно обновление 0.45.0'}).waitFor()
  await page.evaluate(()=>Promise.all([window.update.обновить(),window.update.обновить()]))
  assert.deepEqual(await page.evaluate(()=>window.downloads),[release('0.45.0').assets[0].browser_download_url]);assert.equal(await page.evaluate(()=>window.installs.length),1)
  assert.ok(requests.some(url=>url.endsWith('/releases/tags/v0.45.0')));assert.ok(requests.every(url=>!url.endsWith('/latest')))
 })
 await test('Подмена или исчезновение файла выбранной версии блокирует установку',async(page,{setTagged})=>{
  await page.evaluate(()=>window.start());await page.waitForFunction(()=>window.update?.свежие.length)
  setTagged(release('0.44.0'));await page.evaluate(()=>window.update.обновить())
  assert.equal(await page.evaluate(()=>window.downloads.length),0);assert.equal(await page.evaluate(()=>window.installs.length),0)
  assert.match(await page.evaluate(()=>window.update.ошибка),/0\.45\.0.*недоступен/)
  assert.ok((await page.locator('.update-nudge').getByRole('link',{name:'страницы загрузок'}).getAttribute('href')).endsWith('/releases/tag/v0.45.0'))
 })
 await test('Позже действует на текущий сеанс; прежний постоянный skip не скрывает обновление',async page=>{
  await page.evaluate(()=>{localStorage.setItem('omron.update-skipped','0.45.0');window.start()});await page.locator('.update-nudge').waitFor()
  await page.locator('.update-nudge').getByRole('button',{name:'Напомнить позже'}).click();await page.locator('.update-nudge').waitFor({state:'detached'})
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.locator('.update-nudge').waitFor()
  await page.locator('.update-nudge').getByRole('button',{name:'Напомнить позже'}).click();await page.locator('.update-nudge').waitFor({state:'detached'})
  await page.evaluate(()=>window.unmount());await page.waitForFunction(()=>document.getElementById('root').childElementCount===0)
  await page.evaluate(()=>window.start());await page.locator('.update-nudge').waitFor()
 })
 await test('Ошибка сети не выдаётся за последнюю установленную версию',async(page,{setStatus})=>{
  setStatus(500);await page.evaluate(()=>window.start());await page.getByText('Не удалось узнать, есть ли обновление.',{exact:true}).waitFor()
  assert.equal(await page.getByText('Установлена последняя опубликованная версия.',{exact:true}).count(),0)
 })
 for(const scale of ['normal','xlarge'])for(const overview of [true,false])await test(`Главный экран ${scale}, overview=${overview}: обновление видно без прокрутки`,async page=>{
  if(scale==='xlarge')await page.emulateMedia({colorScheme:'dark'})
  await page.evaluate(({scale,overview})=>window.startApp(scale,overview),{scale,overview});await page.locator('.update-nudge').waitFor()
  assert.equal(await page.locator('.update-nudge').count(),1)
  assert.equal(await page.locator('.app > .card').first().getAttribute('aria-label'),'Обновление приложения')
  const button=page.locator('.update-nudge').getByRole('button',{name:'Обновить до 0.45.0',exact:true});const bounds=await button.boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=780,JSON.stringify(bounds))
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1))
  await page.screenshot({path:`${out}/home-${scale}-${overview?'overview':'pressure'}.png`})
  if(process.env.OMRON_UPDATE_PERCY==='1')await percySnapshot(page,`update-home-${scale}-${overview?'overview':'pressure'}`,{widths:[360,768,1280],minHeight:780})
  await page.getByRole('button',{name:'Настройки',exact:true}).click();await page.locator('.update-nudge').waitFor({state:'detached'})
 })
 writeFileSync(`${out}/integration.json`,JSON.stringify({at:new Date().toISOString(),checks},null,2)+'\n')
}finally{await browser.close()}
