import { useState } from 'react'
import type { DoseStage, IntakeSlot, Medicine, Person, Regimen, Rhythm } from '../types'
import { formatTime, normalizeTimes, parseTime, stageOn, courseEndDay } from '../logic/medicines'
import { normalizeRhythm } from '../logic/rhythm'
import { daysLeftOf, describeEnd, endsAfter, formatDay, regimenFinished } from '../logic/regimen'
import { unitsOf, doseUnitOf, stockUnitOf, UNIT_LABELS } from '../logic/units'
import { NumberField } from './NumberField'
import { Banner, Field } from './bits'
import { MenuButton } from './Picker'
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
}: {
  times: string[]
  presets: Presets
  onChange: (next: string[]) => void
}) {
  const [custom, setCustom] = useState('')

  const toggle = (time: string) =>
    onChange(normalizeTimes(times.includes(time) ? times.filter((t) => t !== time) : [...times, time]))

  const addCustom = () => {
    if (parseTime(custom) === null) return
    onChange(normalizeTimes([...times, formatTime(parseTime(custom)!)]))
    setCustom('')
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
          onChange={(e) => setCustom(e.target.value)}
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
          Время не выбрано — напоминаний не будет. Расход тогда считается по полю «В день» ниже.
        </p>
      )}
    </>
  )
}

