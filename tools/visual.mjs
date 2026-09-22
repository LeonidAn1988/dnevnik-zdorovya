/**
 * Визуальная проверка: снимки всех экранов уходят в Percy.
 *
 *   npm run visual
 *
 * Зачем. Дефекты вёрстки в этом приложении находились глазами по скриншотам —
 * лента дней, распиравшая страницу вчетверо; слова, рвущиеся посреди корня;
 * карточка, вылезшая за край на 360 пикселях. Всё это машина ловит сама, если
 * есть с чем сравнивать. И главное: Percy показывает то, что съехало там, куда
 * не собирались лезть, — правишь отчёт, а разъезжается аптечка.
 *
 * Почему не BrowserStack. Automate у аккаунта на бесплатном триале, минуты
 * выбраны. Percy — отдельный продукт с отдельным счётчиком: разметка снимается
 * здесь локальным браузером, а отрисовывается в облаке Percy, хаб Selenium не
 * участвует.
 *
 * Чего этой проверкой не сделать: настоящего iOS Safari, реальной плотности
 * экрана и Web Bluetooth. Первые два — руками через BrowserStack Live, третье
 * не проверяется в облаке вообще.
 */

import { chromium } from 'playwright'
import percySnapshot from '@percy/playwright'

const URL = process.env.URL ?? 'http://localhost:5199'

/**
 * Часы стоят.
 *
 * Без этого каждый прогон давал бы расхождения на пустом месте: «составлен 15
 * августа», «хватит на 6 дней», «до 21 августа» — всё это меняется само собой,
 * и настоящая правка утонула бы в шуме. Дата выбрана фиксированной, данные
 * ниже отсчитываются от неё же.
 */
export const FROZEN = new Date('2026-08-15T10:30:00').getTime()
const DAY = 24 * 60 * 60 * 1000

/** Экраны, которые снимаем. Порядок — как в навигации, чтобы отчёт читался сверху вниз. */
export const SCREENS = [
  { name: 'Обзор', tab: 'Обзор' },
  { name: 'Давление', tab: 'Давление' },
  { name: 'Сахар', tab: 'Сахар' },
  { name: 'Приём', tab: 'Приём' },
  { name: 'Аптечка', tab: 'Аптечка' },
  { name: 'Карточка препарата', tab: 'Аптечка', open: 'Конкор' },
  { name: 'Карточка БАДа', tab: 'Аптечка', open: 'Омега-3' },
  { name: 'Форма препарата', tab: 'Аптечка', click: 'Добавить препарат' },
  { name: 'Отчёт врачу', tool: 'Отчёт' },
  // Настройки стали двухуровневыми: корень и шесть подэкранов. Снимать надо
  // каждый — регрессия вёрстки на подэкране в корне не видна.
  { name: 'Настройки', tool: 'Настройки' },
  { name: 'Настройки — экран', tool: 'Настройки', open: 'Экран' },
  { name: 'Настройки — что показывать внизу', tool: 'Настройки', open: 'Экран', expand: 'Что показывать внизу' },
  { name: 'Настройки — люди', tool: 'Настройки', open: 'Пользователи' },
  { name: 'Настройки — человек', tool: 'Настройки', open: ['Пользователи', 'Я'] },
  { name: 'Настройки — нормы', tool: 'Настройки', open: 'Нормы' },
  { name: 'Настройки — копия дневника', tool: 'Настройки', open: 'Копия дневника' },
  // Пароль копии — новое состояние экрана, и оно не видно, пока галка снята.
  { name: 'Настройки — пароль копии', tool: 'Настройки', open: 'Копия дневника', check: 'Закрыть копию паролем' },
  { name: 'Настройки — для таблиц', tool: 'Настройки', open: 'Копия дневника', expand: 'Для таблиц' },
  { name: 'Настройки — аптеки', tool: 'Настройки', open: 'Аптеки' },
  { name: 'Настройки — семья', tool: 'Настройки', open: 'Семья' },
  { name: 'Настройки — о приложении', tool: 'Настройки', open: 'О приложении' },
  // История версий свёрнута по умолчанию — иначе в снимок попадает одна строка.
  { name: 'Настройки — история версий', tool: 'Настройки', open: 'О приложении', expand: 'Прежние версии' },
  { name: 'Прибор', tool: 'Прибор' },
  { name: 'Прибор — если не подключается', tool: 'Прибор', expand: 'Если не подключается' },
]

/**
 * Экраны, на которых видно семью: имя в заголовке, полоса людей, сводная
 * аптечка, список людей и экран человека.
 */
