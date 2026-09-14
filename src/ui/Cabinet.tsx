import { useEffect, useRef, useState } from 'react'
import type { IntakeSlot, Medicine, Person } from '../types'
import {
  displayAlert,
  effectiveLeft,
  isEstimated,
  medicineAlert,
  runsOutAt,
  sortMedicines,
  supplyDays,
  shortForm,
} from '../logic/medicines'
import { buildCalendar, countCalendarEvents } from '../logic/calendar'
import { download } from '../logic/io'

import { describeRhythm } from '../logic/rhythm'
import { ChevronIcon } from './icons'
import { FilterButton } from './Picker'
import { sameSubstance, sameSubstanceText, type SameSubstance } from '../logic/duplicates'
import { alertText, ALERT_TONE, KindTag, MedicineNudge, Restock, Supply } from './Medicines'
import { MedicineCard } from './MedicineCard'
import { ownerOf } from '../logic/people'
import { MedicineForm } from './MedicineForm'

/**
 * Аптечка: что лежит дома.
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
 * Фильтры аптечки — по сроку, на который хватит запаса.
 *
 * «Кончается» отвечало на вопрос «что уже горит», но настоящий вопрос другой:
 * «что взять, пока я в аптеке». Ответ у него временной — на неделю вперёд, на
 * две, на месяц. Пороги растут, и каждый следующий включает предыдущий: тот,
 * кто выбирает «на месяц», хочет видеть и то, что кончается завтра.
 */
const FILTERS: { key: Filter; title: string; days?: number }[] = [
  // «Вся аптечка», а не «Все»: рядом, на том же экране, «Все» уже значит «все
  // люди сразу». Два одинаковых слова про разное сбивают.
  { key: 'all', title: 'Все сроки' },
  { key: 'week', title: 'На неделю', days: 7 },
  { key: 'two-weeks', title: 'На 2 недели', days: 14 },
  { key: 'month', title: 'На месяц', days: 30 },
  { key: 'expired', title: 'Просрочены' },
]