export function RegimenForm({
  regimen,
  medicines,
  medicineId,
  intakeSlots,
  people,
  activePerson,
  onSave,
  onStop,
  onCancel,
  onAddMedicine,
}: {
  /** Курс, который правим. Нет — заводим новый. */
  regimen?: Regimen
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
  /** Аптечка пуста — отсюда уводим её заводить. */
  onAddMedicine: () => void
}) {
  const [кому, setКому] = useState(regimen?.person || activePerson)
  const [лекарство, setЛекарство] = useState(regimen?.medicineId ?? medicineId ?? '')
  const [times, setTimes] = useState<string[]>(normalizeTimes(regimen?.times ?? []))
  const [perTime, setPerTime] = useState(String(regimen?.perTime ?? 1))
  const [rhythm, setRhythm] = useState<Rhythm | undefined>(() => normalizeRhythm(regimen?.rhythm))
  const [mealMinutes, setMealMinutes] = useState(String(regimen?.mealMinutes ?? ''))
  const [meal, setMeal] = useState<Regimen['meal']>(regimen?.meal)
  const [plan, setPlan] = useState<DoseStage[]>(regimen?.plan ?? [])
  const [autoDeduct, setAutoDeduct] = useState(regimen?.autoDeduct ?? false)
  const [perDay, setPerDay] = useState(
    regimen?.perDay !== null && regimen?.perDay !== undefined ? String(regimen.perDay).replace('.', ',') : '',
  )
  /** «Принимаю с» — месяц со слов человека, для ответа врачу. */
  const dateValue = (at: number) => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
  const [startedMonth, setStartedMonth] = useState(dateValue(regimen?.planFrom ?? regimen?.startedAt ?? Date.now()))
  const fromDate = new Date(`${startedMonth}T00:00:00`).getTime()

  /**
   * Сколько дней курса осталось, считая сегодняшний.
   *
   * Отсчёт всегда от сегодня, а не от дня заведения препарата. «Принимаю с» —
   * это про жизнь человека, там бывает и позапрошлый год, и трёхдневный курс
   * от такого начала оказывался законченным задолго до того, как его завели.
   * «Осталось три дня» понимается одинаково и в первый день курса, и в пятый.
   *
   * Храним длину, а не дату: врач называет «курс десять дней», и человек
   * повторяет это же.
   */
  const сегодня = Date.now()
  const осталось = regimen ? daysLeftOf(regimen, сегодня) : null
  const [длина, setДлина] = useState(осталось !== null && осталось > 0 ? String(осталось) : '')
  /**
   * Бессрочный курс — выбор вслух, а не пустое поле.
   *
   * Раньше конец курса задавался одним числом, и «ничего не вписано» значило
   * «принимать постоянно». Два разных состояния выглядели одинаково: человек,
   * не дозаполнивший поле, и человек, у которого курс и правда без конца. При
   * гипертонии и диабете второй случай — обычный, и называть его надо прямо.
   */
  const [бессрочно, setБессрочно] = useState(осталось === null)
  const дней = Number(длина.replace(',', '.'))
  /*
   * Пустое поле у законченного курса означает «не трогаем», а не «без конца».
   *
   * Иначе правка курса у давно отменённого препарата молча воскрешала бы его:
   * конец исчез — значит, курс снова бессрочный, и напоминания вернулись бы
   * тем же вечером.
   */
  const законченный = осталось !== null && осталось <= 0
  const endsAt = бессрочно
    ? null
    : длина.trim() !== '' && Number.isFinite(дней) && дней > 0
      ? endsAfter(сегодня, дней)
      : законченный
        ? (regimen?.endsAt ?? null)
        : null

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const прекращён = regimen?.stoppedAt !== undefined && regimen.stoppedAt <= сегодня
  const окончен = regimen ? regimenFinished(regimen, сегодня, stageOn(regimen, сегодня)) : false
  const stop = async () => {
    if (!onStop || busy) return
    setBusy(true)
    setError(null)
    try { await onStop() }
    catch { setError('Не удалось прекратить приём. Попробуйте ещё раз — история сохранена.') }
    finally { setBusy(false) }
  }

  const коробка = medicines.find((m) => m.id === лекарство)
  // Единицы зависят от формы выпуска: у капель приём в каплях, а не в штуках,
  // и подпись поля обязана это говорить.
  const [courseUnit, setCourseUnit] = useState(regimen?.doseUnit)
  const selectedUnit = courseUnit ?? doseUnitOf(коробка ?? {})
  const единицы = unitsOf({ ...коробка, doseUnit: selectedUnit })

  const numberOrNull = (raw: string): number | null => {
    const value = Number(raw.replace(',', '.'))
    return raw.trim() === '' || !Number.isFinite(value) ? null : value
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
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
        person: people.length > 1 ? кому : (regimen?.person ?? activePerson),
        perDay: numberOrNull(perDay),
        startedAt: fromDate,
        doseUnit: selectedUnit,
        mealMinutes: meal === 'before' || meal === 'after' ? Number(mealMinutes) || undefined : undefined,
        autoDeduct: autoDeduct || undefined,
        times: times.length > 0 ? times : undefined,
        perTime: times.length > 0 ? Number(perTime.replace(',', '.')) || 1 : undefined,
        // Ритм без расписания бессмыслен: принимать «через день по
        // потребности» не значит ничего, и считать по такому курсу нечего.
        rhythm: times.length > 0 || plan.length > 0 ? normalizeRhythm(rhythm) : undefined,
        // Схема сохраняется только со своим началом: без даты этапы не с чего
        // отсчитывать. Начало — день, когда схему завели, если человек не
        // указал «принимаю с».
        plan: plan.length > 0 ? plan : undefined,
        planFrom: fromDate,
        meal: times.length > 0 || plan.length > 0 ? meal : undefined,
        endsAt: plan.length ? courseEndDay({ plan, planFrom: fromDate }) ?? undefined : endsAt ?? undefined,
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

  // Заводить курс не из чего: в аптечке пусто. Отдельный экран, а не пустой
  // список в поле выбора — иначе человек жмёт «Выбрать препарат», видит пустой
  // лист и остаётся без ответа, что делать дальше.
  if (medicines.length === 0) {
    return (
      <div className="card">
        <div className="card__head">
          <h2>Курс приёма</h2>
        </div>
        <div className="chart__empty">
          В аптечке пока пусто. Курс — это приём чего-то из неё, поэтому сначала заведите препарат.
        </div>
        <div className="row" style={{ marginTop: 'var(--space-3)' }}>
          <button type="button" className="btn btn--primary" onClick={onAddMedicine}>
            Добавить препарат
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Отмена
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="stack" style={{ gap: 'var(--space-4)' }}>
      {прекращён && <Banner tone="info">
        {describeEnd(regimen!, сегодня)}. История сохранена. Для нового приёма заведите отдельный курс.
      </Banner>}
      {/* Кнопки закреплены сверху — как в форме препарата: экран длинный, и
          «Сохранить» внизу приходилось бы искать прокруткой. */}
      <div className="row form-actions--top">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          Сохранить
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Отмена
        </button>
      </div>

      {/* Препарат — первым вопросом: всё остальное на экране относится к нему.
          Пока он не выбран, «по сколько» и «до какого дня» спрашивать не о
          чем. */}
      <div>
        <div className="tile__label" style={{ marginBottom: 'var(--space-2)' }}>
          Что принимать
        </div>
        <MenuButton
          className="btn pickfield"
          title={коробка ? `${коробка.name}${коробка.dose ? ` ${коробка.dose}` : ''}` : 'Выбрать препарат'}
          label="Что принимать"
          options={medicines.map((item) => ({
            id: item.id,
            title: item.name,
            hint: [item.dose, item.form].filter(Boolean).join(' · ') || undefined,
          }))}
          onPick={setЛекарство}
        />
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
          Когда принимать
        </div>
        <TimePicker times={times} presets={presetsOf(intakeSlots)} onChange={setTimes} />
        {times.length > 0 && plan.length > 0 && (
          <div className="muted" style={{ marginTop: 'var(--space-3)' }}>
            Доза задана схемой ниже — поле «{единицы.doseLabel.toLowerCase()}» она заменяет.
          </div>
        )}

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
        {times.length > 0 && meal && (
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
        {times.length === 0 && (
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

          {прекращён ? (
            <div className="muted">Приём прекращён. Правка срока не возобновляет его; история сохраняется.</div>
          ) : бессрочно ? (
          <div className="muted" style={{ marginTop: 'var(--space-2)' }}>
            Приём постоянный: напоминания не перестанут приходить, пока курс не уберут.
          </div>
        ) : (
          <>
            <div style={{ marginTop: 'var(--space-3)', maxWidth: '11rem' }}>
              <NumberField
                label={осталось !== null && осталось > 0 ? 'Осталось дней' : 'Курс, дней'}
                value={длина}
                onChange={setДлина}
                min={1}
                max={365}
                start={10}
                placeholder="—"
              />
            </div>
            <div className="muted" style={{ marginTop: 'var(--space-2)' }}>
              {endsAt === null
                ? 'Впишите, на сколько дней назначен курс.'
                : законченный && длина.trim() === ''
                  ? `Курс окончен ${formatDay(endsAt)}. Впишите число дней, чтобы начать заново.`
                  : `Последний день — ${formatDay(endsAt)}. Потом напоминания молчат.`}
            </div>
          </>
        )}
      </div>}

      {(times.length > 0 || plan.length > 0) && (
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
                    <TimePicker times={этап.times ?? times} presets={presetsOf(intakeSlots)} onChange={next => setPlan(plan.map((s,j) => i === j ? {...s, times: next} : s))} />
                    <p className="muted">{(этап.times ?? times).length} приём(а) в день · по {этап.perTime} {единицы.dose[2]}</p>
                    <p className="muted">{formatDay(endsAfter(fromDate, plan.slice(0,i).reduce((n,s) => n + (s.days ?? 0),0)+1))} — {этап.days === null ? 'без срока' : formatDay(endsAfter(fromDate, plan.slice(0,i+1).reduce((n,s) => n + (s.days ?? 0),0)))}</p>
                  </div>
                  <button type="button" className="btn btn--sm" onClick={() => setPlan(plan.filter((_, j) => j !== i))}>
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
      )}

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

      {/* Необязательное поле, и спрашивается месяцем, а не днём: день начала
          приёма человек не помнит, а спрашивать то, чего не помнят, — верный
          способ получить выдуманное число. Отвечает на вопрос врача «как
          давно принимаете», на который дневник иначе ответить не может: он
          знает только, когда завели карточку. */}
      <Field label="Единица приёма">
        <select value={selectedUnit} onChange={e => setCourseUnit(e.target.value as typeof selectedUnit)}>
          {[...new Set([stockUnitOf(коробка ?? {}), ...(stockUnitOf(коробка ?? {}) === 'ml' ? ['drop' as const] : []), selectedUnit])].map(u => <option key={u} value={u}>{UNIT_LABELS[u]}</option>)}
        </select>
      </Field>
      <Field label={plan.length ? 'Первый день первого этапа' : 'Принимаю с'}>
        <input type="date" value={startedMonth} onChange={(e) => setStartedMonth(e.target.value)} />
      </Field>

      {/* Прекращение сохраняет курс и его историю; будущие приёмы отменяются. */}
      {onStop && !окончен && (
        <div className="row">
          <button type="button" className="btn" disabled={busy} onClick={() => void stop()}>
            Больше не принимаю
          </button>
        </div>
      )}

      {error && (
        <div className="pill__alert pill__alert--critical" role="alert">
          {error}
        </div>
      )}
    </form>
  )
}
