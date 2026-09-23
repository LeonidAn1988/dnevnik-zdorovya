/**
 * Люди в дневнике.
 *
 * Понятие введено, чтобы отделить человека от памяти прибора. Тонометр помнит
 * двоих — это две кнопки на его корпусе, а не два человека в семье. Людей может
 * быть четверо, у ребёнка прибора нет вовсе, и лекарства у него всё равно свои.
 *
 * Здесь только чистые правила: как завести первого, как найти нынешнего, что
 * значит «ничей препарат». Экранов и хранилища этот модуль не касается.
 */

import type { IntakeSlot, IntakeTimes, LabTest, Measurement, Regimen, Person, Settings } from '../types'

/** Имя, которое приложение ставит первому человеку, если своего нет. */
export const ПЕРВЫЙ = 'Я'

/**
 * Сколько людей помещается в один дневник. Предел не от жадности: номер
 * напоминания несёт человека одним разрядом из восьми значений, и девятый
 * получил бы номера первого — система заменила бы его уведомления молча.
 */
export const MAX_PEOPLE = 8

/**
 * Завести первого человека из прежних настроек.
 *
 * Вызывается один раз при обновлении: до появления людей дневник вёлся на
 * одного, и этот один уже где-то назван — подписью пользователя прибора.
 * Подпись из коробки («Пользователь 1») именем не считаем: человек её не писал,
 * и видеть её вместо своего имени неприятно.
 *
 * Идентификатор — уникальный, а не `p1`. Прежнее постоянное значение означало,
 * что первый человек на каждом телефоне семьи получает один и тот же ключ: при
 * слиянии дневников отец и жена оказались бы одним человеком, а лечится это
 * потом только перебивкой, которая рвёт владельцев коробок и старые копии.
 */
export function firstPerson(settings: Pick<Settings, 'userNames' | 'activeUser'>, seed: string): Person {
  const подпись = (settings.userNames[settings.activeUser] ?? '').trim()
  const своё = подпись.length > 0 && !/^Пользователь\s*\d+$/.test(подпись)
  const memory: 1 | 2 = settings.activeUser === 2 ? 2 : 1
  return { id: defaultPersonId(seed), name: своё ? подпись : ПЕРВЫЙ, deviceUser: memory }
}

/**
 * Идентификатор первого человека — от установки, а не от часов.
 *
 * Это не украшение, а починка потока дублей. Заведённый по умолчанию человек
 * попадал в память, но не в хранилище: `loadSettings` его возвращает, а пишет
 * настройки только правка из интерфейса. Пока человек ничего не менял, при
 * каждом холодном старте рождался новый «Я» с новым ключом от часов, и
 * семейный обмен разносил их по телефонам — сопоставляются люди только по
 * ключу, имена не сравниваются нигде. У владельца так накопилось двое.
 *
 * Ключ установки живёт в хранилище отдельно от настроек и переживает всё, кроме
 * удаления приложения, поэтому один телефон теперь всегда даёт одного «Я».
 * Пустое зерно (платформа не ответила) — откат на прежнее поведение: лучше
 * лишний человек, чем человек без ключа.
 */
export function defaultPersonId(seed: string): string {
  const чистое = seed.trim()
  return чистое ? `p${чистое}` : newPersonId(Date.now())
}

/**
 * Новый идентификатор человека. Время в основе: двоих в одну миллисекунду не
 * заводят. Для добавленных руками это верно — их заводит человек, по одному.
 */
export function newPersonId(now: number): string {
  return `p${now.toString(36)}`
}

/**
 * Кто сейчас выбран.
 *
 * Возвращает первого, если выбранный пропал: человека могли удалить на другом
 * устройстве и прислать настройки копией. Пустой экран без объяснения хуже, чем
 * чужой дневник, — и то и другое человек заметит, но второе он поймёт.
 */
export function activePersonOf(settings: Pick<Settings, 'people' | 'activePerson'>): Person | null {
  if (settings.people.length === 0) return null
  return settings.people.find((p) => p.id === settings.activePerson) ?? settings.people[0]
}

/**
 * Курсы приёма выбранного человека.
 *
 * Пришло на смену `medicinesOf`: коробка с 0.27.0 ничья — она стоит в доме, а
 * не у человека, — и «мои лекарства» теперь значит «мои курсы приёма».
 */
export function regimensOfPerson(regimens: Regimen[], personId: string): Regimen[] {
  return regimens.filter((r) => r.person === personId)
}