export function Cabinet({
  medicines,
  allMedicines,
  intakeSlots,
  people,
  activePerson,
  onSave,
  onDelete,
  familyScope = false,
  pharmacies = [],
  card = null,
  form = null,
  onOpenCard,
  onEditCard,
  onAdd,
  onMemo,
  onBack,
}: {
  medicines: Medicine[]
  /** Вся аптечка семьи — для сводного вида. */
  allMedicines: Medicine[]
  /** Кнопки стандартных приёмов из настроек — они же в форме препарата. */
  intakeSlots: IntakeSlot[]
  people: Person[]
  activePerson: string
  onSave: (item: Medicine) => Promise<void>
  onDelete: (id: string) => Promise<void>
  /** Показывать всю семью, а не выбранного сверху человека. */
  familyScope?: boolean
  /** Выбранные аптеки: кнопки поиска у препарата и в списке покупок. */
  pharmacies?: readonly string[]
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
  /** `edit: 'left'` — открыть карточку сразу с полем остатка. */
  onOpenCard: (id: string, edit?: 'left') => void
  onEditCard: (id: string) => void
  onAdd: () => void
  /** Лист на холодильник: что и когда принимать, с клетками под карандаш. */
  onMemo: () => void
  onBack: () => void
}) {
  const [filter, setFilter] = useState<Filter>('all')
  /**
   * Чью аптечку показываем.
   *
   * Семейный вид нужен ради двух вопросов, которые в личной аптечке не
   * задаются: «что вообще заканчивается в доме» и «что купить одним походом».
   * Он живёт только здесь: приём и отчёт врачу общими быть не могут — отметка
   * ставится человеку, и отчёт тоже про одного.
   */
  const семья = people.length > 1
  // Кого показываем, решает полоса людей наверху — та же, что на остальных
  // экранах. Своего ряда кнопок здесь больше нет: их было два, и они спорили.
  const видимые = familyScope ? allMedicines : medicines
  const людиПоId = (id: string | null) => people.find((p) => p.id === id)?.name?.trim() || null
  const имяВладельца = (item: Medicine) => {
    if (!семья || !familyScope) return null
    const id = ownerOf(item, people)
    return people.find((p) => p.id === id)?.name?.trim() || null
  }
  /** Куда вернуть список после экрана препарата: терять место при возврате нельзя. */
  const scrollRef = useRef(0)
  const былоГлубже = useRef(false)

  // Прокрутку возвращаем сами: наверх стек не смотрит, а список из полутора
  // десятков коробок, открывшийся в начале, ощущается как потеря места.
  const глубже = card !== null || form !== null
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

  const now = Date.now()
  const opened =
    видимые.find((item) => item.id === card?.id) ?? allMedicines.find((item) => item.id === card?.id) ?? null

  if (form) {
    const item = allMedicines.find((m) => m.id === form.id)
    return (
      <div className="card">
        <div className="card__head">
          <h2>{item ? 'Изменить препарат' : 'Новый препарат'}</h2>
        </div>
        <MedicineForm
          people={people}
          activePerson={activePerson}
          medicine={item}
          intakeSlots={intakeSlots}
          onSave={async (next) => {
            await onSave(next)
            onBack()
          }}
          onCancel={onBack}
        />
      </div>
    )
  }

  if (opened) {
    return (
      <MedicineCard
        medicine={opened}
        owner={имяВладельца(opened) ?? (семья ? людиПоId(ownerOf(opened, people)) : null)}
        pharmacies={pharmacies}
        onBack={onBack}
        onSave={onSave}
        editLeft={card?.edit === 'left'}
        onEdit={() => onEditCard(opened.id)}
        onDelete={async () => {
          await onDelete(opened.id)
          onBack()
        }}
      />
    )
  }

  const all = sortMedicines(видимые, now)
  const порог = FILTERS.find((item) => item.key === filter)?.days
  const rows = all.filter((item) => {
    if (filter === 'all') return true
    const alert = medicineAlert(item, now)
    if (filter === 'expired') return alert?.kind === 'expired' || alert?.kind === 'expiring'
    if (порог === undefined) return true
    // Кончившееся и просроченное показываем при любом пороге: за ними идут в
    // аптеку в первую очередь, и прятать их за словом «на месяц» нельзя.
    if (alert?.kind === 'out' || alert?.kind === 'expired') return true
    const хватит = supplyDays(item, now)
    return хватит !== null && хватит <= порог
  })

  const events = countCalendarEvents(видимые)
  // Сводим по действующему веществу тот список, который человек видит: в
  // сводной аптечке семьи совпадение у разных людей — не ошибка, у каждого
  // своё назначение.
  const совпадения = sameSubstance(видимые)

  const имя = (id: string) => people.find((p) => p.id === id)?.name?.trim() || 'Без имени'

  return (
    <div className="stack">
      <Restock
        medicines={видимые}
        ownerName={имяВладельца}
        pharmacies={pharmacies}
        onPick={(id) => onOpenCard(id, 'left')}
      />

      <div className="card">
        <div className="card__head">
          <h2>
            Аптечка
            {семья && !familyScope && <span className="muted"> · {имя(activePerson)}</span>}
          </h2>
          {видимые.length > 0 && <span className="muted">препаратов: {видимые.length}</span>}
        </div>

        {видимые.length > 1 && (
          <div className="no-print">
            <FilterButton
              label="Что показывать"
              selected={filter}
              options={FILTERS.map((item) => ({ id: item.key, title: item.title }))}
              onPick={(id) => setFilter(id as Filter)}
            />
          </div>
        )}

        {видимые.length === 0 && (
          <div className="chart__empty">
            {/* Имя обязательно: пустой экран после переключения человека
                выглядит поломкой, пока не сказано, чья именно аптечка пуста. */}
            {/* Имя перед двоеточием, а не «у Лёлечки»: склонять чужие имена
                приложение не умеет и склонять не должно. */}
            {семья && !familyScope ? `${имя(activePerson)}: в аптечке пусто. ` : 'Аптечка пуста. '}
            Внесите препараты — приложение предупредит, когда они кончаются или истекает срок.
          </div>
        )}

        {видимые.length > 0 && rows.length === 0 && (
          <div className="chart__empty">В этой группе пусто — и это хорошая новость.</div>
        )}

        {rows.length > 0 && (
          <ul className="pills" data-tour="cab-list">
            {rows.map((item) => (
              <CabinetRow
                key={item.id}
                medicine={item}
                now={now}
                owner={имяВладельца(item)}
                same={совпадения.get(item.id)}
                // Чужую коробку открываем как есть, не переключая человека.
                // Раньше переключали «чтобы правки шли владельцу», но владелец
                // берётся из самой коробки, отметить приём с карточки нельзя, а
                // менялся при этом весь экран под человеком, который просто
                // смотрел, что в доме заканчивается.
                onOpen={() => открыть(item.id)}
              />
            ))}
          </ul>
        )}

        {/* Столбиком во всю ширину: в строку эти две не помещаются, а по
            отдельности получаются разной длины — лесенкой. */}
        <div className="row row--stack" style={{ marginTop: 'var(--space-5)' }}>
          <button className="btn btn--primary" onClick={onAdd} data-tour="cab-add">
            Добавить препарат
          </button>
          {/* Лист на кухню. Показываем, только когда есть расписание: без
              времён приёма печатать нечего, и кнопка обманывала бы. */}
          {видимые.some((item) => (item.times?.length ?? 0) > 0) && (
            <button className="btn" onClick={onMemo}>
              Памятка на холодильник
            </button>
          )}
          {events > 0 && (
            <button
              className="btn"
              onClick={() => void download('приём-лекарств.ics', buildCalendar(видимые, Date.now()), 'text/calendar')}
            >
              Напоминания в календарь
            </button>
          )}
        </div>

      </div>
    </div>
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
  medicine,
  now,
  owner,
  same,
  onOpen,
}: {
  medicine: Medicine
  now: number
  /** Чья коробка. Пусто — своя или человек в дневнике один. */
  owner?: string | null
  /** У другой коробки то же действующее вещество. */
  same?: SameSubstance
  onOpen: () => void
}) {
  const { alert, showSupply } = displayAlert(medicine, now)
  const supply = supplyDays(medicine, now)
  const left = effectiveLeft(medicine, now)
  const estimated = isEstimated(medicine, now)

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
            left === null ? '' : `${estimated ? '≈ ' : ''}${left} шт.`,
            // Ритм — в строке списка, а не только в карточке: по этому списку
            // собираются в аптеку, и «через день» меняет, сколько покупать.
            describeRhythm(medicine.rhythm) ?? '',
            estimated ? (medicine.autoDeduct ? 'отмечать не нужно' : 'по расчёту') : '',
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

        {showSupply && <Supply days={supply!} until={runsOutAt(medicine, now)} />}
      </button>
    </li>
  )
}

export { MedicineNudge }
