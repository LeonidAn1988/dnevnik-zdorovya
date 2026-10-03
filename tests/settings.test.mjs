/**
 * Правила и подписи настроек.
 *
 * Настройки стали двухуровневыми, и одно решение теперь принимается на одном
 * подэкране, а сказывается на другом: сахар включается на «Нормах», а нижняя
 * строка и стартовый экран настраиваются на «Экране». Здесь проверяется, что
 * эти правила остались одним куском кода и согласованы между собой.
 */
import {
  visibleSections,
  lockedSection,
  toggleSection,
  setTrackGlucose,
  describeDisplay,
  describePeople,
  describeTargets,
  describeReminders,
  describeBackupRow,
  describePerson,
  describeSections,
  describeFamily,
  setTargets,
  setGlucoseTargets,
  targetsOf,
  glucoseTargetsOf,
} from './build/api.mjs'

const БАЗА = {
  sections: { overview: true, bp: true, glucose: true, intake: true, cabinet: true },
  trackGlucose: true,
  startTab: 'overview',
  theme: 'dark',
  density: 'normal',
  targetSys: 135,
  targetDia: 85,
  remindersOn: true,
  remindersRepeat: true,
  intakeTimes: { morning: '08:00', day: '13:00', evening: '19:00', night: '22:00' },
  people: [{ id: 'p1', name: 'Я', deviceUser: 1 }],
}

