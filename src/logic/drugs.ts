/**
 * Справочник лекарств: поиск по названию.
 *
 * Данные собираются из Государственного реестра лекарственных средств
 * генератором `tools/build_drugs.py` и лежат файлом рядом со сборкой. По сети
 * реестр из браузера не забрать — у выгрузки нет заголовков CORS, а ставить
 * своё зеркало значит пропускать через чужой сервер перечень лекарств
 * конкретного человека. Файл в бандле честнее.
 *
 * Здесь только поиск, без DOM и без React: на нативных платформах файл переедет
 * как есть.
 */

/**
 * Что это по документам: обычное лекарство, БАД или гомеопатия.
 *
 * Различие не косметическое. Лекарство доказывало действие на клинических
 * испытаниях, БАД — не лекарство и лечебного действия не заявляет, гомеопатия
 * зарегистрирована как лекарство, но действующего вещества в проверяемом
 * количестве не содержит. Человек, ведущий дневник давления, вправе знать, что
 * из его списка чем является — особенно если несёт этот список врачу.
 *
 * Пометки нет у обычного лекарства: их подавляющее большинство, и лишнее поле
 * на каждой записи стоило бы справочнику лишних килобайт.
 */
export type DrugKind = 1 | 2

export const KIND_LABEL: Record<DrugKind, string> = {
  1: 'БАД',
  2: 'гомеопатия',
}

export interface Drug {
  /** Торговое наименование, как в реестре. */
  n: string
  /** Международное непатентованное наименование. Врач называет препарат им. */
  i?: string
  /** 1 — БАД, 2 — гомеопатия. Пусто — обычное лекарство. */
  k?: DrugKind
  /**
   * 1 — отпускается по рецепту хотя бы в одной форме выпуска.
   *
   * Пометка приезжает из ГРЛС в том же поле, что и форма, и до сих пор
   * стиралась вместе с прочим шумом. Она стоит у 97 % строк реестра, но это
   * всё же подсказка, а не истина: относится к форме, записана свободным
   * текстом, и у наименования с несколькими формами разной категории мы
   * помечаем всё наименование. Человек её правит.
   */
  r?: 1
  /**
   * Варианты выпуска: `[номер формы в словаре, дозировки, размеры упаковки]`.
   *
   * Один препарат выпускают в нескольких формах, и дозировки у них разные:
   * у геля «5 %», у капсул «200 мг». Общий список дозировок был бы смесью,
   * из которой человек выбрал бы несуществующую пару.
   */
  v?: [number, string[], number[]?][]
  /** Производители — номера в словаре. Держим до трёх: нужно узнать свою пачку. */
  m?: number[]
}

/** Форма выпуска с её дозировками и размерами упаковки. */
export interface DrugVariant {
  form: string
  doses: string[]
  packs: number[]
}

export interface DrugBook {
  /** Дата выгрузки реестра. Справочник устаревает, и это видно в интерфейсе. */
  date: string
  /** Словарь форм. Названия повторяются тысячами раз, поэтому вынесены отдельно. */
  forms: string[]
  /** Словарь производителей — по той же причине. */
  makers: string[]
  items: Drug[]
}

/**
 * Склейка двух справочников в один.
 *
 * Лекарства и БАДы лежат в разных государственных реестрах и собираются двумя
 * генераторами, но человеку, который набирает «омега», знать про это ведомство
 * незачем — поиск обязан быть один.
 *
 * Словари форм и производителей у файлов свои, поэтому номера второго
 * сдвигаются на длину первого: без сдвига «капсулы» из БАДов показались бы
 * «таблетками» из лекарств.
 */
export function mergeBooks(base: DrugBook, extra: DrugBook | null): DrugBook {
  if (!extra) return base
  const formShift = base.forms.length
  const makerShift = base.makers.length

  const shifted = extra.items.map((drug) => ({
    ...drug,
    v: drug.v?.map(([form, doses, packs]) => [form + formShift, doses, packs] as [number, string[], number[]?]),
    m: drug.m?.map((index) => index + makerShift),
  }))

  return {
    // Дата на виду одна, и честнее показать более старую из двух: справочник
    // не свежее самой залежавшейся своей половины.
    date: [base.date, extra.date].filter(Boolean).sort()[0] ?? base.date,
    forms: [...base.forms, ...extra.forms],
    makers: [...base.makers, ...extra.makers],
    items: [...base.items, ...shifted].sort((a, b) => a.n.localeCompare(b.n, 'ru')),
  }
}

