import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { addDays } from '../logic/days'
import type { MealTimer } from '../types'
import type { Dosing } from '../logic/regimen'
import { plural } from '../logic/plural'
import { doseAmount } from '../logic/units'
import {
  DAY_PARTS,
  DAY_PART_TITLE,
  KEEP_INTAKES_DAYS,
  dayStatus,
  dosesOn,
  partOfDay,
  startOfDay,
  type DayPart,
  type DayStatus,
  partWindowOpen,
  perTimeOf,
  formatCount,
  doseChangeOn,
  plannedAt,
  timesOf
} from '../logic/medicines'

/**
 * Приём лекарств по дням.
 *
 * Отдельный раздел, а не часть аптечки: это действие делают каждый день, а в
 * аптечку заглядывают раз в неделю. Смешивать их — значит заставлять человека
 * каждое утро проходить мимо складского учёта.
 *
 * Здесь намеренно нет ни формы выпуска, ни действующего вещества, ни срока
 * годности. Утром нужно знать одно: что выпить и не забыл ли. Всё остальное
 * живёт в карточке препарата.
 */

const DAY = 24 * 60 * 60 * 1000

/** Насколько назад можно листать. Дальше отметок всё равно не хранится. */
const PAST_DAYS = KEEP_INTAKES_DAYS
/** Насколько вперёд. Неделя закрывает вопрос «что нужно завтра». */
const FUTURE_DAYS = 7

const MEAL_TITLE = { before: 'До еды', any: 'Независимо от еды', during: 'Во время еды', after: 'После еды' }

const MEAL_LABEL: Record<string, string> = { before: 'до еды', after: 'после еды', during: 'во время еды' }

/** «2 шт., после еды» — то, чего не хватало строке приёма. */
function doseExtra(medicine: Dosing, day: number): string {
  const доза = perTimeOf(medicine, day)
  const штук = doseAmount(medicine, доза, formatCount(доза))
  const еда = medicine.mealMinutes && (medicine.meal === 'before' || medicine.meal === 'after') ? `${medicine.meal === 'before' ? 'за' : 'через'} ${medicine.mealMinutes} мин ${MEAL_LABEL[medicine.meal]}` : medicine.meal ? (MEAL_LABEL[medicine.meal] ?? '') : ''
  return [штук, еда].filter(Boolean).join(', ')
}

const WEEKDAY = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' })
const DAY_TITLE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })
const MONTH_YEAR = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' })
const ACCESSIBLE_DAY = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

/** Подпись дня словами: «сегодня» читается быстрее, чем «14 августа». */
function dayName(day: number, today: number): string {
  const diff = Math.round((startOfDay(day) - startOfDay(today)) / DAY)
  if (diff === 0) return 'Сегодня'
  if (diff === -1) return 'Вчера'
  if (diff === 1) return 'Завтра'
  return DAY_TITLE.format(day)
}

const STATUS_TITLE: Record<DayStatus, string> = {
  done: 'всё принято',
  missed: 'есть пропуски',
  pending: 'ещё не всё',
  future: 'впереди',
  empty: 'приёмов нет',
}

/**
 * Лента дат.
 *
 * Главная жалоба на приложения этого класса — нельзя вернуться и отметить
 * вчерашнюю дозу. Поэтому прошлые дни здесь равноправны с сегодняшним, а не
 * заперты. Состояние дня видно точкой: цвет плюс подпись, потому что одним
 * цветом смысл передавать нельзя.
 */
