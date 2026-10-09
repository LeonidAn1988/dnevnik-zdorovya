/**
 * Курс приёма отдельно от коробки.
 *
 * Разделение вводилось ради трёх вещей, и каждая проверяется здесь:
 * домашняя аптечка без владельца, одна упаковка на двоих и курс, который
 * кончается. Последнее чинит давний дефект: препарат с законченным курсом
 * вечно числился кончающимся и не уходил из списка покупок.
 */
import {
  dosing,
  dosings,
  regimensFor,
  repeatRegimen,
  mergeRegimen,
  orphanRegimens,
  regimenFinished,
  daysLeftOf,
  endsAfter,
  lengthOf,
  describeEnd,
  splitBox,
  needsSplit,
  regimenIdFor,
  supplyDays,
  perDayOf,
  medicineAlert,
  needUntilEnd,
  enoughForCourse,
  displayAlert,
  projectedLeft,
  restockList,
  stockOf,
  dosesOn,
  buildReminders,
} from './build/api.mjs'

const ДЕНЬ = 24 * 60 * 60 * 1000
const старт = new Date(2026, 8, 1).setHours(0, 0, 0, 0)
/**
 * Сдвиг на календарные сутки, а не на 86 400 000 мс.
 *
 * В ночь перевода часов между двумя полуночами 23 часа или 25, и фикстура на
 * миллисекундах уезжает на соседний день. Проверка тогда падает в Сантьяго или
 * Сиднее — на коде, который как раз считает правильно.
 */
