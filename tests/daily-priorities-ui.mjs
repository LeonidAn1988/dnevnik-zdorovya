import { build } from 'esbuild'
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const output = process.env.EVIDENCE_DIR ?? 'reviews/evidence/daily-priorities'
mkdirSync(output, { recursive: true })
const bundle = (await build({ entryPoints: ['tests/daily-priorities-harness.tsx'], bundle: true, write: false, format: 'iife', logLevel: 'error', jsx: 'automatic' })).outputFiles[0].text
const css = `${readFileSync('src/app.css', 'utf8')}\n${readFileSync('src/modern.css', 'utf8')}`
const html = `<html lang="ru" data-interface="modern" data-text="normal"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${bundle.replaceAll('</script', '<\\/script')}</script></html>`
const browser = await chromium.launch()
const checks = [], errors = []

async function fixture(page, name) {
  await page.evaluate(value => window.setDailyFixture(value), name)
  await page.waitForTimeout(50)
}

try {
  for (const profile of [
    { width: 360, height: 800, text: 'normal' },
    { width: 320, height: 800, text: 'xlarge' },
  ]) {
    const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, hasTouch: true, locale: 'ru-RU', timezoneId: 'Europe/Moscow' })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(`${profile.width}/${profile.text}: ${error.message}`))
    await page.route('https://daily.test/**', route => route.fulfill({ contentType: 'text/html', body: html.replace('data-text="normal"', `data-text="${profile.text}"`) }))
    await page.clock.install({ time: new Date('2026-08-15T10:30:00+03:00') })
    await page.goto('https://daily.test/')

    await page.getByRole('status').filter({ hasText: 'На сейчас всё отмечено' }).waitFor()
    await page.getByText('Следующий приём в').waitFor()
    assert.match(await page.locator('.today-card__next').textContent(), /20:00/)
    await page.screenshot({ path: `${output}/${profile.width}-${profile.text}-overview-future.png` })
    await page.getByRole('button', { name: 'Посмотреть расписание' }).click()
    await page.locator('.intake[data-part="evening"]').waitFor()
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-part')), 'evening', 'Overview opens and focuses the matching part of the day')
    checks.push(`${profile.width}/${profile.text}: future 20:00/21:00 plan is not presented as a current task; schedule opens evening`)

    await fixture(page, 'available')
    await page.getByRole('status').filter({ hasText: 'Есть приёмы без отметки · 1' }).waitFor()
    await page.getByRole('button', { name: 'Открыть «Приём»' }).click()
    await page.locator('.intake[data-part="morning"]').waitFor()
    checks.push(`${profile.width}/${profile.text}: an overdue unmarked dose stays visible as requiring attention and opens its part`)

    await fixture(page, 'automatic')
    await page.getByRole('status').filter({ hasText: 'списываются автоматически' }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Открыть «Приём»' }).count(), 0)
    assert.match(await page.locator('.today-card').textContent(), /не подтверждает, что препарат принят/)
    checks.push(`${profile.width}/${profile.text}: automatic stock deduction is not described as a confirmed dose`)

    await fixture(page, 'automatic-window')
    await page.getByRole('status').filter({ hasText: 'Есть приёмы без отметки · 1' }).waitFor()
    const availableManual = page.locator('.today__row').filter({ hasText: 'Ручной поздний' })
    assert.equal(await availableManual.locator('.today__status').textContent(), 'доступно для отметки', 'A manual dose made available by the part window does not say it is too early')
    assert.equal(await availableManual.locator('.today__mark').getAttribute('aria-label'), 'доступно для отметки', 'Screen reader status matches the available action')
    await page.getByRole('button', { name: 'Открыть «Приём»' }).click()
    const mixedWindow = page.locator('.intake[data-part="morning"]')
    await mixedWindow.getByRole('button', { name: 'Принял', exact: true }).waitFor()
    checks.push(`${profile.width}/${profile.text}: overview and Intake use the same part window when an automatic 08:00 dose precedes a manual 11:45 dose`)

    await page.clock.setFixedTime(new Date('2026-08-15T12:30:00+03:00'))
    await fixture(page, 'priority-intake')
    assert.deepEqual(await page.locator('.intake').evaluateAll(cards => cards.map(card => card.getAttribute('data-part'))), ['day', 'evening', 'morning'], 'Current action is first, then future, then completed')
    await page.locator('.intake[data-part="day"]').getByRole('button', { name: 'Принял', exact: true }).waitFor()
    checks.push(`${profile.width}/${profile.text}: current unfinished block is first, before future and completed blocks`)
    await page.clock.setFixedTime(new Date('2026-08-15T10:30:00+03:00'))
    await fixture(page, 'timer-priority-intake')
    assert.deepEqual(await page.locator('.intake').evaluateAll(cards => cards.map(card => card.getAttribute('data-part'))), ['morning', 'day', 'evening'], 'An active eat timer is current work and precedes pending/future parts')
    await page.locator('.intake[data-part="morning"]').getByText('Можно есть через 20 мин').waitFor()
    await page.locator('.intake[data-part="morning"]').getByRole('button', { name: 'Отменить таймер' }).waitFor()
    checks.push(`${profile.width}/${profile.text}: active eat timer keeps its completed medicine group first in the current-day priority order`)

    await fixture(page, 'complete')
    await page.getByRole('status').filter({ hasText: 'Сегодня все приёмы отмечены' }).waitFor()
    checks.push(`${profile.width}/${profile.text}: completed day has a calm completion message`)

    await fixture(page, 'mixed-intake')
    const morning = page.locator('.intake[data-part="morning"]')
    const evening = page.locator('.intake[data-part="evening"]')
    assert.equal(await morning.getByRole('button', { name: /Показать приёмы/ }).count(), 1)
    assert.ok(await morning.getByText('Утренний препарат').isVisible())
    assert.equal(await morning.getByRole('button', { name: 'убрать отметку' }).count(), 1, 'Undo remains available while a completed part is folded')
    assert.equal(await evening.getByText('Отметить заранее').count(), 1, 'Future dose stays explicitly accessible')
    await page.screenshot({ path: `${output}/${profile.width}-${profile.text}-intake-folded.png` })
    await page.getByRole('button', { name: 'Показать весь день' }).click()
    assert.equal(await page.getByRole('button', { name: 'Свернуть день' }).count(), 1)
    assert.equal(await morning.getByRole('button', { name: /Свернуть выполненное/ }).count(), 0)
    assert.ok(await morning.getByRole('button', { name: 'убрать отметку' }).isVisible(), 'Full-day view keeps undo available')
    await page.getByRole('button', { name: 'Свернуть день' }).click()
    await morning.getByRole('button', { name: /Показать приёмы/ }).waitFor()
    checks.push(`${profile.width}/${profile.text}: full-day toggle reveals all actions and returns completed blocks to compact form`)

    await morning.getByRole('button', { name: 'убрать отметку' }).click()
    await morning.getByRole('button', { name: 'Принял', exact: true }).waitFor()
    assert.equal(await morning.getByRole('button', { name: /Показать приёмы/ }).count(), 0, 'Pending dose stays expanded with its action')
    assert.deepEqual(await page.evaluate(() => window.dailyActions.at(-1)), { kind: 'mark', args: ['morning', new Date('2026-08-15T08:00:00+03:00').getTime(), true] })
    await morning.getByRole('button', { name: 'Принял', exact: true }).click()
    await morning.getByRole('button', { name: /Свернуть выполненное/ }).waitFor()
    assert.ok(await morning.getByText('Утренний препарат').isVisible(), 'Completing the last pending dose does not auto-fold the group')
    checks.push(`${profile.width}/${profile.text}: completed block folds with undo; removing a mark exposes its action, and re-marking does not auto-fold`)

    await fixture(page, 'transition-intake')
    const transitionPart = page.locator('.intake[data-part="morning"]')
    await transitionPart.getByRole('button', { name: /Показать приёмы/ }).waitFor()
    await page.evaluate(() => window.setDailyMark?.(false))
    await transitionPart.getByRole('button', { name: 'Принял', exact: true }).waitFor()
    await transitionPart.getByRole('button', { name: 'Принял', exact: true }).click()
    await transitionPart.getByRole('button', { name: /Свернуть выполненное/ }).waitFor()
    assert.equal(await transitionPart.getByRole('button', { name: 'убрать отметку' }).count(), 1)
    checks.push(`${profile.width}/${profile.text}: same-day mark removal immediately exposes the pending action; completing it does not auto-fold the group`)

    await fixture(page, 'timer-intake')
    const timerPart = page.locator('.intake[data-part="morning"]')
    assert.equal(await timerPart.getByRole('button', { name: /Показать приёмы/ }).count(), 0, 'A meal timer keeps its medicine context expanded')
    await timerPart.getByText('Можно есть через 20 мин').waitFor()
    await timerPart.getByRole('button', { name: 'Отменить таймер' }).waitFor()
    await page.screenshot({ path: `${output}/${profile.width}-${profile.text}-intake-timer.png` })
    checks.push(`${profile.width}/${profile.text}: active meal timer stays beside its medicine in Intake`)

    await fixture(page, 'timer-cancel-intake')
    const strictTimerPart = page.locator('.intake[data-part="morning"]')
    await strictTimerPart.getByText('Можно есть через 20 мин').waitFor()
    assert.equal(await strictTimerPart.getByRole('button', { name: 'Отменить таймер' }).count(), 1, 'Only the active timer matching regimen, planned time, kind and person is shown')
    await strictTimerPart.getByRole('button', { name: 'Отменить таймер' }).click()
    assert.deepEqual(await page.evaluate(() => window.dailyActions.at(-1)), { kind: 'cancel-timer', args: ['timer1'] }, 'Row cancellation targets only the matched active timer id')
    await strictTimerPart.getByRole('button', { name: /Напомнить, когда можно есть/ }).waitFor()
    const timerStateAfterCancel = await page.evaluate(() => window.dailyTimers.map(timer => ({ id: timer.id, cancelledAt: timer.cancelledAt ?? null })))
    assert.deepEqual(timerStateAfterCancel, [
      { id: 'timer1', cancelledAt: new Date('2026-08-15T10:30:00+03:00').getTime() },
      { id: 'wrong-kind', cancelledAt: null },
      { id: 'wrong-person', cancelledAt: null },
      { id: 'cancelled', cancelledAt: new Date('2026-08-15T10:30:00+03:00').getTime() - 1 },
      { id: 'expired', cancelledAt: null },
    ], 'Cancellation changes only the matched timer; wrong-person, wrong-kind and expired records remain untouched')
    await page.screenshot({ path: `${output}/${profile.width}-${profile.text}-intake-timer-cancelled.png` })
    checks.push(`${profile.width}/${profile.text}: active timer shows its remaining time and row cancellation passes only its exact timer id`)

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${profile.width}/${profile.text}: no horizontal overflow`)
    assert.equal(await page.evaluate(() => window.dailyActions.some(action => action.kind === 'mark' || action.kind === 'timer')), false, 'Timer presentation and navigation do not write dose events')
    await context.close()
  }
  assert.deepEqual(errors, [])
  writeFileSync(`${output}/checks.json`, JSON.stringify({ checks, errors }, null, 2))
  console.log(`Daily priorities: ${checks.length} scenarios passed; screenshots saved to ${output}`)
} catch (error) {
  writeFileSync(`${output}/checks.json`, JSON.stringify({ checks, errors, failure: error.message }, null, 2))
  console.error(error)
  process.exitCode = 1
} finally { await browser.close() }
