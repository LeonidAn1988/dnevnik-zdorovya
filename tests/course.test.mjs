/**
 * Расписание измерений: напоминание мерить и курс от врача.
 *
 * Самая опасная часть приложения. В 0.18.3 оно падало на пятьсот первом
 * будильнике Android, поэтому здесь проверяются не только окна и счётчики, но и
 * арифметика бюджета, и непересечение номеров с напоминаниями о приёме.
 */
import {
  courseReportText, planTimes,
  slotWindows, measuredSlots, planDayIndex, planActiveOn, planIntersects,
  courseToday, courseText, courseReport, describeMeasurePlan, measureSubjects,
  planReminders as _planReminders, measureId, reminderId, MEASURE_ID_BASE, MEASURE_ID_MAX, MAX_REMINDERS,
  buildMeasureReminders,
  splitBox,
  dosing,
} from './build/api.mjs'

const ДЕНЬ = 24 * 60 * 60 * 1000
const день = (г, м, д) => new Date(г, м, д).getTime()
const момент = (г, м, д, ч, мин = 0) => new Date(г, м, д, ч, мин).getTime()
const старт = день(2026, 8, 1)


/*
 * Фикстуры плоские — препарат одним объектом, как до 0.27.0. Раскладывает их
 * тот же `splitBox`, что и обновление базы: здесь проверяются напоминания, а не
 * способ хранения. Человек берётся из `owner` фикстуры и становится `person`
 * курса — ровно так же, как при переносе настоящего дневника.
 */
const вПриёмы = (list) =>
  list.map((m) => {
    const { box, regimen } = splitBox(m, m.owner ?? 'p1')
    return dosing(box, regimen ?? { id: `r-${box.id}`, medicineId: box.id, person: m.owner ?? 'p1' })
  })
const planReminders = (input) => _planReminders({ ...input, medicines: вПриёмы(input.medicines ?? []) })

