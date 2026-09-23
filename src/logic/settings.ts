/**
 * Правила и подписи настроек.
 *
 * Настройки переехали из одного свитка в два уровня: корень со списком строк
 * «заголовок · текущее значение · шеврон» и подэкраны. Из-за этого правила,
 * которые раньше жили прямо в разметке одной карточки, стали общими для двух
 * экранов сразу: например, «сахар» включается на «Нормах», а стартовый экран
 * выбирается на «Экране», и оба обязаны согласованно поправить `startTab`.
 * Продублировать такое правило в двух местах — значит однажды разойтись.
 *
 * Поэтому здесь всё, что можно посчитать без React: какие разделы видны, что
 * будет при снятии галки, и что написать в строке корня, чтобы человеку не
 * приходилось открывать подэкран ради проверки. Проверяется обычными тестами
 * без браузера.
 */

import type { SectionKey, Settings, ThemeChoice } from '../types'
import { describeBackupAge } from './backup'
import type { Person } from '../types'
import { glucoseTargetsOf, intakeTimesOf, targetsOf } from './people'
import { plural } from './plural'
import { REPEATS } from './reminders'

/**
 * Разделы, которые можно скрыть.
 *
 * У одного пользователя гипертония и диабет — ему нужны все три дневника.
 * Другому нужны только лекарства, и два лишних пункта внизу он видит каждый
 * день без всякой пользы.
 *
 * Сахара в списке нет намеренно: его вкладка живёт от «Вести дневник сахара»
 * на «Нормах». Две галки на одно решение — конъюнкция, в которой человек
 * выключает сахар в одном месте и не понимает, почему он остался в другом.
 */
export const SECTIONS: { key: SectionKey; title: string; hint: string }[] = [
  { key: 'overview', title: 'Обзор', hint: 'сводка давления и сахара' },
  { key: 'bp', title: 'Давление', hint: 'ввод, история и графики' },
  { key: 'intake', title: 'Приём лекарств', hint: 'что принять сегодня' },
  { key: 'cabinet', title: 'Аптечка', hint: 'что есть дома, сроки и остатки' },
]

export const THEMES: { key: ThemeChoice; title: string }[] = [
  { key: 'auto', title: 'Как в системе' },
  { key: 'light', title: 'Светлая' },
  { key: 'dark', title: 'Тёмная' },
]

export const TEXT_SCALES: { key: Settings['textScale']; title: string }[] = [
  { key: 'small', title: 'Мельче' },
  { key: 'normal', title: 'Обычный' },
  { key: 'large', title: 'Крупный' },
  { key: 'xlarge', title: 'Очень крупный' },
]

export const DENSITIES: { key: Settings['density']; title: string }[] = [
  { key: 'compact', title: 'Плотно' },
  { key: 'normal', title: 'Обычно' },
  { key: 'roomy', title: 'Просторно' },
]


/** Подэкраны настроек. Порядок тот же, что в корне: частое выше редкого. */
export const SUBSCREENS = ['display', 'people', 'targets', 'pharmacies', 'reminders', 'backup', 'family', 'guide', 'about'] as const
export type Subscreen = (typeof SUBSCREENS)[number]

export const SUBSCREEN_TITLE: Record<Subscreen, string> = {
  display: 'Экран',
  people: 'Пользователи',
  targets: 'Нормы',
  pharmacies: 'Аптеки',
  reminders: 'Напоминания',
  backup: 'Копия дневника',
  family: 'Семья',
  guide: 'Как пользоваться',
  about: 'О приложении',
}

/** Порядок разделов в нижней строке — тот же, что у вкладок приложения. */
const ПОРЯДОК: SectionKey[] = ['overview', 'bp', 'glucose', 'intake', 'cabinet']

/** Разделы, видимые в нижней строке. Сахар — от собственного переключателя. */
export function visibleSections(settings: Pick<Settings, 'sections' | 'trackGlucose'>): SectionKey[] {
  return ПОРЯДОК.filter((key) => (key === 'glucose' ? settings.trackGlucose : settings.sections[key]))
}

/**
 * Последний оставшийся раздел — его галку нельзя снять.
 *
 * Приложение без разделов это пустой экран без объяснений, а вернуть их будет
 * неоткуда: нижней строки, через которую открываются настройки, тоже не станет.
 *
 * Сахар в этом счёте не участвует, хотя вкладку он даёт. Иначе получалась бы
 * ловушка: сняв все галки при включённом сахаре, человек выключает сахар на
 * соседнем экране — и остаётся вообще без разделов.
 */
