/** Real useFamilySync + webCloud, disposable browser storage and fake HTTP only. */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const fixtureKey = 'synthetic_family_cloud_key_for_test'
const source = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { installPlatform } from './src/platform/ports';
import { webPlatform } from './src/platform/web';
import { DEFAULT_SETTINGS, saveSettings, putMeasurements, putMedicine, putRegimen, putLab, saveTombstones } from './src/db/store';
import { useFamilySync } from './src/ui/useFamilySync';
const setup = window.bootstrapFixture;
// Control cases substitute only platform kind/read capability; every cloud
// request still uses the real web adapter and intercepted test endpoints.
installPlatform({ ...webPlatform, kind: setup.native ? 'native' : 'web',
  cloud: setup.canRead ? { ...webPlatform.cloud, canDownload: () => true } : webPlatform.cloud });
const initial = { ...DEFAULT_SETTINGS, people: setup.people, activePerson: setup.people[0].id, onboarded: true };
function Harness() {
  const [settings, setSettings] = useState(initial);
  const [finished, setFinished] = useState(false);
  const family = useFamilySync({ ready: true, settings, onSettings: setSettings,
    onChanged: async people => { if (people) setSettings(prev => ({ ...prev, people })); } });
  return <><button disabled={family.busy} onClick={async () => { setFinished(false); await family.cloud.connect(setup.key); setFinished(true); }}>Connect</button>
    <output id="state">{JSON.stringify({ finished, busy: family.busy, connected: family.cloud.connected,
      files: family.cloud.files.map(file => file.name), people: settings.people, lastAt: family.lastAt,
      canRead: family.cloud.canRead, error: family.cloud.error })}</output></>;
}
async function start() {
  await saveSettings(initial);
  if (setup.kind === 'measurement') await putMeasurements([{ id: 'test-bp', kind: 'bp', person: initial.activePerson, user: 1,
    ts: 1800000000000, sys: 123, dia: 81, bpm: 66, ihb: false, mov: false, source: 'manual' }]);
  if (setup.kind === 'medicine') await putMedicine({ id: 'test-med', name: 'Synthetic medicine', dose: '', left: 5, expires: null });
  if (setup.kind === 'regimen') await putRegimen({ id: 'test-course', medicineId: 'test-med', person: initial.activePerson,
    since: 1800000000000, perTime: 1, times: ['08:00'] });
  if (setup.kind === 'lab') await putLab({ id: 'test-lab', owner: initial.activePerson, name: 'Synthetic lab', results: [] });
  if (setup.kind === 'tombstone') await saveTombstones([{ id: 'old-measurement', kind: 'measurement', at: 1800000000000 }]);
  createRoot(document.getElementById('root')).render(<Harness />);
}
void start();`
const bundle = (await build({ stdin: { contents: source, loader: 'tsx', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'iife', jsx: 'automatic', logLevel: 'error' })).outputFiles[0].text
const files = [
  { type: 'file', name: 'дневник-Отец-aaa111.json', modified: '2026-10-07T09:00:00Z', size: 2000 },
  { type: 'file', name: 'дневник-Дочь-bbb222.json', modified: '2026-10-07T09:00:00Z', size: 1800 },
]
const placeholder = [{ id: 'local-browser', name: 'Я', deviceUser: 1 }]
const cases = [
  { name: 'empty placeholder', people: placeholder, upload: false },
  { name: 'trimmed placeholder', people: [{ ...placeholder[0], name: ' Я ' }], upload: false },
  { name: 'explicitly named empty diary', people: [{ ...placeholder[0], name: 'Леонид' }], upload: true },
  { name: 'configured family without records', people: [...placeholder, { id: 'local-child', name: 'Дочь' }], upload: true },
  ...['measurement', 'medicine', 'regimen', 'lab', 'tombstone'].map(kind => ({ name: `placeholder with ${kind}`, people: placeholder, kind, upload: true })),
  { name: 'read-capable platform keeps existing upload behavior', people: placeholder, canRead: true, upload: true },
  { name: 'native platform is outside the browser guard', people: placeholder, native: true, upload: true },
]

const browser = await chromium.launch()
try {
  for (const scenario of cases) {
    const context = await browser.newContext({ hasTouch: true })
    const page = await context.newPage()
    page.setDefaultTimeout(8000)
    const uploads = [], errors = [], deleted = [], unexpected = []
    let listings = 0
    page.on('pageerror', error => errors.push(String(error)))
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin === 'https://bootstrap.invalid') {
        const fixture = JSON.stringify({ ...scenario, key: fixtureKey }).replaceAll('<', '\\u003c')
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script>window.bootstrapFixture=${fixture}</script><script>${bundle.replaceAll('</script', '<\\/script')}</script></body></html>` })
      }
      if (url.origin === 'https://cloud-api.yandex.net') {
        assert.equal(request.headers().authorization, `OAuth ${fixtureKey}`)
        if (request.method() === 'DELETE') {
          deleted.push(url.searchParams.get('path'))
          return route.fulfill({ status: 204 })
        }
        if (url.pathname.endsWith('/upload')) return route.fulfill({ json: { href: 'https://upload.invalid/write' } })
        listings++
        return route.fulfill({ json: { _embedded: { items: files } } })
      }
      if (url.origin === 'https://upload.invalid') {
        uploads.push(JSON.parse(request.postData()))
        return route.fulfill({ status: 201 })
      }
      unexpected.push(request.url())
      return route.abort()
    })
    await page.goto('https://bootstrap.invalid')
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await page.waitForFunction(() => {
      const state = JSON.parse(document.querySelector('#state').textContent)
      return state.finished && !state.busy && state.lastAt !== null
    })
    const state = JSON.parse(await page.locator('#state').textContent())
    assert.equal(state.connected, true, scenario.name)
    assert.equal(state.error, null, scenario.name)
    assert.deepEqual(state.files, files.map(file => file.name), 'listing remains available')
    assert.deepEqual(state.people, scenario.people, 'file labels must not become imported people')
    assert.ok(listings >= 2, 'connect validates the key and sync lists the folder')
    assert.equal(uploads.length > 0, scenario.upload, scenario.name)
    assert.deepEqual(deleted, [], 'never deletes peer files during bootstrap')
    assert.deepEqual(errors, [], scenario.name)
    assert.deepEqual(unexpected, [], 'test must not contact an unmocked service')
    for (const upload of uploads) {
      assert.deepEqual(upload.settings.people, scenario.people)
      if (scenario.kind) {
        const collection = { measurement: 'measurements', medicine: 'medicines', regimen: 'regimens', lab: 'labs', tombstone: 'tombstones' }[scenario.kind]
        assert.equal(upload[collection].length, 1, 'real diary content is still sent')
      }
    }
    // A second manual connection/sync must not create a placeholder later.
    if (!scenario.upload) {
      await page.getByRole('button', { name: 'Connect', exact: true }).click()
      await page.waitForFunction(() => { const s = JSON.parse(document.querySelector('#state').textContent); return s.finished && !s.busy })
      assert.equal(uploads.length, 0)
    }
    console.log(`ok ${scenario.name}: uploads=${uploads.length}, family file list=${state.files.length}`)
    await context.close()
  }
} finally {
  await browser.close()
}
