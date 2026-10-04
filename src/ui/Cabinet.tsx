import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { IntakeSlot, Medicine, Person, Regimen } from '../types'
import {
  displayAlert,
  effectiveLeft,
  isEstimated,
  medicineAlert,
  perDayOf,
  restockList,
  runsOutAt,
  sortStock,
  supplyDays,
  shortForm,
  stageOn,
  timesOf,
  soonDaysOf,
  type Stock,
} from '../logic/medicines'
import { buildCalendar, countCalendarEvents } from '../logic/calendar'
import { download } from '../logic/io'

import { describeRhythm } from '../logic/rhythm'
import { describeEnd, describeSchedule, regimenFinished, type Dosing } from '../logic/regimen'
import { packUnit } from '../logic/units'
import { ChevronIcon, PlusIcon } from './icons'
import { attentionOn, type Attention } from '../logic/attention'
import { FilterButton } from './Picker'
import { sameSubstance, sameSubstanceText, type SameSubstance } from '../logic/duplicates'
import { byPurpose, matchNote, purposesOf, searchStock, stockForPerson, type CabinetHit } from '../logic/cabinet'
import { alertText, ALERT_TONE, KindTag, MedicineNudge, Restock, Supply } from './Medicines'
import { MedicineCard } from './MedicineCard'
import { MedicineForm } from './MedicineForm'
import { RegimenForm } from './RegimenForm'

/**
 * Аптечка: что лежит дома.
 *
 * С 0.27.0 — общая на дом. Фильтр человека меняет просмотр, но не остаток. Коробка стоит в шкафу и
 * принадлежит дому, а кто её принимает, когда и до какого дня — это курс
 * приёма, и живёт он на «Приёме».
 *
 * Отдельный раздел от «Приёма»: сюда заходят раз в неделю — пересчитать пачку,
 * завести новый препарат, посмотреть срок. Ежедневное действие живёт в «Приёме»
 * и сюда не мешается.
 *
 * Строка списка — одна цель нажатия, открывает экран препарата. Раскрытия
 * прямо в списке нет намеренно: подробностей на десяток полей, а две цели
 * нажатия в одной строке дают промахи.
 */

type Filter = 'all' | 'week' | 'two-weeks' | 'month' | 'expired'

/**
 * С какого числа коробок показывать поиск.
 *
 * Пять — примерно тот размер, на котором глазами уже не находится. Меньше —
 * поле ввода только отделяет человека от списка, который и так весь виден.
 */
const ПОИСК_ОТ = 5

/** Ключ «любая категория»: людям такой полки не завести — он непечатаемый. */
const ВСЕ_КАТЕГОРИИ = '\u0000любая'

/**
 * Три раздела аптечки.
 *
 * Дело у них одно — домашние лекарства, — но вопросы разные: что лежит, по
 * какому расписанию это принимают и что пора купить. Порядок такой же, как
 * порядок вопросов: сперва что есть, потом что с этим делать, и только потом
 * поход в аптеку.
 *
 * Подписи короткие намеренно: три кнопки в строку на 360 точках при «Очень
 * крупном» тексте — это около семидесяти точек на слово.
 */
type Вид = 'boxes' | 'courses' | 'buy'

const ВИДЫ: { key: Вид; title: string }[] = [
  { key: 'boxes', title: 'Запасы' },
  { key: 'courses', title: 'Курсы' },
  { key: 'buy', title: 'Купить' },
]

/**
 * Фильтры аптечки — по сроку, на который хватит запаса.
 *
 * «Кончается» отвечало на вопрос «что уже горит», но настоящий вопрос другой:
 * «что взять, пока я в аптеке». Ответ у него временной — на неделю вперёд, на
 * две, на месяц. Пороги растут, и каждый следующий включает предыдущий: тот,
 * кто выбирает «на месяц», хочет видеть и то, что кончается завтра.
 */
const FILTERS: { key: Filter; title: string; days?: number }[] = [
  { key: 'all', title: 'Все' },
  { key: 'week', title: 'На неделю', days: 7 },
  { key: 'two-weeks', title: 'На 2 недели', days: 14 },
  { key: 'month', title: 'На месяц', days: 30 },
  { key: 'expired', title: 'Просрочены' },
]