export function run() {
  let failures = 0
  const check = (name, condition, detail = '') => {
    if (condition) console.log(`  ok   ${name}`)
    else {
      console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`)
      failures++
    }
  }

  // ── окна суток: главная тонкость ──
  const одно = slotWindows(['08:00'], старт)
  check('одно время — окно на все сутки', одно.length === 1 && одно[0].from === старт && одно[0].to === старт + ДЕНЬ)
  const два = slotWindows(['08:00', '20:00'], старт)
  check('два времени — граница посередине', два[0].to === момент(2026, 8, 1, 14) && два[1].from === момент(2026, 8, 1, 14))
  check('окна стыкуются и покрывают сутки', два[0].from === старт && два[1].to === старт + ДЕНЬ)

  const план2 = { times: ['08:00', '20:00'], days: null, from: старт }
  // Ради этого всё и затевалось: утренний замер не должен гасить вечернее напоминание.
  const утром = measuredSlots(план2, [момент(2026, 8, 1, 8, 5)], старт)
  check('утренний замер закрыл утро', утром[0] === true)
  check('и НЕ закрыл вечер', утром[1] === false)
  check('ранний замер закрывает утро', measuredSlots(план2, [момент(2026, 8, 1, 6, 40)], старт)[0] === true)
  check('замер в 14:00 идёт в вечер', measuredSlots(план2, [момент(2026, 8, 1, 14)], старт)[1] === true)
  check('вчерашний замер сегодня не считается', measuredSlots(план2, [момент(2026, 7, 31, 8)], старт)[0] === false)

  // ── курс ──
  const курс = { times: ['08:00', '20:00'], days: 14, from: старт }
  check('первый день — первый', planDayIndex(курс, старт) === 1)
  check('шестой день', planDayIndex(курс, старт + 5 * ДЕНЬ) === 6)
  check('до начала — ноль', planDayIndex(курс, старт - ДЕНЬ) === 0)
  check('последний день ещё действует', planActiveOn(курс, старт + 13 * ДЕНЬ) === true)
  check('пятнадцатый — уже нет', planActiveOn(курс, старт + 14 * ДЕНЬ) === false)
  check('бессрочный действует всегда', planActiveOn({ ...курс, days: null }, старт + 400 * ДЕНЬ) === true)
  check('курс завтра задевает горизонт', planIntersects({ ...курс, from: старт + ДЕНЬ }, старт, старт + 13 * ДЕНЬ) === true)
  check('кончившийся курс горизонта не задевает', planIntersects(курс, старт + 20 * ДЕНЬ, старт + 30 * ДЕНЬ) === false)

  const сегодня = courseToday(курс, [момент(2026, 8, 5, 8, 10)], момент(2026, 8, 5, 12))
  // Курс начат 1 сентября, смотрим 5-го: это пятый день, а не шестой.
  check('счётчик дня', сегодня.day === 5 && сегодня.total === 14, String(сегодня.day))
  check('сегодня сделано одно из двух', сегодня.done === 1 && сегодня.planned === 2)
  check('следующее время названо', сегодня.next === '20:00')
  check('текст счётчика', courseText(сегодня) === 'День 5 из 14 · сегодня 1 из 2', courseText(сегодня))
  const бессрочно = courseToday({ ...курс, days: null }, [], момент(2026, 8, 5, 12))
  check('без курса — только про сегодня', courseText(бессрочно) === 'Сегодня 0 из 2', courseText(бессрочно))

  // Отчёт: не наступивший вечер не может быть пропущен.
  const отчёт = courseReport(курс, [момент(2026, 8, 1, 8), момент(2026, 8, 1, 20), момент(2026, 8, 2, 8)], момент(2026, 8, 2, 12))
  check('ожидаемое считается по начавшимся окнам', отчёт.expected === 3, String(отчёт?.expected))
  check('сделано посчитано', отчёт.done === 3)
  check('у бессрочного отчёта нет', courseReport({ ...курс, days: null }, [], момент(2026, 8, 2, 12)) === null)

  check('описание расписания', describeMeasurePlan(курс) === '08:00 и 20:00, 14 дней', describeMeasurePlan(курс))
  check('пустое расписание', describeMeasurePlan(undefined) === 'не задано')

  // ── номера не пересекаются с приёмными ──
  const мНомер = measureId(старт, 0, 0, 0)
  check('измерения выше приёмного диапазона', мНомер >= MEASURE_ID_BASE && мНомер <= MEASURE_ID_MAX)
  check('приёмный номер ниже базы измерений', reminderId(старт, 127, 7, 7) < MEASURE_ID_BASE)
  check('предельный измерительный ниже отложенных', measureId(старт, 7, 7, 7) < 20_000_000)
  const все = new Set()
  for (let d = 0; d < 14; d++) for (let p = 0; p < 8; p++) for (let sl = 0; sl < 8; sl++) for (let st = 0; st < 4; st++) все.add(measureId(старт + d * ДЕНЬ, sl, st, p))
  check('номера измерений уникальны', все.size === 14 * 8 * 8 * 4, String(все.size))

  // ── бюджет: пятеро с плотной аптечкой и курсом ──
  const люди = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `Ч${i}` }))
  const коробки = люди.flatMap((p) => ['08:00', '13:00', '19:00', '22:00'].map((t, i) => ({
    id: `${p.id}-${i}`, name: 'Т', owner: p.id, times: [t], perTime: 1, dose: '', left: 30, perDay: null, expires: null, taken: [],
  })))
  const субъекты = люди.map((p, index) => ({ person: p.id, index, name: p.name, plan: { times: ['08:00', '20:00'], days: 14, from: старт }, readings: [] }))
  const набор = planReminders({
    medicines: коробки, subjects: субъекты, now: момент(2026, 8, 1, 6),
    options: { repeat: true, personOf: (m) => m.person, personName: (id) => id },
  })
  check('потолок не пробит', набор.length <= MAX_REMINDERS, String(набор.length))
  check('в наборе есть оба рода', набор.some((r) => r.kind === 'dose') && набор.some((r) => r.kind === 'measure'))
  check('все номера различны', new Set(набор.map((r) => r.id)).size === набор.length)
  check('прошедшего в наборе нет', набор.every((r) => r.at > момент(2026, 8, 1, 6)))

  // ── у измерения нет «Принял», но есть ожидание действия ──
  const изм = buildMeasureReminders(субъекты.slice(0, 1), момент(2026, 8, 1, 6))
  check('измерение помечено как ждущее действия', изм.every((r) => r.markable === true))
  check('род проставлен', изм.every((r) => r.kind === 'measure'))
  check('в заголовке сказано про измерение', /измерение/i.test(изм[0].title))

  // ── субъекты ──
  const без = measureSubjects({ people: [], measurePlan: undefined }, [], момент(2026, 8, 1, 6))
  check('без расписания субъектов нет', без.length === 0)
  const одиночка = measureSubjects({ people: [], measurePlan: курс }, [], момент(2026, 8, 1, 6))
  check('одиночке — один субъект без имени', одиночка.length === 1 && одиночка[0].person === null && одиночка[0].name === null)
  const кончился = measureSubjects({ people: [], measurePlan: { ...курс, from: старт - 30 * ДЕНЬ } }, [], момент(2026, 8, 1, 6))
  check('кончившийся курс субъектом не становится', кончился.length === 0)

  // Строка для врача: схема, срок и сколько из назначенного сделано.
  {
    const план = { times: ['08:00', '20:00'], days: 3, from: старт }
    const записи = [
      момент(2026, 8, 1, 8), момент(2026, 8, 1, 20),
      момент(2026, 8, 2, 8),
      момент(2026, 8, 3, 8), момент(2026, 8, 3, 21),
    ]
    const строка = courseReportText(courseReport(план, записи, момент(2026, 8, 3, 23)), planTimes(план))
    check('строка для врача: времена схемы', строка.includes('08:00 и 20:00'), строка)
    check('строка для врача: без повтора слова «курс»', !строка.toLowerCase().startsWith('курс'), строка)
    check('строка для врача: сделано 5 из 6', строка.includes('Сделано 5 из 6'), строка)
    check('без срока строки для врача нет', courseReportText(null, ['08:00']) === null)
  }

  return failures
}
