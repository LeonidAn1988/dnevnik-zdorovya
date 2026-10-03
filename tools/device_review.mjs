/** Read and exercise only the isolated .review Android package through ADB/CDP. */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { _android as android } from 'playwright'
import { seed, SCREENS, go, settle, settleAny } from './visual.mjs'

export const PACKAGE = 'io.github.leonidan1988.omronbp.review'
export const OUT = process.env.OMRON_REVIEW_OUT ?? fileURLToPath(new URL('../reviews/evidence/device/', import.meta.url))
const ADB = '/Users/leonidanchevskiy/Library/Android/sdk/platform-tools/adb'
const rawAdb = (...args) => execFileSync(ADB, [...(process.env.OMRON_DEVICE_SERIAL ? ['-s', process.env.OMRON_DEVICE_SERIAL] : []), ...args], { timeout: 20_000 })
export function reviewForegroundMatches(activity, window) {
  const resumed = activity.split('\n').find(line => /\btopResumedActivity[=:]/.test(line))
    ?? activity.split('\n').find(line => /\bmResumedActivity:/.test(line))
  const focus = window.split('\n').find(line => /\bmCurrentFocus=/.test(line))
  return !!resumed?.includes(` ${PACKAGE}/`) && !!focus?.includes(` ${PACKAGE}/`)
}
export function assertReviewForeground() {
  if (!reviewForegroundMatches(rawAdb('shell', 'dumpsys', 'activity', 'activities').toString(), rawAdb('shell', 'dumpsys', 'window').toString())) {
    throw new Error('Device action blocked: the isolated review app must be resumed and focused')
  }
}
export const adb = (...args) => {
  if (args[0] === 'shell' && (args[1] === 'input' || (args[1] === 'uiautomator' && args[2] === 'dump'))
    || args[0] === 'exec-out' && args[1] === 'screencap') assertReviewForeground()
  return rawAdb(...args)
}

export async function connect() {
  const pid = adb('shell', 'pidof', PACKAGE).toString().trim()
  if (!/^\d+$/.test(pid)) throw new Error('Review package is not running')
  const sockets = adb('shell', 'cat', '/proc/net/unix').toString()
  const socket = `webview_devtools_remote_${pid}`
  if (!sockets.includes(socket)) throw new Error('Review WebView diagnostics not found')
  adb('forward', 'tcp:9228', `localabstract:${socket}`)
  const devices = await android.devices({ omitDriverInstall: true })
  if (devices.length !== 1) throw new Error('Exactly one phone must be connected')
  const device = devices[0]
  const webview = await device.webView({ pkg: PACKAGE }, { timeout: 10_000 })
  const page = await webview.page()
  const browser = { close: () => device.close() }
  page.setDefaultTimeout(8_000)
  mkdirSync(OUT, { recursive: true })
  return { browser, page }
}

export async function patchSettings(page, fields) {
  await page.evaluate(async fields => {
    const db = await new Promise((resolve, reject) => {
      const q = indexedDB.open('omron-bp'); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error)
    })
    const st = await new Promise(resolve => { const q = db.transaction('meta').objectStore('meta').get('settings'); q.onsuccess = () => resolve(q.result) })
    await new Promise((resolve, reject) => {
      const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put({ ...st, ...fields }, 'settings'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error)
    })
    db.close()
  }, fields)
  await page.reload({ waitUntil: 'domcontentloaded' }); await settle(page)
}

export async function capture(page, name, full = false) {
  writeFileSync(`${OUT}${name}-device.png`, adb('exec-out', 'screencap', '-p'))
  if (full) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight)
    await page.screenshot({ path: `${OUT}${name}-webview.png`, fullPage: height <= 12000, timeout: 20_000 })
  }
}

// Screen routing uses DOM activation. This is layout evidence; separate native
// flows use ADB taps/back. It does not measure physical touch ergonomics.
function routeLocator(locator) {
  return new Proxy(locator, { get(target,key) {
    if (key === 'click') return () => target.evaluate(el => el.click())
    if (key === 'check') return () => target.evaluate(el => { if (!el.checked) el.click() })
    const value=target[key]
    if (['first','last','nth','locator','filter'].includes(key)) return (...args) => routeLocator(value.apply(target,args))
    return typeof value === 'function' ? value.bind(target) : value
  } })
}
export const goPhone = async (page, screen) => {
  const routingPage = new Proxy(page, { get(target,key) {
    if (key === 'locator') return (...args) => routeLocator(target.locator(...args))
    const value=target[key]; return typeof value === 'function' ? value.bind(target) : value
  } })
  if (screen.tab === 'Аптечка') {
    // visual.go activates `open` before `section`, so select the section in a
    // separate step before opening a medicine or course.
    await go(routingPage, { name:screen.name, tab:screen.tab, section:screen.section ?? 'Запасы' })
    return go(routingPage, { ...screen, tab:undefined, section:undefined })
  }
  return go(routingPage, screen)
}

