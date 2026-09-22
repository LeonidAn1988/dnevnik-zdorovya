/**
 * Числа в полях ввода не должны обрезаться.
 *
 * Самая дорогая обрезка в приложении: «120» показывалось как «12», а «5,4» как
 * «5,». Человек записывал давление и сахар, не видя, что именно записал, —
 * молча, без единого признака, что строка не поместилась.
 *
 * Меряем не на глаз, а холстом: ширину отрисованного текста против ширины
 * поля. На глаз обрезанное трёхзначное число выглядит как двузначное и
 * подозрений не вызывает.
 *
 * Проверяются оба контрола и оба размера текста:
 * барабан на сенсорном экране и шагалка в браузере без сенсора.
 *
 *     npm run dev
 *     node tools/numbers.mjs
 */
import { chromium } from 'playwright'
import { FROZEN, seed, settleAny, settle, go } from './visual.mjs'

const АДРЕС = 'http://localhost:5199'

const browser = await chromium.launch()
let бед = 0
const итог = (ok, имя, деталь = '') => {
  if (!ok) бед++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${имя}${деталь ? ' — ' + деталь : ''}`)
}

for (const сенсор of [true, false]) {
  for (const размер of ['normal', 'xlarge']) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, locale: 'ru-RU', hasTouch: сенсор })
    const page = await ctx.newPage()
    await page.clock.install({ time: new Date(FROZEN) })
    try {
      await page.goto(АДРЕС, { waitUntil: 'domcontentloaded' })
    } catch {
      console.error(`Не открылся ${АДРЕС}. Поднимите сервер: npm run dev`)
      await browser.close()
      process.exit(1)
    }
    await settleAny(page)
    await seed(page, FROZEN)
    if (размер !== 'normal') {
      await page.evaluate(async (s) => {
        const db = await new Promise((r) => {
          const q = indexedDB.open('omron-bp')
          q.onsuccess = () => r(q.result)
        })
        const st = await new Promise((r) => {
          const q = db.transaction('meta').objectStore('meta').get('settings')
          q.onsuccess = () => r(q.result)
        })
        st.textScale = s
        await new Promise((r) => {
          const q = db.transaction('meta', 'readwrite').objectStore('meta').put(st, 'settings')
          q.onsuccess = () => r()
        })
        db.close()
      }, размер)
    }
    await page.reload({ waitUntil: 'domcontentloaded' })
    await settle(page)

    await go(page, { name: 'Давление', tab: 'Давление' })
    await page.waitForTimeout(250)
    // Правка строки: там шагалка живёт и на сенсорном экране.
    const карандаш = page.locator('.row-edit').first()
    if (await карандаш.count()) {
      await карандаш.click()
      await page.waitForTimeout(350)
    }

    const собрать = () => page.evaluate(() => {
      const вывод = []
      for (const el of document.querySelectorAll('.numfield__input, .wheel__value')) {
        const s = getComputedStyle(el)
        const холст = document.createElement('canvas').getContext('2d')
        холст.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`
        // Подсказка считается наравне со значением: пустое поле показывает
        // «120» именно ею, и обрезалась она так же молча.
        const текст = (el.value || el.placeholder || el.textContent || '').trim()
        if (!текст) continue
        // Запас в четыре точки: ровно впритык — это уже обрезано на соседнем
        // знаке или на другом шрифте.
        if (холст.measureText(текст).width > el.clientWidth - 4) {
          вывод.push(`${текст} в ${Math.round(el.clientWidth)}px (нужно ${Math.round(холст.measureText(текст).width)})`)
        }
      }
      return вывод
    })

    const тесно = await собрать()
    итог(тесно.length === 0, `${сенсор ? 'сенсор' : 'мышь'} · ${размер}: давление`, тесно.join(' | '))

    // Форма препарата — второй дом числовых полей, и самый узкий: там «без
    // конца» обрезалось до «без кон», а «Штук в пачке» стояло пустым.
    await go(page, { name: 'Форма', tab: 'Аптечка', click: 'Добавить препарат' })
    await page.waitForTimeout(400)
    const тесноФорма = await собрать()
    итог(тесноФорма.length === 0, `${сенсор ? 'сенсор' : 'мышь'} · ${размер}: форма препарата`, тесноФорма.join(' | '))
    await ctx.close()
  }
}

console.log(бед === 0 ? 'числа: всё помещается' : `числа: не помещается ${бед}`)
await browser.close()
process.exit(бед > 0 ? 1 : 0)
