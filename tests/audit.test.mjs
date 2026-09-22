/**
 * Находки тотального аудита 22 сентября 2026.
 *
 * Панель узких критиков прошла по коду после четырёх выпусков подряд и нашла
 * десяток дефектов, каждый из которых проходил мимо всех прежних проверок.
 * Набор держит их закрытыми: почти все — молчаливые, то есть возвращаются
 * незамеченными.
 *
 * Числа в ожиданиях не подогнаны под код: они посчитаны руками в комментариях
 * рядом. Проверка, подогнанная под поведение, закрепляет дефект, а не чинит.
 */
import {
  dosing,
  stockOf,
  supplyDays,
  projectedLeft,
  medicineAlert,
  needUntilEnd,
  enoughForCourse,
  restockList,
  markTakenAt,
  foldHistory,
  historyTotal,
  buildMemo,
  endsAfter,
  packUnit,
  parseJson,
  toJson,
  mergeRegimen,
  mergeRestoredSettings,
  MAX_PEOPLE,
  installWebPlatform,
  useIndexedDbFactory,
  getAllMeasurements,
  putMeasurements,
  deleteMeasurement,
  restoreMeasurement,
  getAllTombstones,
} from './build/api.mjs'
import { IDBFactory } from 'fake-indexeddb'

const ДЕНЬ = 86_400_000
const старт = new Date(2026, 8, 22).setHours(0, 0, 0, 0)
const день = (n) => старт + n * ДЕНЬ
const коробка = (f) => ({ id: 'k', name: 'Проба', dose: '', left: null, expires: null, ...f })
const курс = (f) => ({ id: 'r', medicineId: 'k', person: 'p1', ...f })

