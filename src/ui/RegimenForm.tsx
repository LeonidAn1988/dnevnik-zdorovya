import { useState } from 'react'
import { useFormDraft } from './useDraftState'
import { FormDraftNotice } from './FormDraftNotice'
import type { DoseStage, IntakeSlot, Medicine, Person, Regimen, Rhythm } from '../types'
import { formatTime, normalizeTimes, parseTime, stageOn, courseEndDay } from '../logic/medicines'
import { normalizeRhythm } from '../logic/rhythm'
import { daysLeftOf, describeEnd, endsAfter, formatDay, lengthOf, regimenFinished } from '../logic/regimen'
import { unitsOf, doseUnitOf, stockUnitOf, UNIT_LABELS } from '../logic/units'
import { NumberField } from './NumberField'
import { Banner, Field } from './bits'
import { CourseMedicinePicker } from './CourseMedicinePicker'
import { CourseMedicineDialog } from './CourseMedicineDialog'
import { RhythmPicker } from './RhythmPicker'

/**
 * Курс приёма отдельным экраном.
 *
 * До 0.42.0 курс заводился внутри формы препарата — и это было наследство от
 * времён, когда коробка и назначение были одной записью. Разделили их в
 * 0.27.0, а форма осталась общей: человек, которому надо поправить время
 * приёма, шёл через дозировку, производителя, размер упаковки и срок годности.
 *
 * Теперь вопросы разведены по экранам так же, как разведены записи: коробка
 * отвечает «что лежит в шкафу», курс — «кто это принимает, когда и до какого
 * дня». Один экран — один вопрос.
 */

const MEALS: { key: Regimen['meal']; title: string }[] = [
  { key: 'before', title: 'До еды' },
  { key: undefined, title: 'Независимо от еды' },
  { key: 'during', title: 'Во время еды' },
  { key: 'after', title: 'После еды' },
]

/**
 * Готовые времена: почти все схемы приёма укладываются в эти четыре.
 *
 * Часы приходят из настроек, а не зашиты сюда: у кого-то утро в шесть, а вечер
 * в семнадцать, и таким людям приходилось вводить время руками для каждого
 * препарата.
 */
type Presets = { time: string; title: string }[]

function presetsOf(slots: IntakeSlot[]): Presets {
  return slots.map((slot) => ({ time: slot.time, title: slot.title }))
}

/**
 * Время приёма кнопками плюс поле для своего.
 *
 * Набирать время руками на телефоне пожилому человеку тяжело, а четыре готовых
 * значения покрывают почти все назначения. Своё время остаётся для остальных.
 */
function TimePicker({
  times,
  presets,
  onChange,
  custom,
  onCustomChange,
  stage = false,
}: {
  times: string[]
  presets: Presets
  onChange: (next: string[]) => void
  custom: string
  onCustomChange: (next: string) => void
  stage?: boolean
}) {
  const toggle = (time: string) =>
    onChange(normalizeTimes(times.includes(time) ? times.filter((t) => t !== time) : [...times, time]))

  const addCustom = () => {
    if (parseTime(custom) === null) return
    onChange(normalizeTimes([...times, formatTime(parseTime(custom)!)]))
    onCustomChange('')
  }

  const extra = times.filter((t) => !presets.some((p) => p.time === t))

  return (
    <>
      <div className="chips">
        {presets.map(({ time, title }) => (
          <button key={time} type="button" className="chip" aria-pressed={times.includes(time)} onClick={() => toggle(time)}>
            {title} <span className="muted">{time}</span>
          </button>
        ))}
        {extra.map((time) => (
          <button key={time} type="button" className="chip" aria-pressed onClick={() => toggle(time)}>
            {time}
          </button>
        ))}
      </div>

      <div className="row" style={{ marginTop: 'var(--space-3)' }}>
        <label>
          <span className="tile__label">Своё время</span>
        <input
          type="time"
          value={custom}
          onChange={(e) => onCustomChange(e.target.value)}
          aria-label="Своё время приёма"
          style={{ maxWidth: 150 }}
        />
        </label>
        <button type="button" className="btn btn--sm" onClick={addCustom} disabled={parseTime(custom) === null}>
          Добавить время
        </button>
      </div>

      {times.length === 0 && (
        <p className="muted" style={{ margin: 'var(--space-2) 0 0' }}>
          {stage ? 'Выберите хотя бы одно время для этого этапа.' : 'Время не выбрано — напоминаний не будет. Расход тогда считается по полю «В день» ниже.'}
        </p>
      )}
    </>
  )
}