export function lockedSection(settings: Pick<Settings, 'sections' | 'trackGlucose'>): SectionKey | null {
  const включённые = SECTIONS.filter((item) => settings.sections[item.key])
  return включённые.length === 1 ? включённые[0].key : null
}

/** Стартовый экран не должен указывать на спрятанное. */
function поправитьСтарт(sections: Settings['sections'], trackGlucose: boolean, startTab: string): string {
  const остались = visibleSections({ sections, trackGlucose })
  if (остались.includes(startTab as SectionKey)) return startTab
  return остались[0] ?? startTab
}

/** Показать или скрыть раздел. Возвращает и `startTab`: он мог указывать на него. */
export function toggleSection(
  settings: Pick<Settings, 'sections' | 'trackGlucose' | 'startTab'>,
  key: SectionKey,
  on: boolean,
): Pick<Settings, 'sections' | 'startTab'> {
  const sections = { ...settings.sections, [key]: on }
  return { sections, startTab: поправитьСтарт(sections, settings.trackGlucose, settings.startTab) }
}

/**
 * Включить или выключить дневник сахара.
 *
 * Одно решение — один переключатель. Поле `sections.glucose` при этом остаётся
 * в согласии с ним: его читают старые копии и знакомство, и разойтись этим
 * двум значениям нельзя.
 */
export function setTrackGlucose(
  settings: Pick<Settings, 'sections' | 'trackGlucose' | 'startTab'>,
  on: boolean,
): Pick<Settings, 'sections' | 'trackGlucose' | 'startTab'> {
  const sections = { ...settings.sections, glucose: on }
  return { sections, trackGlucose: on, startTab: поправитьСтарт(sections, on, settings.startTab) }
}


/**
 * Поменять целевое давление.
 *
 * Пишется дважды: человеку и в общие настройки. Общие нужны для совместимости
 * в обе стороны — сборка без личных целей прочитает копию, снятую этой, и
 * получит осмысленные числа, а не значения по умолчанию. Двойную запись можно
 * будет снять, когда на всех телефонах семьи будет 0.8.0 и новее.
 */
export function setTargets(
  settings: Pick<Settings, 'people' | 'targetSys' | 'targetDia'>,
  personId: string | null,
  next: { sys: number; dia: number },
): Partial<Settings> {
  const общие = { targetSys: next.sys, targetDia: next.dia }
  if (settings.people.length <= 1 || !personId) return общие
  // Остальным записываем то, что у них и было. Без этого правка цели жены
  // молча меняла бы цель мужу: своей у него нет, а общая только что уехала на
  // её цифры ради совместимости со старыми сборками.
  return {
    ...общие,
    people: settings.people.map((p) =>
      p.id === personId ? { ...p, targets: next } : { ...p, targets: targetsOf(p, settings) },
    ),
  }
}

/** Поменять пороги сахара. Пишется так же дважды, см. `setTargets`. */
export function setGlucoseTargets(
  settings: Pick<Settings, 'people' | 'glucoseFastingMax' | 'glucosePostMealMax' | 'glucoseLow'>,
  personId: string | null,
  next: { fastingMax: number; postMealMax: number; low: number },
): Partial<Settings> {
  const общие = {
    glucoseFastingMax: next.fastingMax,
    glucosePostMealMax: next.postMealMax,
    glucoseLow: next.low,
  }
  if (settings.people.length <= 1 || !personId) return общие
  // Как и с давлением: чужие пороги закрепляем прежними, иначе общее значение
  // утащит их за собой.
  return {
    ...общие,
    people: settings.people.map((p) =>
      p.id === personId ? { ...p, glucose: next } : { ...p, glucose: glucoseTargetsOf(p, settings) },
    ),
  }
}

// ── подписи строк корня ────────────────────────────────────────────────────
//
// Строка корня обязана отвечать на вопрос «что там сейчас» без открывания:
// иначе список из шести названий заставляет обходить все шесть подэкранов,
// чтобы вспомнить, что настроено.

