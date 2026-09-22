import { useState } from 'react'
import type { BpReading } from '../types'
import type { Dosing } from '../logic/regimen'
import { compareAround, comparable, medicineEvents, COMPARE_DAYS, COMPARE_MIN } from '../logic/events'
import { plural } from '../logic/plural'

const ДАТА = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })

/**
 * «Стало ли лучше»: два средних по обе стороны от события.
 *
 * Единственный вопрос, ради которого дневник вообще ведут, и приложение на него
 * не отвечало никак: чтобы сравнить, надо было помнить дату смены таблеток и
 * вручную переключать период, а периодов всего четыре готовых.
 *
 * Событий не придумываем: берём те, что приложение и так знает из аптечки —
 * день, когда препарат завели, и дни, когда схема меняет дозу.
 *
 * **Ни слова оценки.** Ни «лучше», ни цвета, ни стрелок: приложение показывает
 * ровно те два числа, которые человек получил бы сам, переключив период. Оно
 * экономит нажатия, а не делает вывод — за этой чертой начинается медизделие.
 * И рядом с каждым средним стоит, из скольких измерений оно сложено.
 */
export function Compare({ readings, medicines }: { readings: BpReading[]; medicines: Dosing[] }) {
  const события = medicineEvents(medicines, Date.now())
  const [выбрано, setВыбрано] = useState<string | null>(null)

  if (события.length === 0) return null

  const событие = события.find((e) => e.id === выбрано) ?? события[0]
  const сравнение = compareAround(readings, событие.day)

  return (
    <div className="card">
      <div className="card__head">
        <h2>До и после</h2>
        <span className="muted">по {сравнение.days} {plural(сравнение.days, 'дню', 'дням', 'дням')} с каждой стороны</span>
      </div>

      {события.length > 1 && (
        <div className="segmented segmented--chips" role="group" aria-label="Событие">
          {события.slice(0, 6).map((item) => (
            <button key={item.id} aria-pressed={item.id === событие.id} onClick={() => setВыбрано(item.id)}>
              {item.title}
            </button>
          ))}
        </div>
      )}

      <p className="compare__event">
        {событие.title} · {ДАТА.format(событие.day)}
      </p>

      {comparable(сравнение) ? (
        <div className="compare">
          <div className="compare__side">
            <span className="tile__label">До</span>
            <span className="compare__value">
              {сравнение.before.avgSys}/{сравнение.before.avgDia}
            </span>
            <span className="tile__note">
              {сравнение.before.count} {plural(сравнение.before.count, 'измерение', 'измерения', 'измерений')}
            </span>
          </div>
          <div className="compare__side">
            <span className="tile__label">После</span>
            <span className="compare__value">
              {сравнение.after.avgSys}/{сравнение.after.avgDia}
            </span>
            <span className="tile__note">
              {сравнение.after.count} {plural(сравнение.after.count, 'измерение', 'измерения', 'измерений')}
            </span>
          </div>
        </div>
      ) : (
        // Не «данных нет», а почему именно: человек должен понимать, что
        // делать. А делать нужно ровно одно — измерять.
        <p className="muted">
          Пока сравнивать не из чего: нужно хотя бы по {COMPARE_MIN}{' '}
          {plural(COMPARE_MIN, 'измерению', 'измерения', 'измерений')} с каждой стороны. Сейчас{' '}
          {сравнение.before.count} до и {сравнение.after.count} после.
        </p>
      )}

      <p className="muted">
        Это два средних арифметических за {COMPARE_DAYS} дней, а не оценка лечения. Выводы делает врач.
      </p>
    </div>
  )
}
