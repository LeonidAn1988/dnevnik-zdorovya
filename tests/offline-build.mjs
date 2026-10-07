/** Built production PWA, first visit and updates in an isolated synthetic profile.
 * Requires npm run build; never touches a device, user profile or deployment. */
import { chromium } from 'playwright'
import { build } from 'vite'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readdirSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { tmpdir } from 'node:os'
import { FROZEN, seed, settleAny, settle, go } from '../tools/visual.mjs'

const out = 'reviews/evidence/offline-build'
mkdirSync(out, { recursive: true })
const temp = mkdtempSync(join(tmpdir(), 'omron-offline-'))
const snapshot = dir => Object.fromEntries(readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => {
  const path = join(e.parentPath, e.name)
  return [path.slice(dir.length + 1).replaceAll('\\', '/'), readFileSync(path)]
}))
const manifest = files => JSON.parse(files['sw.js'].toString().match(/^const PRECACHE = (.+)$/m)[1])
const buildId = files => files['sw.js'].toString().match(/^const BUILD_ID = '(.+)'$/m)[1]
const first = snapshot(join(process.cwd(), 'dist'))
assert.ok(!first['sw.js'].toString().includes('__BUILD_ID__'))
for (const name of Object.keys(first).filter(name => name.startsWith('assets/'))) assert.ok(manifest(first).includes('./' + name), `Missing chunk: ${name}`)
for (const name of ['index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'drugs.json', 'supplements.json']) assert.ok(manifest(first).includes('./' + name))
let deployed = first
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' }
const requests = []
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const path = url.pathname.startsWith('/health/') ? url.pathname.slice('/health/'.length) || 'index.html' : null
  requests.push({ path, cacheControl: req.headers['cache-control'] })
  const body = path && deployed[path]
  if (!body) { res.writeHead(404); res.end('missing'); return }
  res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': path === 'sw.js' ? 'no-store' : 'public, max-age=600' })
  res.end(body)
})
await new Promise(resolve => server.listen(0, 'localhost', resolve))
const origin = `http://localhost:${server.address().port}`
const url = origin + '/health/'
const browser = await chromium.launch()
const errors = []
async function stored(page) {
  return page.evaluate(async () => {
    const db = await new Promise(resolve => { const q = indexedDB.open('omron-bp'); q.onsuccess = () => resolve(q.result) })
    const result = {}
    for (const name of ['readings', 'medicines', 'regimens', 'labs']) result[name] = await new Promise(resolve => { const q = db.transaction(name).objectStore(name).getAll(); q.onsuccess = () => resolve(q.result) })
    db.close(); return result
  })
}
async function settleWorker(page, checkUpdate = false) {
  await page.evaluate(async checkUpdate => {
    const registration = await navigator.serviceWorker.ready
    if (checkUpdate) await registration.update()
    const worker = registration.installing || registration.waiting
    if (worker && !['activated', 'redundant'].includes(worker.state)) await new Promise(resolve => worker.addEventListener('statechange', () => { if (['activated', 'redundant'].includes(worker.state)) resolve() }))
  }, checkUpdate)
  await page.waitForFunction(() => navigator.serviceWorker.controller)
}
try {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, hasTouch: true, locale: 'ru-RU' })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.install({ time: new Date(FROZEN) })
  await page.goto(url); await settleAny(page)
  await seed(page, FROZEN) // No online reload: the first visit must already install all assets.
  await settleWorker(page)
  const cachePrefix = `omron-bp-v5:${url}:`
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys(), key = keys.find(key => key.startsWith('omron-bp-v5:'))
    return (await (await caches.open(key)).keys()).map(request => request.url)
  })
  for (const name of manifest(first)) assert.ok(cached.includes(new URL(name, url).href), `First visit did not cache ${name}`)
  await page.evaluate(async ({ origin, url }) => {
    await (await caches.open('another-app-cache')).put(origin + '/foreign', new Response('keep'))
    await (await caches.open(`omron-bp-v5:${origin}/other/:foreign`)).put(origin + '/other/', new Response('keep'))
    await (await caches.open('omron-bp-v4')).put(origin + '/legacy-other/', new Response('keep'))
  }, { origin, url })
  const cdp = await context.newCDPSession(page) // This disposable Chromium only; never a device.
  await cdp.send('Network.clearBrowserCache'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  await context.setOffline(true)
  await page.reload(); await settle(page)
  assert.equal(await page.locator('.app').getAttribute('data-nav'), 'overview')
  const before = await stored(page)
  assert.ok(before.readings.length > 0)
  const lazyResponses = Promise.all(['drugs.json', 'supplements.json'].map(name => page.waitForResponse(response => response.url() === new URL(name, url).href)))
  await go(page, { tab: 'Аптечка', add: true })
  for (const response of await lazyResponses) { assert.equal(response.ok(), true); assert.equal(response.fromServiceWorker(), true); assert.ok((await response.json()).items.length > 9000) }
  await page.getByRole('combobox', { name: 'Название или поиск препарата', exact: true }).fill('Конкор')
  await page.getByRole('listbox', { name: 'Препараты из реестра' }).waitFor()
  // Dynamic web-adapter chunks must work even if the first visit never imported them.
  const lazyChunks = manifest(first).filter(name => name.includes('/web-') && name.endsWith('.js'))
  const chunks = await page.evaluate(async files => Promise.all(files.map(async name => { const r = await fetch(name); return { ok: r.ok, size: (await r.text()).length } })), lazyChunks)
  assert.ok(chunks.length > 0 && chunks.every(chunk => chunk.ok && chunk.size > 0))
  await page.screenshot({ path: `${out}/cold-offline-catalogue.png`, fullPage: true })

  // A separate temporary build changes CSS, HTML and an emitted lazy asset.
  // The production source and the release dist stay untouched.
  const nextDir = join(temp, 'next')
  await build({ logLevel: 'error', build: { outDir: nextDir, emptyOutDir: true }, plugins: [{
    name: 'synthetic-offline-update',
    transform(code, id) { if (id.endsWith('/src/app.css')) return code + '\n:root{--offline-test-build:B}\n' },
    transformIndexHtml(html) { return html.replace('<html lang="ru">', '<html lang="ru" data-offline-build="B">') },
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'assets/offline-new-test.js', source: 'window.__offlineNew = true' }) },
  }] })
  const second = snapshot(nextDir)
  assert.notEqual(buildId(second), buildId(first), 'Asset/HTML changes must change the worker cache identity')
  assert.notEqual(second['sw.js'].toString(), first['sw.js'].toString())
  assert.ok(manifest(second).includes('./assets/offline-new-test.js'))
  // Prime an old HTTP-cached shell with a long max-age before deploying B.
  // Fresh reload must work with the ordinary HTTP cache enabled too.
  await context.setOffline(false)
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false })
  await page.reload(); await settle(page)
  assert.equal(await page.locator('html').getAttribute('data-offline-build'), null)
  const deploymentRequest = requests.length
  deployed = second
  // An ordinary reload must still fetch fresh HTML through the old worker.
  await page.reload(); await settle(page)
  assert.equal(await page.locator('html').getAttribute('data-offline-build'), 'B')
  assert.ok(requests.slice(deploymentRequest).some(request => request.path === 'index.html'), 'Fresh HTML must reach the server despite its old HTTP cache entry')
  await settleWorker(page, true)
  await page.waitForFunction(async id => (await caches.keys()).some(key => key.endsWith(':' + id)), buildId(second))
  await cdp.send('Network.clearBrowserCache'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }); await context.setOffline(true)
  await page.reload(); await settle(page)
  assert.equal(await page.locator('html').getAttribute('data-offline-build'), 'B', 'Offline reopen must use the newly installed shell')
  assert.deepEqual(await stored(page), before, 'Updating the shell must preserve the diary')
  const keys = await page.evaluate(() => caches.keys())
  assert.equal(keys.filter(key => key.startsWith(cachePrefix)).length, 2)
  for (const key of ['another-app-cache', `omron-bp-v5:${origin}/other/:foreign`, 'omron-bp-v4']) assert.ok(keys.includes(key), `Foreign cache was removed: ${key}`)
  const oldChunk = Object.keys(first).find(name => name.endsWith('.css') && !second[name])
  assert.ok(oldChunk)
  assert.equal(await page.evaluate(async name => (await fetch(name)).ok, './' + oldChunk), true, 'Previous version remains available to an old open page')

  // A missing required asset must reject the entire update, retaining version B.
  const failedId = 'synthetic-failed-install'
  const brokenWorker = second['sw.js'].toString().replace(buildId(second), failedId).replace(/^const PRECACHE = .+$/m, `const PRECACHE = ${JSON.stringify([...manifest(second), './assets/missing-required.js'])}`)
  deployed = { ...second, 'sw.js': Buffer.from(brokenWorker) }; await context.setOffline(false)
  const state = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    await registration.update()
    const worker = registration.installing
    if (!worker) return 'no-install'
    if (!['activated', 'redundant'].includes(worker.state)) await new Promise(resolve => worker.addEventListener('statechange', () => { if (['activated', 'redundant'].includes(worker.state)) resolve() }))
    return worker.state
  })
  assert.equal(state, 'redundant')
  assert.ok(!(await page.evaluate(() => caches.keys())).some(key => key.endsWith(':' + failedId)))
  await context.setOffline(true); await page.reload(); await settle(page)
  assert.equal(await page.locator('html').getAttribute('data-offline-build'), 'B')
  assert.deepEqual(await stored(page), before)
  assert.deepEqual(errors, [])
  writeFileSync(`${out}/checks.json`, JSON.stringify({ firstBuild: buildId(first), nextBuild: buildId(second), precachedFiles: manifest(first).length, firstVisitOnly: true, clearedHttpCache: true, offlineLazyCatalogues: true, offlineLazyChunks: chunks.length, freshOnlineReload: true, offlineUpdate: true, dataPreserved: true, failedInstallRejected: true, foreignCachesPreserved: true, errors }, null, 2))
  console.log('Built PWA: cold offline, lazy catalogues/chunks, atomic update/failure and diary preservation passed')
  await context.close()
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); rmSync(temp, { recursive: true, force: true }) }