/**
 * Память прибора, чьи измерения показывать.
 *
 * У человека без прибора её нет, и дневник давления у него пустой. Подставлять
 * ему чужие измерения нельзя: это чужое здоровье под его именем.
 */
export function deviceUserOf(person: Person | null): number | null {
  return person?.deviceUser ?? null
}

/**
 * Свободные памяти прибора.
 *
 * Их две, и занимать одну дважды нельзя: два человека на одной памяти означают
 * один дневник давления на двоих, где не разобрать, чьё измерение.
 */
export function freeDeviceUsers(people: Person[], exceptId?: string): (1 | 2)[] {
  const занято = new Set(people.filter((p) => p.id !== exceptId).map((p) => p.deviceUser))
  return ([1, 2] as const).filter((u) => !занято.has(u))
}

/**
 * Часы стандартных приёмов выбранного человека.
 *
 * У каждого они свои: у одного утро в шесть, у другого в девять. Пока своих
 * нет, берутся общие из настроек — так ведёт себя тот, кого завели до появления
 * этой возможности, и так же ведёт себя единственный человек, которому
 * разделение ни к чему.
 */
export function intakeTimesOf(person: Person | null, fallback: IntakeTimes): IntakeTimes {
  return person?.intakeTimes ?? fallback
}

/** Заголовки четырёх исходных кнопок — в том виде, в каком они были зашиты. */
const ИСХОДНЫЕ: { id: keyof IntakeTimes; title: string }[] = [
  { id: 'morning', title: 'Утром' },
  { id: 'day', title: 'Днём' },
  { id: 'evening', title: 'Вечером' },
  { id: 'night', title: 'На ночь' },
]

/**
 * Кнопки стандартных приёмов у человека.
 *
 * Своих нет — берутся общие; общих нет — четыре исходных из `intakeTimes`.
 * Так дневник, заведённый до появления настраиваемых кнопок, продолжает
 * работать ровно как прежде.
 */
export function intakeSlotsOf(
  person: Person | null,
  settings: Pick<Settings, 'intakeTimes' | 'intakeSlots'>,
): IntakeSlot[] {
  const свои = person?.intakeSlots ?? settings.intakeSlots
  if (свои && свои.length > 0) return свои
  const часы = intakeTimesOf(person, settings.intakeTimes)
  return ИСХОДНЫЕ.map(({ id, title }) => ({ id, title, time: часы[id] }))
}

/** Новый ключ кнопки приёма. Время в основе: двух за миллисекунду не заводят. */
export function newSlotId(now: number): string {
  return `s${now.toString(36)}`
}

/**
 * Записать кнопки приёма — человеку или в общие настройки.
 *
 * Заодно обновляются четыре старых поля `intakeTimes`: их читают копии,
 * снятые прежними версиями, и сборки, которые о настраиваемых кнопках не
 * знают. Совпадение по ключу, а не по месту: человек мог убрать «Днём», и
 * подставлять на его место «Вечером» значило бы сдвинуть чужое время.
 */
export function setIntakeSlots(
  settings: Pick<Settings, 'people' | 'intakeTimes' | 'intakeSlots'>,
  personId: string | null,
  slots: IntakeSlot[],
): Partial<Settings> {
  const прежние = settings.intakeTimes
  const время = (id: keyof IntakeTimes) => slots.find((slot) => slot.id === id)?.time ?? прежние[id]
  const совместимость: IntakeTimes = {
    morning: время('morning'),
    day: время('day'),
    evening: время('evening'),
    night: время('night'),
  }
  if (settings.people.length <= 1 || !personId) {
    return { intakeSlots: slots, intakeTimes: совместимость }
  }
  // В семье совместимые часы пишутся человеку, а не в общие настройки: иначе
  // правка кнопок отцу сдвигала бы часы жене — ровно то, чего личные кнопки и
  // должны были избежать.
  return {
    people: settings.people.map((p) => (p.id === personId ? { ...p, intakeSlots: slots, intakeTimes: совместимость } : p)),
  }
}

/**
 * Целевое давление человека. Своё, если назначено; иначе общее из настроек.
 *
 * Тот же приём, что с часами приёма: личное поле необязательно, и дневник,
 * заведённый до его появления, продолжает работать по общим цифрам.
 */
export function targetsOf(
  person: Person | null,
  fallback: Pick<Settings, 'targetSys' | 'targetDia'>,
): { sys: number; dia: number } {
  return person?.targets ?? { sys: fallback.targetSys, dia: fallback.targetDia }
}

