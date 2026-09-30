/**
 * Сквозные пути: несколько экранов подряд с нажатием «Сохранить».
 *
 * Два пути, и оба такие, что обход экранов до них не достаёт — он смотрит
 * вёрстку, а не переходы, и ни одной кнопки записи не жмёт.
 *
 * **Первый — «завести препарат → назначить приём».** Самая частая работа в
 * приложении: форма коробки, её карточка, форма курса, список курсов. До
 * 0.42.0 всё это была одна форма, и проверять было нечего; теперь между
 * экранами есть переходы, и каждый из них уже ломался.
 *
 * **Второй — «этот телефон чей?».** Ответ на него необратим: записи
 * перецепляются на выбранного человека, и карта перецепки односторонняя.
 * Проверяется оба ответа — и «это я», и «я здесь новый», — потому что после
 * первого дневник уже не разобрать обратно, а после второго вопрос обязан
 * замолчать навсегда.
 *
 * Что здесь ловится и не ловится больше нигде:
 *
 * - **карточка заменяет форму, а не ложится поверх.** Аптечка показывает форму
 *   раньше карточки, и оставшийся в стеке узел формы означает, что после
 *   «Сохранить» человек продолжает видеть форму;
 * - **препарат подставлен в новый курс.** С карточки курс заводят на неё, и
 *   спрашивать «что принимать» второй раз незачем;
 * - **сохранённый курс виден в списке.** Запись прошла до базы и вернулась
 *   обратно на экран.
 *
 * Обход экранов (`screens.mjs`) сюда не достаёт: он смотрит вёрстку, а не
 * переходы, и ни одного «Сохранить» не нажимает.
 *
 * Сервер должен быть поднят на 5199 (`npm run dev`).
 */
import { chromium } from 'playwright'
import { FROZEN, seed, settleAny, settle, go } from './visual.mjs'

const АДРЕС = 'http://localhost:5199'
/** Название, которого заведомо нет в посеве: иначе не отличить новое от старого. */
const НОВЫЙ = 'Верошпирон'

const browser = await chromium.launch()
const page = await (
  await browser.newContext({ viewport: { width: 360, height: 780 }, locale: 'ru-RU', hasTouch: true })
).newPage()
page.setDefaultTimeout(8_000)
const ошибки = []
page.on('pageerror', (e) => ошибки.push(String(e)))

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
await page.reload({ waitUntil: 'domcontentloaded' })
await settle(page)

let бед = 0
const проверить = (что, ожидали, вышло) => {
  const ок = ожидали === вышло
  if (!ок) бед++
  console.log(`  ${ок ? 'ok  ' : '⚠   '} ${что}${ок ? '' : ` — ждали «${ожидали}», вышло «${вышло}»`}`)
}

const путь = () => page.locator('.app').getAttribute('data-nav')
const сохранить = async () => {
  await page.locator('button', { hasText: 'Сохранить' }).first().click()
  await page.waitForTimeout(700)
}

/*
 * Шаг, который не роняет прогон.
 *
 * Сорвавшийся клик — это не сбой проверки, а её результат: кнопки нет там, где
 * она должна быть. Стек вызовов Playwright об этом говорит хуже, чем одна
 * строка, и прячет остальные проверки, до которых прогон уже не дойдёт.
 */
const шаг = async (что, действие) => {
  try {
    await действие()
    return true
  } catch (беда) {
    бед++
    console.log(`  ⚠    ${что} — не вышло: ${String(беда).split('\n')[0]}`)
    return false
  }
}

// 1. Завести коробку. Хватит одного названия: остальное необязательно.
await go(page, { name: 'новая коробка', tab: 'Аптечка', section: 'Коробки', add: true })
await page.locator('input').first().fill(НОВЫЙ)
await сохранить()
проверить('после «Сохранить» открылась карточка, а форма ушла', 'cabinet/card', await путь())

// 2. Подсказка на карточке — единственное, что говорит «дело сделано наполовину».
const подсказка = await page.locator('button', { hasText: 'Завести курс приёма' }).count()
проверить('на карточке без курса зовут завести курс', 1, подсказка)

// 3. С карточки — в курс, с уже выбранным препаратом.
const дошли = await шаг('перешли на экран курса', async () => {
  await page.locator('button', { hasText: 'Завести курс приёма' }).first().click()
  await page.waitForTimeout(400)
})
if (дошли) {
  проверить('открылся экран курса', 'cabinet/card/regimen', await путь())
  проверить('препарат подставлен', НОВЫЙ, (await page.locator('.pickfield').first().textContent())?.trim())

  // 4. Назначить утренний приём и сохранить.
  await шаг('назначили утренний приём и сохранили', async () => {
    await page.locator('.chip', { hasText: 'Утром' }).first().click()
    await page.waitForTimeout(200)
    await сохранить()
  })
  проверить('после сохранения курса вернулись на карточку', 'cabinet/card', await путь())

  // 5. Курс виден в списке курсов.
  await go(page, { name: 'курсы', tab: 'Аптечка', section: 'Курсы' })
  await page.waitForTimeout(300)
  const названия = await page.locator('.pill__name').allTextContents()
  проверить('новый курс в списке', true, названия.map((т) => т.trim()).includes(НОВЫЙ))

  // 6. И на «Приёме»: расписание доехало до того экрана, ради которого всё это.
  await go(page, { name: 'приём', tab: 'Приём' })
  await page.waitForTimeout(400)
  проверить('препарат появился в сегодняшнем приёме', true, (await page.content()).includes(НОВЫЙ))
}

