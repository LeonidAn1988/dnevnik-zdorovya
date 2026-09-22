/**
 * Слияние дневника с дневником другого телефона семьи.
 *
 * Сервера нет и не будет: каждый телефон пишет свой файл в общую папку и
 * читает чужие. Значит правил разрешения расхождений нам не подскажет никто —
 * они здесь, и они разного рода для разных полей.
 *
 * - **Свойства записи** (давление, название препарата, дозировка, владелец)
 *   имеют одно верное значение. Побеждает более свежая правка по `updatedAt`;
 *   запись без отметки времени не побеждает никогда — она старше самого
 *   понятия отметки.
 * - **Накопители** (отметки приёма, свёрнутая история) — не значение, а сумма
 *   событий, случившихся на разных телефонах. Выбрать «более свежий объект
 *   целиком» значит молча выбросить отметки жены, сделанные в те же сутки.
 *   Они объединяются.
 * - **Остаток** — подтверждение, сделанное человеком в конкретный момент.
 *   Берём то, что подтверждено позже, и говорим об этом в журнале: если два
 *   телефона считали остаток по-разному, увидеть это должен человек, а не
 *   догадываться алгоритм.
 * - **Удаления** сильнее любых правок. Иначе удалённое возвращалось бы с
 *   каждого телефона, где его ещё не удалили.
 *
 * Настройки устройства не сливаются вовсе — тема, размер текста, файл копий,
 * ключ прибора описывают телефон, а не семью. Люди добавляются, но никогда не
 * заменяются и не удаляются: чужой файл не должен переписывать состав семьи,
 * а вот появление у жены нового человека муж увидеть обязан — иначе её
 * лекарства окажутся ничьими.
 */

import type { Measurement, Medicine, Person, Regimen, Tombstone } from '../types'

/** Что было в дневнике до слияния. */
export interface Diary {
  measurements: Measurement[]
  medicines: Medicine[]
  regimens: Regimen[]
  tombstones: Tombstone[]
  people: Person[]
}

/** Что пришло из чужого файла. Настроек, кроме людей, здесь нет намеренно. */
export interface Incoming {
  measurements: Measurement[]
  medicines: Medicine[]
  regimens: Regimen[]
  tombstones: Tombstone[]
  people?: Person[]
}

/** Что записать и что сказать человеку. */
export interface MergeResult {
  measurements: Measurement[]
  medicines: Medicine[]
  regimens: Regimen[]
  tombstones: Tombstone[]
  people: Person[]
  log: MergeLog
}

export interface MergeLog {
  /** Записей появилось. */
  addedMeasurements: number
  /** Записей обновлено более свежей чужой правкой. */
  updatedMeasurements: number
  /** Коробок появилось. */
  addedMedicines: number
  /** Коробок обновлено. */
  updatedMedicines: number
  /** Курсов приёма появилось. */
  addedRegimens: number
  /** Курсов приёма обновлено. */
  updatedRegimens: number
  /** Отметок приёма подобрано с чужого телефона. */
  addedIntakes: number
  /** Записей и коробок убрано по чужим удалениям. */
  removed: number
  /** Людей добавлено. */
  addedPeople: number
  /**
   * Коробки, где остаток на двух телефонах разошёлся. Не ошибка: два человека
   * могли пересчитать пачку по-разному, и решить это может только человек.
   */
  stockConflicts: string[]
}

/** Пустой журнал — для накопления по нескольким файлам. Массив каждый раз свой. */
export function emptyMergeLog(): MergeLog {
  return { ...ПУСТОЙ_ЖУРНАЛ, stockConflicts: [] }
}

const ПУСТОЙ_ЖУРНАЛ: MergeLog = {
  addedMeasurements: 0,
  updatedMeasurements: 0,
  addedMedicines: 0,
  updatedMedicines: 0,
  addedRegimens: 0,
  updatedRegimens: 0,
  addedIntakes: 0,
  removed: 0,
  addedPeople: 0,
  stockConflicts: [],
}

/** Неизвестное время правки не побеждает известное. */
const когда = (item: { updatedAt?: number }) => item.updatedAt ?? 0

/** Поля-накопители: их нельзя брать «объектом целиком». */
function слитьОтметки(своё: number[] | undefined, чужое: number[] | undefined): number[] | undefined {
  if (!своё && !чужое) return undefined
  const все = new Set<number>([...(своё ?? []), ...(чужое ?? [])])
  return [...все].sort((a, b) => a - b)
}

function слитьИсторию(своё: Regimen['history'], чужое: Regimen['history']): Regimen['history'] {
  if (!своё && !чужое) return undefined
  const итог: NonNullable<Regimen['history']> = { ...(своё ?? {}) }
  for (const [месяц, ячейка] of Object.entries(чужое ?? {})) {
    const было = итог[месяц]
    // Оба телефона сворачивают одно и то же расписание, поэтому расхождение
    // значит, что один свернул больший отрезок. Берём больший — он полнее.
    итог[месяц] = было
      ? { planned: Math.max(было.planned, ячейка.planned), taken: Math.max(было.taken, ячейка.taken) }
      : ячейка
  }
  return итог
}