export function Cabinet({
  stock,
  personFilter = null,
  regimens,
  intakeSlots,
  people,
  activePerson,
  onSave,
  onSaveRegimen,
  onDelete,
  onStopRegimen,
  pharmacies = [],
  attention = [],
  card = null,
  form = null,
  regimen = null,
  onOpenCard,
  onEditCard,
  onOpenSaved,
  onAdd,
  onOpenRegimen,
  onMemo,
  onBack,
}: {
  /** Аптечка дома: коробка и курсы, которые из неё принимают. */
  stock: Stock[]
  /** Фильтр просмотра; владелец медицинского дневника от него не меняется. */
  personFilter?: string | null
  /**
   * Сами курсы — форме нужны они, а не совмещённое представление: сохранять
   * она будет курс, и у него должны быть свои `id` и `medicineId`.
   */
  regimens: Regimen[]
  /** Кнопки стандартных приёмов из настроек — они же в форме препарата. */
  intakeSlots: IntakeSlot[]
  people: Person[]
  activePerson: string
  /** Возвращает идентификатор коробки: у новой он появляется при записи. */
  onSave: (item: Medicine) => Promise<string>
  /** Сохранить курс приёма — свой экран, своя запись. */
  onSaveRegimen: (next: Regimen) => Promise<void>
  onDelete: (id: string) => Promise<void>
  /** Прекратить приём, оставив коробку в аптечке. */
  onStopRegimen: (id: string) => Promise<void>
  /** Выбранные аптеки: кнопки поиска у препарата и в списке покупок. */
  pharmacies?: readonly string[]
  /**
   * Что в аптечке ждёт решения и в каком её разделе.
   *
   * Точка на вкладке «Аптечка» вела просто в аптечку, а разделов с 0.42.0
   * три: человек попадал в «Коробки», хотя купить надо было в «Купить». Теперь
   * горит и сам раздел.
   */
  attention?: readonly Attention[]
  /**
   * Открытая коробка и форма приходят снаружи, из стека экранов приложения.
   *
   * Своим состоянием они быть перестали: аппаратная «Назад» на Android должна
   * закрывать карточку, а не сворачивать приложение, и знать о ней обязано то
   * место, где живёт вся глубина. Заодно уход на другую вкладку и обратно
   * больше не теряет открытую коробку — раньше её стирало размонтирование.
   */
  card?: { id: string; edit?: 'left' } | null
  /** Открытая форма: `id` — правка коробки, `null` внутри объекта — новая. */
  form?: { id: string | null } | null
  /**
   * Открытый курс приёма: `id` — правка, `null` внутри объекта — новый.
   *
   * `medicineId` — препарат, выбранный заранее: с карточки заводят курс на
   * неё, и спрашивать о том, что человек только что смотрел, незачем.
   */
  regimen?: { id: string | null; medicineId?: string | null } | null
  /** `edit: 'left'` — открыть карточку сразу с полем остатка. */
  onOpenCard: (id: string, edit?: 'left') => void
  onEditCard: (id: string) => void
  /**
   * Коробку завели — открыть её карточку вместо формы.
   *
   * Именно вместо: форма своё дело сделала, и возвращаться в неё по «Назад»
   * незачем. Положить карточку поверх формы значило бы оставить её в стеке —
   * и аптечка, которая показывает форму раньше карточки, продолжила бы
   * показывать форму.
   */
  onOpenSaved: (id: string) => void
  onAdd: () => void
  /** Открыть курс: `null` — новый. */
  onOpenRegimen: (id: string | null, medicineId?: string | null) => void
  /** Лист на холодильник: что и когда принимать, с клетками под карандаш. */
  onMemo: () => void
  onBack: () => void
}) {
  /**
   * Какой раздел аптечки открыт.
   *
   * Три дела с одними и теми же коробками: что лежит дома, по какому расписанию
   * это принимают и что пора купить. Раньше «Купить» стояло карточкой и здесь,
   * и на «Обзоре» — то есть дважды, и оба раза посреди чужого содержимого.
   * Состояние местное: возвращаясь в аптечку, человек ждёт её такой, какой
   * оставил, но переживать перезапуск приложения этому выбору незачем.
   */
  const [вид, setВид] = useState<Вид>('boxes')
  const [filter, setFilter] = useState<Filter>('all')
  const [courseFilter, setCourseFilter] = useState<'all' | 'ongoing' | 'finished'>('all')
  /** Категория-полка: «Давление», «Простуда». Пусто — показываем все. */
  const [purpose, setPurpose] = useState('')
  const [query, setQuery] = useState('')
  /*
   * Поиск отстаёт от набора намеренно.
   *
   * Каждый символ — новая отрисовка всего списка с пересчётом предупреждений и
   * запаса по каждой коробке. `useDeferredValue` отдаёт полю ввода приоритет:
   * буквы появляются сразу, список догоняет. На «Очень крупном» и на телефоне
   * отца это разница между «печатает» и «залипает».
   */
  const отложенный = useDeferredValue(query)
  const семья = people.length > 1
  const now = Date.now()
  const видимые = useMemo(() => stockForPerson(stock, personFilter, now), [stock, personFilter, now])
  const покупки = useMemo(() => stockForPerson(stock, personFilter, now, true), [stock, personFilter, now])
  const имяЧеловека = (id: string) => people.find((p) => p.id === id)?.name?.trim() || 'Без имени'
  /**
   * Кто принимает эту коробку.
   *
   * Может быть несколько: одна упаковка на двоих — обычное дело в доме, и
   * ровно ради этого случая коробку от курса и отделили. Никого — коробка
   * просто лежит, и это не ошибка.
   */
  const ктоПринимает = (item: Stock) => {
    if (!семья) return null
    const имена = [...new Set(item.intakes.map((п) => имяЧеловека(п.person)))]
    return имена.length > 0 ? имена.join(', ') : null
  }
  const ктоПокупает = (item: Stock) => {
    if (!семья) return null
    const имена = [...new Set(item.intakes.filter((course) => !regimenFinished(course, now, stageOn(course, now)))
      .map((course) => имяЧеловека(course.person)))]
    return имена.length > 0 ? имена.join(', ') : null
  }
  /** Куда вернуть список после экрана препарата: терять место при возврате нельзя. */
  const scrollRef = useRef(0)
  const былоГлубже = useRef(false)

  // Прокрутку возвращаем сами: наверх стек не смотрит, а список из полутора
  // десятков коробок, открывшийся в начале, ощущается как потеря места.
  const глубже = card !== null || form !== null || regimen !== null
  useEffect(() => {
    if (былоГлубже.current && !глубже) {
      requestAnimationFrame(() => window.scrollTo({ top: scrollRef.current }))
    }
    былоГлубже.current = глубже
  }, [глубже])

  const открыть = (id: string) => {
    scrollRef.current = window.scrollY
    onOpenCard(id)
  }


  /*
   * Всё тяжёлое — через `useMemo`, и всё до единственного выхода ниже.
   *
   * Порядок, сверка веществ и счёт событий календаря обходят всю аптечку и
   * считают по каждой коробке предупреждения и запас. Пока экран был без поля
   * ввода, это случалось редко; с полем — на каждую букву.
   *
   * Ниже экран может вернуть карточку препарата или форму. Оставь хоть один
   * `useMemo` за этой развилкой — и React насчитает разное число хуков и
   * уронит приложение в белый экран; ровно этим когда-то кончался пустой
   * список покупок в `Restock`.
   */
  const категории = useMemo(() => purposesOf(видимые), [видимые])
  // Категория, которой в аптечке уже нет (последнюю коробку удалили или
  // переписали), не должна оставлять экран пустым молча.
  const категория = категории.some((c) => c === purpose) ? purpose : ''
  const поКатегории = useMemo(
    () => (категория ? byPurpose(видимые, категория) : видимые),
    [видимые, категория],
  )

  /** Найденное поиском. `null` — поиска нет, показываем всё по порядку. */
  const найдено: CabinetHit[] | null = useMemo(
    () => (отложенный.trim() ? searchStock(поКатегории, отложенный) : null),
    [поКатегории, отложенный],
  )

  const порог = FILTERS.find((item) => item.key === filter)?.days
  const rows = useMemo(() => {
    // При поиске порядок задаёт он сам — по точности совпадения, а не по
    // тревоге: человек искал конкретную коробку и ждёт её первой.
    const исходные = найдено ? найдено.map((h) => h.item) : sortStock(поКатегории, now)
    return исходные.filter((item) => {
      if (filter === 'all') return true
      const alert = medicineAlert(item.box, item.intakes, now)
      if (filter === 'expired') return alert?.kind === 'expired'
      if (порог === undefined) return true
      // Кончившееся и просроченное показываем при любом пороге: за ними идут в
      // аптеку в первую очередь, и прятать их за словом «на месяц» нельзя.
      if (alert?.kind === 'out' || alert?.kind === 'expired') return true
      const хватит = supplyDays(item.box, item.intakes, now)
      return хватит !== null && хватит <= порог
    })
  }, [найдено, поКатегории, filter, порог, now])

  /** Чем совпало — по идентификатору коробки, чтобы строка могла объяснить себя. */
  const объяснения = useMemo(
    () => new Map((найдено ?? []).map((h) => [h.item.box.id, matchNote(h)])),
    [найдено],
  )

  const всеПриёмы = useMemo(() => видимые.flatMap((item) => item.intakes)
    .filter((course) => personFilter === null || course.person === personFilter), [видимые, personFilter])
  const events = useMemo(() => countCalendarEvents(всеПриёмы, now), [всеПриёмы, now])
  // Сводим по действующему веществу то, что лежит дома: совпадение у разных
  // людей — не ошибка, у каждого своё назначение, но знать о нём стоит.
  const совпадения = useMemo(() => sameSubstance(видимые.map((item) => item.box)), [видимые])

  const opened = stock.find((item) => item.box.id === card?.id) ?? null

  if (form) {
    const открытая = stock.find((item) => item.box.id === form.id)
    const item = открытая?.box
    return (
      <div className="card">
        <div className="card__head">
          <h2>{item ? 'Изменить препарат' : 'Новый препарат'}</h2>
        </div>
        <MedicineForm
          medicine={item}
          onSave={async (next) => {
            const id = await onSave(next)
            // Свежая коробка ведёт в свою карточку, а не обратно в список.
            // Раньше курс заводился в этой же форме, и «сохранить» значило
            // «готово». Теперь коробка — только половина дела: на карточке
            // стоит «Завести курс приёма», и без неё человек, заведя
            // препарат, оказывался в списке без единого намёка, что приём
            // ещё надо назначить. Правка существующей возвращает назад: туда
            // приходили за одним полем и за ним же и уходят.
            if (item) onBack()
            else onOpenSaved(id)
          }}
          onCancel={onBack}
        />
      </div>
    )
  }

  if (regimen) {
    const правим = regimens.find((r) => r.id === regimen.id)
    return (
      <div className="card">
        <div className="card__head">
          <h2>{правим ? 'Курс приёма' : 'Новый курс приёма'}</h2>
        </div>
        <RegimenForm
          regimen={правим}
          medicines={stock.map((item) => item.box)}
          medicineId={regimen.medicineId}
          intakeSlots={intakeSlots}
          people={people}
          activePerson={personFilter ?? activePerson}
          onSave={async (next) => {
            await onSaveRegimen(next)
            onBack()
          }}
          onStop={
            правим
              ? async () => {
                  await onStopRegimen(правим.id)
                  onBack()
                }
              : undefined
          }
          onCancel={onBack}
          onAddMedicine={onAdd}
        />
      </div>
    )
  }

  if (opened) {
    return (
      <MedicineCard
        stock={opened}
        owner={ктоПринимает(opened)}
        people={people}
        pharmacies={pharmacies}
        onBack={onBack}
        onSave={onSave}
        onOpenRegimen={(id) => {
          scrollRef.current = window.scrollY
          onOpenRegimen(id, opened.box.id)
        }}
        editLeft={card?.edit === 'left'}
        onEdit={() => onEditCard(opened.box.id)}
        onDelete={async () => {
          await onDelete(opened.box.id)
          onBack()
        }}
      />
    )
  }

  const курсы = видимые.flatMap((item) => item.intakes
    .filter((course) => personFilter === null || course.person === personFilter)
    .filter((course) => courseFilter === 'all' || regimenFinished(course, now, stageOn(course, now)) === (courseFilter === 'finished'))
    .map((приём) => ({ item, приём })))
  const кПокупке = restockList(покупки, now)

  return (
    <div className="stack">
      <div className="card">
        <div className="card__head">
          <h2>{вид === 'boxes' ? 'Запасы лекарств' : вид === 'courses' ? 'Курсы приёма' : 'Список покупок'}</h2>
          <span className="muted">
            {вид === 'boxes' && видимые.length > 0 && `препаратов: ${видимые.length}`}
            {вид === 'courses' && курсы.length > 0 && `курсов: ${курсы.length}`}
            {вид === 'buy' && кПокупке.length > 0 && `покупок: ${кПокупке.length}`}
          </span>
        </div>

        {/* Полоса разделов и «добавить» — одной закреплённой строкой: на
            телефоне шапка прокручивается прочь, а завести коробку может
            понадобиться с любого места списка. */}
        <div className="cabinet__bar no-print" data-tour="cab-sections">
          <div className="segmented segmented--fill" role="group" aria-label="Разделы аптечки">
            {ВИДЫ.map((item) => {
              const ждёт = attentionOn(attention, item.key)
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={вид === item.key}
                  onClick={() => setВид(item.key)}
                >
                  {item.title}
                  {/* Точка на самой кнопке раздела: вкладка привела в аптечку,
                      а дело лежит в одном из трёх её разделов, и без этого
                      искать его надо было перебором. Подпись — для чтения с
                      экрана: цветная точка молчит. */}
                  {ждёт && (
                    <>
                      <span className="segmented__mark" aria-hidden="true" />
                      <span className="sr-only">, {ждёт.title}</span>
                    </>
                  )}
                </button>
              )
            })}
          </div>
          {/* Единственная кнопка в приложении без подписи, и это решение
              владельца. Подпись у неё есть для скринридера и всплывающая — в
              полосе на слово рядом со значком места нет.

              Заводит она то, чего не хватает в открытом разделе: в «Курсах» —
              курс, в остальных — коробку. Один значок на два дела, но дело
              всегда то, за которым человек сюда зашёл. */}
          <button
            type="button"
            className="cabinet__add"
            onClick={() => (вид === 'courses' ? onOpenRegimen(null) : onAdd())}
            data-tour="cab-add"
            aria-label={вид === 'courses' ? 'Завести курс приёма' : 'Добавить препарат'}
            title={вид === 'courses' ? 'Завести курс приёма' : 'Добавить препарат'}
          >
            <PlusIcon />
          </button>
        </div>

        {вид === 'boxes' && (
          <>
        {/* Поиск появляется, когда искать уже есть в чём. На трёх коробках
            поле ввода — лишний рубеж между человеком и списком. */}
        {(видимые.length >= ПОИСК_ОТ || query.trim() !== '') && (
          <label className="field no-print cabinet__search">
            <span>Найти в аптечке</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="название или вещество"
              autoComplete="off"
              // Автозамена молча правит название препарата, и человек этого не
              // замечает — та же причина, что в поиске по реестру.
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-label="Найти в аптечке"
            />
          </label>
        )}

        {(видимые.length > 1 || filter !== 'all' || категория !== '') && (
          <div className="row no-print cabinet__filters">
            <div className="cabinet__filter">
            <span className="muted">Запас и сроки</span>
            <FilterButton
              label="Что показывать"
              selected={filter}
              options={FILTERS.map((item) => ({ id: item.key, title: item.title }))}
              onPick={(id) => setFilter(id as Filter)}
            />
            </div>
            {/* Фильтр по полке — только из того, что в аптечке правда есть.
                Кнопка, половина вариантов которой всегда пуста, — это шум. */}
            {категории.length > 0 && (
              <div className="cabinet__filter">
              <span className="muted">Назначение</span>
              <FilterButton
                label="Для чего"
                selected={категория || ВСЕ_КАТЕГОРИИ}
                options={[
                  { id: ВСЕ_КАТЕГОРИИ, title: 'Все' },
                  ...категории.map((c) => ({ id: c, title: c })),
                ]}
                onPick={(id) => setPurpose(id === ВСЕ_КАТЕГОРИИ ? '' : id)}
              />
              </div>
            )}
          </div>
        )}

        {видимые.length === 0 && (
          <div className="chart__empty">
            {personFilter === null
              ? 'Аптечка пуста. Добавьте препараты и их остатки. Курс приёма включит прогноз запаса и список покупок.'
              : 'Для этого человека препаратов пока нет. Выберите «Все», чтобы увидеть всю аптечку.'}
          </div>
        )}

        {видимые.length > 0 && rows.length === 0 && (
          <div className="chart__empty">
            {найдено
              ? `Ничего не нашлось по запросу «${отложенный.trim()}». Поиск идёт по названию, веществу, дозировке, производителю и примечанию.`
              : 'В этой группе пусто — и это хорошая новость.'}
          </div>
        )}

        {rows.length > 0 && (
          <ul className="pills" data-tour="cab-list">
            {rows.map((item) => (
              <CabinetRow
                key={item.box.id}
                item={item}
                now={now}
                owner={ктоПринимает(item)}
                same={совпадения.get(item.box.id)}
                why={объяснения.get(item.box.id) ?? null}
                // Чужую коробку открываем как есть, не переключая человека.
                // Раньше переключали «чтобы правки шли владельцу», но владелец
                // берётся из самой коробки, отметить приём с карточки нельзя, а
                // менялся при этом весь экран под человеком, который просто
                // смотрел, что в доме заканчивается.
                onOpen={() => открыть(item.box.id)}
              />
            ))}
          </ul>
        )}

        {/* Столбиком во всю ширину: в строку эти две не помещаются, а по
            отдельности получаются разной длины — лесенкой. Добавление отсюда
            ушло: оно теперь значком в закреплённой полосе наверху. */}
        <div className="row row--stack" style={{ marginTop: 'var(--space-5)' }}>
          {/* Лист на кухню. Показываем, только когда есть расписание: без
              времён приёма печатать нечего, и кнопка обманывала бы. */}
          {(personFilter === null || personFilter === activePerson) && всеПриёмы.some((приём) => приём.person === activePerson && (приём.times?.length ?? 0) > 0) && (
            <button className="btn" onClick={onMemo}>
              {семья ? `Памятка: ${имяЧеловека(activePerson)}` : 'Памятка на холодильник'}
            </button>
          )}
          {events > 0 && (
            <button
              className="btn"
              onClick={() => void download('приём-лекарств.ics', buildCalendar(всеПриёмы, Date.now()), 'text/calendar')}
            >
              Напоминания в календарь
            </button>
          )}
        </div>
          </>
        )}

        {вид === 'courses' && (
          <>
            <div className="no-print cabinet__filter">
              <span className="muted">Статус курса</span>
              <FilterButton label="Статус курса" selected={courseFilter}
                options={[{ id: 'all', title: 'Все' }, { id: 'ongoing', title: 'Действующие' }, { id: 'finished', title: 'Завершённые' }]}
                onPick={(id) => setCourseFilter(id as typeof courseFilter)} />
            </div>
            {курсы.length === 0 ? (
              <div className="chart__empty">
                {courseFilter !== 'all' || personFilter !== null
                  ? 'По выбранным фильтрам курсов нет. Выберите «Все», чтобы увидеть остальные.'
                  : 'Курсов приёма пока нет. Курс — это «кто, что, когда и по сколько принимает»: по нему приходят напоминания и считается, на сколько хватит пачки. Заведите его кнопкой «+» сверху.'}
              </div>
            ) : (
              <ul className="pills">
                {курсы.map(({ item, приём }) => (
                  <CourseRow
                    key={приём.regimenId}
                    item={item}
                    приём={приём}
                    now={now}
                    кто={семья ? имяЧеловека(приём.person) : null}
                    onOpen={() => {
                      scrollRef.current = window.scrollY
                      onOpenRegimen(приём.regimenId)
                    }}
                  />
                ))}
              </ul>
            )}
          </>
        )}

        {вид === 'buy' && (
          <>
            {кПокупке.length === 0 ? (
              <div className="chart__empty">
                {personFilter === null ? 'Список покупок пуст.' : 'По текущим курсам этого человека покупать ничего не нужно. Выберите «Все», чтобы увидеть покупки для всей семьи.'}
              </div>
            ) : (
              <Restock
                stock={покупки}
                ownerName={ктоПокупает}
                pharmacies={pharmacies}
                onPick={(id) => onOpenCard(id, 'left')}
                bare
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Строка курса приёма.
 *
 * Отвечает ровно на то, зачем сюда пришли: кто принимает, что, когда и до
 * какого числа. Остатка и срока годности здесь намеренно нет — это свойства
 * коробки, и о них рассказывает раздел «Запасы».
 */
function CourseRow({
  item,
  приём,
  now,
  кто,
  onOpen,
}: {
  item: Stock
  приём: Dosing
  now: number
  /** Имя того, кто принимает. `null` — человек в дневнике один, имя лишнее. */
  кто: string | null
  onOpen: () => void
}) {
  const расписание = describeSchedule(timesOf(приём, now), describeRhythm(приём.rhythm), perDayOf(приём, now))
  const конец = regimenFinished(приём, now, stageOn(приём, now))
    ? (приём.stoppedAt !== undefined ? describeEnd(приём, now) : 'Курс завершён')
    : describeEnd(приём, now)
  return (
    <li className="pill">
      <button className="pill__open" onClick={onOpen}>
        <span className="pill__head">
          <span className="pill__title">
            <span className="pill__name">{item.box.name}</span>
            {item.box.dose && <span className="muted"> {item.box.dose}</span>}
          </span>
          <ChevronIcon />
        </span>
        {кто && <span className="pill__sub">{кто}</span>}
        <span className="pill__sub">{расписание || 'расписание не задано'}</span>
        {/* Про бессрочный курс молчим. Сказать «бессрочно» вслух на каждой
            строке — значит выстроить колонку из одного слова: у людей с
            гипертонией и диабетом бессрочны почти все курсы, и на этом фоне
            строка с настоящим сроком перестаёт быть заметной. Пустой строки
            при этом не остаётся — строка просто короче на одну. */}
        {конец && <span className="pill__sub muted">{конец}</span>}
      </button>
    </li>
  )
}

/**
 * Строка списка: только то, что нужно для беглого просмотра.
 *
 * Название, дозировка, полоса запаса и предупреждение. Всё остальное — на
 * экране препарата: в списке из полутора десятков коробок подробности мешают,
 * а не помогают.
 */
function CabinetRow({
  item,
  now,
  owner,
  same,
  why,
  onOpen,
}: {
  item: Stock
  now: number
  /** Кто её принимает. Пусто — человек в дневнике один или не принимает никто. */
  owner?: string | null
  /** У другой коробки то же действующее вещество. */
  same?: SameSubstance
  /**
   * Почему коробка нашлась, если совпало не название.
   *
   * Без этого результат выглядит ошибкой: человек ищет «амлодипин», а в списке
   * «Экватор» — и непонятно, при чём тут он.
   */
  why?: string | null
  onOpen: () => void
}) {
  const medicine = item.box
  const { alert, showSupply, enough } = displayAlert(medicine, item.intakes, now)
  const supply = supplyDays(medicine, item.intakes, now)
  const left = effectiveLeft(medicine, item.intakes, now)
  const estimated = isEstimated(medicine, item.intakes, now)
  // Ритм и автосписание — свойства курса, а не коробки. Двух разных ритмов на
  // одной коробке в строке списка не показать, поэтому берём первый: случай
  // «двое принимают по-разному» разбирается на экране препарата.
  const первый = item.intakes[0]

  return (
    <li className="pill">
      <button className="pill__open" onClick={onOpen}>
        <span className="pill__head">
          <span className="pill__title">
            <span className="pill__name">{medicine.name}</span>
            <KindTag kind={medicine.kind} />
            {medicine.dose && <span className="pill__dose">{medicine.dose}</span>}
          </span>
          <ChevronIcon />
        </span>

        <span className="pill__sub">
          {[
            owner ?? '',
            shortForm(medicine.form),
            left === null ? '' : `${estimated ? '≈ ' : ''}${left} ${packUnit(medicine)}`,
            // Ритм — в строке списка, а не только в карточке: по этому списку
            // собираются в аптеку, и «через день» меняет, сколько покупать.
            describeRhythm(первый?.rhythm) ?? '',
            estimated ? (первый?.autoDeduct ? 'отмечать не нужно' : 'по расчёту') : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>

        {alert && (
          <span className={`pill__alert pill__alert--${ALERT_TONE[alert.kind]}`}>{alertText(alert, medicine)}</span>
        )}

        {/* Только факт про собственный список человека — ни оценки, ни совета.
            Врач мог назначить так намеренно, и решать это не приложению.
            Поэтому и тон нейтральный: не предупреждение, а сведение. */}
        {same && <span className="pill__same">{sameSubstanceText(same)}</span>}

        {why && <span className="pill__why">{why}</span>}

        {showSupply && <Supply warningDays={soonDaysOf(medicine)} days={supply!} until={runsOutAt(medicine, item.intakes, now)} />}
        {enough && первый && <span className="supply supply--ok">Хватит до конца курса</span>}
      </button>
    </li>
  )
}

export { MedicineNudge }