/** Пороги сахара человека. Своё, если назначено; иначе общее из настроек. */
export function glucoseTargetsOf(
  person: Person | null,
  fallback: Pick<Settings, 'glucoseFastingMax' | 'glucosePostMealMax' | 'glucoseLow'>,
): { fastingMax: number; postMealMax: number; low: number } {
  return (
    person?.glucose ?? {
      fastingMax: fallback.glucoseFastingMax,
      postMealMax: fallback.glucosePostMealMax,
      low: fallback.glucoseLow,
    }
  )
}

/**
 * Чей это замер: явная пометка, а без неё — кнопка памяти прибора.
 *
 * Первый в списке с такой кнопкой, а не «каждый»: экран измерений показывает
 * запись без пометки всем, кто сидит на этой кнопке, но владелец у неё может
 * быть только один. Кнопки не уникальны — до 0.25.0 приложение штамповало
 * нового «Я» с той же кнопкой при каждом запуске, и в настоящем дневнике на
 * первой кнопке сидят трое.
 */
export function readingOwnerId(people: Person[], m: Pick<Measurement, 'person' | 'user'>): string | null {
  if (m.person) return people.some((p) => p.id === m.person) ? m.person : null
  return people.find((p) => p.deviceUser === m.user)?.id ?? null
}

export interface MergeReport {
  /** Сколько измерений сменило владельца. */
  measurements: number
  /** Сколько курсов приёма сменило человека. */
  regimens: number
  /** Сколько анализов сменило владельца. */
  labs: number
  /** Кнопка прибора, которая освободилась. `null` — ничего не освободилось. */
  freedDeviceUser: 1 | 2 | null
  /** Личные настройки взяты от проигравшего, потому что у выжившего их не было. */
  tookPersonal: boolean
}

/**
 * Объединить двух людей в одного.
 *
 * Понадобилось, когда у владельца в списке оказалось двое «Я»: приложение
 * заводило нового человека при каждом запуске, а семейный обмен разносил их по
 * телефонам. Кран починен в 0.25.0, но накопившихся это не убрало.
 *
 * **Просто удалить лишнего нельзя.** Измерения, помеченные его
 * идентификатором, исчезли бы отовсюду: поиск по человеку сравнивает только с
 * выбранным, а запасной путь «по кнопке прибора» работает лишь у записей, где
 * поля `person` нет вовсе. Поэтому сначала переписываются ссылки, и только
 * потом человек уходит из списка.
 *
 * Коробки здесь не трогаются: с 0.27.0 они ничьи и стоят в общей аптечке.
 * Переходят курсы приёма — вместе с отметками и историей.
 */