export function describeDisplay(settings: Pick<Settings, 'theme' | 'density' | 'textScale'>): string {
  const тема = THEMES.find((item) => item.key === settings.theme)?.title ?? ''
  const размер = (TEXT_SCALES.find((item) => item.key === settings.textScale)?.title ?? '').toLowerCase()
  // Размер текста в строке обязателен: он переехал внутрь этого экрана, и без
  // подписи человек, пришедший «сделать буквы крупнее», не поймёт, куда идти.
  return `${тема.toLowerCase()} · текст ${размер}`
}

export function describePeople(people: Person[], intakeTimes?: Settings['intakeTimes']): string {
  const имена = people.map((person, index) => person.name.trim() || `Человек ${index + 1}`).join(', ')
  // Строка обязана назвать и кнопки приёма: они лежат внутри человека, третьим
  // уровнем, и человек их там просто не находил — искал в «Приёме», в форме
  // препарата, где угодно, кроме «Людей».
  if (!intakeTimes) return имена
  return `${имена} · настройки и часы приёма`
}

export function describeTargets(
  settings: Pick<Settings, 'targetSys' | 'targetDia' | 'trackGlucose'>,
  person?: Person | null,
): string {
  const цель = targetsOf(person ?? null, settings)
  const сахар = settings.trackGlucose ? 'сахар ведётся' : 'сахар не ведётся'
  return `давление ${цель.sys}/${цель.dia} · ${сахар}`
}

export function describeReminders(settings: Pick<Settings, 'remindersOn' | 'remindersRepeat'>): string {
  if (!settings.remindersOn) return 'выключены'
  if (!settings.remindersRepeat) return 'включены, без повтора'
  return `включены, повтор ${REPEATS} ${plural(REPEATS, 'раз', 'раза', 'раз')}`
}

/** Строка «Семья» в корне: сколько телефонов подключено. */
export function describeFamily(sources: number, supported: boolean, ownFile = true, cloud = false): string {
  // Облако важнее файлов: подключённый Диск — и есть настроенный обмен.
  if (cloud) return sources > 0 ? `Яндекс.Диск и файлов: ${sources}` : 'через Яндекс.Диск'
  if (!supported) return 'обмен не настроен'
  if (sources === 0) return 'обмен не настроен'
  // Свой телефон считается, только если его копия куда-то пишется: иначе
  // «телефонов: 3» обещает обмен, которого в одну сторону нет.
  if (!ownFile) return `свой файл не выбран, читаются ${sources}`
  return `телефонов: ${sources + 1}`
}

/** «последняя вчера» или «копий ещё не было» — обычным тоном, это не тревога. */
export function describeBackupRow(lastAt: number | null, now: number): string {
  return lastAt === null ? 'копий ещё не было' : `последняя ${describeBackupAge(lastAt, now)}`
}

/** «Отец · кнопка 2 · часы 09:00–21:30» — строка человека в списке «Людей». */
export function describePerson(person: Person, общиеЧасы: Settings['intakeTimes']): string {
  const часы = intakeTimesOf(person, общиеЧасы)
  const кнопка = person.deviceUser === undefined ? 'без кнопки прибора' : `кнопка ${person.deviceUser}`
  return `${кнопка} · часы ${часы.morning}–${часы.night}`
}

/** Что скрыто из нижней строки — для свёрнутого «Что показывать внизу». */
export function describeSections(settings: Pick<Settings, 'sections'>): string {
  const скрытые = SECTIONS.filter((item) => !settings.sections[item.key])
  if (скрытые.length === 0) return 'показаны все'
  if (скрытые.length === 1) return `скрыт раздел «${скрытые[0].title}»`
  return `скрыто ${скрытые.length} ${plural(скрытые.length, 'раздел', 'раздела', 'разделов')}`
}

/**
 * Привести настройки в согласие с самими собой перед записью.
 *
 * Пока правило одно, и оно повторяет то, что уже делает `loadSettings` при
 * чтении: выбранный человек обязан существовать в списке. Читатель это чинил, а
 * писатель — нет, и настройки могли уехать в хранилище с указателем на
 * человека, которого в них больше нет. После слияния или удаления такое
 * состояние живёт до следующего запуска, а до тех пор отбор «мои курсы» не
 * находит ничего либо находит чужое.
 *
 * Одно место на всех: через него проходит каждая запись настроек, и забыть
 * позвать его неоткуда.
 */
export function normalizeSettings(next: Settings): Settings {
  if (next.people.length === 0) return next
  if (next.people.some((p) => p.id === next.activePerson)) return next
  return { ...next, activePerson: next.people[0].id }
}
