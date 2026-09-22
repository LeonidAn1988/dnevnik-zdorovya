import { useState } from 'react'
import type { IntakeSlot } from '../types'
import type { Dosing } from '../logic/regimen'
import { buildMemo, MEMO_DAYS } from '../logic/memo'
import { platform } from '../platform/ports'
import { BackBar, Banner } from './bits'

const ДАТА = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
const ДЕНЬ_НЕДЕЛИ = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' })
const ДЕНЬ = 24 * 60 * 60 * 1000

/**
 * Лист на холодильник: что и когда принимать, с клетками под карандаш.
 *
 * Печатается крупно и без интерфейса — на бумаге не нужны ни кнопки, ни
 * подсказки. Всё, что не должно попасть в печать, помечено `no-print`.
 *
 * Отмеченное карандашом в дневник не вернётся, и приложение будет считать
 * пропуски там, где их не было. Поэтому лист — шпаргалка для кухни, а не
 * второй дневник, и сказано это прямо на экране, до печати.
 */
export function Memo({
  medicines,
  slots,
  person,
  onBack,
}: {
  medicines: Dosing[]
  slots: IntakeSlot[]
  /** Чей лист. Пусто — человек в дневнике один. */
  person?: string | null
  onBack: () => void
}) {
  const [failed, setFailed] = useState(false)
  const now = Date.now()
  const memo = buildMemo(medicines, slots, now)

  const дни = Array.from({ length: MEMO_DAYS }, (_, i) => new Date(now + i * ДЕНЬ))

  return (
    <div className="stack">
      <div className="no-print">
        <BackBar onBack={onBack} />
      </div>

      {memo.slots.length === 0 ? (
        <div className="card">
          <Banner tone="info">
            <b>Печатать нечего</b>
            <div style={{ marginTop: 4 }}>
              Ни у одного препарата не задано время приёма. Задайте его в аптечке — и лист соберётся сам.
            </div>
          </Banner>
        </div>
      ) : (
        <>
          <div className="row row--stack no-print">
            <button
              className="btn btn--primary"
              onClick={() => void platform().files.print('Памятка о приёме').then((ok) => setFailed(!ok))}
            >
              Распечатать
            </button>
            <div className="muted">
              Лист для кухни: по нему раскладывают таблетницу и сверяются. Отмеченное на бумаге в дневник не
              попадёт — приложение будет считать эти приёмы пропущенными.
            </div>
            {failed && <Banner tone="warning">Печать не запустилась. Попробуйте ещё раз.</Banner>}
          </div>

          <div className="card memo">
            <div className="card__head">
              <h2>Приём лекарств{person ? ` — ${person}` : ''}</h2>
              {/* Дата обязательна: лист устаревает в тот день, когда врач
                  поменял дозу, и по нему продолжают раскладывать таблетницу. */}
              <span className="muted">лист составлен {ДАТА.format(now)}</span>
            </div>

            <table className="memo__table">
              <thead>
                <tr>
                  <th scope="col">Когда и что</th>
                  {дни.map((день) => (
                    <th key={день.getTime()} scope="col" className="memo__day">
                      {ДЕНЬ_НЕДЕЛИ.format(день)}
                      <span className="memo__date">{день.getDate()}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {memo.slots.map((slot) => (
                  <tr key={slot.time}>
                    <th scope="row" className="memo__slot">
                      {/* У времени, не совпавшего ни с одной кнопкой приёма,
                          названием служит само время — печатать его дважды
                          («09:00 · 09:00») ни к чему. */}
                      <span className="memo__time">
                        {slot.title === slot.time ? slot.time : `${slot.title} · ${slot.time}`}
                      </span>
                      {slot.items.map((item, i) => (
                        <span key={i} className="memo__item">
                          {item.name}
                          {item.dose && <span className="memo__dose"> {item.dose}</span>} — {item.count}
                          {/* Ритм прямо в строке препарата: лист уходит на
                              кухню, где приложения нет, и «через день» на нём
                              обязано быть написано. */}
                          {item.rhythm && <span className="memo__rhythm"> · {item.rhythm}</span>}
                        </span>
                      ))}
                    </th>
                    {дни.map((день, i) => (
                      // Перечёркнутая клетка вместо пустой: в день, когда в этом
                      // приёме принимать нечего, пустая клетка просит галочку и
                      // её ставят. Перечёркнутая не просит ничего.
                      <td
                        key={день.getTime()}
                        className={slot.days[i] ? 'memo__box' : 'memo__box memo__box--off'}
                        aria-label={slot.days[i] ? undefined : 'перерыв'}
                      />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>

            {memo.doseChanges.length > 0 && (
              // Курс с этапами кончается или меняется внутри недели — значит
              // лист верен не до конца, и раскладывать по нему всю таблетницу
              // нельзя.
              <p className="memo__warn">
                На этой неделе меняется доза: {memo.doseChanges.join(', ')}. Сверьтесь с приложением, прежде чем
                раскладывать на всю неделю.
              </p>
            )}
          </div>

          {memo.totals.length > 0 && (
            <div className="card memo">
              <div className="card__head">
                <h2>Разложить на неделю</h2>
                <span className="muted">отсчитать на неделю</span>
              </div>
              <table className="memo__table memo__table--totals">
                <tbody>
                  {memo.totals.map((item) => (
                    <tr key={item.name + item.dose}>
                      <th scope="row">
                        {item.name}
                        {item.dose && <span className="memo__dose"> {item.dose}</span>}
                      </th>
                      <td className="memo__count">{item.pieces} {item.unit}</td>
                      <td className="memo__enough">{item.enough === false ? 'в аптечке меньше' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