export function run() {
  let failures = 0
  const check = (name, condition, detail = '') => {
    if (condition) console.log(`  ok   ${name}`)
    else {
      console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`)
      failures++
    }
  }

  // ── видимые разделы ──────────────────────────────────────────────────────
  check('порядок разделов — как у вкладок', visibleSections(БАЗА).join(',') === 'overview,bp,glucose,intake,cabinet')
  check('сахар держится на своём переключателе, а не на галке раздела',
    visibleSections({ ...БАЗА, trackGlucose: false }).join(',') === 'overview,bp,intake,cabinet')
  check('сахар появляется даже при выключенной галке раздела',
    visibleSections({ ...БАЗА, sections: { ...БАЗА.sections, glucose: false } }).includes('glucose'))

  // ── последний раздел ─────────────────────────────────────────────────────
  const пс_один = { ...БАЗА, sections: { overview: false, bp: false, glucose: true, intake: true, cabinet: false } }
  check('последний раздел заперт', lockedSection(пс_один) === 'intake')
  check('когда разделов двое, ничего не заперто', lockedSection(БАЗА) === null)
  check('сахар последним разделом не считается',
    lockedSection({ ...БАЗА, sections: { overview: false, bp: false, glucose: true, intake: false, cabinet: true } }) === 'cabinet')

  // ── переключение разделов и стартовый экран ──────────────────────────────
  const пр_скрыли = toggleSection({ ...БАЗА, startTab: 'bp' }, 'bp', false)
  check('старт уходит с прячущегося раздела', пр_скрыли.startTab === 'overview', пр_скрыли.startTab)
  check('и сам раздел скрыт', пр_скрыли.sections.bp === false)
  const пр_чужой = toggleSection({ ...БАЗА, startTab: 'intake' }, 'bp', false)
  check('чужой стартовый экран не трогается', пр_чужой.startTab === 'intake')
  const пр_вернули = toggleSection({ ...БАЗА, sections: { ...БАЗА.sections, bp: false }, startTab: 'overview' }, 'bp', true)
  check('возврат раздела старт не двигает', пр_вернули.startTab === 'overview' && пр_вернули.sections.bp === true)

  // ── дневник сахара: одно решение ─────────────────────────────────────────
  const дс_выкл = setTrackGlucose({ ...БАЗА, startTab: 'glucose' }, false)
  check('выключенный сахар уводит стартовый экран', дс_выкл.startTab === 'overview', дс_выкл.startTab)
  check('и гасит галку раздела заодно', дс_выкл.sections.glucose === false && дс_выкл.trackGlucose === false)
  const дс_вкл = setTrackGlucose({ ...БАЗА, trackGlucose: false, sections: { ...БАЗА.sections, glucose: false } }, true)
  check('включение возвращает оба значения', дс_вкл.trackGlucose === true && дс_вкл.sections.glucose === true)
  const дс_только = setTrackGlucose(
    { sections: { overview: false, bp: false, glucose: true, intake: false, cabinet: true }, trackGlucose: true, startTab: 'glucose' },
    false,
  )
  check('без сахара стартом становится оставшийся раздел', дс_только.startTab === 'cabinet', дс_только.startTab)

  const чп_семья = {
    ...БАЗА,
    people: [{ id: 'p1', name: 'Я', deviceUser: 1 }, { id: 'p-dad', name: 'Отец', deviceUser: 2 }],
  }

  // ── личные цели ──────────────────────────────────────────────────────────
  const лц_семья = {
    ...БАЗА,
    glucoseFastingMax: 7,
    glucosePostMealMax: 10,
    glucoseLow: 3.9,
    people: [
      { id: 'p1', name: 'Я', deviceUser: 1 },
      { id: 'p-w', name: 'Жена', targets: { sys: 130, dia: 80 } },
    ],
  }
  check('своя цель берётся у того, у кого она есть', targetsOf(лц_семья.people[1], лц_семья).sys === 130)
  check('без своей цели берётся общая', targetsOf(лц_семья.people[0], лц_семья).sys === 135)
  check('без человека тоже общая', targetsOf(null, лц_семья).dia === 85)
  check('пороги сахара падают на общие', glucoseTargetsOf(лц_семья.people[0], лц_семья).fastingMax === 7)

  const лц_правка = setTargets(лц_семья, 'p-w', { sys: 125, dia: 75 })
  check('правка пишется человеку', лц_правка.people[1].targets.sys === 125)
  check('и в общие — ради старых сборок, читающих ту же копию', лц_правка.targetSys === 125 && лц_правка.targetDia === 75)
  check('чужому закрепили прежнюю цель, а не утащили за общей',
    лц_правка.people[0].targets.sys === 135 && лц_правка.people[0].targets.dia === 85)
  check('и после правки он читает своё, а не новое общее',
    targetsOf(лц_правка.people[0], { targetSys: лц_правка.targetSys, targetDia: лц_правка.targetDia }).sys === 135)
  const лц_один = setTargets({ ...БАЗА, people: [{ id: 'p1', name: 'Я' }] }, 'p1', { sys: 120, dia: 70 })
  check('при одном человеке личных целей не заводим', лц_один.targetSys === 120 && !лц_один.people)
  const лц_сахар = setGlucoseTargets(лц_семья, 'p-w', { fastingMax: 6, postMealMax: 8, low: 4 })
  check('пороги сахара тоже двойной записью', лц_сахар.people[1].glucose.fastingMax === 6 && лц_сахар.glucoseFastingMax === 6)
  check('и чужие пороги закреплены прежними', лц_сахар.people[0].glucose.fastingMax === 7)

  // ── подписи строк корня ──────────────────────────────────────────────────
  check('экран называет тему и размер текста',
    describeDisplay({ ...БАЗА, textScale: 'normal' }) === 'тёмная · текст обычный',
    describeDisplay({ ...БАЗА, textScale: 'normal' }))
  check('крупный текст виден в строке корня',
    describeDisplay({ ...БАЗА, textScale: 'xlarge' }) === 'тёмная · текст очень крупный')
  check('люди перечислены', describePeople(чп_семья.people) === 'Я, Отец')
  check('строка называет, что внутри — не только имена',
    describePeople([{ id: 'p1', name: 'Я' }], БАЗА.intakeTimes) === 'Я · настройки и часы приёма',
    describePeople([{ id: 'p1', name: 'Я' }], БАЗА.intakeTimes))
  check('и у семьи тоже', describePeople(чп_семья.people, БАЗА.intakeTimes) === 'Я, Отец · настройки и часы приёма')
  check('безымянный человек назван по месту', describePeople([{ id: 'p1', name: '  ' }]) === 'Человек 1')
  check('нормы', describeTargets(БАЗА) === 'давление 135/85 · сахар ведётся')
  check('нормы показывают цель выбранного человека',
    describeTargets(лц_семья, лц_семья.people[1]) === 'давление 130/80 · сахар ведётся')
  check('нормы без сахара', describeTargets({ ...БАЗА, trackGlucose: false }).endsWith('сахар не ведётся'))
  check('напоминания с повтором', describeReminders(БАЗА) === 'включены, повтор 3 раза', describeReminders(БАЗА))
  check('напоминания без повтора', describeReminders({ ...БАЗА, remindersRepeat: false }) === 'включены, без повтора')
  check('напоминания выключены', describeReminders({ ...БАЗА, remindersOn: false }) === 'выключены')
  check('измерения включены без лекарств', describeReminders({ ...БАЗА, remindersOn: false, measureRemindOn: true }) === 'измерения включены')
  check('оба вида напоминаний названы', describeReminders({ ...БАЗА, measureRemindOn: true }) === 'лекарства и измерения')

  const сейчас = Date.UTC(2026, 8, 2, 10, 30)
  check('копий ещё не было', describeBackupRow(null, сейчас) === 'копий ещё не было')
  check('вчерашняя копия', describeBackupRow(сейчас - 86400000, сейчас) === 'последняя вчера', describeBackupRow(сейчас - 86400000, сейчас))

  check('человек с кнопкой прибора',
    describePerson({ id: 'p-dad', name: 'Отец', deviceUser: 2, intakeTimes: { morning: '09:00', day: '13:00', evening: '18:00', night: '21:30' } }, БАЗА.intakeTimes)
      === 'кнопка 2 · часы 09:00–21:30')
  check('человек без кнопки прибора',
    describePerson({ id: 'p-k', name: 'Ребёнок' }, БАЗА.intakeTimes).startsWith('без кнопки прибора'))

  check('семья не настроена', describeFamily(0, true) === 'обмен не настроен')
  check('семья из трёх телефонов', describeFamily(2, true) === 'телефонов: 3')
  check('без облака и файлов — не настроен', describeFamily(0, false) === 'обмен не настроен')
  check('подключённый Диск и есть настроенный обмен', describeFamily(0, true, true, true) === 'через Яндекс.Диск')
  check('Диск и файлы вместе', describeFamily(2, true, true, true) === 'Яндекс.Диск и файлов: 2')

  check('скрытого нет', describeSections(БАЗА) === 'показаны все')
  check('скрыт один', describeSections({ sections: { ...БАЗА.sections, overview: false } }) === 'скрыт раздел «Обзор»')
  check('скрыто несколько',
    describeSections({ sections: { ...БАЗА.sections, overview: false, bp: false } }) === 'скрыто 2 раздела')

  return failures
}
