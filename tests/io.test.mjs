/** Круговой рейс экспорта-импорта и чтение чужих форматов. */
import {
  FULL_MEDICINE,
  FULL_REGIMEN,
  mergeRestoredSettings, takesPersonalFrom, fillMissingFromCopy, toCsv, toJson, parseCsv, parseJson, parseImportFile,
  peerIsOutdated } from './build/api.mjs'

export function run() {
  let failures = 0
  const check = (name, condition, detail = '') => {
    if (condition) console.log(`  ok   ${name}`)
    else {
      console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`)
      failures++
    }
  }

  const sample = [
    { kind: 'bp', id: 'd1-1', ts: new Date(2026, 7, 10, 7, 5, 0).getTime(), sys: 128, dia: 82, bpm: 71, ihb: true, mov: false, user: 1, source: 'device' },
    {
      kind: 'bp',
      id: 'm-2',
      ts: new Date(2026, 7, 10, 21, 40, 0).getTime(),
      sys: 119, dia: 74, bpm: null, ihb: false, mov: true, user: 1, source: 'manual',
      note: 'после прогулки, "спокойно"; сидя',
    },
    { kind: 'bp', id: 'd2-3', ts: new Date(2026, 7, 9, 13, 0, 0).getTime(), sys: 145, dia: 95, bpm: 88, ihb: false, mov: false, user: 2, source: 'device' },
  ]

  const back = parseCsv(toCsv(sample))
  check('CSV: разобрались все строки', back.measurements.length === 3, `получено ${back.measurements.length}`)
  check('CSV: нечитаемых строк нет', back.skipped === 0)
  for (const original of sample) {
    const restored = back.measurements.find((r) => r.ts === original.ts && r.user === original.user)
    if (!restored) {
      check(`CSV: запись ${original.sys}/${original.dia} восстановлена`, false)
      continue
    }
    check(
      `CSV: запись ${original.sys}/${original.dia} восстановлена без потерь`,
      restored.sys === original.sys &&
        restored.dia === original.dia &&
        restored.bpm === original.bpm &&
        restored.ihb === original.ihb &&
        restored.mov === original.mov &&
        (restored.note ?? undefined) === original.note,
      JSON.stringify(restored),
    )
  }

  const json = parseJson(toJson(sample))
  check('JSON: все записи на месте', json.measurements.length === 3)
  check('JSON: идентификаторы сохранены', json.measurements.every((r, i) => r.id === sample[i].id))

  const omblepyCsv = 'datetime,dia,sys,bpm,mov,ihb\n2026-08-10 07:05:00,82,128,71,0,1\n2026-08-09 13:00:00,95,145,88,0,0\n'
  const fromOmblepy = parseCsv(omblepyCsv)
  check('omblepy user1.csv: две записи', fromOmblepy.measurements.length === 2)
  check(
    'omblepy user1.csv: sys и dia не перепутаны (в файле обратный порядок)',
    fromOmblepy.measurements[0].sys === 128 && fromOmblepy.measurements[0].dia === 82,
    JSON.stringify(fromOmblepy.measurements[0]),
  )
  check('omblepy user1.csv: отметка аритмии прочитана', fromOmblepy.measurements[0].ihb === true)

  const ubpm = JSON.stringify({
    UBPM: {
      U1: [{ date: '10.08.2026', time: '07:05:00', msg: '', sys: 128, dia: 82, bpm: 71, ihb: 1, mov: 0 }],
      U2: [{ date: '09.08.2026', time: '13:00:00', msg: 'проба', sys: 145, dia: 95, bpm: 88, ihb: 0, mov: 0 }],
    },
  })
  const fromUbpm = parseImportFile('ubpm.json', ubpm)
  check('ubpm.json: обе учётные записи', fromUbpm.measurements.length === 2)
  check('ubpm.json: пользователь 2 распознан', fromUbpm.measurements.some((r) => r.user === 2 && r.sys === 145))
  const first = new Date(fromUbpm.measurements[0].ts)
  check('ubpm.json: дата ДД.ММ.ГГГГ разобрана', first.getFullYear() === 2026 && first.getMonth() === 7 && first.getDate() === 10)

  const ru = 'Дата;Время;Систолическое;Диастолическое;Пульс;Примечание\n10.08.2026;07:05;128;82;71;утро\n09.08.2026;21:30;119;74;;вечер\n'
  const fromRu = parseCsv(ru)
  check('CSV с русскими заголовками и «;»: две записи', fromRu.measurements.length === 2, JSON.stringify(fromRu))
  check('CSV с русскими заголовками: значения на местах', fromRu.measurements[0].sys === 128 && fromRu.measurements[0].dia === 82)
  check('CSV с русскими заголовками: пустой пульс стал null', fromRu.measurements[1].bpm === null)
  check('CSV с русскими заголовками: примечание прочитано', fromRu.measurements[0].note === 'утро')

  const dirty = 'datetime,sys,dia\n2026-08-10 07:05:00,128,82\nне дата,abc,def\n,,\n'
  const fromDirty = parseCsv(dirty)
  check('мусорные строки не ломают импорт', fromDirty.measurements.length === 1)
  check('мусорные строки посчитаны пропущенными', fromDirty.skipped === 2, `skipped=${fromDirty.skipped}`)

  // ── сахар ────────────────────────────────────────────────────────────────

  const mixed = [
    ...sample,
    { kind: 'glucose', id: 'g1-1', ts: new Date(2026, 7, 10, 7, 10, 0).getTime(), mmol: 6.2, context: 'fasting', user: 1, source: 'manual' },
    { kind: 'glucose', id: 'g1-2', ts: new Date(2026, 7, 10, 14, 0, 0).getTime(), mmol: 9.4, context: 'after-meal', user: 1, source: 'manual', note: 'плотный обед' },
  ]

  const mixedBack = parseCsv(toCsv(mixed))
  check('CSV: давление и сахар в одном файле', mixedBack.measurements.length === 5, `получено ${mixedBack.measurements.length}`)
  const glucoseRows = mixedBack.measurements.filter((m) => m.kind === 'glucose')
  check('CSV: сахар отличён от давления', glucoseRows.length === 2)
  check(
    'CSV: значение и момент замера восстановлены',
    glucoseRows.some((g) => g.mmol === 6.2 && g.context === 'fasting') &&
      glucoseRows.some((g) => g.mmol === 9.4 && g.context === 'after-meal'),
    JSON.stringify(glucoseRows),
  )
  check(
    'CSV: давление не пострадало от соседства с сахаром',
    mixedBack.measurements.filter((m) => m.kind === 'bp').length === 3,
  )

  const mixedJson = parseJson(toJson(mixed))
  check('JSON: оба дневника в одной резервной копии', mixedJson.measurements.length === 5)

  // Резервная копия версии 1 не знала о видах измерений — она обязана читаться.
  const legacyJson = JSON.stringify({
    format: 'omron-bp/v1',
    readings: [{ id: 'd1-9', ts: Date.UTC(2026, 7, 1, 6, 0, 0), sys: 130, dia: 85, bpm: 70, ihb: false, mov: false, user: 1, source: 'device' }],
  })
  const fromLegacy = parseJson(legacyJson)
  check('старая резервная копия читается', fromLegacy.measurements.length === 1)
  check('записям из старой копии проставлен вид', fromLegacy.measurements[0].kind === 'bp')

  // Чужой файл только с сахаром: колонки kind нет, вид выводится по данным.
  const sugarOnly = 'Дата;Время;Глюкоза;Момент\n10.08.2026;07:10;6,2;натощак\n10.08.2026;14:00;9,4;после еды\n'
  const fromSugar = parseCsv(sugarOnly)
  check('чужой CSV только с сахаром распознан', fromSugar.measurements.length === 2, JSON.stringify(fromSugar))
  check('вид выведен без колонки kind', fromSugar.measurements.every((m) => m.kind === 'glucose'))
  check('запятая как десятичный разделитель понята', fromSugar.measurements[0].mmol === 6.2)
  check('момент замера по-русски распознан', fromSugar.measurements[1].context === 'after-meal')

  // ── полный снимок: копия обязана содержать всё, что вводили руками ────────
  const snapshot = {
    measurements: mixed,
    medicines: [
      {
        id: 'med-1', name: 'Лозартан', dose: '50 мг', inn: 'Лозартан', form: 'Таблетки покрытые пленочной оболочкой', maker: 'ООО «Завод»', packSize: 30, left: 12, perDay: null,
        expires: Date.UTC(2027, 4, 1), note: 'утром', leftAt: Date.UTC(2026, 7, 3),
        times: ['08:00', '20:00'], perTime: 2, meal: 'after', autoDeduct: true,
        taken: [Date.UTC(2026, 7, 12, 5, 0), Date.UTC(2026, 7, 12, 17, 0)],
      },
      { id: 'med-2', name: 'Метформин', dose: '850 мг', left: null, perDay: null, expires: null },
      { id: 'med-3', name: 'Омега-3', dose: '', kind: 1, left: null, perDay: null, expires: null },
    ],
    settings: { targetSys: 135, targetDia: 85, activeUser: 1, trackGlucose: true },
  }
  const restored = parseJson(toJson(snapshot))
  check('в копии есть измерения', restored.measurements.length === 5)
  check('в копии есть аптечка', restored.medicines.length === 3, JSON.stringify(restored.medicines))
  check('пометка БАДа пережила копию', restored.medicines[2].kind === 1)
  check('у обычного лекарства пометки не появилось', restored.medicines[0].kind === undefined)
  check('препарат восстановлен полностью', restored.medicines[0].name === 'Лозартан' && restored.medicines[0].left === 12)
  check('действующее вещество пережило копию', restored.medicines[0].inn === 'Лозартан')
  check('форма выпуска пережила копию', restored.medicines[0].form === 'Таблетки покрытые пленочной оболочкой')
  check('производитель пережил копию', restored.medicines[0].maker === 'ООО «Завод»')
  check('размер упаковки пережил копию', restored.medicines[0].packSize === 30)

  // Расписание и автосписание — тоже введённые руками данные: без них
  // восстановленная аптечка молчит, а остаток перестаёт считаться. С версии
  // формата v4 они лежат в курсе приёма; у копии старого образца их разбирает
  // тот же `splitBox`, что и обновление базы, — и вот это здесь и проверяется.
  const m = restored.medicines[0]
  const к = restored.regimens.find((r) => r.medicineId === 'med-1')
  check('расписание пережило копию', JSON.stringify(к?.times) === JSON.stringify(['08:00', '20:00']), JSON.stringify(к))
  check('штук за приём пережило копию', к?.perTime === 2)
  check('отношение к еде пережило копию', к?.meal === 'after')
  check('автосписание пережило копию', к?.autoDeduct === true)
  check('дата подтверждения остатка пережила копию', m.leftAt === Date.UTC(2026, 7, 3))
  check('отметки о приёме пережили копию', (к?.taken ?? []).length === 2)
  check('старая копия разобрана: расписание ушло из коробки в курс', m.times === undefined && к !== undefined)

  // Чужой или испорченный файл не должен протащить мусор в расписание.
  const кривоеВсё = parseJson(
    JSON.stringify({
      format: 'omron-bp/v3',
      measurements: [],
      medicines: [
        { id: 'x', name: 'Тест', kind: 7, times: ['08:00', 'вечером', 25, null], perTime: 'два', meal: 'иногда', autoDeduct: 'да', taken: ['вчера', 5] },
      ],
    }),
  )
  const кривое = кривоеВсё.medicines[0]
  const кривойКурс = кривоеВсё.regimens[0] ?? {}
  check('в расписание попало только время', JSON.stringify(кривойКурс.times) === JSON.stringify(['08:00']), JSON.stringify(кривойКурс.times))
  check('нечисловое число за приём отброшено', кривойКурс.perTime === undefined)
  check('незнакомое отношение к еде отброшено', кривойКурс.meal === undefined)
  check('автосписание включается только настоящим true', кривойКурс.autoDeduct === undefined)
  check('нечисловые отметки отброшены', JSON.stringify(кривойКурс.taken) === JSON.stringify([5]))
  check(
    'незнакомый вид препарата отброшен',
    кривое.kind === undefined,
    'иначе интерфейс не знает, как назвать пометку, и рисует пустую плашку',
  )
  check('пустые поля препарата остались пустыми', restored.medicines[1].left === null && restored.medicines[1].expires === null)
  check('в копии есть настройки', restored.settings?.targetSys === 135)

  // Служебные поля описывают устройство, где копия делалась, и переезжать не должны.
  const withBookkeeping = parseJson(
    toJson({ ...snapshot, settings: { ...snapshot.settings, backupLastAt: 123, backupLastCount: 7 } }),
  )
  check(
    'отметки о копировании не переносятся',
    withBookkeeping.settings?.backupLastAt === undefined && withBookkeeping.settings?.backupLastCount === undefined,
    JSON.stringify(withBookkeeping.settings),
  )

  // Испорченный или чужой файл не должен протащить пустую запись в аптечку.
  const junk = parseJson(
    JSON.stringify({
      format: 'omron-bp/v3',
      measurements: [],
      medicines: [{ id: 'ok', name: 'Аспирин' }, { id: 'no-name', name: '  ' }, { name: 'без id' }, null, 'строка'],
    }),
  )
  check('мусор в аптечке отброшен', junk.medicines.length === 1 && junk.medicines[0].name === 'Аспирин', JSON.stringify(junk.medicines))
  check('недостающие поля препарата заполнены пустыми', junk.medicines[0].left === null && junk.medicines[0].dose === '')

  // Старые копии аптечки не содержат — это не ошибка.
  check('копия без аптечки читается', fromLegacy.medicines.length === 0 && fromLegacy.settings === null)

  // ── круг «снимок → файл → разбор» по каждому полю препарата ──────────────
  // Восстановление молча теряло owner, since, startedAt, history, foldedUntil —
  // разбор читал только поля первой версии. Здесь препарат со всеми полями
  // типа проходит круг, и сверяется каждое: следующее забытое поле упадёт
  // здесь, а не у человека.
  const полный = FULL_MEDICINE
  const полныйКурс = FULL_REGIMEN
  const файл = toJson({ measurements: [], medicines: [полный], regimens: [полныйКурс], tombstones: [], settings: null })
  const кругом = parseJson(файл)
  const назад = кругом.medicines[0]
  const потеряны = Object.keys(полный).filter((k) => JSON.stringify(назад?.[k]) !== JSON.stringify(полный[k]))
  check('все поля коробки переживают круг', потеряны.length === 0, 'потеряны: ' + потеряны.join(', '))
  const назадКурс = кругом.regimens[0]
  const потеряныКурс = Object.keys(полныйКурс).filter(
    (k) => JSON.stringify(назадКурс?.[k]) !== JSON.stringify(полныйКурс[k]),
  )
  check('все поля курса переживают круг', потеряныКурс.length === 0, 'потеряны: ' + потеряныКурс.join(', '))

  // Кривая история не тянет NaN в отчёт: ячейка отбрасывается, остальные живут.
  const кривая = parseJson(JSON.stringify({ format: 'omron-bp/v3', measurements: [], medicines: [
    { id: 'x', name: 'X', history: { '2025-07': { planned: 10, taken: 'много' }, '2025-08': { planned: 5, taken: 4 }, 'лето': { planned: 1, taken: 1 } } },
  ] })).regimens[0]
  check('испорченная ячейка истории отброшена, целая оставлена', JSON.stringify(кривая.history) === JSON.stringify({ '2025-08': { planned: 5, taken: 4 } }), JSON.stringify(кривая.history))

  // ── что из настроек брать из копии ───────────────────────────────────────
  const своё = {
    pairingKey: 'мой-ключ', theme: 'dark', textScale: 'xlarge', density: 'roomy', startTab: 'intake',
    sections: { overview: true, bp: true, glucose: false, intake: true, cabinet: true },
    remindersOn: true, reminderSound: 'soft', remindersRepeat: true, onboarded: true,
    nudgesUntil: { backup: 1, cabinet: 2 }, backupEncrypt: false, backupLastAt: 5, backupLastCount: 7,
    userNames: { 1: 'Пользователь 1' }, activeUser: 1,
    people: [{ id: 'p1', name: 'Я', deviceUser: 1 }], activePerson: 'p1',
    targetSys: 135, targetDia: 85, glucoseFastingMax: 7, glucosePostMealMax: 10, glucoseLow: 3.9, trackGlucose: false,
    intakeTimes: { morning: '08:00', day: '13:00', evening: '19:00', night: '22:00' },
  }
  const изФайла = {
    theme: 'light', textScale: 'small', density: 'compact', startTab: 'overview',
    sections: { overview: false, bp: true, glucose: true, intake: true, cabinet: true },
    remindersOn: false, reminderSound: 'loud', remindersRepeat: false, onboarded: false,
    nudgesUntil: { backup: 0, cabinet: 0 }, backupEncrypt: true,
    userNames: { 1: 'Отец' }, activeUser: 2,
    people: [{ id: 'p-dad', name: 'Отец', deviceUser: 2 }, { id: 'p-mom', name: 'Мама' }], activePerson: 'p-mom',
    targetSys: 130, targetDia: 80, glucoseFastingMax: 6.5, glucosePostMealMax: 9, glucoseLow: 4, trackGlucose: true,
    intakeTimes: { morning: '06:30', day: '12:00', evening: '18:00', night: '21:00' },
  }
  const слито = mergeRestoredSettings(своё, изФайла)
  check('устройство остаётся своим', слито.theme === 'dark' && слито.textScale === 'xlarge' && слито.remindersOn === true && слито.pairingKey === 'мой-ключ' && слито.backupLastAt === 5)
  check('цели и часы — из файла', слито.targetSys === 130 && слито.intakeTimes.morning === '06:30' && слито.trackGlucose === true)
  check('семья заводится из файла, когда здесь её нет', слито.people.length === 2 && слито.activePerson === 'p-mom')

  const семейное = { ...своё, people: [{ id: 'p1', name: 'Леонид', deviceUser: 1 }, { id: 'p-w', name: 'Жена' }], activePerson: 'p-w' }
  const слито2 = mergeRestoredSettings(семейное, изФайла)
  check('свою семью чужой файл не затирает', слито2.people.length === 2 && слито2.people[0].name === 'Леонид' && слито2.activePerson === 'p-w')
  check('и личное чужого файла не берётся', слито2.targetSys === 135 && слито2.intakeTimes.morning === '08:00')

  // Свой файл при заведённой семье: все здешние люди есть в файле — берём его
  // целиком, недостающих людей он дописывает.
  const свой = { ...изФайла, people: [{ id: 'p1', name: 'Леонид', deviceUser: 1 }, { id: 'p-w', name: 'Жена' }, { id: 'p-k', name: 'Ребёнок' }], activePerson: 'нет-такого' }
  const слито3 = mergeRestoredSettings({ ...семейное, activePerson: 'p1' }, свой)
  check('свой файл дописывает людей', слито3.people.length === 3)
  check('битый activePerson заменяется первым из файла', слито3.activePerson === 'p1')
  check('личное из своего файла берётся', слито3.targetSys === 130)
  const своиСлоты = mergeRestoredSettings({ ...семейное, activePerson: 'p1' }, { ...свой, intakeSlots: [{ id: 'morning', title: 'Утром', time: '07:30' }], pharmacies: ['megapteka'] })
  check('свой файл переносит кнопки приёма', своиСлоты.intakeSlots?.[0]?.time === '07:30')
  check('и выбранные аптеки', (своиСлоты.pharmacies ?? []).join() === 'megapteka')
  check('чужой файл слоты не трогает', mergeRestoredSettings(семейное, { ...изФайла, intakeSlots: [{ id: 'x', title: 'Чужое', time: '01:00' }] }).intakeSlots === семейное.intakeSlots)

  // То же условие наружу — для сообщения после восстановления.
  check('личное не берётся: чужой файл при заведённой семье', takesPersonalFrom(семейное, изФайла) === false)
  check('личное берётся: свой файл', takesPersonalFrom(семейное, свой) === true)
  check('личное берётся: семья ещё не заведена', takesPersonalFrom(своё, изФайла) === true)
  check('переименованный одиночка — уже семья, чужое не берётся', takesPersonalFrom({ people: [{ id: 'p1', name: 'Леонид', deviceUser: 1 }] }, изФайла) === false)
  // `p1` есть на каждой установке — чужой файл с ним за свой не сходит, а свой с тем же именем — сходит.
  check('чужой файл с p1 другого имени — не свой', takesPersonalFrom({ people: [{ id: 'p1', name: 'Леонид', deviceUser: 1 }] }, { people: [{ id: 'p1', name: 'Отец', deviceUser: 1 }, { id: 'p-mom', name: 'Мама' }] }) === false)
  check('свой файл с p1 того же имени — свой', takesPersonalFrom({ people: [{ id: 'p1', name: 'Леонид', deviceUser: 1 }, { id: 'p-w', name: 'Жена' }] }, { people: [{ id: 'p1', name: 'Леонид ', deviceUser: 1 }, { id: 'p-w', name: 'Жена' }, { id: 'p-k', name: 'Ребёнок' }] }) === true)
  check('старая копия без людей при заведённой семье — личное не берётся', takesPersonalFrom(семейное, { targetSys: 120 }) === false)
  check('файл без одного из здешних людей — не свой', takesPersonalFrom(семейное, { people: [{ id: 'p1', name: 'Леонид', deviceUser: 1 }] }) === false)
  check('одиночка «Я» с пересозданным идентификатором — семья не заведена, файл берётся', takesPersonalFrom({ people: [{ id: 'pmtizy0g4', name: 'Я', deviceUser: 1 }] }, изФайла) === true)

  // Известному курсу из копии дописывается только отсутствующее.
  // Владелец из списка ушёл: он теперь `person` и пустым не бывает.
  const пд_свой = { id: 'r1', medicineId: 'm1', person: 'p1', taken: [5, 6] }
  const пд_изКопии = { id: 'r1', medicineId: 'm1', person: 'p-dad', taken: [1], since: 100, startedAt: 50, foldedUntil: 90, history: { '2026-07': { planned: 10, taken: 9 } } }
  const пд_дописано = fillMissingFromCopy(пд_свой, пд_изКопии)
  check('даты и история дописаны', пд_дописано.since === 100 && пд_дописано.startedAt === 50 && пд_дописано.foldedUntil === 90 && пд_дописано.history['2026-07'].taken === 9)
  check('человек и отметки остались местными', пд_дописано.person === 'p1' && пд_дописано.taken.length === 2)
  check('что уже есть — не перезаписывается', fillMissingFromCopy({ ...пд_свой, since: 7 }, пд_изКопии).since === 7)
  check('нечего дописывать — тот же объект', fillMissingFromCopy(пд_дописано, пд_изКопии) === пд_дописано)

  // ── какой сборкой снят чужой файл ────────────────────────────────────────
  //
  // Телефон со сборкой до 0.27.0 обменивается однобоко и молча: присылает
  // коробку старого образца, а своё расписание не получает — места для него у
  // него нет. Пока это не видно, человек чинит последствия вместо причины
  // (BACKLOG §24б). Метка в файле была всегда, но её никто не читал.
  const вер = (obj) => parseJson(JSON.stringify(obj)).peer
  const база = { measurements: [], medicines: [], settings: null }

  check('наш свежий файл не помечается',
    peerIsOutdated(вер({ ...база, format: 'omron-bp/v5', regimens: [] })) === false)
  check('v4 — первая сборка с курсами, тоже не помечается',
    peerIsOutdated(вер({ ...база, format: 'omron-bp/v4', regimens: [] })) === false)
  check('v3 — сборка до 0.27.0',
    peerIsOutdated(вер({ ...база, format: 'omron-bp/v3' })) === true)
  check('совсем старый файл без метки формата',
    peerIsOutdated(вер(база)) === true)
  // Признака два, и довольно любого: номер — заявление файла о себе, ключ
  // `regimens` — факт, потому что `toJson` пишет его всегда.
  check('метка новая, а ключа курсов нет — всё равно старый',
    peerIsOutdated(вер({ ...база, format: 'omron-bp/v5' })) === true)
  // Сборка новее нашей молчит: пугать ею незачем, а метку мы не знаем.
  check('незнакомая метка при живых курсах молчит',
    peerIsOutdated(вер({ ...база, format: 'omron-bp/v9', regimens: [] })) === false)
  check('мусор вместо метки при живых курсах молчит',
    peerIsOutdated(вер({ ...база, format: 'что-то своё', regimens: [] })) === false)
  check('про несуществующий файл ничего не утверждаем', peerIsOutdated(undefined) === false)
  // Свой же файл обязан проходить без пометки — иначе человек увидит её у себя.
  check('свой свежий снимок не помечается',
    peerIsOutdated(parseJson(toJson([], [], [], [], [], null)).peer) === false)

  return failures
}
