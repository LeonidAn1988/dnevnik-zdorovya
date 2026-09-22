import { useEffect, useRef, useState } from 'react'
import type { IntakeSlot, Medicine, Person, Regimen } from '../types'
import {
  displayAlert,
  effectiveLeft,
  isEstimated,
  medicineAlert,
  runsOutAt,
  sortStock,
  supplyDays,
  shortForm,
  type Stock,
} from '../logic/medicines'
import { buildCalendar, countCalendarEvents } from '../logic/calendar'
import { download } from '../logic/io'

import { describeRhythm } from '../logic/rhythm'
import { packUnit } from '../logic/units'
import { ChevronIcon } from './icons'
import { FilterButton } from './Picker'
import { sameSubstance, sameSubstanceText, type SameSubstance } from '../logic/duplicates'
import { alertText, ALERT_TONE, KindTag, MedicineNudge, Restock, Supply } from './Medicines'
import { MedicineCard } from './MedicineCard'
import { MedicineForm } from './MedicineForm'

/**
 * Аптечка: что лежит дома.
 *
 * С 0.27.0 — общая на дом, без выбора человека. Коробка стоит в шкафу и
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
  stock,
  regimens,
  intakeSlots,
  people,
  activePerson,
  onSave,
  onDelete,
  onStopRegimen,
  pharmacies = [],
  card = null,
  form = null,
  onOpenCard,
  onEditCard,
  onAdd,
  onMemo,
  onBack,
}: {
  /** Аптечка дома: коробка и курсы, которые из неё принимают. */
  stock: Stock[]
  /**
   * Сами курсы — форме нужны они, а не совмещённое представление: сохранять
   * она будет курс, и у него должны быть свои `id` и `medicineId`.
   */
  regimens: Regimen[]
  /** Кнопки стандартных приёмов из настроек — они же в форме препарата. */
  intakeSlots: IntakeSlot[]
  people: Person[]
  activePerson: string
  onSave: (item: Medicine, regimen?: Regimen | null) => Promise<void>
  onDelete: (id: string) => Promise<void>
  /** Прекратить приём, оставив коробку в аптечке. */
  onStopRegimen: (id: string) => Promise<void>
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
  const семья = people.length > 1
  const видимые = stock
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
  const opened = видимые.find((item) => item.box.id === card?.id) ?? null

  if (form) {
    const открытая = видимые.find((item) => item.box.id === form.id)
    const item = открытая?.box
    return (
      <div className="card">
        <div className="card__head">
          <h2>{item ? 'Изменить препарат' : 'Новый препарат'}</h2>
        </div>
        <MedicineForm
          people={people}
          activePerson={activePerson}
          medicine={item}
          regimens={regimens.filter((r) => r.medicineId === form.id)}
          intakeSlots={intakeSlots}
          onSave={async (next, курс) => {
            await onSave(next, курс)
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
        stock={opened}
        owner={ктоПринимает(opened)}
        pharmacies={pharmacies}
        onBack={onBack}
        onSave={onSave}
        onStopRegimen={(id) => void onStopRegimen(id)}
        editLeft={card?.edit === 'left'}
        onEdit={() => onEditCard(opened.box.id)}
        onDelete={async () => {
          await onDelete(opened.box.id)
          onBack()
        }}
      />
    )
  }

  const all = sortStock(видимые, now)
  const порог = FILTERS.find((item) => item.key === filter)?.days
  const rows = all.filter((item) => {
    if (filter === 'all') return true
    const alert = medicineAlert(item.box, item.intakes, now)
    if (filter === 'expired') return alert?.kind === 'expired' || alert?.kind === 'expiring'
    if (порог === undefined) return true
    // Кончившееся и просроченное показываем при любом пороге: за ними идут в
    // аптеку в первую очередь, и прятать их за словом «на месяц» нельзя.
    if (alert?.kind === 'out' || alert?.kind === 'expired') return true
    const хватит = supplyDays(item.box, item.intakes, now)
    return хватит !== null && хватит <= порог
  })

  const всеПриёмы = видимые.flatMap((item) => item.intakes)
  const events = countCalendarEvents(всеПриёмы)
  // Сводим по действующему веществу то, что лежит дома: совпадение у разных
  // людей — не ошибка, у каждого своё назначение, но знать о нём стоит.
  const совпадения = sameSubstance(видимые.map((item) => item.box))

  return (
    <div className="stack">
      <Restock
        stock={видимые}
        ownerName={ктоПринимает}
        pharmacies={pharmacies}
        onPick={(id) => onOpenCard(id, 'left')}
      />

      <div className="card">
        <div className="card__head">
          {/* Без имени человека: аптечка одна на дом. Чей курс — видно в
              строке коробки и на экране приёма. */}
          <h2>Аптечка</h2>
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
            Аптечка пуста. Внесите препараты — приложение предупредит, когда они кончаются или истекает срок.
          </div>
        )}

        {видимые.length > 0 && rows.length === 0 && (
          <div className="chart__empty">В этой группе пусто — и это хорошая новость.</div>
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
            отдельности получаются разной длины — лесенкой. */}
        <div className="row row--stack" style={{ marginTop: 'var(--space-5)' }}>
          <button className="btn btn--primary" onClick={onAdd} data-tour="cab-add">
            Добавить препарат
          </button>
          {/* Лист на кухню. Показываем, только когда есть расписание: без
              времён приёма печатать нечего, и кнопка обманывала бы. */}
          {всеПриёмы.some((приём) => (приём.times?.length ?? 0) > 0) && (
            <button className="btn" onClick={onMemo}>
              Памятка на холодильник
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
  item,
  now,
  owner,
  same,
  onOpen,
}: {
  item: Stock
  now: number
  /** Кто её принимает. Пусто — человек в дневнике один или не принимает никто. */
  owner?: string | null
  /** У другой коробки то же действующее вещество. */
  same?: SameSubstance
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

        {showSupply && <Supply days={supply!} until={runsOutAt(medicine, item.intakes, now)} />}
        {enough && первый && <span className="supply supply--ok">Хватит до конца курса</span>}
      </button>
    </li>
  )
}

export { MedicineNudge }
