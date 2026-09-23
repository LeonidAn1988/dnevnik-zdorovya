/**
 * Объединение двух людей в одного.
 *
 * Понадобилось, когда в дневнике владельца оказалось двое «Я». Цена ошибки
 * здесь необратима — записи перепривязываются и человек уходит из списка, —
 * поэтому проверяется не только счастливый путь, но и всё, что при наивном
 * удалении теряется молча: измерения без поля `person`, коробки, кнопка
 * прибора, личные настройки и цепочки из нескольких объединений.
 */
import { mergePeople, readingOwnerId, collapsePersonal, redirectPerson, mergeDiary, mergeRestoredSettings } from './build/api.mjs'

const измерение = (f) => ({ kind: 'bp', id: f.id, ts: f.ts, sys: 120, dia: 80, bpm: 70, ihb: false, mov: false, user: f.user ?? 1, source: 'device', ...f })
const коробка = (f) => ({ id: f.id, name: f.name ?? 'Проба', dose: '', left: null, expires: null, ...f })
const курс = (f) => ({ id: f.id, medicineId: f.medicineId ?? 'k0', person: f.person, ...f })
const анализ = (f) => ({ id: f.id, name: f.name ?? 'ТТГ', owner: f.owner, results: [], ...f })

const itogЛюди = (r) => r.settings.people.map((p) => p.id)
const lёняКнопка = (p) => p?.deviceUser ?? null

