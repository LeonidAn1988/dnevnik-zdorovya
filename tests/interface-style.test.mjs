import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { IDBFactory } from 'fake-indexeddb'
import {
  DEFAULT_SETTINGS, displayPresetOf, displayPresetPatch, describeDisplay,
  installWebPlatform, useIndexedDbFactory, platform, loadSettings, saveSettings,
  toJson, parseJson, mergeRestoredSettings,
} from './build/api.mjs'

export async function run() {
  let failures = 0
  const check = async (name, fn) => {
    try { await fn(); console.log(`  ok   ${name}`) }
    catch (error) { failures++; console.log(`  FAIL ${name} — ${error.message}`) }
  }
  installWebPlatform()
  useIndexedDbFactory(new IDBFactory())
  const old = {
    ...DEFAULT_SETTINGS, people: [{ id: 'p-local', name: 'Я' }], activePerson: 'p-local',
    textScale: 'xlarge', density: 'roomy', theme: 'dark',
    remindersOn: true, reminderPeople: ['p-local'], startTab: 'intake',
  }
  delete old.interfaceStyle
  await check('старая установка получает привычный стиль, сохраняя все прежние настройки', async () => {
    await platform().storage.saveSettings(old)
    const loaded = await loadSettings()
    assert.deepEqual(loaded, { ...old, interfaceStyle: 'classic' })
  })
  await check('неизвестный стиль не активирует экспериментальное оформление', async () => {
    await platform().storage.saveSettings({ ...old, interfaceStyle: 'future-value' })
    assert.equal((await loadSettings()).interfaceStyle, 'classic')
  })
  await check('современный режим сохраняется после повторной загрузки дневника', async () => {
    const modern = { ...old, ...displayPresetPatch('modern') }
    await saveSettings(modern)
    assert.deepEqual(await loadSettings(), modern)
  })
  await check('переключение оформления не меняет людей, напоминания и состав разделов', () => {
    for (const key of ['comfortable', 'compact', 'modern']) {
      const changed = { ...old, ...displayPresetPatch(key) }
      const { textScale, density, interfaceStyle, ...rest } = changed
      const { textScale: oldText, density: oldDensity, ...expected } = old
      assert.deepEqual(rest, expected)
      assert.equal(displayPresetOf(changed), key)
    }
  })
  await check('возврат к комфортному и компактному режимам снимает современный стиль', () => {
    const modern = { ...old, ...displayPresetPatch('modern') }
    for (const key of ['comfortable', 'compact']) {
      const changed = { ...modern, ...displayPresetPatch(key) }
      assert.equal(changed.interfaceStyle, 'classic')
      assert.equal(displayPresetOf(changed), key)
    }
  })
  await check('крупный текст и просторные отступы не выключают современный стиль', () => {
    const custom = { ...old, ...displayPresetPatch('modern'), textScale: 'xlarge', density: 'roomy' }
    assert.equal(displayPresetOf(custom), 'modern')
    assert.equal(describeDisplay(custom), 'современный · тёмная · текст очень крупный')
  })
  await check('старые сочетания размеров распознаются без нового поля', () => {
    assert.equal(displayPresetOf({ textScale: 'large', density: 'roomy' }), 'comfortable')
    assert.equal(displayPresetOf({ textScale: 'normal', density: 'compact' }), 'compact')
    assert.equal(displayPresetOf({ textScale: 'xlarge', density: 'roomy' }), null)
  })
  await check('оформление переносится без потерь через формат резервной копии', () => {
    const settings = { ...old, ...displayPresetPatch('modern'), textScale: 'large' }
    const back = parseJson(toJson({ measurements: [], medicines: [], regimens: [], labs: [], tombstones: [], settings }))
    assert.equal(back.settings.interfaceStyle, 'modern')
    assert.equal(back.settings.textScale, 'large')
    assert.equal(back.settings.density, 'compact')
  })
  await check('восстановление новой или старой копии сохраняет локально выбранный стиль', () => {
    for (const localStyle of ['classic', 'modern']) {
      const local = { ...old, interfaceStyle: localStyle }
      for (const incoming of [old, { ...old, interfaceStyle: 'classic' }, { ...old, interfaceStyle: 'modern' }]) {
        const merged = mergeRestoredSettings(local, incoming)
        assert.equal(merged.interfaceStyle, localStyle)
        assert.equal(merged.textScale, local.textScale)
        assert.equal(merged.density, local.density)
      }
    }
  })
  await check('чужая семейная копия не меняет современный стиль', () => {
    const local = { ...old, interfaceStyle: 'modern', people: [{ id: 'p-local', name: 'Леонид' }] }
    const incoming = { ...old, interfaceStyle: 'classic', people: [{ id: 'other', name: 'Отец' }] }
    assert.deepEqual(mergeRestoredSettings(local, incoming), local)
  })
  await check('предпочтение применяется до загрузки React и IndexedDB', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    const earlyScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
    assert.ok(earlyScript)
    const document = { documentElement: { dataset: {} } }
    vm.runInNewContext(earlyScript, {
      document, localStorage: { getItem: key => ({ interfaceStyle: 'modern', textScale: 'large', density: 'roomy', theme: 'dark' })[key] },
    })
    assert.deepEqual(document.documentElement.dataset, { theme: 'dark', text: 'large', density: 'roomy', interface: 'modern' })
  })
  await check('приватный режим не ломает раннюю отрисовку', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
    const document = { documentElement: { dataset: {} } }
    vm.runInNewContext(script, { document, localStorage: { getItem() { throw new Error('Blocked storage') } } })
    assert.deepEqual(document.documentElement.dataset, {})
  })
  return failures
}