/** Разворачивает варианты препарата в названия форм. */
export function variantsOf(drug: Drug, forms: string[]): DrugVariant[] {
  return (drug.v ?? [])
    .map(([index, doses, packs]) => ({ form: forms[index] ?? '', doses, packs: packs ?? [] }))
    .filter((v) => v.form !== '')
}

/** Производители препарата словами. */
export function makersOf(drug: Drug, makers: string[]): string[] {
  return (drug.m ?? []).map((index) => makers[index] ?? '').filter(Boolean)
}

/**
 * Крупные группы форм для первого шага поиска.
 *
 * В реестре 2289 разных написаний формы — списком их не покажешь. Человек же
 * держит в руках коробку и знает одно: таблетки это или мазь. Группа сужает
 * поиск, а точное написание подставится потом из самого препарата.
 */
export const FORM_GROUPS: { key: string; title: string; match: string[] }[] = [
  { key: 'tab', title: 'Таблетки', match: ['таблетк', 'драже', 'пастилк'] },
  { key: 'cap', title: 'Капсулы', match: ['капсул'] },
  { key: 'drops', title: 'Капли', match: ['капли'] },
  { key: 'syrup', title: 'Сироп, суспензия', match: ['сироп', 'суспензи', 'эмульси'] },
  { key: 'inj', title: 'Ампулы, раствор', match: ['раствор', 'лиофилизат', 'концентрат', 'порошок для'] },
  { key: 'ointment', title: 'Мазь, крем, гель', match: ['мазь', 'крем', 'гель', 'линимент'] },
  { key: 'spray', title: 'Спрей, аэрозоль', match: ['спрей', 'аэрозоль'] },
  { key: 'other', title: 'Другое', match: [] },
]

/** К какой группе относится форма. Неопознанное попадает в «Другое». */
export function formGroup(form: string): string {
  const text = form.toLowerCase()
  for (const group of FORM_GROUPS) {
    if (group.match.some((needle) => text.includes(needle))) return group.key
  }
  return 'other'
}

/** Оставляет препараты, у которых есть форма из выбранной группы. */
export function filterByForm(items: Drug[], forms: string[], group: string): Drug[] {
  if (!group) return items
  return items.filter((drug) => (drug.v ?? []).some(([index]) => formGroup(forms[index] ?? '') === group))
}

/**
 * Приводим к сравнимому виду: реестр пишет «Аспирин® Кардио», человек набирает
 * «аспирин кардио». Без этого половина знакомых названий не находится.
 */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    // На пробел, не на пустоту: «СЛАБИДОЛ®КАПС» иначе склеивается в одно слово.
    .replace(/[®™©]/g, ' ')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim()
}

/**
 * Приведённые названия, посчитанные один раз.
 *
 * После слияния двух реестров в справочнике 35 тысяч наименований, и полный
 * проход случается на каждом нажатии клавиши — по запросу с малым числом
 * совпадений выхода раньше конца нет. Замер до кэша: 30 мс на настольной
 * машине, то есть заметное залипание ввода на телефоне пятилетней давности.
 *
 * `WeakMap` по объекту препарата, а не отдельный индекс: справочник может быть
 * пересобран (лекарства, потом лекарства с добавками), и старые записи должны
 * уходить из памяти сами.
 */
const normalizedName = new WeakMap<Drug, string>()
const normalizedInn = new WeakMap<Drug, string>()
const normalizedMakers = new WeakMap<string[], string[]>()

function nameOf(drug: Drug): string {
  let value = normalizedName.get(drug)
  if (value === undefined) {
    value = normalize(drug.n)
    normalizedName.set(drug, value)
  }
  return value
}

function innOf(drug: Drug): string {
  let value = normalizedInn.get(drug)
  if (value === undefined) {
    value = drug.i ? normalize(drug.i) : ''
    normalizedInn.set(drug, value)
  }
  return value
}