export function mergePeople(
  settings: Pick<Settings, 'people' | 'activePerson' | 'mergedPeople'>,
  measurements: Measurement[],
  regimens: Regimen[],
  labs: LabTest[],
  pair: { loser: string; winner: string },
): {
  settings: Partial<Settings>
  measurements: Measurement[]
  regimens: Regimen[]
  labs: LabTest[]
  report: MergeReport
} | null {
  const { loser, winner } = pair
  const проигравший = settings.people.find((p) => p.id === loser)
  const выживший = settings.people.find((p) => p.id === winner)
  if (!проигравший || !выживший || loser === winner) return null

  /*
   * Измерения переписываются у обоих, а не только у проигравшего.
   *
   * У старых записей поля `person` нет, и они ходят за кнопкой прибора. Если у
   * проигравшего была кнопка 2, а у выжившего 1, то после слияния «кнопка 2»
   * становится ничьей, и эти записи осиротели бы. Явная простановка снимает
   * зависимость от кнопок навсегда.
   */
  const изменённые: Measurement[] = []
  for (const m of measurements) {
    const чей = readingOwnerId(settings.people, m)
    if (чей !== loser && чей !== winner) continue
    if (m.person === winner) continue
    изменённые.push({ ...m, person: winner })
  }

  // Коробки не трогаем: с 0.27.0 они ничьи. Человек — у курса приёма.
  const курсы = regimens.filter((r) => r.person === loser).map((r) => ({ ...r, person: winner }))

  /*
   * Анализы — та же история, что с курсами, и их здесь однажды уже забыли.
   *
   * Правило простое: карта объединения обязана вести **всё**, у чего есть
   * владелец. Забытый анализ не ломается с грохотом — он просто исчезает с
   * экрана, потому что его `owner` указывает на человека, которого больше нет
   * в списке. Снимки бланков уходят вместе с ним: они привязаны к анализу, а
   * не к человеку.
   */
  const анализы = labs.filter((t) => t.owner === loser).map((t) => ({ ...t, owner: winner }))

  // Кнопка прибора: своя дороже чужой, но пустое место занимается.
  const кнопка = выживший.deviceUser ?? проигравший.deviceUser
  const освободилась = выживший.deviceUser && проигравший.deviceUser && выживший.deviceUser !== проигравший.deviceUser
    ? проигравший.deviceUser
    : null

  // Личное: своё держим, пустое дописываем. Заменять заполненное нельзя —
  // тот же приём, что при дописывании полей из копии.
  const слитый: Person = {
    ...выживший,
    deviceUser: кнопка,
    intakeTimes: выживший.intakeTimes ?? проигравший.intakeTimes,
    intakeSlots: выживший.intakeSlots ?? проигравший.intakeSlots,
    measurePlan: выживший.measurePlan ?? проигравший.measurePlan,
    targets: выживший.targets ?? проигравший.targets,
    glucose: выживший.glucose ?? проигравший.glucose,
  }
  const взялЛичное =
    (!выживший.intakeTimes && !!проигравший.intakeTimes) ||
    (!выживший.intakeSlots && !!проигравший.intakeSlots) ||
    (!выживший.measurePlan && !!проигравший.measurePlan) ||
    (!выживший.targets && !!проигравший.targets) ||
    (!выживший.glucose && !!проигравший.glucose)

  const люди = settings.people.filter((p) => p.id !== loser).map((p) => (p.id === winner ? слитый : p))

  // Карта с перецепкой хвостов: если A вёл к проигравшему, теперь он ведёт к
  // выжившему. Иначе цепочка упёрлась бы в мёртвый идентификатор.
  const карта: Record<string, string> = {}
  for (const [откуда, куда] of Object.entries(settings.mergedPeople ?? {})) {
    карта[откуда] = куда === loser ? winner : куда
  }
  карта[loser] = winner

  return {
    settings: collapsePersonal({
      people: люди,
      activePerson: settings.activePerson === loser ? winner : settings.activePerson,
      mergedPeople: карта,
    }),
    measurements: изменённые,
    regimens: курсы,
    labs: анализы,
    report: {
      measurements: изменённые.length,
      regimens: курсы.length,
      labs: анализы.length,
      freedDeviceUser: освободилась ?? null,
      tookPersonal: взялЛичное,
    },
  }
}

/**
 * Когда остался один человек, личное переезжает в общее.
 *
 * Иначе вскрывается давний дефект: при одном человеке записи личных настроек
 * уходят в общие (`setIntakeSlots`, `setTargets`, `setGlucoseTargets`,
 * `setMeasurePlan` все проверяют `people.length <= 1`), а чтение всё равно идёт
 * из человека. Правка часов приёма и норм просто перестаёт действовать. До
 * слияния до этого доходили редко — только удалив второго человека; слияние
 * делает случай обычным.
 */
export function collapsePersonal<T extends Partial<Settings> & { people: Person[] }>(patch: T): T {
  if (patch.people.length !== 1) return patch
  const один = patch.people[0]
  const общее: Partial<Settings> = {}
  if (один.targets) {
    общее.targetSys = один.targets.sys
    общее.targetDia = один.targets.dia
  }
  if (один.glucose) {
    общее.glucoseFastingMax = один.glucose.fastingMax
    общее.glucosePostMealMax = один.glucose.postMealMax
    общее.glucoseLow = один.glucose.low
  }
  if (один.intakeTimes) общее.intakeTimes = один.intakeTimes
  if (один.intakeSlots) общее.intakeSlots = один.intakeSlots
  if (один.measurePlan) общее.measurePlan = один.measurePlan

  const {
    targets: _t,
    glucose: _g,
    intakeTimes: _it,
    intakeSlots: _is,
    measurePlan: _mp,
    ...чистый
  } = один
  return { ...patch, ...общее, people: [чистый] }
}

/** Куда ведёт идентификатор после всех объединений. Незнакомый — сам к себе. */
export function redirectPerson(id: string | null | undefined, map: Record<string, string> | undefined): string | null {
  if (!id) return id ?? null
  return map?.[id] ?? id
}