function DayStrip({
  days,
  selected,
  today,
  statusOf,
  onSelect,
}: {
  days: number[]
  selected: number
  today: number
  statusOf: (day: number) => DayStatus
  onSelect: (day: number) => void
}) {
  const stripRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const [visibleMonth, setVisibleMonth] = useState(() => MONTH_YEAR.format(selected))

  const selectDay = (day: number) => {
    setVisibleMonth(MONTH_YEAR.format(day))
    onSelect(day)
  }

  // The heading follows the date at the center of the visible strip, even
  // when the user scrolls without changing the selected day.
  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const updateVisibleMonth = () => {
      scrollFrameRef.current = null
      const center = strip.getBoundingClientRect().left + strip.clientWidth / 2
      const closest = [...strip.querySelectorAll<HTMLButtonElement>('[data-day]')].reduce<HTMLButtonElement | null>((best, button) => {
        const bounds = button.getBoundingClientRect()
        const distance = Math.abs(bounds.left + bounds.width / 2 - center)
        if (!best) return button
        const bestBounds = best.getBoundingClientRect()
        return distance < Math.abs(bestBounds.left + bestBounds.width / 2 - center) ? button : best
      }, null)
      if (closest) setVisibleMonth(MONTH_YEAR.format(Number(closest.dataset.day)))
    }
    const onScroll = () => {
      if (scrollFrameRef.current === null) scrollFrameRef.current = requestAnimationFrame(updateVisibleMonth)
    }
    strip.addEventListener('scroll', onScroll, { passive: true })
    updateVisibleMonth()
    return () => {
      strip.removeEventListener('scroll', onScroll)
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current)
    }
  }, [])

  // Выбранный день подтягивается в центр: без этого при открытии видно начало
  // ленты — то есть два месяца назад, а не сегодня.
  useLayoutEffect(() => {
    const strip = stripRef.current
    const active = activeRef.current
    if (!strip || !active) return
    strip.scrollLeft = active.offsetLeft - strip.clientWidth / 2 + active.clientWidth / 2
  }, [selected])

  /**
   * Стрелки двигают выбор, табуляция проходит ленту одной остановкой.
   *
   * Лента объявлена `tablist`, а вела себя как шестьдесят восемь отдельных
   * кнопок: чтобы добраться клавиатурой до содержимого дня, приходилось
   * нажимать Tab шестьдесят восемь раз, и стрелки при этом не делали ничего.
   * Образец для вкладок обратный: в обходе одна остановка — выбранная, —
   * а между ними ходят стрелками.
   */
  const onKeyDown = (event: React.KeyboardEvent) => {
    const шаг =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'Home' ? -days.length : event.key === 'End' ? days.length : 0
    if (шаг === 0) return
    event.preventDefault()
    const текущий = days.findIndex((day) => startOfDay(day) === startOfDay(selected))
    const следующий = Math.min(days.length - 1, Math.max(0, (текущий < 0 ? days.length - 1 : текущий) + шаг))
    stripRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[следующий]?.focus({ preventScroll: true })
    selectDay(days[следующий])
  }

  return (
    <>
      <p className="daystrip__month" id="daystrip-month" aria-live="polite">{visibleMonth}</p>
      <div className="daystrip" ref={stripRef} role="tablist" aria-label="Выбор дня" aria-describedby="daystrip-month" onKeyDown={onKeyDown}>
        {days.map((day) => {
          const status = statusOf(day)
          const active = startOfDay(day) === startOfDay(selected)
          return (
            <button
              key={day}
              ref={active ? activeRef : undefined}
              role="tab"
              aria-label={`${ACCESSIBLE_DAY.format(day)}, ${STATUS_TITLE[status]}`}
              aria-selected={active}
              // В обходе табуляции — только выбранный день.
              tabIndex={active ? 0 : -1}
              className="daystrip__day"
              data-day={startOfDay(day)}
              data-status={status}
              data-today={startOfDay(day) === startOfDay(today) ? 'true' : undefined}
              onClick={() => selectDay(day)}
            >
              <span className="daystrip__weekday">{WEEKDAY.format(day)}</span>
              <span className="daystrip__date">{new Date(day).getDate()}</span>
              <span className="daystrip__dot" aria-hidden="true" />
              <span className="sr-only">{STATUS_TITLE[status]}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}

interface Slot {
  medicine: Dosing
  time: string
  planned: number
  takenAt: number | null
  overdue: boolean
}

function needsConfirmation(row: Slot, day: number, now: number) {
  return row.takenAt === null && (!row.medicine.autoDeduct || (!!row.medicine.mealMinutes && (row.medicine.meal === 'before' || row.medicine.meal === 'after') && startOfDay(day) === startOfDay(now)))
}

function canCollapsePart(rows: Slot[], day: number, now: number, future: boolean, onMealTimer?: (id: string, kind: 'eat' | 'dose', planned: number) => Promise<void>, modern?: boolean): boolean {
  if (!modern || future || rows.some(row => needsConfirmation(row, day, now))) return false
  return !rows.some(row => onMealTimer && startOfDay(day) === startOfDay(now) && row.medicine.mealMinutes && ((row.medicine.meal === 'before' && row.takenAt !== null) || (row.medicine.meal === 'after' && row.takenAt === null)))
}

export function Intake({
  medicines,
  onMark,
  onMealTimer,
  onCancelMealTimer,
  onAddMedicine,
  mealTimers = [],
  toRoot = 0,
  openDay = null,
  openPart = null,
  onPartOpened,
  modern = false,
  scopeKey = '',
  имя = null,
}: {
  medicines: Dosing[]
  /**
   * Отметить или снять отметку приёма.
   *
   * Экран передаёт только «какой препарат и какой приём», а новое состояние
   * собирается там, где видно настоящее содержимое хранилища. Собирать его
   * здесь было нельзя: пропс — слепок последней отрисовки, и второе нажатие
   * подряд строило отметку на препарате без первой, стирая её.
   */
  onMark: (id: string, plannedTs: number, undo?: boolean) => Promise<void>
  mealTimers?: MealTimer[]
  onMealTimer?: (id: string, kind: 'eat' | 'dose', planned: number) => Promise<void>
  onCancelMealTimer?: (id: string) => void
  onAddMedicine?: () => void
  /** Меняется, когда человек нажал на уже активную вкладку: вернуться на сегодня. */
  toRoot?: number
  /**
   * День, который надо показать: приходит от нажатия по напоминанию.
   *
   * Напоминание может быть о вчерашнем приёме — например, человек нажал
   * «Принял» утром на уведомлении, которое пришло вечером. Открыть при этом
   * сегодняшний день значит показать не то, что он только что отметил.
   */
  openDay?: number | null
  /** Часть суток, выбранная с карточки «Приёмы сегодня» на обзоре. */
  openPart?: DayPart | null
  onPartOpened?: () => void
  modern?: boolean
  /** Перемонтирует локальное раскрытие при смене члена семьи. */
  scopeKey?: string
  /** Чей приём показан. Пусто, пока человек в дневнике один: уточнять нечего. */
  имя?: string | null
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => Date.now())
  const [selected, setSelected] = useState(() => openDay ?? Date.now())
  const [showFullDay, setShowFullDay] = useState(false)
  const [collapseAllSignal, setCollapseAllSignal] = useState(0)
  const [collapseAllParts, setCollapseAllParts] = useState<DayPart[]>([])

  // День из уведомления главнее текущего выбора: человек только что нажал
  // «Принял» именно на нём.
  useEffect(() => {
    if (openDay !== null) setSelected(openDay)
  }, [openDay])

  // Уйдя листать прошлую неделю, вернуться к сегодняшнему дню человек будет
  // именно нажатием на вкладку — искать «Сегодня» в ленте из шести десятков
  // дней он не станет.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    setSelected(Date.now())
  }, [toRoot])

  useEffect(() => {
    setShowFullDay(false)
  }, [scopeKey, startOfDay(selected)])

  // Время идёт: без обновления «пора принять» не станет «время прошло», пока
  // человек не перезайдёт. Раз в минуту достаточно и не греет телефон.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  useLayoutEffect(() => {
    if (!openPart) return
    const target = rootRef.current?.querySelector<HTMLElement>(`[data-part="${openPart}"]`)
    if (!target) return
    target.scrollIntoView({ block: 'start', behavior: 'smooth' })
    target.focus({ preventScroll: true })
    onPartOpened?.()
  }, [openPart, selected, onPartOpened])

  const days: number[] = []
  // Календарными сутками: в ночь перевода часов сложение миллисекундами
  // повторяет один день дважды, а соседний теряет.
  for (let offset = -PAST_DAYS; offset <= FUTURE_DAYS; offset++) {
    days.push(addDays(new Date(startOfDay(now)), offset).getTime())
  }

  const slots: Slot[] = medicines
    .flatMap((medicine) =>
      dosesOn(medicine, selected, now).map((slot) => ({
        medicine,
        time: slot.time,
        planned: plannedAt(selected, slot.time),
        takenAt: slot.takenAt,
        overdue: slot.overdue,
      })),
    )
    .sort((a, b) => a.time.localeCompare(b.time))

  const byPart = DAY_PARTS.map((part) => ({
    part,
    rows: slots.filter((slot) => partOfDay(slot.time) === part),
  })).filter((group) => group.rows.length > 0)

  const left = slots.filter(row => needsConfirmation(row, selected, now)).length
  const future = startOfDay(selected) > startOfDay(now)
  const canExpandCompleted = modern && byPart.some(({ rows }) => canCollapsePart(rows, selected, now, future, onMealTimer, modern))
  const orderedParts = modern && !future ? [...byPart].sort((a, b) => {
    const priority = (rows: Slot[]) => {
      const hasActiveEatTimer = rows.some(row => mealTimers.some(timer =>
        timer.kind === 'eat' && timer.regimenId === row.medicine.regimenId &&
        timer.plannedAt === row.planned && timer.person === row.medicine.person &&
        !timer.cancelledAt && timer.dueAt > now
      ))
      if (hasActiveEatTimer) return 0
      if (!rows.some(row => needsConfirmation(row, selected, now))) return 2
      const canStartMealTimer = rows.some(row => startOfDay(selected) === startOfDay(now) && (
        (row.medicine.meal === 'after' && row.medicine.mealMinutes && row.takenAt === null) ||
        (row.medicine.autoDeduct && row.medicine.meal === 'before' && row.medicine.mealMinutes && row.takenAt === null)
      ))
      const firstTime = rows.map(row => row.time).sort()[0]
      return canStartMealTimer || partWindowOpen(selected, firstTime, now) ? 0 : 1
    }
    const delta = priority(a.rows) - priority(b.rows)
    return delta || DAY_PARTS.indexOf(a.part) - DAY_PARTS.indexOf(b.part)
  }) : byPart

  return (
    <div className="stack" ref={rootRef}>
      <DayStrip
        days={days}
        selected={selected}
        today={now}
        statusOf={(day) => dayStatus(medicines, day, now)}
        onSelect={setSelected}
      />

      <div className="intake__head" data-tour="intake-day">
        <h2>
          {dayName(selected, now)}
          {имя && <span className="muted"> · {имя}</span>}
        </h2>
        {/* Живая область: отметка приёма — самое частое действие в
            приложении, и до этого она проходила совсем молча. Экранный
            диктор теперь произносит, сколько осталось, сразу после
            нажатия. */}
        <span className="muted" role="status" aria-live="polite">
          {slots.length === 0
            ? 'приёмов нет'
            : left === 0
              ? 'всё отмечено'
              : future
                ? `приёмов: ${slots.length}`
                : `осталось отметить: ${left}`}
        </span>
      </div>

      {canExpandCompleted && <button type="button" className="intake__full-day" aria-expanded={showFullDay} onClick={() => {
        if (showFullDay) {
          setShowFullDay(false)
          setCollapseAllParts(byPart
            .filter(({ rows }) => canCollapsePart(rows, selected, now, future, onMealTimer, modern))
            .map(({ part }) => part))
          setCollapseAllSignal(value => value + 1)
        } else setShowFullDay(true)
      }}>
        {showFullDay ? 'Свернуть выполненные' : 'Показать выполненные'}
      </button>}

      {slots.length === 0 && (
        <div className="card">
          <div className="chart__empty">
            {medicines.length === 0
              ? 'Здесь будут приёмы по вашему расписанию. Сначала добавьте препарат и назначьте ему курс.'
              : 'На этот день приёмов нет.'}
          </div>
          {medicines.length === 0 && onAddMedicine && <button type="button" className="btn btn--primary" onClick={onAddMedicine}>
            Добавить препарат и расписание
          </button>}
        </div>
      )}

      {orderedParts.map(({ part, rows }) => (
        <PartCard key={`${scopeKey}-${startOfDay(selected)}-${part}`} part={part} rows={rows} future={future} day={selected} now={now} onMark={onMark} onMealTimer={onMealTimer} onCancelMealTimer={onCancelMealTimer} mealTimers={mealTimers} modern={modern} expand={openPart === part} expandAll={showFullDay} collapseAllSignal={collapseAllSignal} collapseAllPart={collapseAllParts.includes(part)} />
      ))}
    </div>
  )
}