const СЕМЕЙНЫЕ = [
  { name: 'Обзор', tab: 'Обзор' },
  { name: 'Приём', tab: 'Приём' },
  { name: 'Аптечка', tab: 'Аптечка' },
  { name: 'Аптечка — вся семья', tab: 'Аптечка', family: true },
  { name: 'Настройки', tool: 'Настройки' },
  { name: 'Настройки — люди', tool: 'Настройки', open: 'Пользователи' },
  { name: 'Настройки — человек', tool: 'Настройки', open: ['Пользователи', 'Отец'] },
  { name: 'Настройки — нормы', tool: 'Настройки', open: 'Нормы' },
]

/** Экраны, где крупный текст ломает вёрстку чаще всего. */
const КРУПНЫЕ = [
  { name: 'Обзор', tab: 'Обзор' },
  { name: 'Приём', tab: 'Приём' },
  { name: 'Аптечка', tab: 'Аптечка' },
  { name: 'Форма препарата', tab: 'Аптечка', click: 'Добавить препарат' },
  { name: 'Настройки', tool: 'Настройки' },
  { name: 'Настройки — экран', tool: 'Настройки', open: 'Экран' },
  { name: 'Настройки — копия дневника', tool: 'Настройки', open: 'Копия дневника' },
  { name: 'Отчёт врачу', tool: 'Отчёт' },
]

/**
 * Прогоны: две темы плюс режим отца и семейный.
 *
 * Отец читает «Очень крупным» текстом, и вёрстка ломается именно там — а до
 * 0.8.0 этот режим не снимался вовсе, и регрессию в нём поймать было нечем.
 */
const ПРОФИЛИ = [
  { suffix: 'светлая', theme: 'light' },
  { suffix: 'тёмная', theme: 'dark' },
  { suffix: 'очень крупный', theme: 'light', patch: { textScale: 'xlarge' }, screens: КРУПНЫЕ },
  {
    suffix: 'семья',
    theme: 'light',
    patch: {
      people: [
        { id: 'p1', name: 'Я', deviceUser: 1 },
        { id: 'p-dad', name: 'Отец', deviceUser: 2, intakeTimes: { morning: '09:00', day: '13:00', evening: '18:00', night: '21:30' } },
      ],
      activePerson: 'p1',
    },
    screens: СЕМЕЙНЫЕ,
  },
]

