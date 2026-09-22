/**
 * Единая точка входа для тестов.
 *
 * Собирается одним бандлом намеренно: реестр платформы в `platform/ports.ts`
 * хранит состояние в модуле, и при раздельных бандлах установленная платформа
 * была бы не видна остальным — тесты падали бы с «платформа не установлена».
 */

export { parseRecord } from '../src/ble/hem6232t'

export {
  parseSFloat,
  parseGlucoseMeasurement,
  parseGlucoseContext,
  parseRacpResponse,
} from '../src/ble/glucose'

export { toCsv, toJson, parseCsv, parseJson, parseImportFile } from '../src/logic/io'

export { encryptBackup, decryptBackup, isEncrypted } from '../src/logic/crypto'

export {
  getAllMeasurements,
  putMeasurements,
  addNewMeasurements,
  deleteMeasurement,
  clearMeasurements,
  loadSettings,
  saveSettings,
  deviceMeasurementId,
  getAllMedicines,
  putMedicine,
  deleteMedicine,
  getAllRegimens,
  putRegimen,
  deleteRegimen,
  getAllTombstones,
  saveTombstones,
} from '../src/db/store'

export { plural, monthYear } from '../src/logic/plural'
export {
  firstPerson,
  activePersonOf,
  regimensOfPerson,
  readingOwnerId,
  deviceUserOf,
  freeDeviceUsers,
  newPersonId,
  defaultPersonId,
  mergePeople,
  collapsePersonal,
  redirectPerson,
  intakeTimesOf,
  ПЕРВЫЙ, MAX_PEOPLE, targetsOf, glucoseTargetsOf, intakeSlotsOf, setIntakeSlots, newSlotId } from '../src/logic/people'

export {
  normalize,
  searchDrugs,
  searchHits,
  describeDrug,
  variantsOf,
  makersOf,
  formGroup,
  filterByForm,
  instructionUrl,
  mergeBooks,
  FORM_GROUPS,
  KIND_LABEL,
} from '../src/logic/drugs'

export { buildCalendar, countCalendarEvents, foldLine, doseTitle } from '../src/logic/calendar'

export {
  HORIZON_DAYS,
  MAX_REMINDERS,
  REPEATS,
  REPEAT_INTERVAL_MIN,
  buildReminders,
  buildMeasureReminders,
  planReminders,
  measureId,
  MEASURE_ID_BASE,
  MEASURE_ID_MAX,
  doseLine,
  reminderId,
  reminderTimes,
  shortBody,
} from '../src/logic/reminders'

export {
  DAY_PARTS,
  DAY_PART_TITLE,
  EXPIRY_SOON_DAYS,
  KEEP_INTAKES_DAYS,
  RESTOCK_DAYS,
  SUPPLY_SOON_DAYS,
  SUPPLY_SOON_RX_DAYS,
  addPack,
  soonDaysOf,
  adherence,
  foldHistory,
  partWindowOpen,
  historyTotal,
  monthKey,
  countAlerts,
  dayStatus,
  daysToExpiry,
  displayAlert,
  dosesOn,
  dosesToday,
  effectiveLeft,
  expiryToMonth,
  formatTime,
  isEstimated,
  markTakenAt,
  medicineAlert,
  monthToExpiry,
  normalizeTimes,
  packsNeeded,
  parseTime,
  partOfDay,
  pendingToday,
  perDayOf,
  perTimeOf,
  projectedLeft,
  restockList,
  restockText,
  runsOutAt,
  setLeft,
  shortForm,
  sortStock,
  stockOf,
  needUntilEnd,
  enoughForCourse,
  supplyDays,
  trackedSince,
  undoTaken,
  stageOn,
  doseChangeOn,
  formatCount
} from '../src/logic/medicines'

export {
  shouldAutoBackup,
  shouldWriteBackup,
  backupWarning,
  describeBackupAge,
  backupFilename,
  STALE_DAYS,
  BEHIND_COUNT,
  NO_BACKUP,
  recordsBehind,
} from '../src/logic/backup'
export { parseChangelog, currentVersion } from '../src/logic/changelog'
export { fillMissingFromCopy, mergeRestoredSettings, takesPersonalFrom } from '../src/logic/io'

/** Стек экранов: чистая модель навигации, без window и document. */
export {
  rootStack,
  tabOf,
  topOf,
  push,
  pop,
  replaceTop,
  depthOf,
  tapTab,
  toTab,
  pathOf,
  prune,
} from '../src/logic/nav'

/** Правила и подписи настроек: без React, чтобы проверялись обычными тестами. */
export {
  SECTIONS,
  THEMES,
  TEXT_SCALES,
  DENSITIES,
  SUBSCREENS,
  SUBSCREEN_TITLE,
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
} from '../src/logic/settings'

/** Слияние дневников двух телефонов: чистые правила, без хранилища. */
export { mergeDiary, mergeMedicine, mergeChangedAnything, diarySignature } from '../src/logic/merge'

/** Аптеки: ссылки на поиск, без сети и без обещаний про наличие. */
export {
  unitsOf, dosesPerPackUnit, needsDropSize, doseUnit, doseAmount, packUnit, toPackUnits, dosesInPack, DROPS_PER_ML,
} from '../src/logic/units'

export {
  normalizeRhythm, intakeOn, rhythmDuty, nextIntakeDays, shiftRhythm, describeRhythm, describeUpcoming, isoWeekday, WEEKDAYS,
} from '../src/logic/rhythm'