// ── путь второй: «этот телефон чей?» ──────────────────────────────────────
console.log('')

/** Подложить семью, какой её привёз бы обмен, и снять пометку об ответе. */
const семья = async () => {
  await page.evaluate(async () => {
    const db = await new Promise((r) => {
      const q = indexedDB.open('omron-bp')
      q.onsuccess = () => r(q.result)
    })
    const st = await new Promise((r) => {
      const g = db.transaction('meta').objectStore('meta').get('settings')
      g.onsuccess = () => r(g.result)
    })
    st.people = [
      { id: 'p1', name: 'Я', deviceUser: 1 },
      { id: 'p-lel', name: 'Лёлечка', deviceUser: 2 },
    ]
    st.activePerson = 'p1'
    await new Promise((r) => {
      const put = db.transaction('meta', 'readwrite').objectStore('meta').put(st, 'settings')
      put.onsuccess = () => r()
    })
    db.close()
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await settle(page)
  await page.waitForTimeout(400)
}

/** Состав дневника глазами приложения: имена людей и пометка об ответе. */
const состав = () =>
  page.evaluate(async () => {
    const db = await new Promise((r) => {
      const q = indexedDB.open('omron-bp')
      q.onsuccess = () => r(q.result)
    })
    const st = await new Promise((r) => {
      const g = db.transaction('meta').objectStore('meta').get('settings')
      g.onsuccess = () => r(g.result)
    })
    db.close()
    return {
      имена: (st.people ?? []).map((p) => p.name).join(','),
      активный: (st.people ?? []).find((p) => p.id === st.activePerson)?.name ?? null,
    }
  })

// Ответ «это я»: местный «Я» уходит, записи достаются Лёлечке.
await семья()
проверить('вопрос поднялся сам', 1, await page.locator('dialog[open]').count())
await шаг('выбрали Лёлечку и подтвердили', async () => {
  await page.locator('dialog[open] .sheet__row', { hasText: 'Лёлечка' }).first().click()
  await page.waitForTimeout(300)
  await page.locator('dialog[open] button', { hasText: 'Да, это я' }).first().click()
  await page.waitForTimeout(1200)
})
{
  const после = await состав()
  проверить('местный «Я» ушёл из списка', 'Лёлечка', после.имена)
  проверить('выбран выживший', 'Лёлечка', после.активный)
  проверить('лист закрылся', 0, await page.locator('dialog[open]').count())
}
// Главное про ответ: вопрос не возвращается после перезапуска. Отдельной
// пометки «отвечали» нет — гасит его само состояние, и проверять надо его.
await page.reload({ waitUntil: 'domcontentloaded' })
await settle(page)
await page.waitForTimeout(500)
проверить('после перезапуска вопрос не вернулся', 0, await page.locator('dialog[open]').count())

// Ответ «я здесь новый»: местный человек получает имя, вопрос замолкает.
await семья()
await шаг('назвались новым человеком', async () => {
  await page.locator('dialog[open] .sheet__row', { hasText: 'Я здесь новый' }).first().click()
  await page.waitForTimeout(300)
  await page.locator('dialog[open] input').first().fill('Отец')
  await page.waitForTimeout(200)
  await page.locator('dialog[open] button', { hasText: 'Готово' }).first().click()
  await page.waitForTimeout(600)
})
{
  const после = await состав()
  проверить('имя записано вместо «Я»', 'Отец,Лёлечка', после.имена)
}
await page.reload({ waitUntil: 'domcontentloaded' })
await settle(page)
await page.waitForTimeout(500)
проверить('назвавшись, вопрос тоже не видим после перезапуска', 0, await page.locator('dialog[open]').count())

// Занятое имя не даёт закончить: двоих «Лёлечек» в дневнике быть не должно.
await семья()
await шаг('открыли ввод имени', async () => {
  await page.locator('dialog[open] .sheet__row', { hasText: 'Я здесь новый' }).first().click()
  await page.waitForTimeout(300)
  await page.locator('dialog[open] input').first().fill('Лёлечка')
  await page.waitForTimeout(300)
})
проверить('«Готово» с занятым именем не нажать', true, await page.locator('dialog[open] button', { hasText: 'Готово' }).first().isDisabled())

console.log('')
console.log(`сквозные пути: бед ${бед}, ошибок в консоли ${ошибки.length}`, ошибки[0] ?? '')
await browser.close()
process.exit(бед + ошибки.length > 0 ? 1 : 0)
