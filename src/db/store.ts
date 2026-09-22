/**
 * Работа с дневником поверх StoragePort.
 *
 * Здесь только правила приложения: детерминированные идентификаторы, дедупликация,
 * значения настроек по умолчанию. Всё, что зависит от среды выполнения, живёт в
 * `src/platform/`, поэтому этот файл переезжает на нативные платформы без правок.
 */

import type {Measurement, Medicine, Regimen, Settings, Tombstone } from '../types'
import { firstPerson } from '../logic/people'
import { platform } from '../platform/ports'
import { DEFAULT_PAIRING_KEY } from '../ble/protocol'

export const DEFAULT_SETTINGS: Settings = {
  pairingKey: DEFAULT_PAIRING_KEY,
  userNames: { 1: 'Пользователь 1', 2: 'Пользователь 2' },
  activeUser: 1,
  people: [],
  activePerson: '',
  targetSys: 135,
  targetDia: 85,
  glucoseFastingMax: 7.0,
  glucosePostMealMax: 10.0,
  glucoseLow: 3.9,
  trackGlucose: false,
  theme: 'auto',
  textScale: 'normal',
  density: 'normal',
  sections: { overview: true, bp: true, glucose: true, intake: true, cabinet: true },
  startTab: 'overview',
  remindersOn: false,
  // Не системный звук: напоминание о лекарстве должно отличаться от почты и
  // мессенджера, иначе человек перестаёт на него реагировать.
  reminderSound: 'kolokolchik',
  measureRemindOn: false,
  remindersRepeat: true,
  intakeTimes: { morning: '08:00', day: '13:00', evening: '19:00', night: '22:00' },
  onboarded: false,
  nudgesUntil: { backup: 0, cabinet: 0 },
  backupEncrypt: false,
  backupLastAt: null,
  backupLastCount: 0,
}

/**
 * Идентификатор записи, снятой с прибора. Детерминированный — повторная выгрузка
 * не плодит дубли.
 *
 * Префикс зависит от вида измерения: давление и сахар, снятые в одну и ту же секунду,
 * иначе затёрли бы друг друга.
 */
export function deviceMeasurementId(kind: Measurement['kind'], user: number, ts: number): string {
  return `${kind === 'bp' ? 'd' : 'g'}${user}-${Math.floor(ts / 1000)}`
}

/** Совместимость: идентификаторы давления, выданные до появления сахара, выглядели так же. */
export const readingId = (user: number, ts: number) => deviceMeasurementId('bp', user, ts)


export function getAllMeasurements(): Promise<Measurement[]> {
  return platform().storage.allMeasurements()
}

export function putMeasurements(items: Measurement[], stamp = true): Promise<void> {
  return platform().storage.putMeasurements(items, stamp)
}

/**
 * Добавляет только то, чего ещё нет. Дубли режутся по id, поэтому повторная
 * выгрузка с прибора безопасна.
 *
 * `stamp` ложно при восстановлении из копии: у записей оттуда своя отметка
 * времени, и переписать её сегодняшним числом значит сделать старую копию
 * свежее местных правок.
 */
export async function addNewMeasurements(items: Measurement[], stamp = true): Promise<Measurement[]> {
  const existing = new Set((await getAllMeasurements()).map((m) => m.id))
  const fresh = items.filter((m) => !existing.has(m.id))
  await putMeasurements(fresh, stamp)
  return fresh
}

export function deleteMeasurement(id: string): Promise<void> {
  return platform().storage.deleteMeasurement(id)
}

export function clearMeasurements(): Promise<void> {
  return platform().storage.clearMeasurements()
}