/**
 * Слить одну коробку. Возвращает `null`, если ничего не изменилось: вызывающему
 * достаточно сравнить ссылку, чтобы не писать в хранилище зря.
 */
export function mergeMedicine(своя: Medicine, чужая: Medicine): { next: Medicine; конфликтОстатка: boolean } | null {
  const свежее = когда(чужая) > когда(своя) ? чужая : своя

  // Остаток — подтверждение в конкретный момент, и берём подтверждённое позже.
  const своёПодтверждение = своя.leftAt ?? 0
  const чужоеПодтверждение = чужая.leftAt ?? 0
  const остатокЧужой = чужоеПодтверждение > своёПодтверждение
  const источникОстатка = остатокЧужой ? чужая : своя
  const конфликтОстатка =
    своя.left !== undefined &&
    чужая.left !== undefined &&
    своя.left !== чужая.left &&
    своёПодтверждение === чужоеПодтверждение

  const next: Medicine = {
    ...свежее,
    left: источникОстатка.left,
    leftAt: источникОстатка.leftAt,
    // Отметка времени — максимум из двух: результат слияния не старше ни одного
    // из слагаемых, иначе следующий обмен посчитает его устаревшим.
    updatedAt: Math.max(когда(своя), когда(чужая)) || undefined,
  }

  const тоЖе = JSON.stringify(next) === JSON.stringify({ ...своя, updatedAt: своя.updatedAt })
  return тоЖе ? null : { next, конфликтОстатка }
}

/**
 * Слить один курс приёма.
 *
 * Отметки и свёрнутая история — накопители: их нельзя брать «объектом
 * целиком», иначе приём, отмеченный на телефоне сына, пропадёт при первом же
 * обмене с телефоном отца. Раньше это жило в слиянии коробки, вместе с
 * остатком; после разделения остаток остался у коробки, а отметки — здесь.
 */
export function mergeRegimen(свой: Regimen, чужой: Regimen): Regimen | null {
  const свежее = когда(чужой) > когда(свой) ? чужой : свой
  const отметки = слитьОтметки(свой.taken, чужой.taken)
  const история = слитьИсторию(свой.history, чужой.history)
  const свёрнутоДо = Math.max(свой.foldedUntil ?? 0, чужой.foldedUntil ?? 0) || undefined

  const next: Regimen = {
    ...свежее,
    ...(отметки ? { taken: отметки } : {}),
    ...(история ? { history: история } : {}),
    ...(свёрнутоДо ? { foldedUntil: свёрнутоДо } : {}),
    updatedAt: Math.max(когда(свой), когда(чужой)) || undefined,
  }
  return JSON.stringify(next) === JSON.stringify({ ...свой, updatedAt: свой.updatedAt }) ? null : next
}

/**
 * Слить дневник с содержимым чужого файла.
 *
 * Чистая функция: ничего не читает и не пишет. Так её можно проверить обычными
 * тестами, а вызывающий сам решит, что сохранять — и сохранит одной транзакцией.
 */