/**
 * Карточка части суток.
 *
 * Пожилой человек мыслит «утренние таблетки», а не «приём в 08:00» — так
 * назначение и проговаривает врач. Точное время при этом никуда не девается,
 * оно стоит у каждой строки.
 */
function PartCard({
  part,
  rows,
  future,
  day,
  now,
  onMark,
  onMealTimer,
  onCancelMealTimer,
  mealTimers = [],
  modern = false,
  expand = false,
  expandAll = false,
  collapseAllSignal = 0,
  collapseAllPart = false,
}: {
  part: DayPart
  rows: Slot[]
  future: boolean
  /** Выбранный день и текущее время — для окна части суток. */
  day: number
  now: number
  onMark: (id: string, plannedTs: number, undo?: boolean) => Promise<void>
  mealTimers?: MealTimer[]
  onMealTimer?: (id: string, kind: 'eat' | 'dose', planned: number) => Promise<void>
  onCancelMealTimer?: (id: string) => void
  modern?: boolean
  expand?: boolean
  expandAll?: boolean
  collapseAllSignal?: number
  collapseAllPart?: boolean
}) {
  const needsMark = (row: Slot) => needsConfirmation(row, day, now)
  const done = rows.every(row => !needsMark(row))
  const [занят, setЗанят] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const actionButtons = useRef(new Map<string, { mark?: HTMLButtonElement; undo?: HTMLButtonElement }>())
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const focusIntent = useRef(0)
  const focusAfterMark = useRef<{ key: string; action: 'mark' | 'undo'; source: HTMLElement; intent: number; before: number | null } | null>(null)
  const actionKey = (row: Slot) => `${row.medicine.regimenId}:${row.planned}`
  const actionRef = (row: Slot, action: 'mark' | 'undo') => (button: HTMLButtonElement | null) => {
    const key = actionKey(row)
    const refs = actionButtons.current.get(key) ?? {}
    if (button) refs[action] = button
    else delete refs[action]
    if (refs.mark || refs.undo) actionButtons.current.set(key, refs)
    else actionButtons.current.delete(key)
  }
  useLayoutEffect(() => {
    const pending = focusAfterMark.current
    if (!pending) return
    if (pending.intent !== focusIntent.current) {
      focusAfterMark.current = null
      return
    }
    const row = rows.find(item => actionKey(item) === pending.key)
    if (!row) return
    if (row.takenAt === pending.before) return
    if (pending.action === 'undo' && row.takenAt === null) {
      focusAfterMark.current = null
      return
    }
    if (pending.action === 'mark' && row.takenAt !== null) {
      focusAfterMark.current = null
      return
    }
    const active = document.activeElement
    if (active !== pending.source && !(active === document.body && !pending.source.isConnected)) {
      focusAfterMark.current = null
      return
    }
    const button = actionButtons.current.get(pending.key)?.[pending.action]
    ;(button ?? cardRef.current)?.focus({ preventScroll: true })
    focusAfterMark.current = null
  }, [rows])

  useEffect(() => {
    const cancelIfUserMoved = () => {
      focusIntent.current += 1
      focusAfterMark.current = null
    }
    document.addEventListener('focusin', cancelIfUserMoved)
    document.addEventListener('pointerdown', cancelIfUserMoved, true)
    return () => {
      document.removeEventListener('focusin', cancelIfUserMoved)
      document.removeEventListener('pointerdown', cancelIfUserMoved, true)
    }
  }, [])

  function clearIfUnchanged(pending: NonNullable<typeof focusAfterMark.current>) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (focusAfterMark.current !== pending) return
      const current = rowsRef.current.find(item => actionKey(item) === pending.key)
      if (!current || current.takenAt === pending.before) focusAfterMark.current = null
    }))
  }

  async function markDose(row: Slot, undo = false, source?: HTMLElement) {
    const key = actionKey(row)
    const origin = source ?? (document.activeElement instanceof HTMLElement ? document.activeElement : cardRef.current)
    const pending = {
      key,
      action: undo ? 'mark' as const : 'undo' as const,
      source: origin ?? document.body,
      intent: focusIntent.current,
      before: row.takenAt,
    }
    focusAfterMark.current = pending
    try {
      await onMark(row.medicine.regimenId, undo ? row.takenAt! : row.planned, undo)
    } catch (error) {
      if (focusAfterMark.current === pending) focusAfterMark.current = null
      throw error
    }
    // Some storage adapters report a write failure through UI state while
    // resolving this callback. If the row did not change, discard the focus
    // request after React has had a frame to commit a successful refresh.
    clearIfUnchanged(pending)
  }

  /**
   * Открыто ли окно этой части суток.
   *
   * До открытия у строк нет кнопок — только серое «с 19:00». Иначе утром
   * единственными синими кнопками на экране оказывались вечерние, и человек
   * отмечал вечерний приём в десять утра. Кто раскладывает таблетницу заранее,
   * идёт через «Отметить заранее» с вопросом — осознанно, а не мимоходом.
   * Разрешение живёт до смены дня: на другую дату оно не переносится.
   */
  const первоеВремя = [...rows].map((row) => row.time).sort()[0]
  const открыто = !future && partWindowOpen(day, первоеВремя, now)
  const [досрочно, setДосрочно] = useState(false)
  const [спросить, setСпросить] = useState(false)
  useEffect(() => {
    setДосрочно(false)
    setСпросить(false)
  }, [day])
  const можно = открыто || досрочно

  // Что в этой карточке ещё не отмечено. Препараты с автосписанием не считаем:
  // кнопки «Принял» у них нет вовсе, и отмечать за них нечего.
  const неотмеченных = rows.filter(needsMark)

  async function принятьВсё(group: Slot[], source: HTMLElement) {
    setЗанят(true)
    const pendingRows = group.filter(needsMark)
    const last = pendingRows.at(-1)
    const pending = last ? { key: actionKey(last), action: 'undo' as const, source, intent: focusIntent.current, before: last.takenAt } : null
    if (pending) focusAfterMark.current = pending
    try {
      // По очереди, а не разом: каждая отметка меняет остаток препарата, и
      // параллельная запись затёрла бы соседнюю — обе читают одно состояние.
      for (const row of pendingRows) {
        await onMark(row.medicine.regimenId, row.planned)
      }
      if (pending) clearIfUnchanged(pending)
    } catch (error) {
      if (pending && focusAfterMark.current === pending) focusAfterMark.current = null
      throw error
    } finally {
      setЗанят(false)
    }
  }
  const времена = [...new Set(rows.map((row) => row.time))].sort()
  const часыКарточки = времена.length > 1 ? `${времена[0]}–${времена[времена.length - 1]}` : времена[0]
  const activeMealTimer = (row: Slot) => mealTimers.find(timer =>
    timer.regimenId === row.medicine.regimenId &&
    timer.plannedAt === row.planned &&
    timer.kind === (row.medicine.meal === 'before' ? 'eat' : 'dose') &&
    timer.person === row.medicine.person &&
    !timer.cancelledAt &&
    timer.dueAt > now
  )
  const canCollapse = canCollapsePart(rows, day, now, future, onMealTimer, modern)
  const [collapsed, setCollapsed] = useState(() => canCollapse && !expand && !expandAll)
  const previouslyCollapsible = useRef(canCollapse)
  const lastCollapseSignal = useRef(collapseAllSignal)
  useEffect(() => {
    if (previouslyCollapsible.current && !canCollapse) setCollapsed(false)
    previouslyCollapsible.current = canCollapse
  }, [canCollapse])
  useEffect(() => {
    if (collapseAllSignal === lastCollapseSignal.current) return
    lastCollapseSignal.current = collapseAllSignal
    if (collapseAllPart && canCollapse) setCollapsed(true)
  }, [collapseAllSignal, collapseAllPart, canCollapse])
  const isCollapsed = canCollapse && collapsed && !expandAll
  const onlyAutomatic = rows.every(row => row.medicine.autoDeduct)

  return (
    <div ref={cardRef} className="card intake" data-part={part} data-done={done ? 'true' : undefined} tabIndex={-1}>
      <div className="card__head">
        <h2>{DAY_PART_TITLE[part]}</h2>
        {/* Часть суток может держать несколько приёмов: «Вечер» это и 20:00, и
            21:00. Раньше в заголовок шло время первой строки, и карточка
            уверяла, что весь вечер — двадцать ноль-ноль. */}
        <span className="muted">{часыКарточки}</span>
      </div>

      {canCollapse && !expandAll && <button
        type="button"
        className="intake__part-toggle"
        aria-expanded={!isCollapsed}
        onClick={() => setCollapsed(value => !value)}
      >
        {isCollapsed ? 'Показать приёмы' : 'Свернуть выполненное'} · {onlyAutomatic ? 'запас списывается автоматически' : неотмеченных.length === 0 ? 'всё отмечено' : `осталось ${неотмеченных.length}`}
      </button>}

      {isCollapsed ? <ul className="doses doses--summary" aria-label={`${DAY_PART_TITLE[part]} — выполненные приёмы`}>
        {rows.map(row => <li className="dose" key={`${row.medicine.regimenId}-${row.time}`}>
          <span className="dose__body">
            <span className="dose__name">{row.medicine.name}</span>
            {row.medicine.autoDeduct
              ? <span className="dose__extra">Запас списывается автоматически; это не подтверждает приём</span>
              : <span className="dose__done">✓ принято <button ref={actionRef(row, 'undo')} className="dose__undo" onClick={event => { setCollapsed(false); void markDose(row, true, event.currentTarget) }}>убрать отметку</button></span>}
          </span>
          <span className="dose__time">{row.time}</span>
        </li>)}
      </ul> : <>

      {(['before', 'any', 'during', 'after'] as const).map(meal => {
        const group = rows.filter(row => (row.medicine.meal ?? 'any') === meal)
        if (!group.length) return null
        const remaining = group.filter(needsMark)
        return <section className="intake__meal" key={meal} aria-label={MEAL_TITLE[meal]}>
          <h3>{MEAL_TITLE[meal]}</h3>
          {meal === 'before' && group.some(r => r.medicine.mealMinutes) && <p className="muted">После «Принял» таймер напомнит, когда можно есть.</p>}
          {meal === 'after' && group.some(r => r.medicine.mealMinutes) && <p className="muted">Нажмите «Закончил есть», чтобы запустить отсчёт до приёма.</p>}
          {можно && remaining.length > 1 && <button className="btn" disabled={занят} onClick={event => void принятьВсё(group, event.currentTarget)}>
            {занят ? 'Отмечаю…' : `Принял всё — ${remaining.length} ${plural(remaining.length, 'приём', 'приёма', 'приёмов')}`}
          </button>}
      <ul className="doses">
        {group.map((row) => (
          <li
            key={`${row.medicine.regimenId}-${row.time}`}
            className="dose"
            data-done={row.takenAt !== null ? 'true' : undefined}
          >
            {/* Когда приём в карточке один, час уже стоит в заголовке —
                повторять его у каждой строки значит писать одно число трижды.
                Колонку при этом убираем целиком: пустой span шириной 3,5em
                оставлял слева широкий провал и сдвигал названия к середине. */}
            {времена.length > 1 && <span className="dose__time">{row.time}</span>}

            <span className="dose__body">
              <span className="dose__name">{row.medicine.name}</span>
              {row.medicine.dose && <span className="dose__amount">{row.medicine.dose}</span>}
              {row.medicine.autoDeduct && <span className="dose__extra">Запас списывается автоматически</span>}
              {/* Сколько штук и когда относительно еды.
                  Экран приёма отвечает на вопрос «что выпить сейчас», и без
                  количества он отвечает на половину: назначение «по две
                  таблетки утром» превращалось в «Лозап 50 мг». Ошибка вдвое по
                  дозе у гипертоника опаснее пропуска. В уведомлении эти данные
                  показывались, а на самом экране — нет. */}
              {doseExtra(row.medicine, day) && <span className="dose__extra">{doseExtra(row.medicine, day)}</span>}
              {/* Смена дозы по схеме — молча её проводить нельзя: человек
                  примет по привычке прежнее число, а назначение уже другое. */}
              {(() => {
                const смена = doseChangeOn(row.medicine, day)
                return смена ? (
                  <span className="dose__change">
                    сегодня {timesOf(row.medicine, day).length} приём(а): по {formatCount(смена.to)} {doseAmount(row.medicine, смена.to, '')} · {timesOf(row.medicine, day).join(' и ')}
                  </span>
                ) : null
              })()}
              {/* Отметка и её отмена стоят одной строкой под названием, а не в
                  колонке действий: широкая кнопка выдавливала название в три
                  строки, и отмеченная строка была вдвое выше остальных. */}
              {row.takenAt !== null && (
                <span className="dose__done">
                  {/* Раньше здесь стояло «принято в 08:00», и это было
                      плановое время, а не фактическое: приняв таблетки в 11:40,
                      человек читал, что принял их в восемь. Приложение врало в
                      собственных данных, и эта неправда уезжала врачу. Пока
                      отметка хранит плановый час (по нему приём и опознаётся),
                      честнее не называть час вовсе. */}
                  ✓ принято
                  <button ref={actionRef(row, 'undo')} className="dose__undo" onClick={event => void markDose(row, true, event.currentTarget)}>
                    убрать отметку
                  </button>
                </span>
              )}
              {/* Тревога только там, где есть что сделать. У препарата с
                  автосписанием кнопки «Принял» нет вовсе, и остаток списывается
                  сам — «время прошло» на нём это тревога без повода и без
                  выхода, да ещё и набранная ярче отмеченных строк. */}
              {row.medicine.autoDeduct && (row.medicine.meal === 'before' || row.medicine.meal === 'after') && row.medicine.mealMinutes && row.takenAt === null && startOfDay(day) === startOfDay(now) && <button className="btn btn--sm" onClick={() => void onMark(row.medicine.regimenId, row.planned)}>{row.medicine.meal === 'before' ? 'Принял — запустить таймер' : 'Принял'}</button>}
              {onMealTimer && startOfDay(day) === startOfDay(now) && row.medicine.mealMinutes && ((row.medicine.meal === 'before' && row.takenAt !== null) || (row.medicine.meal === 'after' && row.takenAt === null)) && (() => {
                const timer = activeMealTimer(row)
                return timer ? <span className="dose__timer" role="group" aria-label={`Таймер ${row.medicine.name}`}>
                  <span className="dose__extra">{timer.kind === 'eat' ? 'Можно есть через' : 'Приём через'} {Math.max(0, Math.ceil((timer.dueAt - now) / 60_000))} мин</span>
                  {onCancelMealTimer && <button className="btn btn--sm" onClick={() => onCancelMealTimer(timer.id)}>Отменить таймер</button>}
                </span> : <button className="btn btn--sm" onClick={() => void onMealTimer(row.medicine.regimenId, row.medicine.meal === 'before' ? 'eat' : 'dose', row.planned)}>
                  {row.medicine.meal === 'before' ? `Напомнить, когда можно есть · ${row.medicine.mealMinutes} мин` : `Закончил есть · напомнить через ${row.medicine.mealMinutes} мин`}
                </button>
              })()}
              {(row.medicine.meal === 'before' || row.medicine.meal === 'after') && !row.medicine.mealMinutes && <span className="dose__extra">Для таймера укажите интервал в курсе приёма.</span>}
              {row.overdue && row.takenAt === null && !row.medicine.autoDeduct && !mealTimers.some(t => t.regimenId === row.medicine.regimenId && t.plannedAt === row.planned && t.kind === 'dose' && !t.cancelledAt && t.dueAt > now) && (
                <span className="dose__late">● время прошло</span>
              )}
            </span>

            {row.medicine.autoDeduct ? null : row.takenAt === null ? (
              можно ? (
                <button
                  ref={actionRef(row, 'mark')}
                  className="btn btn--primary"
                  disabled={future || занят}
                  onClick={event => void markDose(row, false, event.currentTarget)}
                >
                  Принял
                </button>
              ) : (
                <span className="dose__auto">с {row.time}</span>
              )
            ) : null}
          </li>
        ))}
      </ul>
        </section>
      })}

      {future && (
        <p className="muted" style={{ margin: 'var(--space-3) 0 0' }}>
          День ещё не наступил — отмечать нечего, это список на будущее.
        </p>
      )}

      {!future && !можно && неотмеченных.length > 0 && (
        спросить ? (
          <div className="card card--inset" style={{ marginTop: 'var(--space-3)' }}>
            <b>Приём «{DAY_PART_TITLE[part]}» ещё не наступил.</b>
            <div className="muted" style={{ marginTop: 4 }}>
              Отметить сейчас? Подтвердите, только если уже приняли препарат.
            </div>
            <div className="row" style={{ marginTop: 'var(--space-3)' }}>
              <button className="btn" onClick={() => setСпросить(false)}>
                Отмена
              </button>
              <button
                className="btn btn--primary"
                onClick={() => {
                  setДосрочно(true)
                  setСпросить(false)
                }}
              >
                Да, отметить
              </button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <button className="btn btn--sm" onClick={() => setСпросить(true)}>
              Отметить заранее
            </button>
          </div>
        )
      )}
      </>}
    </div>
  )
}