export function RegimenForm({
  regimen,
  template,
  repeatFromId,
  onRepeat,
  medicines,
  medicineId,
  intakeSlots,
  people,
  activePerson,
  onSave,
  onStop,
  onCancel,
  onAddMedicine,
  addingMedicine,
  onCloseMedicine,
  onSaveMedicine,
}: {
  /** Курс, который правим. Нет — заводим новый. */
  regimen?: Regimen
  /** Scheduling-only defaults for a new repeat; no history or identity. */
  template?: Regimen
  repeatFromId?: string
  onRepeat?: () => void
  /** Вся аптечка: из неё выбирают препарат. */
  medicines: Medicine[]
  /** Препарат, выбранный заранее: пришли с его карточки. */
  medicineId?: string | null
  /** Часы стандартных приёмов из настроек. */
  intakeSlots: IntakeSlot[]
  /** Люди в дневнике. Пока он один, выбора человека нет вовсе. */
  people: Person[]
  /** Кто выбран сейчас — ему и достаётся новый курс. */
  activePerson: string
  onSave: (next: Regimen) => Promise<void>
  /** Убрать курс совсем. Нет — курс новый, убирать нечего. */
  onStop?: () => Promise<void>
  onCancel: () => void
  /** Добавить препарат поверх текущего черновика курса. */
  onAddMedicine: (name?: string) => void
  addingMedicine?: { name: string }
  onCloseMedicine?: () => void
  onSaveMedicine?: (medicine: Medicine) => Promise<string>
}) {
  const initial = regimen ?? template
  const draftKey = `regimen:${regimen ? `existing:${regimen.id}` : repeatFromId ? `repeat:${repeatFromId}` : `new:${activePerson}:${medicineId ?? 'choose'}`}`
  const draft = useFormDraft(draftKey, initial ?? null)
  const [кому, setКому] = draft.field('кому', initial?.person || activePerson)
  const [medicineQuery, setMedicineQuery] = draft.field('medicineQuery', '')
  const [addedMedicine, setAddedMedicine] = useState(false)
  const [лекарство, setЛекарство] = draft.field('лекарство', initial?.medicineId ?? medicineId ?? '')
  const [times, setTimes] = draft.field<string[]>('times', normalizeTimes(initial?.times ?? []))
  const [customTime, setCustomTime] = draft.field('customTime', '')
  const [stageCustomTimes, setStageCustomTimes] = draft.field<string[]>('stageCustomTimes', [])
  const [perTime, setPerTime] = draft.field('perTime', String(initial?.perTime ?? 1))
  const [rhythm, setRhythm] = draft.field<Rhythm | undefined>('rhythm', normalizeRhythm(initial?.rhythm))
  const [mealMinutes, setMealMinutes] = draft.field('mealMinutes', String(initial?.mealMinutes ?? ''))
  const [meal, setMeal] = draft.field<Regimen['meal']>('meal', initial?.meal)
  const [plan, setPlan] = draft.field<DoseStage[]>('plan', initial?.plan ?? [])
  const [autoDeduct, setAutoDeduct] = draft.field('autoDeduct', initial?.autoDeduct ?? false)
  const [perDay, setPerDay] = draft.field('perDay',
    initial?.perDay !== null && initial?.perDay !== undefined ? String(initial.perDay).replace('.', ',') : '',
  )
  /** Local calendar date anchors course duration and staged dosing. */
  const dateValue = (at: number) => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
  const [startedMonth, setStartedMonth] = draft.field('startedMonth', dateValue(initial?.planFrom ?? initial?.startedAt ?? initial?.since ?? Math.min(Date.now(), initial?.endsAt ?? Date.now())))
  const fromDate = new Date(`${startedMonth}T00:00:00`).getTime()

  const сегодня = Date.now()
  const окончен = regimen ? regimenFinished(regimen, сегодня, stageOn(regimen, сегодня)) : false
  const осталось = regimen ? daysLeftOf(regimen, сегодня) : null
  // New/archived courses use full length from their first day. Active courses
  // retain the familiar “days remaining”, including a future start date.
  const durationFrom = regimen && !окончен ? Math.max(new Date(сегодня).setHours(0, 0, 0, 0), fromDate) : fromDate
  const initialStart = initial?.planFrom ?? initial?.startedAt ?? initial?.since ?? Math.min(сегодня, initial?.endsAt ?? сегодня)
  const initialLength = initial?.endsAt === undefined ? null : lengthOf(
    regimen && !окончен ? Math.max(new Date(сегодня).setHours(0, 0, 0, 0), initialStart) : initialStart,
    initial.endsAt,
  )
  const [длина, setДлина] = draft.field('длина', initialLength !== null && initialLength > 0 ? String(initialLength) : '')
  const [бессрочно, setБессрочно] = draft.field('бессрочно', initial?.endsAt === undefined)
  const maxDays = regimen && окончен ? Math.max(365, initialLength ?? 0) : 365
  const дней = Number(длина.replace(',', '.'))
  const endsAt = !Number.isFinite(fromDate) || бессрочно || !длина.trim() || !Number.isInteger(дней) || дней < 1 || дней > maxDays
    ? null : endsAfter(durationFrom, дней)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const прекращён = regimen?.stoppedAt !== undefined && regimen.stoppedAt <= сегодня
  const stop = async () => {
    if (!onStop || busy) return
    setBusy(true)
    setError(null)
    try { await onStop(); draft.clear() }
    catch { setError('Не удалось прекратить приём. Попробуйте ещё раз — история сохранена.') }
    finally { setBusy(false) }
  }

  const коробка = medicines.find((m) => m.id === лекарство)
  // Единицы зависят от формы выпуска: у капель приём в каплях, а не в штуках,
  // и подпись поля обязана это говорить.
  const [courseUnit, setCourseUnit] = draft.field('courseUnit', initial?.doseUnit)
  const selectedUnit = courseUnit ?? doseUnitOf(коробка ?? {})
  const единицы = unitsOf({ ...коробка, doseUnit: selectedUnit })

  const numberOrNull = (raw: string): number | null => {
    const value = Number(raw.replace(',', '.'))
    return raw.trim() === '' || !Number.isFinite(value) ? null : value
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (draft.conflict) return
    if (medicineQuery.trim()) {
      setError('Выберите препарат из результатов поиска или очистите поиск, чтобы оставить прежний выбор.')
      return
    }
    if (!коробка) {
      setError('Выберите препарат: курс — это приём чего-то конкретного из аптечки.')
      return
    }
    if (plan.some((s, i) => !Number.isFinite(s.perTime) || s.perTime < 0 || (s.days === null ? i !== plan.length - 1 : !Number.isInteger(s.days) || s.days <= 0) || !normalizeTimes(s.times ?? times).length)) {
      setError('У каждого этапа выберите время и целое число дней. Без срока может быть только последний этап.')
      return
    }
    if (!Number.isFinite(fromDate) || ((meal === 'before' || meal === 'after') && mealMinutes.trim() && (!Number.isInteger(Number(mealMinutes)) || Number(mealMinutes) <= 0 || Number(mealMinutes) > 1440))) {
      setError('Проверьте дату начала и интервал еды: от 1 до 1440 минут.')
      return
    }
    if (selectedUnit !== stockUnitOf(коробка) && !(stockUnitOf(коробка) === 'ml' && selectedUnit === 'drop' && (коробка.dropsPerMl ?? 0) > 0)) {
      setError('Единица приёма не соответствует запасу. Выберите единицу упаковки; для капель укажите число капель в 1 мл в препарате.')
      return
    }
    if (!plan.length && !бессрочно && (!длина.trim() || !Number.isInteger(дней) || дней < 1 || дней > maxDays)) {
      setError(`Укажите срок курса: целое число дней от 1 до ${maxDays}.`)
      return
    }
    const finalEnd = plan.length ? courseEndDay({ plan, planFrom: fromDate }) ?? undefined : endsAt ?? undefined
    const previousEnd = regimen ? courseEndDay(regimen) : null
    if (окончен && !прекращён && (finalEnd === undefined || (previousEnd !== null && finalEnd > previousEnd) || !regimenFinished({ ...regimen!, endsAt: finalEnd, plan, planFrom: fromDate }, сегодня, stageOn({ plan, planFrom: fromDate }, сегодня)))) {
      setError('Этот курс уже завершён. Для нового приёма нажмите «Повторить курс» — история и перерыв сохранятся.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const scheduleVersion = Math.max(Date.now(), (regimen?.scheduleUpdatedAt ?? regimen?.updatedAt ?? 0) + 1, (regimen?.bindingUpdatedAt ?? 0) + 1)
      await onSave({
        ...regimen,
        legacySchedule: undefined,
        scheduleUpdatedAt: scheduleVersion,
        bindingUpdatedAt: scheduleVersion,
        id: regimen?.id ?? '',
        medicineId: коробка.id,
        person: people.length > 1 ? кому : (initial?.person ?? activePerson),
        perDay: numberOrNull(perDay),
        startedAt: fromDate,
        doseUnit: selectedUnit,
        mealMinutes: meal === 'before' || meal === 'after' ? Number(mealMinutes) || undefined : undefined,
        autoDeduct: autoDeduct || undefined,
        times: times.length > 0 ? times : undefined,
        perTime: times.length > 0 ? Number(perTime.replace(',', '.')) || 1 : undefined,
        // Ритм без расписания бессмыслен: принимать «через день по
        // потребности» не значит ничего, и считать по такому курсу нечего.
        rhythm: times.length > 0 || plan.length > 0 ? normalizeRhythm(repeatFromId && rhythm && !rhythm.weekdays?.length && rhythm.from === initial?.planFrom ? { ...rhythm, from: fromDate } : rhythm) : undefined,
        // Схема сохраняется только со своим началом: без даты этапы не с чего
        // отсчитывать. Начало — день, когда схему завели, если человек не
        // указал «принимаю с».
        plan: plan.length > 0 ? plan : undefined,
        planFrom: fromDate,
        meal: times.length > 0 || plan.length > 0 ? meal : undefined,
        endsAt: finalEnd,
        /*
         * Отметки, история и день заведения переносятся, а не теряются.
         *
         * Форма собирает курс заново из полей, и всё, что она не назвала явно,
         * при сохранении пропадает. `since` не назывался — и правка расписания
         * стирала дату заведения. Следом возвращались пропуски за то время,
         * когда препарата ещё не было.
         */
        taken: regimen?.taken,
        history: regimen?.history,
        foldedUntil: regimen?.foldedUntil,
        since: regimen?.since,
      })
      draft.clear()
    } catch (caught) {
      // Без этого отказ уходил в никуда: форма оставалась открытой со всеми
      // полями, ошибка не показывалась, и человек либо жал ещё раз, либо
      // уходил в уверенности, что курс заведён.
      setError(
        'Не удалось сохранить: телефон отказал в записи. Проверьте, есть ли свободное место, и повторите. ' +
          (caught instanceof Error ? caught.message : ''),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
    <form onSubmit={submit} className="stack" style={{ gap: 'var(--space-4)' }}>
      {окончен && <Banner tone="info">
        {describeEnd(regimen!, сегодня) || 'Курс завершён'}. История сохранена.
        {onRepeat && <div style={{ marginTop: 'var(--space-2)' }}>
          <button type="button" className="btn btn--primary" disabled={busy || draft.conflict} onClick={onRepeat}>Повторить курс</button>
          <p className="muted">Новый курс с сохранёнными настройками. Правки ниже относятся к прошлому курсу.</p>
        </div>}
      </Banner>}
      {template && <Banner tone="info">Проверьте дату, срок и дозу. Прошлый курс останется в истории.{plan.length > 0 && ' Этапы начнутся с первого.'}</Banner>}
      {/* Кнопки закреплены сверху — как в форме препарата: экран длинный, и
          «Сохранить» внизу приходилось бы искать прокруткой. */}
      <div className="row form-actions--top">
        <button type="submit" className={окончен ? "btn" : "btn btn--primary"} disabled={busy || draft.conflict}>
          {окончен ? 'Сохранить правки' : 'Сохранить'}
        </button>
        <button type="button" className="btn" onClick={() => { draft.clear(); onCancel() }} disabled={busy}>
          Отмена
        </button>
      </div>

      {error && (
        <div className="pill__alert pill__alert--critical" role="alert">
          {error}
        </div>
      )}

      <FormDraftNotice conflict={draft.conflict} onReload={draft.clear} onKeep={draft.keep} />

      {/* Препарат — первым вопросом: всё остальное на экране относится к нему.
          Пока он не выбран, «по сколько» и «до какого дня» спрашивать не о
          чем. */}
      <div>
        <div className="tile__label" style={{ marginBottom: 'var(--space-2)' }}>
          Что принимать
        </div>
        <CourseMedicinePicker medicines={medicines} selected={коробка} query={medicineQuery}
          onQuery={setMedicineQuery} onPick={id => { setЛекарство(id); setCourseUnit(undefined); setAddedMedicine(false) }}
          onAdd={() => onAddMedicine(medicineQuery.trim())} />
        {addedMedicine && <p className="muted" role="status">Препарат добавлен в аптечку. Завершите настройку и сохраните курс.</p>}
      </div>

      {/* Кто принимает — вторым и только когда людей больше одного. Ошибиться
          человеком легко, а найти ошибку потом трудно: курс просто не
          показывается тому, кто его ищет. */}
      {people.length > 1 && (
        <div>
          <div className="tile__label" style={{ marginBottom: 'var(--space-2)' }}>
            Кто принимает
          </div>
          <div className="segmented segmented--fill segmented--chips" role="group" aria-label="Кто принимает">
            {/* `type="button"` обязателен: кнопка внутри формы без него —
                отправка, и нажатие на имя человека сохраняло и закрывало
                форму вместо того, чтобы выбрать его. */}
            {people.map((person, index) => (
              <button key={person.id} type="button" aria-pressed={кому === person.id} onClick={() => setКому(person.id)}>
                {person.name || `Человек ${index + 1}`}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="tile__label" style={{ marginBottom: 'var(--space-2)' }}>
          {plan.length > 0 ? 'Расписание по этапам' : 'Когда принимать'}
        </div>
        {plan.length > 0
          ? <p className="muted">Часы и доза задаются отдельно в каждом этапе ниже.</p>
          : <TimePicker times={times} presets={presetsOf(intakeSlots)} onChange={setTimes} custom={customTime} onCustomChange={setCustomTime} />}

        {/* В какие дни — отдельный вопрос от «в котором часу», и стоит он
            сразу за временами: «через день по таблетке утром» читается в том
            же порядке, в каком это произносит врач. */}
        {(times.length > 0 || plan.length > 0) && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <RhythmPicker value={rhythm} onChange={setRhythm} now={сегодня} />
          </div>
        )}

        {times.length > 0 && plan.length === 0 && (
          <div className="row" style={{ marginTop: 'var(--space-4)', alignItems: 'flex-end' }}>
            <div style={{ maxWidth: 150 }}>
              <NumberField
                label={единицы.doseLabel}
                value={perTime}
                onChange={setPerTime}
                min={0.5}
                step={0.5}
                decimals={2}
                max={999}
                start={1}
                size="compact"
              />
            </div>
          </div>
        )}
        {(times.length > 0 || plan.length > 0) && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <div style={{ flex: '1 1 12rem', minWidth: 0 }}>
              {/* Подпись обязательна. Три кнопки без неё стояли рядом с «штук
                  за приём», и было непонятно ни что они значат, ни что даст
                  выбор. «Условия приёма» — потому что еда здесь не
                  единственное возможное условие, а первое из них. */}
              <div className="tile__label" style={{ marginBottom: 'var(--space-2)' }}>
                Условия приёма
              </div>
              <div className="regimen__meals" role="group" aria-label="Условия приёма">
                {MEALS.map(({ key, title }) => (
                  <button
                    key={title}
                    className={meal === key || (key === undefined && (!meal || meal === 'any')) ? 'btn btn--primary' : 'btn'}
                    type="button"
                    aria-pressed={meal === key || (key === undefined && (!meal || meal === 'any'))}
                    onClick={() => setMeal(key)}
                  >
                    {title}
                  </button>
                ))}
              </div>
            </div>
            {(meal === 'before' || meal === 'after') && <div style={{ maxWidth: '14rem', marginTop: 'var(--space-3)' }}>
              <NumberField label={meal === 'before' ? 'За сколько минут до еды' : 'Через сколько минут после еды'} value={mealMinutes} onChange={setMealMinutes} min={1} max={1440} start={meal === 'before' ? 20 : 30} placeholder="Не задано" />
            </div>}
          </div>
        )}
        {(times.length > 0 || plan.length > 0) && meal && (
          // Что человек получит за этот выбор — прямым текстом. Иначе кнопка
          // нажата, а результат всплывает через сутки в уведомлении, и связать
          // одно с другим уже нечем.
          <div className="muted" style={{ marginTop: 'var(--space-2)' }}>
            «{MEALS.find(m => m.key === meal)?.title.toLowerCase()}» будет приписано в напоминании, на экране приёма и в отчёте
            врачу.
          </div>
        )}

        {/* Без расписания остаётся расход: по нему считается, на сколько
            хватит пачки. С расписанием он считается сам, и спрашивать
            незачем. */}
        {times.length === 0 && plan.length === 0 && (
          <div style={{ maxWidth: '11rem', marginTop: 'var(--space-4)' }}>
            <NumberField
              label="В день"
              value={perDay}
              onChange={setPerDay}
              placeholder="1"
              min={0.5}
              max={12}
              start={1}
              step={0.5}
              decimals={1}
              size="compact"
            />
          </div>
        )}
      </div>

      <Field label={plan.length ? 'Первый день первого этапа' : 'Принимаю с'}>
        <input type="date" value={startedMonth} onChange={(e) => setStartedMonth(e.target.value)} />
      </Field>

      {/* Срок курса — свой вопрос, а не приписка к расписанию: врач говорит
          «курс десять дней» отдельно от того, по сколько принимать. */}
      {plan.length === 0 && <div>
        <div className="tile__label" style={{ marginBottom: 'var(--space-2)' }}>
          Срок курса
        </div>
        <div className="segmented segmented--fill" role="group" aria-label="Срок курса">
          <button type="button" aria-pressed={бессрочно} onClick={() => setБессрочно(true)}>
            Бессрочно
          </button>
          <button type="button" aria-pressed={!бессрочно} onClick={() => setБессрочно(false)}>
            Ограничен
          </button>
        </div>

          {бессрочно ? (
          <div className="muted" style={{ marginTop: 'var(--space-2)' }}>
            {окончен ? 'Срок в истории — без ограничения. Курс остаётся завершённым; для нового приёма нажмите «Повторить курс».' : 'Приём постоянный: напоминания приходят, пока вы не прекратите курс.'}
          </div>
        ) : (
          <>
            <div style={{ marginTop: 'var(--space-3)', maxWidth: '11rem' }}>
              <NumberField
                label={regimen && !окончен && осталось !== null && осталось > 0 ? 'Осталось дней' : 'Курс, дней'}
                value={длина}
                onChange={setДлина}
                min={1}
                max={maxDays}
                start={10}
                placeholder="—"
              />
            </div>
            <div className="muted" style={{ marginTop: 'var(--space-2)' }}>
              {endsAt === null
                ? 'Впишите, на сколько дней назначен курс.'
                : окончен
                  ? `Последний день по сроку — ${formatDay(endsAt)}. Курс остаётся завершённым; для нового приёма нажмите «Повторить курс».`
                  : `Последний день — ${formatDay(endsAt)}. Потом напоминания молчат.`}
            </div>
          </>
        )}
      </div>}

        <details open={plan.length > 0}>
          <summary>Курс по этапам: доза и число приёмов</summary>
          <div className="stack" style={{ gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
            {plan.length === 0 ? (
              <div className="muted">Например: 14 дней два раза в день, затем 30 дней один раз в день.</div>
            ) : (
              plan.map((этап, i) => (
                <div className="card stack" key={i}>
                  <strong>Этап {i + 1}</strong>
                  <Field label={`Этап ${i + 1}: ${единицы.doseLabel.toLowerCase()}`}>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.5"
                      min="0"
                      max="999"
                      value={String(этап.perTime)}
                      onChange={(e) =>
                        setPlan(plan.map((x, j) => (j === i ? { ...x, perTime: Number(e.target.value) || 0 } : x)))
                      }
                    />
                  </Field>
                  <Field label={этап.days === null ? 'дальше так же' : 'дней'}>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max="365"
                      // Пустое поле у последнего этапа значит «дальше так же»:
                      // схема наращивания заканчивается поддерживающей дозой.
                      value={этап.days === null ? '' : String(этап.days)}
                      placeholder="без конца"
                      onChange={(e) =>
                        setPlan(
                          plan.map((x, j) =>
                            j === i ? { ...x, days: e.target.value === '' ? null : Number(e.target.value) || 1 } : x,
                          ),
                        )
                      }
                    />
                  </Field>
                  <div>
                    <div className="tile__label">Время приёма на этом этапе</div>
                    <TimePicker
                      times={этап.times ?? times}
                      presets={presetsOf(intakeSlots)}
                      onChange={next => setPlan(plan.map((s, j) => i === j ? { ...s, times: next } : s))}
                      custom={stageCustomTimes[i] ?? ''}
                      onCustomChange={next => setStageCustomTimes(previous =>
                        Array.from({ length: Math.max(plan.length, previous.length) }, (_, j) => i === j ? next : previous[j] ?? ''))}
                      stage
                    />
                    <p className="muted">{(этап.times ?? times).length} приём(а) в день · по {этап.perTime} {единицы.dose[2]}</p>
                    <p className="muted">{Number.isFinite(fromDate) ? <>{formatDay(endsAfter(fromDate, plan.slice(0,i).reduce((n,s) => n + (s.days ?? 0),0)+1))} — {этап.days === null ? 'без срока' : formatDay(endsAfter(fromDate, plan.slice(0,i+1).reduce((n,s) => n + (s.days ?? 0),0)))}</> : 'Укажите дату начала.'}</p>
                  </div>
                  <button type="button" className="btn btn--sm" onClick={() => { setPlan(plan.filter((_, j) => j !== i)); setStageCustomTimes(previous => previous.filter((_, j) => j !== i)) }}>
                    Убрать
                  </button>
                </div>
              ))
            )}
            <div className="row">
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setPlan([...plan, { perTime: plan.length ? plan[plan.length - 1].perTime : Number(perTime.replace(',', '.')) || 1, times: [...(plan.at(-1)?.times ?? times)], days: 7 }])}
              >
                Добавить этап
              </button>
            </div>
            {plan.length > 0 && (
              <div className="muted">
                {plan[plan.length - 1].days === null
                  ? 'Последний этап без срока — приём продолжается с этой дозой.'
                  : 'У последнего этапа указан срок: когда он выйдет, приём закончится.'}
              </div>
            )}
          </div>
        </details>

      {(times.length > 0 || plan.length > 0) && (
        <div>
          <label className="badge">
            <input type="checkbox" checked={autoDeduct} onChange={(e) => setAutoDeduct(e.target.checked)} />
            Списывать без подтверждения
          </label>
          <p className="muted" style={{ margin: 'var(--space-1) 0 0' }}>
            {autoDeduct
              ? 'Остаток уменьшается сам по расписанию. Отмечать приём не нужно — кнопка «Принял» пропадёт.'
              : 'Отметки подтверждают приём. Между отметками показываем расчётный остаток по расписанию.'}
          </p>
        </div>
      )}

      <Field label="Единица приёма">
        <select value={selectedUnit} onChange={e => setCourseUnit(e.target.value as typeof selectedUnit)}>
          {[...new Set([stockUnitOf(коробка ?? {}), ...(stockUnitOf(коробка ?? {}) === 'ml' ? ['drop' as const] : []), selectedUnit])].map(u => <option key={u} value={u}>{UNIT_LABELS[u]}</option>)}
        </select>
      </Field>

      {/* Прекращение сохраняет курс и его историю; будущие приёмы отменяются. */}
      {onStop && !окончен && (
        <div className="row">
          <button type="button" className="btn" disabled={busy} onClick={() => void stop()}>
            Больше не принимаю
          </button>
        </div>
      )}

    </form>
    {addingMedicine && onSaveMedicine && onCloseMedicine && <CourseMedicineDialog name={addingMedicine.name} draftKey={draftKey}
      onClose={onCloseMedicine} onSave={async medicine => {
        const id = await onSaveMedicine(medicine)
        setЛекарство(id)
        setCourseUnit(undefined)
        setMedicineQuery('')
        setAddedMedicine(true)
        onCloseMedicine()
      }} />}
    </>
  )
}
