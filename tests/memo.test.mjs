/**
 * Памятка на холодильник.
 *
 * По этому листу жена раскладывает таблетницу на неделю. Ошибка в счёте штук —
 * это неверно разложенная таблетница, поэтому доза берётся на каждый день
 * отдельно: курс мог кончиться в среду.
 */
import { buildMemo as _buildMemo, MEMO_DAYS, splitBox, dosing } from './build/api.mjs'

const ДЕНЬ = 24 * 60 * 60 * 1000
const сейчас = Date.UTC(2026, 8, 10, 12, 0, 0)


/*
 * Фикстуры плоские, как препарат выглядел до 0.27.0. Раскладывает их тот же
 * `splitBox`, что и обновление базы: проверяется содержимое, а не хранение.
 */
const вПриёмы = (list) =>
  list.map((m) => {
    const { box, regimen } = splitBox(m, 'p1')
    return dosing(box, regimen ?? { id: `r-${box.id}`, medicineId: box.id, person: 'p1' })
  })
const buildMemo = (list, slots, now) => _buildMemo(вПриёмы(list), slots, now)

export function run() {
  let failures = 0
  const check = (name, condition, detail = '') => {
    if (condition) console.log(`  ok   ${name}`)
    else {
      console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`)
      failures++
    }
  }

  const слоты = [
    { id: 'morning', title: 'Утром', time: '08:00' },
    { id: 'evening', title: 'Вечером', time: '19:00' },
  ]
  const мед = (over) => ({
    id: 'm', name: 'Конкор', dose: '5 мг', form: 'Таблетки', times: ['08:00'], perTime: 1,
    left: null, perDay: null, expires: null, taken: [], ...over,
  })

  check('без расписания печатать нечего', buildMemo([мед({ times: [] })], слоты, сейчас).slots.length === 0)

  const один = buildMemo([мед({})], слоты, сейчас)
  check('приём попал на лист', один.slots.length === 1 && один.slots[0].time === '08:00')
  check('название кнопки подхвачено', один.slots[0].title === 'Утром')
  check('в приёме назван препарат и доза', один.slots[0].items[0].name === 'Конкор' && один.slots[0].items[0].count === '1')
  check('на неделю семь штук', один.totals[0].pieces === MEMO_DAYS)

  // Два приёма в день — четырнадцать штук на неделю.
  const дважды = buildMemo([мед({ times: ['08:00', '19:00'] })], слоты, сейчас)
  check('два приёма — две строки', дважды.slots.length === 2)
  check('дважды в день — четырнадцать', дважды.totals[0].pieces === 14)

  // Половина таблетки пишется дробью, а не «0.5».
  check('половина дробью', buildMemo([мед({ perTime: 0.5 })], слоты, сейчас).slots[0].items[0].count === '½')

  // Время без своей кнопки — название становится самим временем.
  const чужое = buildMemo([мед({ times: ['09:00'] })], слоты, сейчас)
  check('время без кнопки не теряется', чужое.slots[0].title === '09:00')

  // Порядок: кнопки в своём порядке, чужие времена — после.
  const порядок = buildMemo(
    [мед({ id: 'a', times: ['19:00'] }), мед({ id: 'b', times: ['09:00'] }), мед({ id: 'c', times: ['08:00'] })],
    слоты,
    сейчас,
  )
  check('кнопки идут первыми, в своём порядке', порядок.slots.map((s) => s.time).join(',') === '08:00,19:00,09:00')
  // Итоги считаются по каждому препарату отдельно. Ключ здесь — курс приёма, и
  // проверка стоит ровно потому, что общий ключ склеил бы все три в один.
  check('три препарата дают три итога', порядок.totals.length === 3, String(порядок.totals.length))

  // Хватает ли остатка на неделю — это и есть вопрос раскладывающего.
  check('нехватка видна', buildMemo([мед({ left: 3 })], слоты, сейчас).totals[0].enough === false)
  check('хватает — молчим', buildMemo([мед({ left: 30 })], слоты, сейчас).totals[0].enough === true)
  check('остаток неизвестен — не врём', buildMemo([мед({ left: null })], слоты, сейчас).totals[0].enough === null)

  // Курс кончается в среду: на неделю нужно меньше, и об этом надо сказать.
  const курс = мед({ plan: [{ perTime: 1, days: 3 }], planFrom: сейчас })
  const сКурсом = buildMemo([курс], слоты, сейчас)
  check('после конца курса штуки не считаются', сКурсом.totals[0].pieces === 3, String(сКурсом.totals[0]?.pieces))
  check('о смене дозы внутри недели предупреждаем', сКурсом.doseChanges.length > 0)

  return failures
}