export { PHARMACIES, pharmacyQuery, pharmacyQueries, pharmacyLinks, cleanTradeName, describePharmacies, searchEngineUrl } from '../src/logic/pharmacies'
export type { Diary, Incoming, MergeResult, MergeLog } from '../src/logic/merge'

export { installWebPlatform, useIndexedDbFactory } from '../src/platform/web'

/** Чтение настроек мимо `loadSettings` — чтобы видеть, что легло в хранилище, а
 *  не то, что дописал читатель. Нужно проверке «первый человек сохранён». */
export { platform } from '../src/platform/ports'

import type { Medicine, Regimen } from '../src/types'
export { medicinesForReminder } from '../src/logic/reminders'

/**
 * Препарат со всеми полями типа. `Required<Medicine>` — чтобы новое поле в типе
 * ломало typecheck, пока его не добавят сюда и в разбор копии: круг «снимок →
 * файл → разбор» в tests/io.test.mjs сверяет каждое поле этой фикстуры.
 */
export const FULL_MEDICINE: Required<Medicine> = {
  rx: true,
  id: 'm-full', name: 'Периндоприл', dose: '5 мг', inn: 'Периндоприл', form: 'Таблетки', maker: 'Сервье',
  regNumber: 'ЛП-000001', kind: 1, packSize: 30, dropsPerMl: 40, left: 12, expires: Date.UTC(2027, 3, 30),
  note: 'после завтрака', leftAt: 1_700_000_000_000,
  updatedAt: 1_700_100_000_000,
}

/**
 * Курс приёма со всеми полями типа — тот же сторож, что и у коробки.
 *
 * `Required<Regimen>` ломает typecheck, пока новое поле не добавят сюда и в
 * разбор копии: круг «снимок → файл → разбор» сверяет каждое поле.
 */
export const FULL_REGIMEN: Required<Regimen> = {
  id: 'r-m-full', medicineId: 'm-full', person: 'p-dad',
  plan: [{ perTime: 0.5, days: 7 }, { perTime: 1, days: null }],
  planFrom: Date.UTC(2026, 7, 1),
  endsAt: Date.UTC(2026, 8, 30),
  perDay: 1, times: ['08:00', '20:00'], perTime: 1, meal: 'after',
  autoDeduct: true, taken: [1_700_000_000_000, 1_700_086_400_000],
  // Начало цикла — местная полночь: разбор копии приводит его к ней, и
  // ненормализованное значение сломало бы сверку круга не по делу.
  rhythm: { onDays: 5, offDays: 2, from: new Date(2026, 7, 1).getTime() },
  since: 1_690_000_000_000, startedAt: 1_680_000_000_000, foldedUntil: 1_699_000_000_000,
  history: { '2025-07': { planned: 62, taken: 58 }, '2025-08': { planned: 62, taken: 60 } },
  updatedAt: 1_700_100_000_000,
}

/** Классификация давления и сахара — пороги, по которым приложение зовёт скорую. */
export { classify, isWithinTarget, alertFor, glucoseCeiling, ALL_CATEGORIES } from '../src/logic/classify'
/** Статистика для отчёта врачу. */
export { describe, summarize, filterByPeriod, dailyAverages, movingAverage, glucoseMovingAverage, summarizeGlucose } from '../src/logic/stats'

/** Обмен через Яндекс.Диск: адреса и разбор, без сети. */
export {
  authUrl,
  parseToken,
  authHeader,
  listUrl,
  uploadUrl,
  downloadUrl,
  diskFileName,
  parseListing,
  parseHref,
  DISK_FOLDER,
  YANDEX_CLIENT_ID,
} from '../src/logic/yandex'

export { memoryUse, memoryHint, memoryTight, DEVICE_SLOTS } from '../src/logic/memory'
export { substances, sameSubstance, sameSubstanceText } from '../src/logic/duplicates'
export { silence, silenceText, SILENCE_DAYS } from '../src/logic/silence'
export { buildMemo, MEMO_DAYS } from '../src/logic/memo'
export { diaryByDays, daysMissed, SERIES_GAP_MIN, SERIES_RULE } from '../src/logic/diary'
export { medicineEvents, compareAround, comparable, COMPARE_DAYS, COMPARE_MIN } from '../src/logic/events'
export {
  slotWindows, measuredSlots, planDayIndex, planActiveOn, planIntersects,
  courseToday, courseText, courseReport, courseReportText, describeMeasurePlan, measureSubjects,
  measurePlanOf, readingOwner, planTimes, MAX_MEASURE_TIMES,
} from '../src/logic/course'

export { tours, tourByKey } from '../src/logic/tour'
export { TOOL_ITEMS, toolLabels } from '../src/logic/nav'

/** Курс приёма: совмещение с коробкой, конец курса, разбор старой коробки. */
export {
  dosing,
  dosings,
  regimensOf,
  regimensFor,
  orphanRegimens,
  regimenFinished,
  daysLeftOf,
  endsAfter,
  lengthOf,
  newRegimenId,
  formatDay,
  describeEnd,
} from '../src/logic/regimen'
export type { Dosing } from '../src/logic/regimen'
export { splitBox, splitBoxes, needsSplit, regimenIdFor } from '../src/logic/split'
export { mergeRegimen } from '../src/logic/merge'
