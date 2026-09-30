/**
 * Сквозной путь «завести препарат → назначить приём».
 *
 * Самая частая работа в приложении и единственная, которая идёт через четыре
 * экрана подряд: форма коробки, её карточка, форма курса, список курсов. До
 * 0.42.0 всё это была одна форма, и проверять было нечего; теперь между
 * экранами есть переходы, и каждый из них уже ломался.
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

console.log(`путь «завести и назначить»: бед ${бед}, ошибок в консоли ${ошибки.length}`, ошибки[0] ?? '')
await browser.close()
process.exit(бед + ошибки.length > 0 ? 1 : 0)
