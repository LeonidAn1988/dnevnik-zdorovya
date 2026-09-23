import { useState } from 'react'
import type { MeasurePlan } from '../types'
import { courseText, courseToday, describeMeasurePlan, planTimes } from '../logic/course'
import { plural } from '../logic/plural'
import { Banner, Field } from './bits'

/** Готовые схемы — те, что врач и называет. Своё время добавляется руками. */
const СХЕМЫ: { title: string; times: string[] }[] = [
  { title: 'Утром', times: ['08:00'] },
  { title: 'Утром и вечером', times: ['08:00', '20:00'] },
  { title: 'Утром, днём и вечером', times: ['08:00', '14:00', '20:00'] },
]

const СРОКИ: { title: string; days: number | null }[] = [
  { title: '7 дней', days: 7 },
  { title: '14 дней', days: 14 },
  { title: '30 дней', days: 30 },
  { title: 'Без срока', days: null },
]

const ДАТА = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })

/**
 * Курс измерений, назначенный врачом.
 *
 * «Две недели меряйте утром и вечером, потом придёте» — утро человек помнит,
 * вечер забывает, и на приёме выясняется, что дневник вёлся не по той схеме,
 * о которой договаривались.
 *
 * **Схему вводит человек со слов врача.** Приложение готовые схемы показывает,
 * но само ничего не предлагает и не советует: предложить режим измерений
 * значит назначить, а назначает врач.
 */
export function Course({
  plan,
  readings,
  onChange,
}: {
  plan: MeasurePlan | undefined
  /** Метки времени измерений этого человека. */
  readings: number[]
  onChange: (next: MeasurePlan | undefined) => void
}) {
  const [настраиваю, setНастраиваю] = useState(false)
  const [времена, setВремена] = useState<string[]>(() => planTimes(plan) || ['08:00'])
  const [дней, setДней] = useState<number | null>(plan?.days ?? 14)

  const now = Date.now()
  const идёт = plan && planTimes(plan).length > 0
  const состояние = идёт ? courseToday(plan!, readings, now) : null

  if (!идёт && !настраиваю) {
    return (
      <div className="card" data-tour="bp-course">
        <div className="card__head">
          <h2>Врач попросил вести дневник?</h2>
        </div>
        <p className="muted">
          Задайте схему — приложение будет напоминать измерить давление и посчитает, сколько измерений сделано из
          назначенных.
        </p>
        <button className="btn" onClick={() => setНастраиваю(true)}>
          Задать схему измерений
        </button>
      </div>
    )
  }

  if (настраиваю) {
    return (
      <div className="card" data-tour="bp-course">
        <div className="card__head">
          <h2>Схема измерений</h2>
          <span className="muted">со слов врача</span>
        </div>

        <Field label="Когда мерить">
          <div className="segmented segmented--chips" role="group" aria-label="Когда мерить">
            {СХЕМЫ.map((схема) => (
              <button
                key={схема.title}
                type="button"
                aria-pressed={схема.times.join() === времена.join()}
                onClick={() => setВремена(схема.times)}
              >
                {схема.title}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Сколько дней">
          <div className="segmented segmented--chips" role="group" aria-label="Сколько дней">
            {СРОКИ.map((срок) => (
              <button key={срок.title} type="button" aria-pressed={срок.days === дней} onClick={() => setДней(срок.days)}>
                {срок.title}
              </button>
            ))}
          </div>
        </Field>

        <p className="muted">{describeMeasurePlan({ times: времена, days: дней, from: now })}</p>

        <div className="row row--stack">
          <button
            className="btn btn--primary"
            onClick={() => {
              onChange({ times: времена, days: дней, from: now })
              setНастраиваю(false)
            }}
          >
            {идёт ? 'Сохранить' : 'Начать с сегодня'}
          </button>
          <button className="btn" onClick={() => setНастраиваю(false)}>
            Отмена
          </button>
        </div>

        <p className="muted">
          Напоминания об измерении включаются отдельно, в «Настройках → Напоминания».
        </p>
      </div>
    )
  }

  return (
    <div className="card" data-tour="bp-course">
      <div className="card__head">
        <h2>Схема измерений</h2>
        <span className="muted">{describeMeasurePlan(plan)}</span>
      </div>

      {состояние!.finished ? (
        <Banner tone="good">
          <b>Схема закончилась</b>
          <div style={{ marginTop: 4 }}>
            Он шёл {plan!.days} {plural(plan!.days!, 'день', 'дня', 'дней')} с {ДАТА.format(plan!.from)}. Итог — в
            отчёте врачу.
          </div>
        </Banner>
      ) : (
        <>
          <p className="course__state">{courseText(состояние!)}</p>
          {состояние!.next ? (
            <p className="muted">Следующее измерение — в {состояние!.next}.</p>
          ) : (
            <p className="muted">На сегодня всё измерено.</p>
          )}
        </>
      )}

      <div className="row">
        <button className="btn btn--sm" onClick={() => setНастраиваю(true)}>
          Изменить
        </button>
        <button className="btn btn--sm" onClick={() => onChange(undefined)}>
          {состояние!.finished ? 'Убрать' : 'Прекратить'}
        </button>
      </div>
    </div>
  )
}