export async function loadSettings(): Promise<Settings> {
  const stored = await platform().storage.loadSettings()
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(stored ?? {}),
    userNames: { ...DEFAULT_SETTINGS.userNames, ...(stored?.userNames ?? {}) },
    // Разделы мержатся по полю: у копии, снятой до появления настройки, их нет,
    // и без слияния все разделы разом пропали бы из навигации.
    sections: { ...DEFAULT_SETTINGS.sections, ...(stored?.sections ?? {}) },
  }

  /*
   * Первый человек заводится сам, и это не может подождать.
   *
   * До появления людей дневник вёлся на одного, и без него список пуст: аптечка
   * ничья, отчёт ни на кого, переключать некого. Заводим молча и из того, что
   * уже известно, — человек не должен отвечать на вопрос «а вы кто» только
   * потому, что мы поменяли модель данных у себя внутри.
   */
  if (merged.people.length > 0) {
    const activePerson = merged.people.some((p) => p.id === merged.activePerson)
      ? merged.activePerson
      : merged.people[0].id
    return { ...merged, activePerson }
  }

  // Ключ от установки, а не от часов, — см. `defaultPersonId`.
  const seed = await platform()
    .storage.installId()
    .catch(() => '')
  const people = [firstPerson(merged, seed)]
  const готово = { ...merged, people, activePerson: people[0].id }

  /*
   * Запись из читателя — намеренно, и это второй рубеж той же починки.
   *
   * Дальше есть путь, где настройки читают и не сохраняют никогда: начальная
   * загрузка кладёт их в состояние напрямую, а в хранилище пишет только правка
   * из интерфейса. Без этой строки человек оставался бы в памяти, и телефон
   * выкладывал бы его в семейную папку заново после каждого запуска.
   *
   * Повтор безвреден: ключ от установки постоянный, значит повторная запись
   * кладёт то же самое. Отказ хранилища проглатываем — человек в памяти уже
   * есть, дневник работает, а на следующем запуске попробуем снова.
   */
  await saveSettings(готово).catch(() => undefined)
  return готово
}

export function saveSettings(settings: Settings): Promise<void> {
  return platform().storage.saveSettings(settings)
}

// ── аптечка ────────────────────────────────────────────────────────────────

export function getAllMedicines(): Promise<Medicine[]> {
  return platform().storage.allMedicines()
}

export function putMedicine(item: Medicine, stamp = true): Promise<void> {
  return platform().storage.putMedicine(item, stamp)
}

/** Идентификатор этой установки приложения. Заводится сам при первом обращении. */
/** Вернуть удалённое измерение: снимает надгробие и кладёт запись обратно. */
export function restoreMeasurement(item: Measurement): Promise<void> {
  return platform().storage.restoreMeasurement(item)
}

export function getInstallId(): Promise<string> {
  return platform().storage.installId()
}

/** Следы удалённых записей — их несёт резервная копия, иначе удалённое возвращается. */
export function getAllTombstones() {
  return platform().storage.allTombstones()
}

export function saveTombstones(items: Tombstone[]) {
  return platform().storage.putTombstones(items)
}

export function deleteMedicine(id: string): Promise<void> {
  return platform().storage.deleteMedicine(id)
}

// ── курсы приёма ───────────────────────────────────────────────────────────

export function getAllRegimens(): Promise<Regimen[]> {
  return platform().storage.allRegimens()
}

export function putRegimen(item: Regimen, stamp = true): Promise<void> {
  return platform().storage.putRegimen(item, stamp)
}

export function deleteRegimen(id: string): Promise<void> {
  return platform().storage.deleteRegimen(id)
}

/**
 * Идентификатор препарата. В отличие от измерений, детерминированным его сделать
 * не из чего: один и тот же препарат заводят дважды с разным сроком годности —
 * это две разные коробки, а не дубль.
 */
export function newMedicineId(): string {
  return `med-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// ── сохранность ────────────────────────────────────────────────────────────

/** Просит платформу не вытеснять данные. Ответ показываем в настройках. */
export function requestDurability(): Promise<boolean | null> {
  return platform().storage.requestDurability()
}

export const backupTarget = {
  isSupported: () => platform().backup.isSupported(),
  choose: (suggestedName: string) => platform().backup.choose(suggestedName),
  current: () => platform().backup.target(),
  write: (content: string) => platform().backup.write(content),
  read: () => platform().backup.read(),
  forget: () => platform().backup.forget(),
}
