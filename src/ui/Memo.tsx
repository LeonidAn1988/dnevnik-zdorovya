import { useState } from 'react'
import { addDays } from '../logic/days'
import type { IntakeSlot } from '../types'
import type { Dosing } from '../logic/regimen'
import { buildMemo, memoText, MEMO_DAYS } from '../logic/memo'
import { platform } from '../platform/ports'
import { BackBar, Banner } from './bits'

const ДАТА = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
const ДЕНЬ_НЕДЕЛИ = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' })

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
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const now = Date.now()
  const memo = buildMemo(medicines, slots, now)

  const share = async (save = false) => {
    setBusy(true); setMessage(null)
    try {
      const text = memoText(memo, now, person)
      const ok = save ? await platform().files.save(`памятка-приёма-${new Date(now).toISOString().slice(0,10)}.txt`, text, 'text/plain;charset=utf-8') : await platform().files.shareText(text, 'Памятка о приёме лекарств')
      if (!ok) setMessage(save ? 'Сохранение отменено.' : 'Памятка не отправлена. Можно сохранить её текст и прикрепить к сообщению.')
    } catch { setMessage('Не удалось подготовить памятку. Попробуйте ещё раз.') }
    finally { setBusy(false) }
  }

  // Календарными сутками: иначе в ночь перевода часов памятка на холодильник
  // печатает один день дважды.
  const дни = Array.from({ length: MEMO_DAYS }, (_, i) => addDays(new Date(now), i))

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
            <button className="btn" disabled={busy} onClick={() => void share()}>Поделиться памяткой</button>
            <button className="btn" disabled={busy} onClick={() => void share(true)}>Сохранить текст памятки</button>
            <p className="muted">В меню «Поделиться» выберите Telegram, почту или другое приложение. Если меню недоступно, сохраните текст и прикрепите файл.</p>
            {message && <p role="status">{message}</p>}
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

            <p className="muted">В клетках — количество на один приём. Прочерк — не принимать.</p>
            <div className="table-scroll"><table className="memo__table">
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
                {memo.slots.flatMap(slot => slot.items.map((item, index) => (
                  <tr key={`${slot.time}:${index}`}>
                    <th scope="row" className="memo__slot">
                      <span className="memo__time">{slot.title === slot.time ? slot.time : `${slot.title} · ${slot.time}`}</span>
                      <span className="memo__item">{item.name}{item.dose && <span className="memo__dose"> {item.dose}</span>}
                        <span className="memo__meal"> · {item.meal}</span>
                        {item.rhythm && <span className="memo__rhythm"> · {item.rhythm}</span>}
                      </span>
                    </th>
                    {дни.map((day, i) => <td key={day.getTime()} className={item.dayCounts[i] ? 'memo__box' : 'memo__box memo__box--off'} aria-label={item.dayCounts[i] ? `${item.name}: ${item.dayCounts[i]}` : `${item.name}: не принимать`}>{item.dayCounts[i] ?? '—'}</td>)}
                  </tr>
                )))}
              </tbody>
            </table></div>

            {memo.doseChanges.length > 0 && (
              // Курс с этапами кончается или меняется внутри недели — значит
              // лист верен не до конца, и раскладывать по нему всю таблетницу
              // нельзя.
              <p className="memo__warn">
                На этой неделе меняется схема приёма: {memo.doseChanges.join(', ')}. Сверьтесь с приложением, прежде чем
                раскладывать на всю неделю.
              </p>
            )}
          </div>

          {memo.totals.length > 0 && (
            <div className="card memo">
              <div className="card__head">
                <h2>Разложить на неделю</h2>
                <span className="muted">сколько штук взять из пачки</span>
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
