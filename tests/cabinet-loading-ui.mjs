import { build } from 'esbuild'
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const bundle = (await build({ entryPoints: ['tests/cabinet-loading-harness.tsx'], bundle: true, write: false, format: 'iife', logLevel: 'error', jsx: 'automatic' })).outputFiles[0].text
const css = `${readFileSync('src/app.css', 'utf8')}\n${readFileSync('src/modern.css', 'utf8')}`
const html = `<html lang="ru" data-interface="modern" data-text="normal"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${bundle.replaceAll('</script', '<\\/script')}</script></html>`
const browser = await chromium.launch()
try {
  for (const width of [360, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 780 }, hasTouch: true, locale: 'ru-RU' })
    await page.route('https://cabinet.test/**', route => route.fulfill({ contentType: 'text/html', body: html }))
    await page.goto('https://cabinet.test/')
    await page.getByRole('heading', { name: 'Запасы лекарств' }).waitFor()
    assert.equal(await page.getByText(/Аптечка пуста/).count(), 0, `${width}px: don't show empty-state copy during family sync`)
    await page.evaluate(() => window.setCabinetLoading(false))
    await page.getByText(/Аптечка пуста/).waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.close()
  }
  console.log('Cabinet loading state: hides false empty copy while syncing, then shows the real empty state at 360px and 320px')
} finally {
  await browser.close()
}