/**
 * Все дозировки препарата одной приведённой строкой.
 *
 * Нужны поиску: набрав «конкор 2,5», человек ищет вполне определённую коробку,
 * а дозировка лежит внутри записи и в поиске раньше не участвовала вовсе. У
 * «Конкора» их четыре записи, и та, что с 2,5 мг, называется «Конкор® Кор» —
 * угадать это по названию невозможно, приходилось открывать каждую.
 */
const normalizedDoses = new WeakMap<Drug, string>()

function dosesOf(drug: Drug): string {
  let value = normalizedDoses.get(drug)
  if (value === undefined) {
    value = normalize((drug.v ?? []).flatMap(([, doses]) => doses ?? []).join(' '))
    normalizedDoses.set(drug, value)
  }
  return value
}

/**
 * Разделить запрос на название и дозировку.
 *
 * «конкор 2 5» → название «конкор», дозировка «2 5». Границей считается первое
 * слово, начинающееся с цифры: названий, которые начинаются с числа, в реестре
 * хватает («9 месяцев Фолиевая кислота»), но там число стоит первым — и тогда
 * названия не остаётся, а значит и делить нечего.
 */
function splitQuery(needle: string): { text: string; dose: string } {
  const words = needle.split(' ').filter(Boolean)
  const at = words.findIndex((word) => /^\d/.test(word))
  if (at <= 0) return { text: needle, dose: '' }
  return { text: words.slice(0, at).join(' '), dose: words.slice(at).join(' ') }
}

function makersOfIndex(makers: string[]): string[] {
  let value = normalizedMakers.get(makers)
  if (value === undefined) {
    value = makers.map(normalize)
    normalizedMakers.set(makers, value)
  }
  return value
}

/** Сколько подсказок показываем. Больше — список не помещается и его перестают читать. */
export const SUGGEST_LIMIT = 8

/** По какому полю нашёлся препарат — подсказка показывает это словами. */
export type MatchField = 'name' | 'inn' | 'maker' | 'dose' | 'form'

export interface DrugHit {
  drug: Drug
  field: MatchField
}

/**
 * Поиск препарата по названию, действующему веществу и производителю.
 *
 * Порядок важности жёсткий: начало названия, затем название целиком, затем
 * вещество, затем производитель. Набрав «кард», человек ищет «Кардиомагнил», а
 * не всё, что выпускает «Кардиоцентр». Поиск по веществу нужен, когда врач
 * назвал препарат одним словом, а на упаковке другое; по производителю — когда
 * в руках коробка и знакомо только название завода.
 */