export const geometry = page => page.evaluate(() => {
  const r = e => { const b=e.getBoundingClientRect(); return { x:b.x,y:b.y,w:b.width,h:b.height } }
  const visible = e => { const b=e.getBoundingClientRect(); return b.width && b.height && getComputedStyle(e).visibility !== 'hidden' }
  return {
    width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
    viewport: { width:visualViewport.width,height:visualViewport.height,offsetTop:visualViewport.offsetTop,scale:visualViewport.scale },
    dpr: devicePixelRatio, touch: navigator.maxTouchPoints, coarse: matchMedia('(pointer:coarse)').matches,
    font: getComputedStyle(document.body).fontFamily, fontSize: getComputedStyle(document.documentElement).fontSize,
    active: document.activeElement?.outerHTML.slice(0,500), nav:document.querySelector('.app')?.dataset.nav,
    headings:[...document.querySelectorAll('h2,h3')].map(e=>e.textContent),
    controls: [...document.querySelectorAll('button,input,select,summary,[role=button]')].filter(visible).map(e => ({ label:e.getAttribute('aria-label')||e.textContent.trim().slice(0,80)||e.placeholder, ...r(e) })),
  }
})

async function main() {
  const mode = process.argv[2] ?? 'inspect'
  const {browser,page} = await connect()
  try {
    await settleAny(page)
    if (mode === 'inspect') {
      console.log(JSON.stringify({ ua:await page.evaluate(()=>navigator.userAgent), ...await geometry(page), text:await page.locator('body').innerText() },null,2))
    } else if (mode === 'seed') {
      await seed(page,Date.now()); await page.reload({waitUntil:'domcontentloaded'}); await settle(page)
      await capture(page,'overview',true); console.log(JSON.stringify(await geometry(page)))
    } else if (mode === 'crawl') {
      const all = [], errors = []
      page.on('pageerror', e=>errors.push(String(e)))
      for (const scale of ['normal','xlarge']) {
        await seed(page,Date.now()); await patchSettings(page,{ textScale:scale, theme:'light', remindersOn:false })
        for (const [i,screen] of SCREENS.entries()) {
          try {
            await goPhone(page,screen)
            const metrics=await geometry(page)
            const name=`${scale}-${String(i+1).padStart(2,'0')}`
            await capture(page,name,true)
            all.push({scale,name:screen.name,...metrics})
            writeFileSync(`${OUT}crawl.json`,JSON.stringify({devicePackage:PACKAGE,at:new Date().toISOString(),complete:false,screens:all,errors},null,2))
            console.log(`${scale}: ${screen.name}: ${metrics.scrollWidth}/${metrics.width}`)
          } catch (e) { all.push({scale,name:screen.name,error:String(e).split('\n')[0]}); console.log(`${scale}: ${screen.name}: ERROR ${String(e).split('\n')[0]}`) }
        }
      }
      writeFileSync(`${OUT}crawl.json`,JSON.stringify({devicePackage:PACKAGE,at:new Date().toISOString(),complete:true,screens:all,errors},null,2))
      console.log(JSON.stringify({screens:all.length,failed:all.filter(x=>x.error).length,overflow:all.filter(x=>x.scrollWidth>x.width+1).length,errors}))
    } else if (mode === 'repair-crawl') {
      const all = JSON.parse(readFileSync(`${OUT}crawl.json`,'utf8'))
      copyFileSync(`${OUT}normal-09-device.png`,`${OUT}crawler-wrong-medicine-card-device.png`)
      for (const scale of ['normal','xlarge']) {
        await seed(page,Date.now()); await patchSettings(page,{ textScale:scale, theme:'light', remindersOn:false })
        for (const i of [8,9,10,26]) {
          const screen=SCREENS[i]; await goPhone(page,screen)
          const metrics=await geometry(page)
          await capture(page,`${scale}-${String(i+1).padStart(2,'0')}`,true)
          const idx=all.screens.findIndex(s=>s.scale===scale && s.name===screen.name)
          all.screens[idx]={scale,name:screen.name,...metrics}
          console.log(`${scale}: repaired ${screen.name}: ${metrics.scrollWidth}/${metrics.width}`)
        }
      }
      all.complete=true; all.at=new Date().toISOString(); all.repairs='Cabinet state explicitly selected; oversized history screenshot uses viewport'
      writeFileSync(`${OUT}crawl.json`,JSON.stringify(all,null,2))
      console.log(JSON.stringify({screens:all.screens.length,failed:all.screens.filter(x=>x.error).length,overflow:all.screens.filter(x=>x.scrollWidth>x.width+1).length,errors:all.errors}))
    } else throw new Error(`Unknown mode ${mode}`)
  } finally { await browser.close() }
}

if(process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e);process.exitCode=1})
