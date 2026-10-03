import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PACKAGE, reviewForegroundMatches } from '../tools/device_review.mjs'

const resumed = pkg => `mResumedActivity: ActivityRecord{abc u0 ${pkg}/.MainActivity t1}`
const focus = pkg => `mCurrentFocus=Window{abc u0 ${pkg}/.MainActivity}`

test('only the exact review package may receive global Android input or screenshots', () => {
  assert.ok(reviewForegroundMatches(resumed(PACKAGE), focus(PACKAGE)))
  for (const pkg of ['io.github.leonidan1988.omronbp', 'ru.hranitel.spike', `${PACKAGE}.other`]) {
    assert.ok(!reviewForegroundMatches(resumed(pkg), focus(PACKAGE)))
    assert.ok(!reviewForegroundMatches(resumed(PACKAGE), focus(pkg)))
  }
  assert.ok(!reviewForegroundMatches(resumed(PACKAGE), focus('com.android.systemui')))
  assert.ok(!reviewForegroundMatches(resumed(PACKAGE), 'mCurrentFocus=null'))
  assert.ok(!reviewForegroundMatches(`topResumedActivity=ActivityRecord{abc u0 ru.hranitel.spike/.MainActivity}\n${resumed(PACKAGE)}`, focus(PACKAGE)))
  assert.ok(!reviewForegroundMatches('', ''))
})
