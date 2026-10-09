/**
 * Аптечка как инвентарь: поиск и категории.
 *
 * Названия взяты из настоящей аптечки владельца — там «Конкор® Кор», «Форлакс®»
 * и «Витамин D3 500» лежат рядом, и именно на таких строках поиск и ломается:
 * знак ® склеивает слова, а цифра в названии спорит с дозировкой.
 */
import {
  searchStock,
  stockForPerson,
  dosing,
  restockList,
  medicineAlert,
  enoughForCourse,
  supplyDays,
  projectedLeft,
  regimenFinished,
  regimenEndDay,
  dosesOn,
  dosesToday,
  pendingToday,
  buildReminders,
  medicinesForReminder,
  buildCalendar,
  countCalendarEvents,
  buildMemo,
  dueOf,
  mergeRegimen,
  toJson,
  parseJson,
  snoozeIsRelevant,
  matchNote,
  purposesOf,
  byPurpose,
  suggestPurpose,
  PURPOSE_HINTS,
  MIN_QUERY,
} from './build/api.mjs'

const коробка = (f) => ({
  box: { id: f.id, name: f.name, dose: f.dose ?? '', left: null, expires: null, ...f },
  intakes: [],
})

export function run() {
  let failures = 0
  const check = (name, condition, detail = '') => {
    if (condition) console.log(`  ok   ${name}`)
    else {
      console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`)
      failures++
    }
  }

  const аптечка = [
    коробка({ id: 'k1', name: 'Конкор® Кор', dose: '2,5 мг', inn: 'Бисопролол', maker: 'Мерк' }),
    коробка({ id: 'k2', name: 'Экватор', dose: '10 мг', inn: 'Амлодипин + Лизиноприл', maker: 'Гедеон Рихтер' }),
    коробка({ id: 'k3', name: 'Амлодипин', dose: '5 мг', inn: 'Амлодипин', maker: 'Озон' }),
    коробка({ id: 'k4', name: 'Форлакс®', dose: '4 г', inn: 'Макрогол', purpose: 'Желудок' }),
    коробка({ id: 'k5', name: 'Тамифлю®', dose: '75 мг', inn: 'Осельтамивир', note: 'при контакте с больным' }),
    коробка({ id: 'k6', name: 'Витамин D3 500', dose: '500 МЕ', inn: 'Колекальциферол' }),
    коробка({ id: 'k7', name: 'Бинт стерильный', purpose: 'Перевязка' }),
  ]
  const ищем = (q) => searchStock(аптечка, q).map((h) => h.item.box.id)
  const поля = (q) => searchStock(аптечка, q).map((h) => `${h.item.box.id}:${h.field}`)

  // ── по названию ──────────────────────────────────────────────────────────
  check('одной буквы достаточно', MIN_QUERY === 1 && ищем('к').length > 0)
  check('пустой запрос ничего не ищет', searchStock(аптечка, '').length === 0)
  check('пробелы — тоже пустой запрос', searchStock(аптечка, '   ').length === 0)
  check('название находится с начала', ищем('конкор').join() === 'k1', ищем('конкор').join())
  check('знак ® не мешает', ищем('конкор кор').join() === 'k1', ищем('конкор кор').join())
  check('регистр не важен', ищем('КОНКОР').join() === 'k1')
  check('ё приводится к е', searchStock([коробка({ id: 'ё', name: 'Тёплый' })], 'теплый').length === 1)

  // Начало названия важнее включения: набрав «амлодипин», человек ищет
  // «Амлодипин», а не «Экватор», где то же вещество внутри комбинации.
  const амло = ищем('амлодипин')
  check('точное название идёт первым', амло[0] === 'k3', амло.join())
  check('и комбинация тоже находится — по веществу', амло.includes('k2'), амло.join())

  // ── по действующему веществу ─────────────────────────────────────────────
  // Ровно тот случай, ради которого сверка веществ и делалась, только наоборот:
  // ищем вещество, а лежит оно внутри комбинации под чужим торговым именем.
  check('вещество из комбинации находит коробку', ищем('лизиноприл').join() === 'k2', ищем('лизиноприл').join())
  check('и совпадение объяснено', поля('лизиноприл').join() === 'k2:inn', поля('лизиноприл').join())
  check('бисопролол находит Конкор', ищем('бисопролол').join() === 'k1')

  // ── прочие поля ──────────────────────────────────────────────────────────
  check('дозировка ищется', ищем('75').join() === 'k5', ищем('75').join())
  check('производитель ищется', ищем('озон').join() === 'k3')
  check('примечание ищется', ищем('контакте').join() === 'k5')
  check('категория ищется', ищем('перевязка').join() === 'k7')
  check('чего нет — не находится', ищем('парацетамол').length === 0)

  // Порядок корзин: название вперёд примечания. Набрав «там», человек ищет
  // «Тамифлю», а не коробку с примечанием про то же.
  const смесь = [
    коробка({ id: 'имя', name: 'Тамифлю' }),
    коробка({ id: 'прим', name: 'Другое', note: 'там же лежит' }),
  ]
  check(
    'название важнее примечания',
    searchStock(смесь, 'там').map((h) => h.item.box.id).join() === 'имя,прим',
    searchStock(смесь, 'там').map((h) => h.item.box.id).join(),
  )

  // Одна коробка — один результат, даже если совпало сразу в двух полях.
  const дважды = [коробка({ id: 'два', name: 'Амлодипин', inn: 'Амлодипин' })]
  check('коробка не задваивается', searchStock(дважды, 'амлодипин').length === 1)

  // ── подписи совпадения ───────────────────────────────────────────────────
  const подпись = (q) => matchNote(searchStock(аптечка, q)[0])
  check('совпадение по названию не объясняют', подпись('конкор') === null)
  check('совпадение по веществу объясняют', подпись('лизиноприл') === 'по веществу: Амлодипин + Лизиноприл')
  check('и по примечанию тоже', подпись('контакте') === 'по примечанию: при контакте с больным')

  // ── категории ────────────────────────────────────────────────────────────
  check('в фильтр попадает только то, что есть', purposesOf(аптечка).join() === 'Желудок,Перевязка', purposesOf(аптечка).join())
  check('пустая аптечка — пустой фильтр', purposesOf([]).length === 0)
  const разнобой = [
    коробка({ id: 'a', name: 'A', purpose: 'Давление' }),
    коробка({ id: 'b', name: 'B', purpose: 'давление' }),
    коробка({ id: 'c', name: 'C', purpose: '  Давление  ' }),
  ]
  check('одинаковые по сути схлопываются', purposesOf(разнобой).join() === 'Давление', purposesOf(разнобой).join())
  check('и фильтр находит все три', byPurpose(разнобой, 'давление').length === 3)
  check('чужая категория не находит ничего', byPurpose(разнобой, 'Желудок').length === 0)

  // ── подсказка категории ──────────────────────────────────────────────────
  check('амлодипин — давление', suggestPurpose({ name: 'Амлодипин', inn: 'Амлодипин' }) === 'Давление')
  // В реестре вещество пишут полным именем соли: «периндоприла эрбумин».
  check('соль вещества узнаётся', suggestPurpose({ name: 'Престариум', inn: 'Периндоприла эрбумин' }) === 'Давление')
  check('комбинация берёт первое известное', suggestPurpose({ name: 'Экватор', inn: 'Амлодипин + Лизиноприл' }) === 'Давление')
  check('метформин — сахар', suggestPurpose({ name: 'Метформин', inn: 'Метформин' }) === 'Сахар')
  check('колекальциферол — витамины', suggestPurpose({ name: 'Вигантол', inn: 'Колекальциферол' }) === 'Витамины')
  check('бинт узнаётся по названию', suggestPurpose({ name: 'Бинт марлевый стерильный' }) === 'Перевязка')
  check('перекись тоже', suggestPurpose({ name: 'Перекись водорода' }) === 'Перевязка')
  check('и йод — целым словом', suggestPurpose({ name: 'Йод раствор спиртовой' }) === 'Перевязка')
  check('хондроитин — суставы', suggestPurpose({ name: 'Хондрогард', inn: 'Хондроитина сульфат' }) === 'Суставы')
  // Состав добавки пишут родительным падежом: «витаминов группы В». Ни одно
  // имя из таблицы веществ туда не попадает, а слово «витамин» — попадает.
  check('состав добавки узнаётся по слову', suggestPurpose({ name: 'Мемори райс', inn: 'витаминов группы В, флавоноидов' }) === 'Витамины')
  check('и «Витамин D3» без вещества тоже', suggestPurpose({ name: 'Витамин D3' }) === 'Витамины')
  // Дженерик назван веществом, а поле вещества пустое — так заведена половина
  // коробок в настоящей аптечке.
  check('название как вещество, когда вещества нет', suggestPurpose({ name: 'Аторвастатин' }) === 'Сердце')
  check('реестр важнее названия', suggestPurpose({ name: 'Аторвастатин', inn: 'Метформин' }) === 'Сахар')
  // «Йодомарин» — калия йодид, добавка для щитовидной железы. Начинается на
  // «йод» и без границы слова попадал бы в перевязочное.
  check('а Йодомарин — не перевязка', suggestPurpose({ name: 'Йодомарин 200' }) === null,
    String(suggestPurpose({ name: 'Йодомарин 200' })))
  // Вещество солью — то, что подставляется из реестра само.
  check('тиамина хлорид — витамины', suggestPurpose({ name: 'Тиамин', inn: 'Тиамина хлорид' }) === 'Витамины')
  check('амлодипина безилат — давление', suggestPurpose({ name: 'Норваск', inn: 'Амлодипина безилат' }) === 'Давление')
  // Аскорбиновая кислота стоит добавкой в половине простудных порошков, и по
  // ней «Аспирин-С» оказывался витаминами. Найдено сверкой по всему реестру.
  check(
    'витамин в комбинации не перевешивает',
    suggestPurpose({ name: 'Аспирин®-С', inn: 'Ацетилсалициловая кислота+[Аскорбиновая кислота]' }) === 'Сердце',
    String(suggestPurpose({ name: 'Аспирин®-С', inn: 'Ацетилсалициловая кислота+[Аскорбиновая кислота]' })),
  )
  check('а сам по себе витамин — витамины', suggestPurpose({ name: 'Аскорбинка', inn: 'Аскорбиновая кислота' }) === 'Витамины')
  check('лактитол — желудок', suggestPurpose({ name: 'Экспортал', inn: 'Лактитол' }) === 'Желудок')
  // Главное про подсказку: она молчит, когда не знает. Пустое поле честнее
  // выдуманной полки, и это не дефект, а правило.
  check('незнакомое — молчим', suggestPurpose({ name: 'Оциллококцинум', inn: '' }) === null)
  check('без вещества и без правила — молчим', suggestPurpose({ name: 'Что-то' }) === null)
  check('все подсказки различны', new Set(PURPOSE_HINTS).size === PURPOSE_HINTS.length)
  // Каждая подсказка должна быть достижима: список, половина которого никогда
  // не предлагается, вводит в заблуждение о том, что приложение умеет.
  const достижимые = new Set(
    [
      'Амлодипин', 'Аторвастатин', 'Метформин', 'Омепразол', 'Осельтамивир',
      'Парацетамол', 'Цетиризин', 'Колекальциферол',
    ].map((в) => suggestPurpose({ name: в, inn: в })),
  )
  достижимые.add(suggestPurpose({ name: 'Бинт' }))
  достижимые.add(suggestPurpose({ name: 'Хондрогард', inn: 'Хондроитина сульфат' }))
  check(
    'каждая подсказка выводима таблицей',
    PURPOSE_HINTS.every((h) => достижимые.has(h)),
    PURPOSE_HINTS.filter((h) => !достижимые.has(h)).join(),
  )

  const now = new Date(2026, 9, 3, 12).getTime()
  const yesterday = new Date(2026, 9, 2).getTime()
  const course = (box, fields = {}) => dosing(box, {
    id: `r-${box.id}`, medicineId: box.id, person: 'p1', times: ['08:00'], perTime: 1, ...fields,
  })
  const expired = коробка({ id: 'ended', name: 'Завершённый', left: 2, expires: yesterday })
  expired.intakes = [course(expired.box, { endsAt: yesterday })]
  check('завершённый курс с просроченной пачкой не требует покупки', restockList([expired], now).length === 0)
  check('просрочка остаётся видна в запасах', medicineAlert(expired.box, expired.intakes, now)?.kind === 'expired')
  const empty = { ...expired, box: { ...expired.box, left: 0, expires: null } }
  check('завершённый курс без остатка не требует покупки', restockList([empty], now).length === 0)
  const expiring = { ...expired, box: { ...expired.box, expires: new Date(2026, 9, 10).getTime() } }
  check('завершённый курс с истекающим сроком не требует покупки', restockList([expiring], now).length === 0)
  const staged = { ...expired, intakes: [course(expired.box, { planFrom: yesterday, plan: [{ perTime: 1, days: 1 }] })] }
  check('окончание срочной схемы также убирает покупку', restockList([staged], now).length === 0)
  const lastDay = { ...expired, intakes: [course(expired.box, { endsAt: now })] }
  check('последний день курса ещё требует непросроченной упаковки', restockList([lastDay], now).length === 1)
  const exactStop = new Date(2026, 9, 3, 11).getTime()
  const stopBox = { box: { id: 'stopped-today', name: 'Остановлен сегодня', dose: '', left: 0, expires: null, leftAt: exactStop - 1 }, intakes: [] }
  stopBox.intakes = [course(stopBox.box, { stoppedAt: exactStop })]
  const midnight = new Date(2026, 9, 3).getTime()
  const noon = new Date(2026, 9, 3, 12).getTime()
  check('перед временем остановки бейдж и список покупок видят дефицит', stockForPerson([stopBox], 'p1', midnight, true).length === 1 && restockList([stopBox], midnight).length === 1)
  check('после времени остановки бейдж и список покупок снимают завершённый курс', stockForPerson([stopBox], 'p1', noon, true).length === 0 && restockList([stopBox], noon).length === 0)
  const годныйДоКурса = коробка({ id: 'expiry-after-course', name: 'Хватит до конца', left: 6, leftAt: now, expires: new Date(2026, 9, 10).getTime(), expiryWarningDays: 14 })
  годныйДоКурса.intakes = [course(годныйДоКурса.box, { times: [], perDay: 1, endsAt: new Date(2026, 9, 8).getTime() })]
  check('ровно шести таблеток хватает на шесть дней курса', enoughForCourse(годныйДоКурса.box, годныйДоКурса.intakes, now))
  check('истекающую упаковку не просят купить после завершения курса', medicineAlert(годныйДоКурса.box, годныйДоКурса.intakes, now)?.kind === 'expiring' && restockList([годныйДоКурса], now).length === 0)
  const нехватаетДоКурса = { ...годныйДоКурса, box: { ...годныйДоКурса.box, id: 'expiry-short', name: 'Не хватит', left: 5 }, intakes: [] }
  нехватаетДоКурса.intakes = [course(нехватаетДоКурса.box, { times: [], perDay: 1, endsAt: new Date(2026, 9, 8).getTime() })]
  check('если запаса не хватает на курс, покупка остаётся', !enoughForCourse(нехватаетДоКурса.box, нехватаетДоКурса.intakes, now) && restockList([нехватаетДоКурса], now).length === 1)
  const границаГодности = коробка({ id: 'expiry-on-course', name: 'Курс до срока', left: 8, leftAt: now, expires: new Date(2026, 9, 10).getTime(), expiryWarningDays: 14 })
  границаГодности.intakes = [course(границаГодности.box, { times: [], perDay: 1, endsAt: new Date(2026, 9, 10).getTime() })]
  check('последний день курса совпадает с последним годным днём — покупка не нужна', enoughForCourse(границаГодности.box, границаГодности.intakes, now) && medicineAlert(границаГодности.box, границаГодности.intakes, now)?.kind === 'expiring' && restockList([границаГодности], now).length === 0)
  const дозаВПоследнийДень = коробка({ id: 'last-valid-dose', name: 'Таблетка в срок', left: 8, leftAt: now, expires: new Date(2026, 9, 10).getTime(), expiryWarningDays: 14 })
  дозаВПоследнийДень.intakes = [course(дозаВПоследнийДень.box, { times: ['20:00'], endsAt: new Date(2026, 9, 10).getTime() })]
  check('последняя доза в последний годный день не создаёт покупку', enoughForCourse(дозаВПоследнийДень.box, дозаВПоследнийДень.intakes, now) && restockList([дозаВПоследнийДень], now).length === 0)
  const дозаПослеСрока = коробка({ id: 'dose-after-expiry', name: 'Таблетка после срока', left: 9, leftAt: now, expires: new Date(2026, 9, 10).getTime(), expiryWarningDays: 14 })
  дозаПослеСрока.intakes = [course(дозаПослеСрока.box, { times: ['20:00'], endsAt: new Date(2026, 9, 11).getTime() })]
  check('если курс требует дозу на следующий день, предупреждение сохраняется', enoughForCourse(дозаПослеСрока.box, дозаПослеСрока.intakes, now) && restockList([дозаПослеСрока], now).some(item => item.reason === 'expiring'))
  const пятница = new Date(2026, 9, 9).getTime()
  const пятницаПолдень = new Date(2026, 9, 9, 12).getTime()
  const воскресеньеСрок = new Date(2026, 9, 11).getTime()
  const вторникКонец = new Date(2026, 9, 13).getTime()
  const недельнаяКоробка = (id, name, left) => коробка({ id, name, left, leftAt: пятница, expires: воскресеньеСрок, expiryWarningDays: 14 })
  const недельныйБезДоз = недельнаяКоробка('weekly-no-post-expiry', 'Только пятницы', 1)
  недельныйБезДоз.intakes = [course(недельныйБезДоз.box, {
    since: пятница, startedAt: пятница, times: ['20:00'], rhythm: { weekdays: [5] }, endsAt: вторникКонец,
  })]
  check('еженедельный курс без доз после срока не просит новую упаковку', enoughForCourse(недельныйБезДоз.box, недельныйБезДоз.intakes, пятницаПолдень) && medicineAlert(недельныйБезДоз.box, недельныйБезДоз.intakes, пятницаПолдень)?.kind === 'expiring' && restockList([недельныйБезДоз], пятницаПолдень).length === 0)
  const поПятницамИПонедельникам = недельнаяКоробка('weekly-post-expiry', 'Есть доза после срока', 2)
  поПятницамИПонедельникам.intakes = [course(поПятницамИПонедельникам.box, {
    since: пятница, startedAt: пятница, times: ['20:00'], rhythm: { weekdays: [1, 5] }, endsAt: вторникКонец,
  })]
  check('еженедельная доза после срока сохраняет предупреждение', enoughForCourse(поПятницамИПонедельникам.box, поПятницамИПонедельникам.intakes, пятницаПолдень) && restockList([поПятницамИПонедельникам], пятницаПолдень).some(item => item.reason === 'expiring'))
  const этапБезДозПослеСрока = недельнаяКоробка('staged-no-post-expiry', 'Этап без расписания', 1)
  этапБезДозПослеСрока.intakes = [course(этапБезДозПослеСрока.box, {
    since: пятница, startedAt: пятница, planFrom: пятница, perDay: 0, endsAt: вторникКонец,
    plan: [{ perTime: 1, times: ['20:00'], days: 1 }, { perTime: 1, times: [], days: 4 }],
  })]
  check('этап без доз после срока учитывается по фактическому расписанию', enoughForCourse(этапБезДозПослеСрока.box, этапБезДозПослеСрока.intakes, пятницаПолдень) && restockList([этапБезДозПослеСрока], пятницаПолдень).length === 0)
  const несколькоРитмов = недельнаяКоробка('multiple-rhythms-post-expiry', 'Два курса с дозой после срока', 2)
  несколькоРитмов.intakes = [
    course(несколькоРитмов.box, { id: 'r-friday', since: пятница, startedAt: пятница, times: ['20:00'], rhythm: { weekdays: [5] }, endsAt: вторникКонец }),
    course(несколькоРитмов.box, { id: 'r-monday', person: 'p2', since: пятница, startedAt: пятница, times: ['08:00'], rhythm: { weekdays: [1] }, endsAt: вторникКонец }),
  ]
  check('несколько курсов: доза одного после срока сохраняет покупку', enoughForCourse(несколькоРитмов.box, несколькоРитмов.intakes, пятницаПолдень) && restockList([несколькоРитмов], пятницаПолдень).some(item => item.reason === 'expiring'))
  const неизвестныйПослеСрока = недельнаяКоробка('unknown-post-expiry', 'Неизвестный расход', 1)
  неизвестныйПослеСрока.intakes = [course(неизвестныйПослеСрока.box, {
    since: пятница, startedAt: пятница, times: [], perDay: null, endsAt: вторникКонец,
  })]
  const неизвестнаяПокупка = restockList([неизвестныйПослеСрока], пятницаПолдень)[0]
  check('неизвестный расход после срока сохраняет предупреждение с неизвестным количеством', неизвестнаяПокупка?.reason === 'expiring' && неизвестнаяПокупка.need === null)
  const несколькоКурсов = коробка({ id: 'expiry-multiple', name: 'Два курса', left: 13, leftAt: now, expires: new Date(2026, 9, 10).getTime(), expiryWarningDays: 14 })
  несколькоКурсов.intakes = [
    course(несколькоКурсов.box, { id: 'r-first', times: [], perDay: 1, endsAt: new Date(2026, 9, 8).getTime() }),
    course(несколькоКурсов.box, { id: 'r-second', person: 'p2', times: [], perDay: 1, endsAt: new Date(2026, 9, 9).getTime() }),
  ]
  check('суммарный запас на два курса до срока не создаёт покупку', enoughForCourse(несколькоКурсов.box, несколькоКурсов.intakes, now) && restockList([несколькоКурсов], now).length === 0)
  const ровноНаЖивойКурс = коробка({ id: 'finished-plus-six-days', name: 'Завершённый и шестидневный', left: 6, leftAt: new Date(2026, 9, 10).getTime(), expires: new Date(2027, 5, 30).getTime() })
  const конецЖивогоКурса = new Date(2026, 9, 15).getTime()
  ровноНаЖивойКурс.intakes = [
    course(ровноНаЖивойКурс.box, { id: 'r-finished-oct-4', since: new Date(2026, 8, 25).getTime(), endsAt: new Date(2026, 9, 4).getTime() }),
    course(ровноНаЖивойКурс.box, { id: 'r-six-days-left', person: 'p2', since: new Date(2026, 9, 10).getTime(), times: [], perDay: 1, endsAt: конецЖивогоКурса }),
  ]
  const десятоеОктября = new Date(2026, 9, 10, 7).getTime()
  check('завершённый 4 октября курс не завышает потребность второго курса на 6 дней', enoughForCourse(ровноНаЖивойКурс.box, ровноНаЖивойКурс.intakes, десятоеОктября) && restockList([ровноНаЖивойКурс], десятоеОктября).length === 0)
  const курсПослеСрока = { ...несколькоКурсов, box: { ...несколькоКурсов.box, id: 'expiry-before-course', name: 'Курс после срока', left: 16 }, intakes: [] }
  курсПослеСрока.intakes = [
    course(курсПослеСрока.box, { id: 'r-first', times: [], perDay: 1, endsAt: new Date(2026, 9, 8).getTime() }),
    course(курсПослеСрока.box, { id: 'r-later', person: 'p2', times: [], perDay: 1, endsAt: new Date(2026, 9, 12).getTime() }),
  ]
  check('срок раньше конца одного из курсов сохраняет предупреждение', enoughForCourse(курсПослеСрока.box, курсПослеСрока.intakes, now) && restockList([курсПослеСрока], now).some(item => item.reason === 'expiring'))
  const shared = { ...expired, intakes: [expired.intakes[0], course(expired.box, { id: 'r-active', person: 'p2' })] }
  check('общая пачка нужна человеку с действующим курсом', restockList([shared], now).length === 1)
  check('фильтр покупок не зовёт пополнять пачку для окончившего курс', stockForPerson([shared], 'p1', now, true).length === 0)
  check('фильтр покупок оставляет действующий курс', stockForPerson([shared], 'p2', now, true)[0] === shared)
  const reserve = коробка({ id: 'reserve', name: 'Домашний запас', left: 0 })
  check('без курса нет потребности покупать', restockList([reserve], now).length === 0)
  const family = [expired, shared, reserve]
  check('«Все» возвращает всю аптечку, в том числе без курсов', stockForPerson(family, null, now) === family)
  check('имя сужает аптечку по курсам', stockForPerson(family, 'p2', now).map((s) => s.box.id).join() === shared.box.id)
  const daily = коробка({ id: 'daily', name: 'На двоих', left: 4 })
  daily.intakes = [course(daily.box), course(daily.box, { id: 'r-other', person: 'p2' })]
  const selected = stockForPerson([daily], 'p1', now)[0]
  check('фильтр не уменьшает общий расход упаковки', selected === daily && selected.intakes.length === 2 && supplyDays(selected.box, selected.intakes, now) === 3)

  const stoppedAt = new Date(2026, 9, 3, 10, 30, 25).getTime()
  const morning = new Date(2026, 9, 3, 8).getTime()
  const later = new Date(2026, 9, 10, 12).getTime()
  const stoppedBox = { id: 'stop', name: 'Прекращённый', dose: '', left: 20, expires: null, leftAt: yesterday }
  const stoppedRegimen = { id: 'r-stop', medicineId: 'stop', person: 'p1', times: ['08:00', '20:00'],
    perTime: 1, stoppedAt, taken: [morning], scheduleUpdatedAt: stoppedAt, updatedAt: stoppedAt }
  const stopped = dosing(stoppedBox, stoppedRegimen)
  check('прекращение в середине минуты действует сразу', regimenFinished(stopped, stoppedAt))
  const pastSlots = dosesOn(stopped, stoppedAt, stoppedAt)
  check('утренняя отметка остаётся в истории, вечер отменён', pastSlots.length === 1 && pastSlots[0].takenAt === morning)
  check('прекращённый курс не зовёт отметить приём сегодня', dosesToday(stopped, stoppedAt).length === 0 && pendingToday([stopped], stoppedAt) === 0)
  check('расход по расписанию не продолжается после прекращения', projectedLeft(stoppedBox, [stopped], stoppedAt) === projectedLeft(stoppedBox, [stopped], later))
  const manual = { ...stopped, times: undefined, perDay: 2, since: yesterday }
  check('ручной суточный расход также прекращается', projectedLeft(stoppedBox, [manual], stoppedAt) === projectedLeft(stoppedBox, [manual], later))
  const early = { ...stopped, stoppedAt: new Date(2026, 9, 3, 8, 5, 25).getTime(), taken: [] }
  const advance = { ...early, taken: [new Date(2026, 9, 3, 20).getTime()] }
  const advanceSlots = dosesOn(advance, early.stoppedAt, early.stoppedAt)
  check('заранее отмеченный вечер не переезжает на утро', advanceSlots.length === 2 && advanceSlots[0].takenAt === null && advanceSlots[1].time === '20:00' && advanceSlots[1].takenAt === advance.taken[0])
  check('после прекращения нет позднего повтора напоминания', buildReminders([early], early.stoppedAt, { repeat: true }).length === 0)
  check('старое уведомление не предлагает отменённый препарат', medicinesForReminder([early], [], '08:00', early.stoppedAt, early.stoppedAt, 'p1').length === 0)
  const snoozeInput = { medicines: [early], subjects: [], now: early.stoppedAt, options: { repeat: false, personOf: m => m.person } }
  check('просьба «позже» отменяется после прекращения', !snoozeIsRelevant(snoozeInput, { kind: 'dose', day: new Date(2026, 9, 3).getTime(), slot: '08:00', person: 'p1' }))
  check('прекращённый курс не экспортируется в календарь', countCalendarEvents([stopped], stoppedAt) === 0 && !buildCalendar([stopped], stoppedAt).includes('BEGIN:VEVENT'))
  check('памятка не содержит прекращённый сегодня курс', buildMemo([stopped], [], stoppedAt).slots.length === 0)
  const laboratory = { id: 'lab-stop', owner: 'p1', name: 'Контроль', results: [], schedule: { due: later, afterRegimen: 'r-stop', afterDays: 14 } }
  const expectedDue = new Date(2026, 9, 17).getTime()
  check('контрольный анализ отсчитывается от фактической остановки', dueOf(laboratory, [stoppedRegimen]).at === expectedDue && regimenEndDay(stoppedRegimen) === new Date(2026, 9, 3).getTime())
  const snapshot = { measurements: [], medicines: [stoppedBox], regimens: [stoppedRegimen], labs: [], tombstones: [], settings: null }
  const restored = parseJson(toJson(snapshot)).regimens[0]
  check('копия сохраняет прекращение и утреннюю отметку', restored.stoppedAt === stoppedAt && restored.taken[0] === morning)
  const other = { ...stoppedRegimen, stoppedAt: undefined, scheduleUpdatedAt: later, updatedAt: later }
  const mergedStop = mergeRegimen(stoppedRegimen, other) ?? stoppedRegimen
  check('чужая свежая отметка не возобновляет прекращённое расписание', mergedStop.stoppedAt === stoppedAt && mergedStop.taken.includes(morning))
  check('прекращение сохраняется и в обратном направлении обмена', (mergeRegimen(other, stoppedRegimen) ?? other).stoppedAt === stoppedAt)

  return failures
}