const день = (n) => {
  const d = new Date(старт)
  d.setDate(d.getDate() + n)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const коробка = (f) => ({ id: 'k1', name: 'Метформин', dose: '850 мг', left: null, expires: null, ...f })
const курс = (f) => ({ id: 'r1', medicineId: 'k1', person: 'p1', ...f })

export function run() {
  let failures = 0
  const check = (name, condition, detail = '') => {
    if (condition) console.log(`  ok   ${name}`)
    else {
      console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`)
      failures++
    }
  }

  // ── совмещение ───────────────────────────────────────────────────────────
  const пара = dosing(коробка({ form: 'Таблетки' }), курс({ times: ['08:00'] }))
  check('у совмещённого два идентификатора, а общего нет', пара.boxId === 'k1' && пара.regimenId === 'r1' && пара.id === undefined)
  check('поля обоих на месте', пара.name === 'Метформин' && пара.times.join() === '08:00' && пара.person === 'p1')

  const своё = dosings([коробка({}), коробка({ id: 'k2' })], [курс({}), курс({ id: 'r2', medicineId: 'k2' })])
  check('совмещаются все пары', своё.length === 2)
  check('курс без коробки в пару не идёт', dosings([коробка({})], [курс({ id: 'r9', medicineId: 'нет' })]).length === 0)
  check('и находится как осиротевший', orphanRegimens([коробка({})], [курс({ id: 'r9', medicineId: 'нет' })]).length === 1)
  check('курсы одной коробки собираются вместе', regimensFor([курс({}), курс({ id: 'r2', medicineId: 'k2' })], 'k1').length === 1)

  // ── длина курса ──────────────────────────────────────────────────────────
  // «Курс десять дней» — это сегодня плюс девять: день начала считается
  // первым, ровно так его и называет врач.
  check('курс на десять дней кончается на девятый', endsAfter(старт, 10) === день(9))
  check('длина считается обратно', lengthOf(старт, день(9)) === 10)
  check('курс на один день кончается сегодня', endsAfter(старт, 1) === старт)

  const десятидневный = курс({ since: старт, endsAt: endsAfter(старт, 10), times: ['08:00'] })
  check('в первый день курс не окончен', !regimenFinished(десятидневный, старт))
  check('в последний день ещё не окончен', !regimenFinished(десятидневный, день(9)))
  check('на следующий — окончен', regimenFinished(десятидневный, день(10)))
  check('курс без конца не кончается никогда', !regimenFinished(курс({}), день(3650)))
  check('осталось дней считается со включением сегодняшнего', daysLeftOf(десятидневный, старт) === 10)
  check('в последний день остался один', daysLeftOf(десятидневный, день(9)) === 1)
  check('у курса без конца остатка дней нет', daysLeftOf(курс({}), старт) === null)
  check('словами: сегодня последний', describeEnd(десятидневный, день(9)) === 'Сегодня последний день курса')
  check('словами: завтра последний', describeEnd(десятидневный, день(8)) === 'Завтра последний день курса')
  check('у курса без конца слов нет', describeEnd(курс({}), старт) === null)

  // ── законченный курс молчит ──────────────────────────────────────────────
  // Тот самый дефект: схема кончилась, а телефон две недели звал принять
  // отменённое и держал коробку в списке покупок.
  const кончился = dosing(коробка({ left: 20, leftAt: старт }), десятидневный)
  check('в приёмный день приёмы есть', dosesOn(десятидневный, старт, старт).length === 1)
  check('после конца курса приёмов нет', dosesOn(десятидневный, день(10), день(10)).length === 0)
  check('расход законченного курса — ноль', perDayOf(кончился, день(10)) === 0)
  check('и запас по нему не считается', supplyDays(коробка({ left: 20, leftAt: старт }), [кончился], день(10)) === null)

  const банка = коробка({ left: 2, leftAt: старт })
  check(
    'законченный курс не просит купить ещё',
    medicineAlert(банка, [dosing(банка, десятидневный)], день(10)) === null,
    JSON.stringify(medicineAlert(банка, [dosing(банка, десятидневный)], день(10))),
  )
  check(
    'а пока курс идёт — просит',
    medicineAlert(банка, [dosing(банка, десятидневный)], день(1))?.kind === 'low',
  )
  // Коробка при этом из аптечки не пропадает: список строится из самих
  // коробок, а не из предупреждений.
  const полка = stockOf([банка], [dosing(банка, десятидневный)])
  check('коробка остаётся в аптечке и после конца курса', полка.length === 1 && полка[0].box.id === 'k1')
  check('и в список покупок не попадает', restockList(полка, день(10)).length === 0)

  // ── хватает до конца курса — в аптеку не зовём ───────────────────────────
  // Владелец просил прямо: «после этого не напоминать о приёме и не пугать,
  // что заканчивается». Десять таблеток — это мало на месяц и с избытком на
  // оставшиеся три дня назначения.
  // Пять таблеток — это пять дней, то есть меньше недельного порога: по
  // месячной мерке «пора покупать». Но курс идёт три дня, и этого с избытком.
  // Фикстура подобрана именно так: с запасом на десять дней тревоги не было бы
  // и без всякой проверки, и она бы ничего не проверяла.
  const трёхдневный = курс({ since: старт, endsAt: endsAfter(старт, 3), times: ['08:00'] })
  const пачка = коробка({ left: 5, leftAt: старт })
  const пара3 = dosing(пачка, трёхдневный)
  check('без конца курса пять таблеток — повод идти в аптеку',
    medicineAlert(пачка, [dosing(пачка, курс({ times: ['08:00'], since: старт }))], старт)?.kind === 'low')
  check('нужно ровно на оставшиеся дни', needUntilEnd([пара3], старт) === 3, String(needUntilEnd([пара3], старт)))
  check('пяти таблеток на три дня хватает', enoughForCourse(пачка, [пара3], старт))
  check('и в аптеку не зовём', medicineAlert(пачка, [пара3], старт) === null, JSON.stringify(medicineAlert(пачка, [пара3], старт)))
  check('и полосу запаса не рисуем', displayAlert(пачка, [пара3], старт).showSupply === false)
  const мало = коробка({ left: 2, leftAt: старт })
  check('а если не хватает даже на курс — зовём', medicineAlert(мало, [dosing(мало, трёхдневный)], старт)?.kind === 'low')
  check(
    'у бессрочного курса счёта «до конца» нет',
    needUntilEnd([dosing(пачка, курс({ times: ['08:00'], since: старт }))], старт) === null,
  )

  // «Хватит до конца курса» про законченный курс — бессмыслица: курса уже нет.
  // Замечено на приборе: у отменённого препарата стояла именно эта строка.
  check(
    'у законченного курса «хватит до конца» не пишем',
    !enoughForCourse(банка, [dosing(банка, десятидневный)], день(10)),
  )
  check('и полосы запаса тоже нет', displayAlert(банка, [dosing(банка, десятидневный)], день(10)).showSupply === false)

  // Срок годности законченный курс не отменяет: просроченная пачка в тумбочке
  // — факт о коробке, а не о назначении.
  const просрочен = коробка({ left: 2, leftAt: старт, expires: день(-1) })
  check(
    'просроченная коробка говорит об этом и при законченном курсе',
    medicineAlert(просрочен, [dosing(просрочен, десятидневный)], день(10))?.kind === 'expired',
  )

  // Напоминания после конца курса не ставятся вовсе.
  const набор = buildReminders([кончился], день(10), { repeat: false, horizonDays: 5 })
  check('после конца курса напоминаний нет', набор.length === 0, String(набор.length))
  const наборДо = buildReminders([dosing(коробка({ left: 20 }), десятидневный)], старт, { repeat: false, horizonDays: 3 })
  check('а до конца — есть', наборДо.length === 3, String(наборДо.length))

  // ── одна упаковка на двоих ───────────────────────────────────────────────
  // Случай, которого до разделения не существовало вовсе: коробка была у
  // одного человека, и второй мог только завести себе такую же.
  const общая = коробка({ left: 60, leftAt: старт })
  const двое = [
    dosing(общая, курс({ id: 'r-a', person: 'p1', times: ['08:00'], since: старт })),
    dosing(общая, курс({ id: 'r-b', person: 'p2', times: ['08:00'], since: старт })),
  ]
  check('расход складывается по обоим', supplyDays(общая, двое, старт) === 30, String(supplyDays(общая, двое, старт)))
  check('одному хватило бы вдвое дольше', supplyDays(общая, [двое[0]], старт) === 60)
  check(
    'за десять дней вдвоём ушло двадцать',
    projectedLeft(общая, двое, день(10)) === 40,
    String(projectedLeft(общая, двое, день(10))),
  )

  // A repetition never extends the old ledger across a treatment gap.
  const old = курс({ since: день(0), startedAt: день(0), planFrom: день(0), endsAt: день(2),
    times: ['08:00'], perTime: 1, autoDeduct: true, meal: 'before', mealMinutes: 20,
    taken: [день(0) + 8 * 3600000], untaken: [день(1)], intakeState: { old: { at: 10, taken: true } },
    history: { old: { planned: 2, taken: 1 } }, historyState: { version: 1, legacy: {}, planned: {} },
    foldedUntil: день(1), stoppedAt: день(3), scheduleUpdatedAt: 8, bindingUpdatedAt: 9, updatedAt: 10,
  })
  const beforeRepeat = JSON.stringify(old)
  const repeated = { ...repeatRegimen(old, день(9)), id: 'r-repeat' }
  check('повтор сохраняет дозу, еду и человека', repeated.perTime === 1 && repeated.mealMinutes === 20 && repeated.person === old.person)
  check('повтор трёх дней — с нового начала', repeated.planFrom === день(9) && repeated.endsAt === день(11))
  check('у повтора нет истории, остановки и старых версий', ['taken', 'untaken', 'intakeState', 'history', 'historyState', 'foldedUntil', 'stoppedAt', 'scheduleUpdatedAt', 'bindingUpdatedAt', 'updatedAt'].every(key => !Object.hasOwn(repeated, key)))
  check('старый курс не изменён', JSON.stringify(old) === beforeRepeat)
  const gapBox = коробка({ left: 100, leftAt: день(2) + 23 * 3600000 })
  const gapCourses = [dosing(gapBox, old), dosing(gapBox, repeated)]
  check('за перерыв остаток не убывает', projectedLeft(gapBox, gapCourses, день(9) + 7 * 3600000) === 100)
  check('в перерыве нет приёмов', gapCourses.every(r => dosesOn(r, день(5)).length === 0))
  check('повтор начинает расход в первый день', projectedLeft(gapBox, gapCourses, день(9) + 9 * 3600000) === 99)
  const other = курс({ id: 'other', since: день(9), planFrom: день(9), times: ['08:00'], perTime: 2, autoDeduct: true })
  check('повтор и другой курс учитывают общий запас', projectedLeft(gapBox, [...gapCourses, dosing(gapBox, other)], день(9) + 9 * 3600000) === 97)
  const mergedOld = mergeRegimen(old, { ...old, updatedAt: 100 })
  check('обмен старого курса не останавливает новый', mergedOld.stoppedAt === old.stoppedAt && !regimenFinished(repeated, день(9)))
  const staged = repeatRegimen(курс({ planFrom: день(0), plan: [{ days: 14, perTime: 1, times: ['08:00', '20:00'] }, { days: 30, perTime: 1, times: ['08:00'] }], rhythm: { onDays: 2, offDays: 1, from: день(0) } }), день(9))
  check('этапы повторяются с первого и новый ритм с начала', staged.plan[0].times.length === 2 && staged.plan[1].days === 30 && staged.rhythm.from === день(9))
  const emptyWeekdays = repeatRegimen(курс({ rhythm: { weekdays: [], onDays: 1, offDays: 1, from: день(0) } }), день(9))
  check('пустые дни недели не стирают цикл', emptyWeekdays.rhythm.onDays === 1 && emptyWeekdays.rhythm.offDays === 1 && emptyWeekdays.rhythm.from === день(9))
  const weekdays = repeatRegimen(курс({ rhythm: { weekdays: [1, 4] } }), день(9))
  check('дни недели повтора сохранены', weekdays.rhythm.weekdays.join() === '1,4')
  const unknown = repeatRegimen(курс({ endsAt: день(2) }), день(9))
  check('неизвестная длина не становится бессрочной', unknown.endsAt !== undefined && unknown.endsAt < unknown.planFrom)

  // ── разбор коробки старого образца ───────────────────────────────────────
  const старая = {
    id: 'k-old', name: 'Конкор', dose: '5 мг', left: 10, expires: null,
    owner: 'p-dad', times: ['08:00'], perTime: 1, taken: [1, 2], updatedAt: 99,
  }
  check('старую коробку видно по полям', needsSplit(старая))
  check('новую — нет', !needsSplit(коробка({})))
  const { box, regimen } = splitBox(старая, null)
  check('коробка очищена от приёма', box.times === undefined && box.taken === undefined && box.owner === undefined)
  check('а её собственное цело', box.name === 'Конкор' && box.left === 10)
  check('курс получил человека из владельца', regimen.person === 'p-dad')
  check('и всё про приём', regimen.times.join() === '08:00' && regimen.taken.join() === '1,2')
  check('идентификатор выведен из коробки', regimen.id === regimenIdFor('k-old'))
  check('время правки унаследовано', regimen.updatedAt === 99)

  const безВладельца = splitBox({ id: 'k-n', name: 'X', dose: '', left: null, expires: null, times: ['09:00'] }, 'p-первый')
  check('без владельца человек берётся из подсказки', безВладельца.regimen.person === 'p-первый')
  const безНичего = splitBox({ id: 'k-e', name: 'X', dose: '', left: null, expires: null }, 'p1')
  check('коробке без единого следа приёма курс не выдумывается', безНичего.regimen === null)

  return failures
}