export function mergeDiary(своё: Diary, чужое: Incoming, redirect?: Record<string, string>): MergeResult {
  const log: MergeLog = { ...ПУСТОЙ_ЖУРНАЛ, stockConflicts: [] }

  /*
   * Чужую сторону прогоняем через карту объединений.
   *
   * На других телефонах семьи объединённый человек остаётся живым, и записи
   * будут приходить с его идентификатором вечно. Без перецепки они невидимы у
   * всех: поиск по человеку сравнивает только с выбранным, а запасной путь «по
   * кнопке прибора» работает лишь там, где поля `person` нет вовсе. И сам
   * человек вернулся бы в список — люди здесь только добавляются.
   *
   * Свою сторону не трогаем: она переписана самим слиянием и со свежей
   * отметкой правки, поэтому при встрече одинаковых идентификаторов побеждает.
   */
  if (redirect && Object.keys(redirect).length > 0) {
    const куда = (id: string | undefined) => (id ? (redirect[id] ?? id) : id)
    чужое = {
      ...чужое,
      people: (чужое.people ?? []).filter((p) => !(p.id in redirect)),
      measurements: чужое.measurements.map((m) => (m.person ? { ...m, person: куда(m.person) } : m)),
      // Коробка теперь ничья, а человек — у курса приёма.
      regimens: чужое.regimens.map((r) => (r.person ? { ...r, person: куда(r.person)! } : r)),
    }
  }

  // Надгробия первыми: удаление сильнее правки, и применить его надо до того,
  // как чужая запись попробует вернуться.
  const могилы = new Map<string, Tombstone>()
  for (const grave of своё.tombstones) могилы.set(grave.id, grave)
  for (const grave of чужое.tombstones) {
    const было = могилы.get(grave.id)
    // Дата первого удаления — та, что человек и помнит.
    if (!было || grave.at < было.at) могилы.set(grave.id, grave)
  }

  const измерения = new Map<string, Measurement>()
  for (const item of своё.measurements) if (!могилы.has(item.id)) измерения.set(item.id, item)
  else log.removed += 1
  for (const item of чужое.measurements) {
    if (могилы.has(item.id)) continue
    const своя = измерения.get(item.id)
    if (!своя) {
      измерения.set(item.id, item)
      log.addedMeasurements += 1
    } else if (когда(item) > когда(своя)) {
      измерения.set(item.id, item)
      log.updatedMeasurements += 1
    }
  }

  const коробки = new Map<string, Medicine>()
  for (const item of своё.medicines) if (!могилы.has(item.id)) коробки.set(item.id, item)
  else log.removed += 1
  for (const item of чужое.medicines) {
    if (могилы.has(item.id)) continue
    const своя = коробки.get(item.id)
    if (!своя) {
      коробки.set(item.id, item)
      log.addedMedicines += 1
      continue
    }
    const слито = mergeMedicine(своя, item)
    if (!слито) continue
    коробки.set(item.id, слито.next)
    log.updatedMedicines += 1
    if (слито.конфликтОстатка) log.stockConflicts.push(своя.name)
  }

  const курсы = new Map<string, Regimen>()
  for (const item of своё.regimens) if (!могилы.has(item.id)) курсы.set(item.id, item)
  else log.removed += 1
  for (const item of чужое.regimens) {
    if (могилы.has(item.id)) continue
    // Курс осиротевшей коробки не берём: показывать назначение без препарата
    // не из чего, а сама коробка удалена чьим-то надгробием.
    if (!коробки.has(item.medicineId)) continue
    const свой = курсы.get(item.id)
    if (!свой) {
      курсы.set(item.id, item)
      log.addedRegimens += 1
      log.addedIntakes += (item.taken ?? []).length
      continue
    }
    const слито = mergeRegimen(свой, item)
    if (!слито) continue
    const былоОтметок = (свой.taken ?? []).length
    курсы.set(item.id, слито)
    log.updatedRegimens += 1
    log.addedIntakes += Math.max(0, (слито.taken ?? []).length - былоОтметок)
  }

  // Люди только добавляются. Заменить человека чужой записью значит переписать
  // состав семьи с телефона, который о ней знает не больше нашего.
  const люди = [...своё.people]
  const известные = new Set(люди.map((p) => p.id))
  for (const person of чужое.people ?? []) {
    if (известные.has(person.id)) continue
    люди.push(person)
    известные.add(person.id)
    log.addedPeople += 1
  }

  return {
    measurements: [...измерения.values()].sort((a, b) => a.ts - b.ts),
    medicines: [...коробки.values()],
    regimens: [...курсы.values()],
    tombstones: [...могилы.values()],
    people: люди,
    log,
  }
}

/** Было ли в слиянии хоть что-то. Молчать о пустом обмене — правильно. */
export function mergeChangedAnything(log: MergeLog): boolean {
  return (
    log.addedMeasurements > 0 ||
    log.updatedMeasurements > 0 ||
    log.addedMedicines > 0 ||
    log.updatedMedicines > 0 ||
    log.addedRegimens > 0 ||
    log.updatedRegimens > 0 ||
    log.addedIntakes > 0 ||
    log.removed > 0 ||
    log.addedPeople > 0
  )
}

/**
 * Слепок содержимого дневника — по нему видно, разошёлся ли он с файлом.
 *
 * Считать записи мало: правка остатка, отметка приёма и смена дозы числа
 * записей не меняют, и копия оставалась вчерашней. Отметка времени правки есть
 * у каждой записи, поэтому слепок ловит любое изменение и не растёт со временем.
 */
export function diarySignature(
  measurements: Measurement[],
  medicines: Medicine[],
  regimens: Regimen[],
  tombstones: Tombstone[],
): string {
  let сумма = 0
  let длина = 0
  const подмешать = (id: string, when: number) => {
    длина += 1
    // Порядок записей роли не играет: складываем, а не сцепляем.
    сумма = (сумма + when + hashCode(id)) % Number.MAX_SAFE_INTEGER
  }
  for (const item of measurements) подмешать(item.id, item.updatedAt ?? item.ts)
  for (const item of medicines) подмешать(item.id, item.updatedAt ?? 0)
  // Курсы обязаны входить в слепок: отметка приёма меняет только их, и без
  // этого копия молча оставалась бы вчерашней, а «копия устарела» молчало.
  for (const item of regimens) подмешать(item.id, item.updatedAt ?? 0)
  for (const grave of tombstones) подмешать(grave.id, grave.at)
  return `${длина}:${сумма}`
}

function hashCode(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) % 2_147_483_647
  return hash
}