export function searchHits(
  items: Drug[],
  query: string,
  makers: string[] = [],
  limit = SUGGEST_LIMIT,
  criterion: MatchField | 'all' = 'all',
  forms: string[] = [],
): DrugHit[] {
  const needle = normalize(query)
  if (needle.length < 2) return []

  if (criterion !== 'all') {
    const words = needle.split(' ')
    const hits: DrugHit[] = []
    for (const drug of items) {
      const haystack = criterion === 'name' ? nameOf(drug) : criterion === 'inn' ? innOf(drug) : criterion === 'maker' ? normalize(makersOf(drug, makers).join(' ')) : criterion === 'dose' ? dosesOf(drug) : normalize((drug.v ?? []).map(v => forms[v[0]] ?? '').join(' '))
      if (words.every(word => haystack.includes(word))) hits.push({ drug, field: criterion })
      if (hits.length >= limit) break
    }
    return hits
  }
  const { text, dose } = splitQuery(needle)

  // Шесть корзин. Первые две — совпавшие и по названию, и по дозировке:
  // сначала простая дозировка, потом комбинированная. Спросив «конкор 2,5»,
  // человек ищет «Конкор® Кор» с 2,5 мг, а не «Конкор® НСТ» с «2,5 мг +
  // 6,25 мг» — тот тоже содержит эту цифру, но это другой препарат.
  // Дальше всё остальное в прежнем порядке.
  const buckets: DrugHit[][] = [[], [], [], [], [], []]
  const makerIndex = makersOfIndex(makers)

  for (const item of items) {
    const name = nameOf(item)

    if (dose && text) {
      const подходит =
        name.includes(text) ||
        innOf(item).includes(text) ||
        (item.m ?? []).some((index) => (makerIndex[index] ?? '').includes(text))
      if (подходит && dosesOf(item).includes(dose)) {
        // Простая дозировка — та, где нет знака сложения: «2,5 мг» против
        // «2,5 мг + 6,25 мг».
        const простая = (item.v ?? []).some((variant) =>
          (variant[1] ?? []).some((one) => !one.includes('+') && normalize(one).includes(dose)),
        )
        buckets[простая ? 0 : 1].push({ drug: item, field: 'dose' })
        if (buckets[0].length >= limit) break
        continue
      }
    }

    if (name.startsWith(needle)) buckets[2].push({ drug: item, field: 'name' })
    else if (name.includes(needle)) buckets[3].push({ drug: item, field: 'name' })
    else if (innOf(item).includes(needle)) buckets[4].push({ drug: item, field: 'inn' })
    else if ((item.m ?? []).some((index) => (makerIndex[index] ?? '').includes(needle)))
      buckets[5].push({ drug: item, field: 'maker' })
    else if (normalize((item.v ?? []).map(v => forms[v[0]] ?? '').join(' ')).includes(needle)) buckets[5].push({ drug: item, field: 'form' })
    else if (dosesOf(item).includes(needle)) buckets[5].push({ drug: item, field: 'dose' })
    else {
      const haystack = [name, innOf(item), dosesOf(item), normalize(makersOf(item, makers).join(' ')), normalize((item.v ?? []).map(v => forms[v[0]] ?? '').join(' '))].join(' ')
      if (needle.split(' ').every(word => haystack.includes(word))) buckets[5].push({ drug: item, field: 'name' })
    }

    // Раньше выхода нет: точные совпадения могут встретиться в конце реестра,
    // а он отсортирован по алфавиту, а не по важности.
    if (buckets[2].length >= limit) break
  }

  return buckets.flat().slice(0, limit)
}

/** Совместимость: части кода нужен только список препаратов, без поля совпадения. */
export function searchDrugs(items: Drug[], query: string, limit = SUGGEST_LIMIT): Drug[] {
  return searchHits(items, query, [], limit).map((hit) => hit.drug)
}

/**
 * Подпись под названием в подсказке: чем этот препарат является.
 *
 * Форм бывает несколько, но в подсказке нужна одна. Когда задан фильтр, берётся
 * форма из выбранной группы, а не первая попавшаяся: искали мазь, а подпись
 * сообщала «капсулы» — то есть про другой препарат из той же коробки.
 */
export function describeDrug(drug: Drug, forms: string[] = [], group = ''): string {
  const variants = drug.v ?? []
  const match = group ? variants.find(([index]) => formGroup(forms[index] ?? '') === group) : undefined
  const chosen = match ?? variants[0]
  const form = chosen ? forms[chosen[0]] : undefined
  // Дозировки — в подписи, а не внутри карточки. У «Конкора» четыре записи, и
  // без цифры они выглядят одинаково: человек открывал каждую, чтобы найти
  // свои 2,5 мг. Больше трёх не показываем — строка перестаёт читаться.
  const doses = chosen?.[1] ?? []
  const дозировки =
    doses.length === 0 ? '' : doses.length <= 3 ? doses.join(', ') : `${doses.slice(0, 3).join(', ')} и ещё ${doses.length - 3}`
  return [drug.i, form?.toLowerCase(), дозировки].filter(Boolean).join(' · ')
}

/**
 * Адрес официальной инструкции.
 *
 * Прямой ссылки на инструкцию у реестра нет: страница ГРЛС — форма с постбэком,
 * по адресу с параметрами она не открывается (проверено). Поэтому открываем
 * поиск по названию и дозировке. Наружу уходит только название препарата — оно
 * и так публично, ничего о человеке в запросе нет.
 */
export function instructionUrl(name: string, dose?: string): string {
  const query = [name, dose, 'инструкция по применению'].filter(Boolean).join(' ')
  return `https://yandex.ru/search/?text=${encodeURIComponent(query)}`
}