export function run() {
  let failures = 0
  const check = (name, condition, detail = '') => {
    if (condition) console.log(`  ok   ${name}`)
    else {
      console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`)
      failures++
    }
  }

  const настройки = {
    people: [
      { id: 'a', name: 'Я', deviceUser: 1, targets: { sys: 130, dia: 80 } },
      { id: 'b', name: 'Я', deviceUser: 2, intakeTimes: { morning: '09:00', day: '13:00', evening: '19:00', night: '22:00' } },
      { id: 'c', name: 'Жена' },
    ],
    activePerson: 'b',
  }
  const измерения = [
    измерение({ id: 'm1', ts: 1, person: 'a' }),
    измерение({ id: 'm2', ts: 2, person: 'b' }),
    // Без `person`: такая запись ходит за кнопкой прибора, и кнопка 2 — у «b».
    измерение({ id: 'm3', ts: 3, user: 2 }),
    измерение({ id: 'm4', ts: 4, person: 'c' }),
  ]
  const курсы = [курс({ id: 'r1', person: 'b' }), курс({ id: 'r2', person: 'a' }), курс({ id: 'r3', person: 'c' })]

  const слито = mergePeople(настройки, измерения, курсы, [], { loser: 'b', winner: 'a' })
  check('слияние состоялось', слито !== null)

  check('проигравший ушёл из списка', !слито.settings.people.some((p) => p.id === 'b'))
  check('остальные на месте', слито.settings.people.map((p) => p.id).join() === 'a,c')

  // Главное: запись без поля `person`, ходившая за кнопкой проигравшего.
  const переписаны = слито.measurements.map((m) => m.id).sort().join()
  check('переписаны записи проигравшего и безымянные', переписаны === 'm2,m3', переписаны)
  check('все переписанные достались выжившему', слито.measurements.every((m) => m.person === 'a'))
  check('чужие записи не тронуты', !слито.measurements.some((m) => m.id === 'm4'))
  check('записи выжившего не переписываются зря', !слито.measurements.some((m) => m.id === 'm1'))

  check('курс проигравшего перешёл', слито.regimens.length === 1 && слито.regimens[0].id === 'r1' && слито.regimens[0].person === 'a')
  check('и курс выжившего не переписан зря', !слито.regimens.some((r) => r.id === 'r2'))

  const выживший = слито.settings.people.find((p) => p.id === 'a')
  check('кнопка прибора осталась своя', выживший.deviceUser === 1)
  check('вторая кнопка освободилась, и об этом сказано', слито.report.freedDeviceUser === 2)
  check('пустое личное дописано от проигравшего', выживший.intakeTimes?.morning === '09:00')
  check('заполненное личное не заменено', выживший.targets.sys === 130)
  check('и об этом сказано в отчёте', слито.report.tookPersonal === true)
  check('выбранным стал выживший', слито.settings.activePerson === 'a')
  check('счётчики отчёта верны', слито.report.measurements === 2 && слито.report.regimens === 1)

  check('карта ведёт от проигравшего к выжившему', слито.settings.mergedPeople.b === 'a')

  // ── записи проигравшего можно не переносить, а стереть ───────────────────
  //
  // Случай из жизни: прибор дали проверить отцу, три десятка его замеров легли
  // на лишнего человека. Перенести их к себе — испортить свою историю чужими
  // числами; вычистить руками нечем — удаление у записи поштучное, а «Удалить
  // все измерения» сносит и чужие.
  {
    const снос = mergePeople(настройки, измерения, курсы, [], { loser: 'b', winner: 'a' }, { dropMeasurements: true })
    // m2 — явно на «b», m3 — без пометки, но на кнопке 2, то есть тоже его.
    check('записи проигравшего ушли под снос', снос.removed.slice().sort().join() === 'm2,m3', снос.removed.join())
    check('и это названо в отчёте', снос.report.removed === 2, String(снос.report.removed))
    check('ничего из них не переносится', !снос.measurements.some((m) => снос.removed.includes(m.id)))
    check('чужая запись не тронута', !снос.removed.includes('m4'))
    check('своя запись выжившего тоже цела', !снос.removed.includes('m1'))

    // Курсы и анализы — не записи: их сносить никто не просил.
    check('курс проигравшего всё равно переехал', снос.regimens.some((r) => r.id === 'r1' && r.person === 'a'))

    // Без флага поведение прежнее — это главная защита от случайного сноса.
    check('по умолчанию ничего не стирается', слито.removed.length === 0 && слито.report.removed === 0)
    check('и записи по-прежнему переносятся', слито.measurements.length > 0)
  }

  // ── анализы ─────────────────────────────────────────────────────────────
  //
  // Их здесь однажды уже забыли: удаление человека анализы переносило, а
  // слияние — нет, и после объединения анализ оставался с мёртвым владельцем.
  // Не падает ничего: он просто исчезает с экрана вместе со снимками бланков,
  // и заметить это можно только хватившись конкретного анализа.
  {
    const анализы = [
      анализ({ id: 'l1', owner: 'b', name: 'ТТГ' }),
      анализ({ id: 'l2', owner: 'a', name: 'Гликированный' }),
      анализ({ id: 'l3', owner: 'c', name: 'Холестерин' }),
    ]
    const сЛабами = mergePeople(настройки, [], [], анализы, { loser: 'b', winner: 'a' })
    check('анализ проигравшего переехал к выжившему', сЛабами.labs.length === 1 && сЛабами.labs[0].id === 'l1' && сЛабами.labs[0].owner === 'a')
    check('чужой анализ не тронут', !сЛабами.labs.some((t) => t.id === 'l3'))
    check('свой анализ переписывать незачем', !сЛабами.labs.some((t) => t.id === 'l2'))
    check('и это названо в отчёте', сЛабами.report.labs === 1, String(сЛабами.report.labs))

    // После слияния у всех анализов обязан быть живой владелец: если хоть один
    // указывает на человека, которого нет в списке, — он пропал.
    const послеСлияния = анализы.map((t) => сЛабами.labs.find((n) => n.id === t.id) ?? t)
    const живые = new Set(сЛабами.settings.people.map((p) => p.id))
    check('ни один анализ не остался без хозяина', послеСлияния.every((t) => живые.has(t.owner)), JSON.stringify(послеСлияния.map((t) => t.owner)))
  }

  // ── цепочка: объединили дважды ──────────────────────────────────────────
  {
    const шаг2 = mergePeople(
      { people: слито.settings.people, activePerson: 'a', mergedPeople: слито.settings.mergedPeople },
      [], [], [], { loser: 'a', winner: 'c' },
    )
    check('хвост перецеплен: b ведёт к c, а не к мёртвому a', шаг2.settings.mergedPeople.b === 'c', JSON.stringify(шаг2.settings.mergedPeople))
    check('и сам a тоже ведёт к c', шаг2.settings.mergedPeople.a === 'c')
  }

  // ── чего делать нельзя ──────────────────────────────────────────────────
  check('сам с собой не объединяется', mergePeople(настройки, [], [], [], { loser: 'a', winner: 'a' }) === null)
  check('несуществующий не объединяется', mergePeople(настройки, [], [], [], { loser: 'нет', winner: 'a' }) === null)

  // ── когда остался один: личное переезжает в общее ───────────────────────
  {
    const двое = {
      people: [
        { id: 'x', name: 'Я', targets: { sys: 125, dia: 75 }, intakeSlots: [{ id: 'morning', title: 'Утром', time: '07:00' }] },
        { id: 'y', name: 'Я' },
      ],
      activePerson: 'x',
    }
    const один = mergePeople(двое, [], [], [], { loser: 'y', winner: 'x' })
    check('после схлопывания остался один', один.settings.people.length === 1)
    check('цель переехала в общие настройки', один.settings.targetSys === 125 && один.settings.targetDia === 75)
    check('кнопки приёма переехали в общие', один.settings.intakeSlots?.[0]?.time === '07:00')
    // Ради этого всё и делается: запись личного при одном человеке уходит в
    // общее, а чтение — из человека. Личное обязано быть снято.
    check('личное снято с человека, иначе правка норм перестала бы действовать', один.settings.people[0].targets === undefined)
    check('и кнопки тоже сняты', один.settings.people[0].intakeSlots === undefined)
  }
  check('при двоих ничего не схлопывается', collapsePersonal({ people: [{ id: 'x', name: 'A', targets: { sys: 1, dia: 2 } }, { id: 'y', name: 'B' }] }).targetSys === undefined)

  // ── перенаправление ─────────────────────────────────────────────────────
  check('знакомый ведёт по карте', redirectPerson('b', { b: 'a' }) === 'a')
  check('незнакомый ведёт сам к себе', redirectPerson('z', { b: 'a' }) === 'z')
  check('пустой остаётся пустым', redirectPerson(undefined, { b: 'a' }) === null)
  check('без карты ничего не меняется', redirectPerson('b', undefined) === 'b')

  // ── чего бы стоило наивное удаление ─────────────────────────────────────
  // Не проверка кода, а закрепление причины: курс с мёртвым человеком не
  // достаётся никому — ни в аптечке, ни на экране приёма он не показывается.
  check(
    'курс с мёртвым человеком не виден никому',
    mergePeople(настройки, [], [курс({ id: 'r9', person: 'призрак' })], [], { loser: 'b', winner: 'a' }).regimens.length === 0,
  )

  // ── объединённый не возвращается ────────────────────────────────────────
  // Без этого слияние отменялось первой же синхронизацией: люди при обмене
  // только добавляются, а записи с мёртвым идентификатором невидимы у всех.
  {
    const карта = { b: 'a' }
    const своё = { measurements: [], medicines: [], regimens: [], labs: [], tombstones: [], people: [{ id: 'a', name: 'Я' }] }
    const чужое = {
      measurements: [измерение({ id: 'm9', ts: 9, person: 'b' })],
      medicines: [коробка({ id: 'k9' })],
      regimens: [курс({ id: 'r9', medicineId: 'k9', person: 'b' })],
      tombstones: [],
      people: [{ id: 'a', name: 'Я' }, { id: 'b', name: 'Я' }],
    }

    const без = mergeDiary(своё, чужое)
    check('без карты объединённый возвращается — так и было', без.people.some((p) => p.id === 'b'))

    const с = mergeDiary(своё, чужое, карта)
    check('с картой он не возвращается', !с.people.some((p) => p.id === 'b'), JSON.stringify(с.people.map((p) => p.id)))
    check('его измерение перецеплено на выжившего', с.measurements[0]?.person === 'a', с.measurements[0]?.person)
    check('и курс тоже', с.regimens[0]?.person === 'a', с.regimens[0]?.person)
  }

  // ── вчерашняя копия не возвращает дубля ─────────────────────────────────
  {
    const местные = { people: [{ id: 'a', name: 'Я' }], activePerson: 'a', mergedPeople: { b: 'a' } }
    const изКопии = { people: [{ id: 'a', name: 'Я' }, { id: 'b', name: 'Я' }], activePerson: 'b' }
    const после = mergeRestoredSettings(местные, изКопии)
    check('копия, снятая до объединения, дубля не возвращает', !после.people.some((p) => p.id === 'b'), JSON.stringify(после.people.map((p) => p.id)))
    check('и выбранный из копии перецеплен', после.activePerson === 'a', после.activePerson)
  }

  // ── трое на одной кнопке: так лежит настоящий дневник владельца ─────────
  {
    // До 0.25.0 каждый запуск штамповал нового «Я» с той же кнопкой. В дневнике
    // владельца на первой кнопке оказались трое, и записи без пометки видны у
    // всех троих, хотя владелец у них один — первый в списке.
    const трое = {
      people: [
        { id: 'я1', name: 'Я', deviceUser: 1 },
        { id: 'лёня', name: 'Леонид', deviceUser: 1 },
        { id: 'я2', name: 'Я', deviceUser: 1 },
      ],
      activePerson: 'я1',
    }
    const безПометки = [измерение({ id: 'т1', ts: 1, user: 1 }), измерение({ id: 'т2', ts: 2, user: 1 })]
    check('владелец записи без пометки — первый с этой кнопкой', readingOwnerId(трое.people, безПометки[0]) === 'я1')
    check('пометка на несуществующего человека владельца не даёт', readingOwnerId(трое.people, { person: 'нет', user: 1 }) === null)

    const итог = mergePeople(трое, безПометки, [], [], { loser: 'я2', winner: 'я1' }, 1000)
    check('двух «Я» на одной кнопке сводит', itogЛюди(итог).join(',') === 'я1,лёня', itogЛюди(итог).join(','))
    check('кнопка у выжившего осталась первой', итог.settings.people[0].deviceUser === 1)
    check('обе записи закреплены за выжившим явно', итог.measurements.length === 2 && итог.measurements.every((m) => m.person === 'я1'))

    // Третий с той же кнопкой их больше не показывает — ради этого в
    // предупреждении и появилась строка про «оттуда пропадут». Считать надо по
    // всему дневнику после правок, а не по одному списку изменённых: он пуст,
    // когда переписывать перестали, и проверка «пропали» прошла бы вхолостую.
    const правки = new Map(итог.measurements.map((m) => [m.id, m]))
    const весьДневник = безПометки.map((m) => правки.get(m.id) ?? m)
    const лёня = итог.settings.people.find((x) => x.id === 'лёня')
    const видноУЛёни = весьДневник.filter((m) => (m.person ? m.person === 'лёня' : lёняКнопка(лёня) === m.user))
    check('у третьего на той же кнопке они пропали', видноУЛёни.length === 0, String(видноУЛёни.length))
    check('а у выжившего показываются все', весьДневник.filter((m) => m.person === 'я1').length === 2)
  }

  return failures
}
