import { useDraftState } from './useDraftState'
import type { MeasurePlan } from '../types'
import { courseText, courseToday, describeMeasurePlan, planTimes } from '../logic/course'
import { plural } from '../logic/plural'
import { Banner } from './bits'

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
  draftKey = 'local',
}: {
  draftKey?: string
  plan: MeasurePlan | undefined
  /** Метки времени измерений этого человека. */
  readings: number[]
  onChange: (next: MeasurePlan | undefined) => void
}) {
  const [настраиваю, setНастраиваю] = useDraftState(`measure-plan:${draftKey}:editing`, false)
  const [времена, setВремена] = useDraftState<string[]>(`measure-plan:${draftKey}:times`, [])
  const [дней, setДней] = useDraftState<number | null>(`measure-plan:${draftKey}:days`, 14)
  const [исходный, setИсходный] = useDraftState<string>(`measure-plan:${draftKey}:signature`, '')
  const [начало, setНачало] = useDraftState<number>(`measure-plan:${draftKey}:from`, 0)
  const [startToday, setStartToday] = useDraftState(`measure-plan:${draftKey}:startToday`, false)
  const signature = JSON.stringify(plan ?? null)
  const изменилось = настраиваю && исходный !== signature
  const открыть = (повторить = false) => {
    setВремена(planTimes(plan))
    setДней(plan ? plan.days : 14)
    setStartToday(повторить || !plan)
    setНачало(!повторить && plan ? plan.from : Date.now())
    setИсходный(signature)
    setНастраиваю(true)
  }

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
        <button className="btn" onClick={() => открыть()}>
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

        <div className="field">
          <span>Когда мерить</span>
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
        </div>

        <div className="field">
          <span>Сколько дней</span>
          <div className="segmented segmented--chips" role="group" aria-label="Сколько дней">
            {СРОКИ.map((срок) => (
              <button key={срок.title} type="button" aria-pressed={срок.days === дней} onClick={() => setДней(срок.days)}>
                {срок.title}
              </button>
            ))}
          </div>
        </div>

        {изменилось && <Banner tone="warning">
          <p>Схема изменилась, пока вы её редактировали. Загрузите актуальные значения перед сохранением.</p>
          <button className="btn" onClick={() => открыть()}>Загрузить актуальную схему</button>
        </Banner>}
        <p className="muted">{времена.length ? describeMeasurePlan({ times: времена, days: дней, from: startToday ? Date.now() : начало }) : 'Выберите время измерений.'}</p>

        <div className="row row--stack">
          <button
            className="btn btn--primary"
            disabled={!времена.length || изменилось}
            onClick={() => {
              if (!времена.length || изменилось) return
              onChange({ times: времена, days: дней, from: startToday ? Date.now() : начало })
              setНастраиваю(false)
            }}
          >
            {startToday ? 'Начать с сегодня' : 'Сохранить'}
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
        <button className="btn btn--sm" onClick={() => открыть()}>
          Изменить
        </button>
        {состояние!.finished && <button className="btn btn--sm" onClick={() => открыть(true)}>Повторить с сегодня</button>}
        <button className="btn btn--sm" onClick={() => onChange(undefined)}>
          {состояние!.finished ? 'Убрать' : 'Прекратить'}
        </button>
      </div>
    </div>
  )
}