/** Дописать настройки поверх посева и перезагрузить: состояние читается при старте. */
async function применить(page, patch) {
  await page.evaluate(async (fields) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('omron-bp')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const было = await new Promise((resolve, reject) => {
      const request = db.transaction('meta').objectStore('meta').get('settings')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise((resolve, reject) => {
      const tx = db.transaction('meta', 'readwrite')
      tx.objectStore('meta').put({ ...(было || {}), ...fields }, 'settings')
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  }, patch)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await settle(page)
}

/**
 * Наполнение аптечки и дневников.
 *
 * Пустые экраны не показывают ничего интересного: заглушка «дневник пуст»
 * выглядит одинаково при любой поломке вёрстки. Поэтому данные подобраны так,
 * чтобы задеть все состояния разом — кончающийся запас, истекающий срок,
 * автосписание, пропущенный приём, БАД и гомеопатия.
 */
export async function seed(page, frozen) {
  await page.evaluate(async (now) => {
    const DAY = 86_400_000
    const midnight = (ts) => {
      const d = new Date(ts)
      d.setHours(0, 0, 0, 0)
      return d.getTime()
    }
    const day0 = midnight(now)
    const at = (offset, hour) => day0 + offset * DAY + hour * 3_600_000

    const marks = []
    for (let i = -20; i <= 0; i++) {
      if (i !== -5) marks.push(at(i, 8))
      if (i < 0 && i !== -12) marks.push(at(i, 20))
    }

    const medicines = [
      {
        id: 'm1', name: 'Конкор', dose: '5 мг', inn: 'Бисопролол',
        form: 'Таблетки, покрытые пленочной оболочкой', maker: 'Мерк КГаА',
        packSize: 30, left: 12, perDay: null, expires: Date.UTC(2027, 4, 31),
        times: ['08:00', '20:00'], perTime: 1, meal: 'after', taken: marks, leftAt: now - 3 * DAY,
        // Свёрнутая история и день начала приёма — литералом, а не расчётом от
        // засеянных отметок: снимок должен быть побайтово одинаковым от прогона
        // к прогону, а свёртка зависит от текущего дня.
        startedAt: Date.UTC(2025, 6, 1),
        foldedUntil: now - 59 * DAY,
        history: { '2026-05': { planned: 44, taken: 39 }, '2026-06': { planned: 60, taken: 51 } },
      },
      {
        id: 'm2', name: 'Омега-3 Ультра', dose: '', kind: 1,
        inn: 'ПНЖК омега-3, витамина Е', form: 'капсулы', maker: 'ООО «Эвалар»',
        packSize: 60, left: 40, perDay: null, expires: Date.UTC(2027, 0, 31),
        times: ['09:00'], perTime: 1, taken: [at(-3, 9), at(-2, 9), at(0, 9)], leftAt: now - DAY,
      },
      {
        id: 'm3', name: 'Оциллококцинум', dose: '', kind: 2, inn: '',
        form: 'Гранулы гомеопатические', maker: 'Лаборатория Буарон',
        packSize: 6, left: 4, perDay: null, expires: Date.UTC(2026, 8, 30),
      },
      {
        id: 'm4', name: 'Лозартан', dose: '50 мг', inn: 'Лозартан', form: 'Таблетки',
        maker: 'Озон', packSize: 30, left: 25, perDay: null, expires: Date.UTC(2027, 7, 31),
        times: ['21:00'], perTime: 1, taken: [],
      },
      {
        id: 'm5', name: 'Метформин', dose: '850 мг', inn: 'Метформин', form: 'Таблетки',
        maker: 'Гедеон Рихтер', packSize: 60, left: 30, perDay: 2,
        expires: Date.UTC(2027, 10, 30), times: ['08:00', '19:00'], perTime: 1,
        autoDeduct: true, taken: [], leftAt: now - 5 * DAY,
      },
    ]

    const readings = []
    for (let i = -29; i <= 0; i++) {
      readings.push({
        id: `bp-${i}`, kind: 'bp', ts: at(i, 8) + 600_000, user: 1, source: 'manual',
        sys: 128 + ((i % 7) + 7) % 7, dia: 82 + ((i % 4) + 4) % 4,
        bpm: 68 + ((i % 5) + 5) % 5, ihb: i % 11 === 0, mov: false,
      })
      if (i % 2 === 0) {
        readings.push({
          id: `gl-${i}`, kind: 'glucose', ts: at(i, 7) + 300_000, user: 1, source: 'manual',
          mmol: 5.4 + (((i % 6) + 6) % 6) * 0.4,
          context: i % 4 === 0 ? 'fasting' : 'after-meal',
        })
      }
    }

    /*
     * Коробка отдельно от курса приёма — как в базе с версии 5.
     *
     * Фикстуры выше остались плоскими: так они читаются, и менять их полсотни
     * строк ради формы хранения незачем. Разбирает их то же правило, что и
     * обновление базы: поля приёма уезжают в курс, вещественное остаётся у
     * коробки. Идентификатор курса выводится из коробки, поэтому посев
     * повторяется от прогона к прогону побайтово.
     */
    const ПОЛЯ_КУРСА = ['times', 'perTime', 'meal', 'rhythm', 'plan', 'planFrom', 'perDay',
      'autoDeduct', 'since', 'startedAt', 'taken', 'history', 'foldedUntil']
    const boxes = []
    const regimens = []
    for (const m of medicines) {
      const box = { ...m }
      const курс = { id: `r-${m.id}`, medicineId: m.id, person: m.owner ?? 'p1' }
      for (const поле of ПОЛЯ_КУРСА) {
        if (m[поле] !== undefined) курс[поле] = m[поле]
        delete box[поле]
      }
      delete box.owner
      boxes.push(box)
      regimens.push(курс)
    }

    const db = await new Promise((resolve, reject) => {
      // Без номера версии: открывается та, что уже создало приложение. С
      // жёстко указанной цифрой посев ломался при каждой миграции схемы —
      // прогон падал с VersionError ещё до первого снимка.
      const request = indexedDB.open('omron-bp')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['medicines', 'regimens', 'readings', 'meta'], 'readwrite')
      boxes.forEach((m) => tx.objectStore('medicines').put(m))
      regimens.forEach((r) => tx.objectStore('regimens').put(r))
      readings.forEach((r) => tx.objectStore('readings').put(r))
      // Дневник сахара включаем явно: иначе раздел прячется и снимок пустой.
      // `onboarded` — тоже явно: без него приложение на пустом дневнике
      // показывает экран знакомства, а не себя. Человека тоже заводим сами: с
      // 0.7.2 приложение даёт первому уникальный идентификатор от часов, и
      // посев без этой строки перестал бы повторяться от прогона к прогону.
      tx.objectStore('meta').put(
        { trackGlucose: true, onboarded: true, people: [{ id: 'p1', name: 'Я', deviceUser: 1 }], activePerson: 'p1' },
        'settings',
      )
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  }, frozen)
}

/** Ждём, пока React отрисует: без этого снимок ловит «Загрузка…». */
export const settle = async (page) => {
  await page.waitForSelector('nav.tabs', { timeout: 15_000 })
  await page.waitForTimeout(400)
}

/**
 * То же самое, но до засева.
 *
 * На пустом дневнике приложение показывает экран знакомства, а у него нет
 * вкладок — и ожидание `nav.tabs` валило весь прогон на первом же шаге, ещё до
 * единого снимка. Здесь достаточно дождаться, что React вообще отрисовал: база
 * к этому моменту уже создана, а засевать можно с любого экрана.
 */
export const settleAny = async (page) => {
  await page.waitForSelector('.app', { timeout: 15_000 })
  await page.waitForTimeout(400)
}

export async function go(page, screen) {
  if (screen.tab) {
    await page.locator('nav.tabs button', { hasText: screen.tab }).first().click()
  } else if (screen.tool) {
    await page.locator('header button', { hasText: screen.tool }).first().click()
  }
  await page.waitForTimeout(250)

  // Список: два клика подряд — так открывается экран человека внутри «Людей».
  for (const шаг of screen.open ? (Array.isArray(screen.open) ? screen.open : [screen.open]) : []) {
    await page.locator('.pill__open', { hasText: шаг }).first().click()
    await page.waitForTimeout(250)
  }
  if (screen.family) {
    await page.locator('[aria-label="Чья аптечка"] button', { hasText: 'Вся семья' }).click()
    await page.waitForTimeout(250)
  }
  if (screen.click) {
    await page.locator('button', { hasText: screen.click }).first().click()
    await page.waitForTimeout(250)
  }
  // Галка, а не кнопка: раскрывашки в настройках открываются переключателем, и
  // без этого их содержимое в снимок не попадает вовсе.
  if (screen.expand) {
    await page.locator('details', { hasText: screen.expand }).first().evaluate((el) => {
      el.open = true
    })
    await page.waitForTimeout(300)
  }
  if (screen.check) {
    await page.locator('label', { hasText: screen.check }).locator('input[type=checkbox]').first().check()
    await page.waitForTimeout(300)
  }
  // Прокрутка вверх: страницу мог утащить предыдущий экран, и снимок начался бы
  // с середины. Percy снимает документ целиком, но позиция влияет на «липкие»
  // элементы шапки.
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(150)
}

async function main() {
  const browser = await chromium.launch()
  let count = 0

  for (const профиль of ПРОФИЛИ) {
    const theme = профиль.theme
    const context = await browser.newContext({
      viewport: { width: 390, height: 900 },
      locale: 'ru-RU',
      timezoneId: 'Europe/Moscow',
      colorScheme: theme,
    })
    const page = await context.newPage()

    // Часы замораживаем до первого скрипта страницы: приложение читает время
    // сразу при запуске, и подмена после загрузки уже опоздала бы.
    await page.clock.install({ time: new Date(FROZEN) })

    await page.goto(URL, { waitUntil: 'domcontentloaded' })
    await settleAny(page)
    await seed(page, FROZEN)

    // Перезагрузка, а не обновление состояния: данные читаются один раз при
    // старте, дописывать их в живое приложение нечем.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await settle(page)

    // Тема ставится настройкой приложения, а не системной: снимок должен
    // показывать ровно то, что выбрал человек.
    // Сначала настройки профиля, потом тема: `применить` перезагружает
    // страницу, и атрибут темы, поставленный до неё, потерялся бы.
    if (профиль.patch) await применить(page, профиль.patch)
    await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme)
    await page.waitForTimeout(200)

    for (const screen of профиль.screens ?? SCREENS) {
      try {
        await go(page, screen)
        await percySnapshot(page, `${screen.name} — ${профиль.suffix}`)
        count += 1
        console.log(`  снят: ${screen.name} (${профиль.suffix})`)
      } catch (error) {
        // Один непойманный экран не должен ронять весь прогон: остальные
        // снимки полезны и сами по себе.
        console.error(`  ПРОПУЩЕН ${screen.name} (${профиль.suffix}): ${error.message.split('\n')[0]}`)
      }
    }

    await context.close()
  }

  await browser.close()
  const всего = ПРОФИЛИ.reduce((sum, п) => sum + (п.screens ?? SCREENS).length, 0)
  console.log(`\nснимков отправлено: ${count} из ${всего}`)
  if (count === 0) process.exitCode = 1
}

// Запускаем только при прямом вызове: проверка детерминизма импортирует
// отсюда посев и список экранов, и снимать при этом ничего не нужно.
if (process.argv[1]?.endsWith('visual.mjs')) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
