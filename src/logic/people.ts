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

import type { IntakeSlot, IntakeTimes, Medicine, Person, Settings } from '../types'

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
 * Чей это препарат.
 *
 * Два случая ведут к одному ответу — первому человеку в списке.
 *
 * Первый: препарат заведён до появления людей, владельца у него нет вовсе. Он
 * принадлежит тому единственному, для кого дневник и вёлся.
 *
 * Второй: владелец записан, но такого человека больше нет — его удалили, и
 * ровно это обещало окно подтверждения: «препараты перейдут первому человеку в
 * списке». Без проверки коробка осталась бы за призраком и пропала бы из
 * аптечки у всех сразу: фильтр по человеку не нашёл бы её ни у кого.
 */
export function ownerOf(medicine: Medicine, people: Person[]): string | null {
  if (medicine.owner && people.some((p) => p.id === medicine.owner)) return medicine.owner
  return people[0]?.id ?? null
}

/**
 * Препараты выбранного человека.
 *
 * Пока человек один, это вся аптечка — и проверка на единственного здесь не
 * оптимизация, а осторожность: у препаратов, заведённых до появления людей,
 * владельца нет, и фильтр по нему спрятал бы всю аптечку разом.
 */
export function medicinesOf(items: Medicine[], people: Person[], personId: string): Medicine[] {
  if (people.length <= 1) return items
  return items.filter((m) => ownerOf(m, people) === personId)
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
