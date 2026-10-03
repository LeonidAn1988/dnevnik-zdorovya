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

import { historyState, intakeStates, mergeHistoryState, mergeIntakeStates, projectIntakes } from './intakeState'
import type { LabResult, LabTest, Measurement, Medicine, Person, Regimen, Tombstone } from '../types'

/** Что было в дневнике до слияния. */
export interface Diary {
  measurements: Measurement[]
  medicines: Medicine[]
  regimens: Regimen[]
  labs: LabTest[]
  tombstones: Tombstone[]
  people: Person[]
}

/** Что пришло из чужого файла. Настроек, кроме людей, здесь нет намеренно. */
export interface Incoming {
  measurements: Measurement[]
  medicines: Medicine[]
  regimens: Regimen[]
  labs?: LabTest[]
  tombstones: Tombstone[]
  people?: Person[]
}

/** Что записать и что сказать человеку. */
export interface MergeResult {
  measurements: Measurement[]
  medicines: Medicine[]
  regimens: Regimen[]
  labs: LabTest[]
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
  /** Анализов появилось. */
  addedLabs: number
  /** Анализов обновлено, включая новые результаты. */
  updatedLabs: number
  /** Курсов приёма обновлено. */
  updatedRegimens: number
  /** Отметок приёма подобрано с чужого телефона. */
  addedIntakes: number
  /** Записей и коробок убрано по чужим удалениям. */
  removed: number
  /** Новые или уточнённые следы удаления, даже если самой записи здесь нет. */
  changedTombstones: number
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
  addedLabs: 0,
  updatedLabs: 0,
  addedIntakes: 0,
  removed: 0,
  changedTombstones: 0,
  addedPeople: 0,
  stockConflicts: [],
}

/** Один механизм для файлового и облачного обмена: новые счётчики не теряются. */
export function accumulateMergeLog(target: MergeLog, source: MergeLog): void {
  for (const key of Object.keys(ПУСТОЙ_ЖУРНАЛ) as (keyof MergeLog)[]) {
    if (key === 'stockConflicts') target.stockConflicts.push(...source.stockConflicts)
    else target[key] += source[key]
  }
}

/** Неизвестное время правки не побеждает известное. */
const когда = (item: { updatedAt?: number }) => item.updatedAt ?? 0

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
 * Слить один анализ.
 *
 * Результаты — накопитель, как отметки о приёме: анализ, записанный на телефоне
 * отца, не должен пропасть при первом же обмене с телефоном сына. Сам анализ
 * (имя, расписание, единица) берётся целиком у более свежей стороны.
 *
 * Одинаковые результаты различаем по идентификатору, а не по дню: за один день
 * анализ можно сдать дважды — утром в поликлинике и вечером в лаборатории.
 */
export function mergeLab(свой: LabTest, чужой: LabTest): LabTest | null {
  const свежее = когда(чужой) > когда(свой) ? чужой : свой
  const результаты = new Map<string, LabResult>()
  for (const r of свой.results) результаты.set(r.id, r)
  for (const r of чужой.results) {
    const есть = результаты.get(r.id)
    // При совпадении идентификаторов побеждает сторона, которую правили позже:
    // человек мог исправить опечатку в числе.
    if (!есть || когда(чужой) > когда(свой)) результаты.set(r.id, r)
  }

  const next: LabTest = {
    ...свежее,
    results: [...результаты.values()].sort((a, b) => a.day - b.day),
    updatedAt: Math.max(когда(свой), когда(чужой)) || undefined,
  }
  const тоЖе = JSON.stringify(next) === JSON.stringify({ ...свой, results: [...свой.results].sort((a, b) => a.day - b.day), updatedAt: свой.updatedAt })
  return тоЖе ? null : next
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
  if (JSON.stringify(свой) === JSON.stringify(чужой)) return null
  const свежее = когда(чужой) > когда(свой) ? чужой : свой
  const современные = [свой, чужой].filter(r => !r.legacySchedule)
  const расписание = современные.sort((a,b) => (b.scheduleUpdatedAt ?? когда(b)) - (a.scheduleUpdatedAt ?? когда(a)))[0] ?? свежее
  const base = { ...свежее, legacySchedule: расписание.legacySchedule, scheduleUpdatedAt: расписание.legacySchedule ? undefined : расписание.scheduleUpdatedAt ?? когда(расписание) }
  for (const key of ['times', 'perTime', 'meal', 'rhythm', 'plan', 'planFrom', 'endsAt'] as const) Object.assign(base, { [key]: расписание[key] })
  // Возобновление — отдельный курс. Копия старой сборки, не знающая
  // прекращения, не должна запускать прежнее назначение заново.
  const остановки = [свой.stoppedAt, чужой.stoppedAt].filter((at): at is number => at !== undefined)
  base.stoppedAt = остановки.length > 0 ? Math.min(...остановки) : undefined
  const foldedUntil = Math.max(свой.foldedUntil ?? 0, чужой.foldedUntil ?? 0) || undefined
  const next = projectIntakes(
    { ...base, foldedUntil },
    mergeIntakeStates(intakeStates(свой), intakeStates(чужой)),
    mergeHistoryState(historyState(свой), historyState(чужой)),
  )
  return JSON.stringify(next) === JSON.stringify(свой) ? null : next
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
      // Анализы — туда же. Без этого анализ с объединённого человека приходит с
      // мёртвым идентификатором и не виден никому: список отбирается по
      // человеку, а такого человека в дневнике уже нет.
      labs: (чужое.labs ?? []).map((t) => (t.owner ? { ...t, owner: куда(t.owner)! } : t)),
    }
  }

  // Надгробия первыми: удаление сильнее правки, и применить его надо до того,
  // как чужая запись попробует вернуться.
  const могилы = new Map<string, Tombstone>()
  for (const grave of своё.tombstones) могилы.set(grave.id, grave)
  for (const grave of чужое.tombstones) {
    const было = могилы.get(grave.id)
    // Дата первого удаления — та, что человек и помнит.
    if (!было || grave.at < было.at) {
      могилы.set(grave.id, grave)
      log.changedTombstones += 1
    }
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

  const анализы = new Map<string, LabTest>()
  for (const item of своё.labs ?? []) if (!могилы.has(item.id)) анализы.set(item.id, item)
  else log.removed += 1
  for (const item of чужое.labs ?? []) {
    if (могилы.has(item.id)) continue
    const свой = анализы.get(item.id)
    if (!свой) {
      анализы.set(item.id, item)
      log.addedLabs += 1
      continue
    }
    const слито = mergeLab(свой, item)
    if (!слито) continue
    анализы.set(item.id, слито)
    log.updatedLabs += 1
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
    labs: [...анализы.values()],
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
    log.addedLabs > 0 ||
    log.updatedLabs > 0 ||
    log.removed > 0 ||
    log.changedTombstones > 0 ||
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
  labs: LabTest[],
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
  for (const item of regimens) подмешать(item.id, (item.updatedAt ?? 0) + hashCode(JSON.stringify([item.intakeState, item.historyState, item.foldedUntil])))
  // Анализы — по той же причине: новый результат не меняет числа записей
  // дневника, и без них копия оставалась бы вчерашней.
  for (const item of labs) подмешать(item.id, item.updatedAt ?? 0)
  for (const grave of tombstones) подмешать(grave.id, grave.at)
  return `${длина}:${сумма}`
}

function hashCode(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) % 2_147_483_647
  return hash
}
