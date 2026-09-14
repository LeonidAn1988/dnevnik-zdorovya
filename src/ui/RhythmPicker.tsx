import { useState } from 'react'
import type { Rhythm } from '../types'
import { startOfDay } from '../logic/days'
import { describeUpcoming, isoWeekday, normalizeRhythm, shiftRhythm, WEEKDAYS } from '../logic/rhythm'
import { NumberField } from './NumberField'

/** Готовые ответы на вопрос «в какие дни» плюс два открытых варианта. */
type Режим = 'daily' | 'every2' | 'every3' | 'weekdays' | 'cycle'

const РЕЖИМЫ: { key: Режим; title: string }[] = [
  { key: 'daily', title: 'Каждый день' },
  { key: 'every2', title: 'Через день' },
  { key: 'every3', title: 'Через 2 дня' },
  { key: 'weekdays', title: 'По дням недели' },
  { key: 'cycle', title: 'С перерывами' },
]

function режимОт(rhythm: Rhythm | undefined): Режим {
  const правило = normalizeRhythm(rhythm)
  if (!правило) return 'daily'
  if (правило.weekdays?.length) return 'weekdays'
  if (правило.onDays === 1 && правило.offDays === 1) return 'every2'
  if (правило.onDays === 1 && правило.offDays === 2) return 'every3'
  return 'cycle'
}

/**
 * В какие дни принимать.
 *
 * **Зачем вообще выбор, а не одно поле «каждые N дней».** «Через 2 дня» одни
 * понимают как каждый третий день, другие как через один, и переспрашивать
 * бесполезно — уверены обе стороны. Поэтому здесь стоят готовые ответы теми
 * словами, которыми говорит врач, а спор решает строка с датами под ними:
 * человек сверяет «сегодня, 17 и 20 сентября» с назначением и не рассуждает о
 * том, что значит «через».
 *
 * **Почему пять кнопок, а не список за нажатием.** Скрытый список экономит
 * место и стоит внимания: пожилой человек не догадается, что за строкой
 * «Каждый день» что-то есть. Пять кнопок занимают две строки и отвечают на
 * вопрос, не задавая его.
 *
 * **Почему нужен сдвиг.** У «через день» две половины, и приложение обязано
 * угадать, на какой из них человек. Не угадает — будет напоминать ровно в те
 * дни, когда принимать не надо, а связать причину со следствием через неделю
 * уже нельзя. Кнопка «Сдвинуть на день» двигает фазу, и даты рядом сразу
 * показывают результат.
 */
export function RhythmPicker({
  value,
  onChange,
  now,
}: {
  value: Rhythm | undefined
  onChange: (next: Rhythm | undefined) => void
  now: number
}) {
  const режим = режимОт(value)
  const правило = normalizeRhythm(value)
  // Фаза цикла переживает смену режима: человек, переключившийся с «через день»
  // на «через 2 дня», не должен заново ловить нужную половину.
  const начало = правило?.from ?? startOfDay(now)

  const выбрать = (next: Режим) => {
    if (next === 'daily') return onChange(undefined)
    if (next === 'every2') return onChange({ onDays: 1, offDays: 1, from: начало })
    if (next === 'every3') return onChange({ onDays: 1, offDays: 2, from: начало })
    // Начинаем с сегодняшнего дня недели: пустой набор — не расписание, а
    // ошибка, и показывать его человеку незачем.
    if (next === 'weekdays') return onChange({ weekdays: [isoWeekday(now)] })
    return onChange({ onDays: 5, offDays: 2, from: начало })
  }

  const переключитьДень = (id: number) => {
    const дни = правило?.weekdays ?? []
    // Последний день снять нельзя: препарат, который не принимают никогда, —
    // это не ритм, а недоразумение. То же правило, что у разделов в настройках.
    if (дни.length === 1 && дни.includes(id)) return
    onChange({ weekdays: дни.includes(id) ? дни.filter((d) => d !== id) : [...дни, id] })
  }

  const ближайшие = describeUpcoming(value, now)

  return (
    <div className="rhythm">
      <div className="tile__label" style={{ marginBottom: 'var(--space-2)' }} id="rhythm-label">
        В какие дни
      </div>

      <div className="segmented segmented--chips" role="group" aria-labelledby="rhythm-label">
        {РЕЖИМЫ.map((item) => (
          <button key={item.key} type="button" aria-pressed={режим === item.key} onClick={() => выбрать(item.key)}>
            {item.title}
          </button>
        ))}
      </div>

      {режим === 'weekdays' && (
        <div className="chips chips--week" role="group" aria-label="Дни недели" style={{ marginTop: 'var(--space-3)' }}>
          {WEEKDAYS.map((day) => (
            <button
              key={day.id}
              type="button"
              className="chip"
              aria-pressed={правило?.weekdays?.includes(day.id) ?? false}
              aria-label={day.long}
              onClick={() => переключитьДень(day.id)}
            >
              {day.short}
            </button>
          ))}
        </div>
      )}

      {режим === 'cycle' && (
        <div className="row rhythm__cycle" style={{ marginTop: 'var(--space-3)' }}>
          <div>
            <ЦиклПоле
              label="Принимать, дней"
              value={правило?.onDays ?? 5}
              onCommit={(n) => onChange({ onDays: n, offDays: правило?.offDays ?? 2, from: начало })}
            />
          </div>
          <div>
            <ЦиклПоле
              label="Перерыв, дней"
              value={правило?.offDays ?? 2}
              onCommit={(n) => onChange({ onDays: правило?.onDays ?? 5, offDays: n, from: начало })}
            />
          </div>
        </div>
      )}

      {ближайшие && (
        // Живая область: даты — единственное, по чему человек проверяет, что
        // понял приложение так же, как приложение поняло его. Менять их молча
        // нельзя, иначе диктор оставит человека с прежней картиной.
        <div className="rhythm__preview" role="status" aria-live="polite">
          <span>{ближайшие}</span>
          {режим !== 'weekdays' && (
            <button type="button" className="btn btn--sm" onClick={() => onChange(shiftRhythm(value, 1))}>
              Сдвинуть на день
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Поле длины цикла со своим текстовым состоянием.
 *
 * Держать в поле само число нельзя: значение снаружи зажато по границам, и на
 * пустом поле или на промежуточном наборе оно возвращалось бы обратно — набрать
 * «10», стерев «5», стало бы невозможно. Наружу уходит только то, что уже
 * похоже на число в допустимых пределах.
 */
function ЦиклПоле({ label, value, onCommit }: { label: string; value: number; onCommit: (next: number) => void }) {
  const [текст, setТекст] = useState(String(value))

  return (
    <NumberField
      label={label}
      value={текст}
      onChange={(действие) => {
        // Кнопки «−» и «+» присылают не строку, а как её изменить.
        const набрано = typeof действие === 'function' ? действие(текст) : действие
        setТекст(набрано)
        const n = Number(набрано)
        if (набрано.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 60) onCommit(n)
      }}
      min={1}
      max={60}
      start={value}
      size="compact"
    />
  )
}
