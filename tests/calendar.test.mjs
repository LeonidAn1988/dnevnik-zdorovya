/**
 * Файл расписания для календаря телефона.
 *
 * Проверяется то, на чём календари спотыкаются чаще всего: складывание длинных
 * строк по байтам (кириллица — два байта на символ), экранирование служебных
 * знаков, переводы строк CRLF и устойчивые идентификаторы событий.
 */
import { buildCalendar as _buildCalendar, countCalendarEvents as _countCalendarEvents, foldLine, doseTitle as _doseTitle, splitBox, dosing } from './build/api.mjs'


/*
 * Фикстуры плоские, как препарат выглядел до 0.27.0. Раскладывает их тот же
 * `splitBox`, что и обновление базы: проверяется содержимое, а не хранение.
 */
const вПриёмы = (list) =>
  list.map((m) => {
    const { box, regimen } = splitBox(m, 'p1')
    return dosing(box, regimen ?? { id: `r-${box.id}`, medicineId: box.id, person: 'p1' })
  })
const buildCalendar = (list, now, opts) => _buildCalendar(вПриёмы(list), now, opts)
const countCalendarEvents = (list) => _countCalendarEvents(вПриёмы(list))
const doseTitle = (m) => _doseTitle(вПриёмы([m])[0])

export function run() {
  let failures = 0
  const check = (name, condition, detail = '') => {
    if (condition) console.log(`  ok   ${name}`)
    else {
      console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`)
      failures++
    }
  }

  const med = (over) => ({ id: 'med-1', name: 'Лозартан', dose: '50 мг', left: 30, perDay: null, expires: null, ...over })
  const now = new Date(2026, 7, 13, 12, 0, 0).getTime()
  const bytes = (s) => new TextEncoder().encode(s).length

  // ── складывание строк ────────────────────────────────────────────────────
  check('короткая строка не трогается', foldLine('SUMMARY:Лозартан') === 'SUMMARY:Лозартан')
  const длинная = 'DESCRIPTION:' + 'Ацетилсалициловая кислота '.repeat(6)
  const сложено = foldLine(длинная)
  check('длинная строка сложена', сложено.includes('\r\n '))
  check(
    'каждый кусок укладывается в 75 байт',
    сложено.split('\r\n').every((part) => bytes(part) <= 75),
    сложено.split('\r\n').map(bytes).join(','),
  )
  check(
    'при разворачивании получается исходная строка',
    сложено.split('\r\n ').join('') === длинная,
  )
  check(
    'кириллица считается по байтам, а не по символам',
    bytes(foldLine('X:' + 'я'.repeat(50)).split('\r\n')[0]) <= 75,
    'по символам строка «влезала», а по спецификации уже нет',
  )

  // ── структура файла ──────────────────────────────────────────────────────
  const ics = buildCalendar([med({ times: ['08:00', '20:00'] })], now)
  check('начало и конец на месте', ics.startsWith('BEGIN:VCALENDAR') && ics.trimEnd().endsWith('END:VCALENDAR'))
  check('переводы строк CRLF', ics.includes('\r\n') && !/[^\r]\n/.test(ics), 'часть календарей иначе не читает файл')
  check('событий по числу приёмов', (ics.match(/BEGIN:VEVENT/g) ?? []).length === 2)
  check('повтор ежедневный', (ics.match(/RRULE:FREQ=DAILY/g) ?? []).length === 2)
  check('будильник внутри каждого события', (ics.match(/BEGIN:VALARM/g) ?? []).length === 2)
  check('название препарата в подписи', ics.includes('SUMMARY:Лозартан 50 мг'))

  // ── время ────────────────────────────────────────────────────────────────
  check(
    'время без часового пояса',
    /DTSTART:2026\d{4}T\d{6}\r\n/.test(ics) && !/DTSTART:[^\r]*Z/.test(ics),
    'плавающее время календарь понимает как местное — при переезде это верно',
  )
  check(
    'прошедший приём переносится на завтра',
    ics.includes('DTSTART:20260814T080000'),
    'в полдень утренний приём уже позади',
  )
  check('будущий приём остаётся сегодня', ics.includes('DTSTART:20260813T200000'))

  // ── устойчивость и экранирование ─────────────────────────────────────────
  const снова = buildCalendar([med({ times: ['08:00', '20:00'] })], now + 3600000)
  const uid = (text) => (text.match(/UID:[^\r]+/g) ?? []).sort()
  check(
    'идентификаторы устойчивы между выгрузками',
    JSON.stringify(uid(ics)) === JSON.stringify(uid(снова)),
    'иначе повторная выгрузка заведёт второе событие рядом',
  )

  const хитрый = buildCalendar([med({ name: 'Аспирин, Кардио; форте', times: ['09:00'], note: 'строка\nвторая' })], now)
  check('запятая экранирована', хитрый.includes('Аспирин\\, Кардио'))
  check('точка с запятой экранирована', хитрый.includes('\\; форте'))
  check('перевод строки в примечании экранирован', хитрый.includes('строка\\nвторая'))

  check(
    'идентификатор события без кириллицы',
    (ics.match(/UID:[^\r]+/g) ?? []).every((u) => /^UID:[\x20-\x7e]+$/.test(u)),
    'спецификация ждёт адрес почтового вида, часть календарей спотыкается',
  )

  // ── подписи и подсчёт ────────────────────────────────────────────────────
  check('одна штука за приём не упоминается', doseTitle(med({})) === 'Лозартан 50 мг')
  check('две штуки за приём подписаны', doseTitle(med({ perTime: 2 })) === 'Лозартан 50 мг — 2 шт.')
  check('препарат без дозировки не даёт лишнего пробела', doseTitle(med({ dose: '' })) === 'Лозартан')

  check('счёт событий', countCalendarEvents([med({ times: ['08:00', '20:00'] }), med({ times: ['09:00'] })]) === 3)
  check('препарат без расписания в календарь не идёт', countCalendarEvents([med({})]) === 0)
  check('пустая аптечка даёт пустой календарь', (buildCalendar([], now).match(/BEGIN:VEVENT/g) ?? []).length === 0)

  const заранее = buildCalendar([med({ times: ['08:00'] })], now, { alarmBefore: 15 })
  check('будильник за 15 минут', заранее.includes('TRIGGER:-PT15M'))

  const day = n => new Date(2026, 9, n).getTime()
  const finite = med({ times: ['08:00'], since: day(17), startedAt: day(17), endsAt: day(22), rhythm: { onDays: 2, offDays: 1, from: day(17) } })
  const unfold = text => text.replace(/\r\n /g, '')
  const dated = unfold(buildCalendar([finite], day(17)))
  const occurrences = [dated.match(/DTSTART:([^\r]+)/)?.[1], ...(dated.match(/RDATE;VALUE=DATE-TIME:([^\r]+)/)?.[1].split(',') ?? [])]
  check('ограниченный цикл экспортирует ровно четыре приёма', JSON.stringify(occurrences) === JSON.stringify(['20261017T080000','20261018T080000','20261020T080000','20261021T080000']))
  const stopped = unfold(buildCalendar([{ ...finite, stoppedAt: new Date(2026, 9, 20, 8).getTime() }], day(17)))
  check('остановка исключает приём ровно в момент остановки', !stopped.includes('20261020T080000') && !stopped.includes('20261021T080000'))
  const noFuture = buildCalendar([med({ times:['08:00'], endsAt:day(17), rhythm:{ weekdays:[1] } })], day(17))
  check('ближайший приём за концом курса не создаёт DTSTART', !noFuture.includes('BEGIN:VEVENT'))
  const boundedDaily = buildCalendar([med({ times:['08:00'], endsAt:day(22) })],day(17))
  check('UNTIL соответствует плавающему местному DTSTART', boundedDaily.includes('UNTIL=20261022T235959'))

  // Runs in the DST timezone matrix as well as the default zone. Assertions
  // compare requested wall time, independent of the local UTC offset.
  const spring = new Date(2026, 2, 28).getTime()
  const dstCycle = unfold(buildCalendar([med({ times:['08:00'], rhythm:{ onDays:2,offDays:1,from:spring } })],spring))
  const dstDates = [dstCycle.match(/DTSTART:([^\r]+)/)?.[1], ...(dstCycle.match(/RDATE;VALUE=DATE-TIME:([^\r]+)/)?.[1].split(',')??[])]
  check('цикл сохраняет местные 08:00 при DST', dstDates.every(value=>value?.endsWith('T080000')))
  const sunday = new Date(2026, 2, 29).getTime()
  const weekly = buildCalendar([med({ times:['08:00'],rhythm:{weekdays:[1]} })],sunday)
  check('первый недельный приём сохраняет местные 08:00',weekly.includes('DTSTART:20260330T080000'))

  return failures
}