export async function run() {
  let failures = 0
  const check = (name, condition, detail = '') => {
    if (condition) console.log(`  ok   ${name}`)
    else {
      console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`)
      failures++
    }
  }

  // ── «Вернуть» после удаления измерения ───────────────────────────────────
  // Кнопка молча не работала: удаление ставит надгробие, а повторная запись
  // надгробие уважает и запись не пускает. Баннер при этом закрывался, как
  // после успеха, и человек считал, что откатил ошибку.
  {
    installWebPlatform()
    useIndexedDbFactory(new IDBFactory())
    const зап = {
      kind: 'bp', id: 'bp-1', ts: 1_700_000_000_000, sys: 130, dia: 85,
      bpm: 70, ihb: false, mov: false, user: 1, source: 'manual',
    }
    await putMeasurements([зап])
    await deleteMeasurement('bp-1')
    check('удаление ставит надгробие', (await getAllTombstones()).length === 1)
    check('и запись уходит', (await getAllMeasurements()).length === 0)
    await putMeasurements([зап])
    check('обычная запись обратно не пускает — так и задумано', (await getAllMeasurements()).length === 0)
    await restoreMeasurement(зап)
    check('а «Вернуть» возвращает', (await getAllMeasurements()).length === 1)
    check('и надгробие снято', (await getAllTombstones()).length === 0)
  }

  // ── капли: «в день» — это капли, а не миллилитры ─────────────────────────
  // Флакон 10 мл по три капли в день — это 200 капель, то есть 66 дней.
  // Без перевода выходило три дня, и список покупок просил восемь флаконов.
  {
    const b = коробка({ form: 'Капли глазные', packSize: 10, left: 10, leftAt: старт })
    const d = dosing(b, курс({ perDay: 3, since: старт }))
    check('флакона хватает на 66 дней, а не на три', supplyDays(b, [d], старт) === 66, String(supplyDays(b, [d], старт)))
    check('и в аптеку не зовёт', restockList(stockOf([b], [d]), старт).length === 0)
    // У таблеток пересчёта нет — там единица приёма и есть единица упаковки.
    const т = коробка({ form: 'Таблетки', packSize: 30, left: 30, leftAt: старт })
    const тд = dosing(т, курс({ perDay: 3, since: старт }))
    check('у таблеток счёт прежний', supplyDays(т, [тд], старт) === 10, String(supplyDays(т, [тд], старт)))
  }

  // ── курс без расписания списывает только за свои дни ─────────────────────
  // Остаток подтверждён 30 дней назад, курс заведён вчера, по 2 в сутки.
  // Списать можно ровно за прожитые курсом дни, а не за весь месяц.
  {
    const b = коробка({ left: 30, leftAt: день(-30), packSize: 30 })
    const d = dosing(b, курс({ perDay: 2, since: день(-1) }))
    check('полная пачка не объявляется кончившейся', projectedLeft(b, [d], старт) === 28, String(projectedLeft(b, [d], старт)))
    check('и тревоги нет', medicineAlert(b, [d], старт) === null, JSON.stringify(medicineAlert(b, [d], старт)))
    // Зеркально: законченный курс не списывает за дни после конца.
    const к = dosing(b, курс({ perDay: 2, since: день(-30), endsAt: день(-20) }))
    check('после конца курса расход останавливается', projectedLeft(b, [к], старт) === 10, String(projectedLeft(b, [к], старт)))
  }

  // ── отметка задним числом не списывает вторую таблетку ───────────────────
  // Принято три таблетки из двадцати — значит семнадцать, сколько бы раз
  // человек ни отмечал задним числом.
  {
    let b = коробка({ left: 20, leftAt: день(-1) + 7 * 3600_000 })
    let r = курс({ times: ['08:00', '20:00'], perTime: 1, since: день(-1) })
    const шаг = (planned, now) => {
      const х = markTakenAt(b, r, [dosing(b, r)], planned, now)
      b = х.box
      r = х.regimen
      return b.left
    }
    шаг(день(-1) + 8 * 3600_000, день(-1) + 8 * 3600_000 + 60_000)
    шаг(старт + 8 * 3600_000, старт + 8 * 3600_000 + 60_000)
    const после = шаг(день(-1) + 20 * 3600_000, старт + 9 * 3600_000)
    check('три принятые таблетки из двадцати оставляют семнадцать', после === 17, String(после))
  }

  // Две отметки подряд у коробки без даты подтверждения списывают обе.
  {
    let b = коробка({ left: 30 })
    let r = курс({ times: ['20:00', '21:00'], perTime: 1, since: старт })
    const сейчас = старт + 21 * 3600_000 + 1800_000
    for (const час of [20, 21]) {
      const х = markTakenAt(b, r, [dosing(b, r)], старт + час * 3600_000, сейчас)
      b = х.box
      r = х.regimen
    }
    check('две таблетки из тридцати оставляют двадцать восемь', b.left === 28, String(b.left))
  }

  // ── «хватит до конца курса» считается по дням, а не средней дозой ────────
  // Схема «неделя по ½, неделя по целой, дальше по две», курс 21 день:
  // 3,5 + 7 + 14 = 24,5 таблетки. Средняя сегодняшняя доза давала 10,5, и
  // одиннадцати таблеток «хватало» — молчание там, где нужна тревога.
  {
    const b = коробка({ left: 11 })
    const d = dosing(b, курс({
      times: ['08:00'], perTime: 1, since: старт, endsAt: endsAfter(старт, 21), planFrom: старт,
      plan: [{ perTime: 0.5, days: 7 }, { perTime: 1, days: 7 }, { perTime: 2, days: null }],
    }))
    check('нужда считается по дням схемы', needUntilEnd([d], старт) === 24.5, String(needUntilEnd([d], старт)))
    check('и одиннадцати таблеток не хватает', !enoughForCourse(b, [d], старт))
    check('а двадцати пяти хватает', enoughForCourse(коробка({ left: 25 }), [d], старт))
    // Ритм тоже учитывается: «через день по две», три приёмных дня — шесть штук.
    const ч = dosing(коробка({ left: 5 }), курс({
      times: ['08:00'], perTime: 2, since: старт, endsAt: день(4),
      rhythm: { onDays: 1, offDays: 1, from: старт },
    }))
    check('через день считается через день', needUntilEnd([ч], старт) === 6, String(needUntilEnd([ч], старт)))
  }

  // ── памятка на холодильник знает про конец курса ─────────────────────────
  // Лист, по которому раскладывают таблетницу, не должен назначать неделю
  // отменённого препарата.
  {
    const d = dosing(коробка({ left: 30 }), курс({ times: ['08:00'], perTime: 1, since: день(-10), endsAt: день(-2) }))
    const м = buildMemo([d], [{ time: '08:00', title: 'Утро' }], старт)
    check('законченный курс в памятку не попадает', м.slots.length === 0 && м.totals.length === 0)
    const живой = dosing(коробка({ left: 30 }), курс({ times: ['08:00'], perTime: 1, since: день(-10), endsAt: день(3) }))
    const м2 = buildMemo([живой], [{ time: '08:00', title: 'Утро' }], старт)
    check('а идущий — попадает', м2.slots.length === 1)
    // Курс кончается через три дня: клеток под карандаш четыре, а не семь.
    check('клетки кончаются вместе с курсом', м2.slots[0].days.filter(Boolean).length === 4,
      String(м2.slots[0].days.filter(Boolean).length))
  }

  // ── свёрнутая история считает назначенное по ритму ───────────────────────
  // Приём через день за два месяца — это примерно тридцать доз, а не шестьдесят.
  // Прежний счёт давал врачу 50 % соблюдения там, где не пропущено ни одной.
  {
    const r = курс({
      times: ['08:00'], perTime: 1, since: день(-120), foldedUntil: день(-120),
      rhythm: { onDays: 1, offDays: 1, from: день(-120) },
    })
    const итог = historyTotal(foldHistory(r, старт))
    check('через день сворачивается через день', итог.planned > 25 && итог.planned < 35, String(итог.planned))
  }

  // ── обмен с телефоном старой сборки не стирает расписание ────────────────
  // Сборка до 0.27 не знает про курсы: её коробка приходит без часов, зато со
  // свежей отметкой правки. Взять её целиком значит замолчать напоминаниям.
  {
    const своё = курс({ times: ['08:00', '20:00'], perTime: 2, meal: 'after', updatedAt: 100 })
    const чужое = курс({ updatedAt: 200 })
    const слито = mergeRegimen(своё, чужое)
    check('часы приёма переживают чужую пустоту', JSON.stringify(слито?.times) === JSON.stringify(['08:00', '20:00']),
      JSON.stringify(слито?.times))
    check('и доза за приём тоже', слито?.perTime === 2)
    check('и отношение к еде', слито?.meal === 'after')
    // Заполненное чужое по-прежнему побеждает, если оно свежее.
    const свежее = mergeRegimen(своё, курс({ times: ['09:00'], perTime: 1, updatedAt: 300 }))
    check('заполненное чужое побеждает', JSON.stringify(свежее?.times) === JSON.stringify(['09:00']))
  }

  // ── разбор копии не выдумывает курс ──────────────────────────────────────
  // Коробка без единого поля приёма — бинт, ибупрофен «по потребности» —
  // назначения не получала никогда и не должна получить при восстановлении.
  {
    const файл = JSON.stringify({
      format: 'omron-bp/v3',
      measurements: [],
      medicines: [{ id: 'k1', name: 'Бинт', dose: '', left: null, expires: null }],
      settings: { people: [{ id: 'pW', name: 'Я' }], activePerson: 'pW' },
    })
    check('коробке без приёма курс не заводится', parseJson(файл).regimens.length === 0,
      JSON.stringify(parseJson(файл).regimens))
    // А коробке с расписанием — заводится.
    const сПриёмом = JSON.stringify({
      format: 'omron-bp/v3',
      measurements: [],
      medicines: [{ id: 'k2', name: 'Конкор', dose: '', left: null, expires: null, times: ['08:00'], owner: 'pW' }],
      settings: { people: [{ id: 'pW', name: 'Я' }], activePerson: 'pW' },
    })
    check('а коробке с расписанием — заводится', parseJson(сПриёмом).regimens.length === 1)
  }

  // ── людей из копии не больше, чем помещается в номера уведомлений ────────
  // Девятый человек повторяет номер первого: одно напоминание молча
  // переписывает другое, и человек перестаёт их получать.
  {
    const много = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `Ч${i}` }))
    const после = mergeRestoredSettings({ people: [], activePerson: '' }, { people: много, activePerson: 'p0' })
    check('из копии берётся не больше потолка', после.people.length === MAX_PEOPLE, String(после.people.length))
  }

  return failures
}
