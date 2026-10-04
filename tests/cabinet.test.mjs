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
