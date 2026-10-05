/**
 * Памятка на холодильник.
 *
 * По этому листу жена раскладывает таблетницу на неделю. Ошибка в счёте штук —
 * это неверно разложенная таблетница, поэтому доза берётся на каждый день
 * отдельно: курс мог кончиться в среду.
 */
import { buildMemo as _buildMemo, MEMO_DAYS, memoText, splitBox, dosing } from './build/api.mjs'

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

  const meals = buildMemo([
    мед({id:'a',name:'После',meal:'after',mealMinutes:30}),
    мед({id:'b',name:'Во время',meal:'during'}),
    мед({id:'c',name:'Любое'}),
    мед({id:'d',name:'До',meal:'before',mealMinutes:20}),
  ], слоты, сейчас)
  check('условия на листе идут в порядке до/независимо/во время/после', meals.slots[0].items.map(i=>i.meal).join('|') === 'За 20 мин до еды|Независимо от еды|Во время еды|Через 30 мин после еды')
  const text = memoText(meals, сейчас, 'Я')
  check('в отправляемой памятке есть владелец, дата и интервалы еды', text.includes('Приём лекарств — Я') && text.includes('2026') && text.includes('За 20 мин до еды') && text.includes('Через 30 мин после еды'))
  const short = buildMemo([мед({id:'short',name:'Короткий',endsAt:сейчас+ДЕНЬ}), мед({id:'long',name:'Постоянный'})], слоты, сейчас)
  check('разные курсы в одно время имеют отдельные дни', short.slots[0].items[0].dayCounts.filter(Boolean).length === 2 && short.slots[0].items[1].dayCounts.filter(Boolean).length === 7)
  const shortText = memoText(short, сейчас, 'Я').split('• Короткий')[1].split('• Постоянный')[0]
  check('текст короткого курса не обещает ежедневный приём всю неделю', !shortText.includes('ежедневно') && (shortText.match(/2026/g)||[]).length===2)
  const pause = buildMemo([мед({plan:[{perTime:0,days:1},{perTime:1,days:6}],planFrom:сейчас})], слоты, сейчас)
  check('сегодня пауза, но следующие шесть дней остаются в памятке', pause.slots[0].items[0].dayCounts[0]===null && pause.slots[0].items[0].dayCounts.filter(Boolean).length===6 && pause.totals[0].pieces===6)
  const future = buildMemo([мед({plan:[{perTime:1,days:4}],planFrom:сейчас+3*ДЕНЬ,since:сейчас+3*ДЕНЬ})],слоты,сейчас)
  check('курс с будущим началом: три пустых дня и четыре дозы', future.slots[0].items[0].dayCounts.slice(0,3).every(v=>v===null)&&future.totals[0].pieces===4)
  const staleNow=new Date(2026,8,10).getTime()
  const stale = buildMemo([мед({left:10,leftAt:staleNow-4*ДЕНЬ,since:staleNow-4*ДЕНЬ})],слоты,staleNow)
  check('памятка сравнивает с текущим расчётным остатком', stale.totals[0].enough===false)
  const box={id:'shared',name:'Общий',left:10,leftAt:сейчас,stockUnit:'piece',doseUnit:'piece'}
  const all=[0,1].map(i=>dosing(box,{id:'r'+i,medicineId:box.id,person:'p'+i,since:сейчас,times:['08:00'],perTime:1}))
  check('общий запас меньше суммы двух недельных потребностей', _buildMemo(all,слоты,сейчас).totals.every(t=>t.enough===false))
  check('памятка одного человека учитывает расход второго', _buildMemo([all[0]],слоты,сейчас,all).totals[0].enough===false)
  const midnight=new Date(2026,8,10).getTime()
  const sharedBox={...box,leftAt:midnight}
  const scheduled=dosing(sharedBox,{id:'scheduled',medicineId:box.id,person:'p0',since:midnight,times:['08:00'],perTime:1})
  const manual=dosing(sharedBox,{id:'manual',medicineId:box.id,person:'p1',since:midnight,perDay:1})
  check('общий запас учитывает и ручной суточный расход другого курса',_buildMemo([scheduled],слоты,midnight,[scheduled,manual]).totals[0].enough===false)
  return failures
}
