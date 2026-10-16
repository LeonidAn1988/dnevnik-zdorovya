import { useEffect, useRef, useState } from 'react'
import type { Person } from '../types'
import { describeTally, distinctName, nameTakenBy, ПЕРВЫЙ, type Tally } from '../logic/people'
import { Row } from './Picker'

/**
 * «Этот телефон чей?» — вопрос, который снимает дубли «Я».
 *
 * Дубль заводится не от ошибки человека, а от устройства обмена: людей
 * сопоставляют только по ключу, а ключ у каждой установки свой. Два телефона
 * одного человека дают двух «Я», и приложение не может знать, один это человек
 * или двое разных. Знает только он сам — и спросить его надо в тот
 * единственный момент, когда ответ ещё есть: обмен уже привёз состав семьи, а
 * здесь ещё никто не назвался.
 *
 * Поэтому вопрос задаётся листом поверх всего, а не строкой на «Обзоре».
 * Пожилой человек карточку пролистает, и дубль заведётся молча — ровно то, что
 * чинится. Но и ловушкой лист не становится: «Назад» его закрывает, а вопрос
 * возвращается при следующем открытии приложения, пока на него не ответят.
 *
 * Три шага, и второй есть только тогда, когда терять есть что: объединение
 * назад не разбирается, и показать, что именно уедет, обязательно.
 */

type Шаг = { вид: 'выбор' } | { вид: 'подтверждение'; кто: Person } | { вид: 'имя' }

export function WhosePhone({
  people,
  mine,
  tally,
  onJoin,
  onRename,
  onDismiss,
}: {
  /** Весь состав семьи после обмена. */
  people: Person[]
  /** Человек этого телефона — тот, кого предстоит либо назвать, либо слить. */
  mine: Person
  /** Что числится за человеком: нужно и для подтверждения, и для различения тёзок. */
  tally: (id: string) => Tally
  /** «Это я» — местного человека объединить с выбранным, выживает выбранный. */
  onJoin: (winner: string) => Promise<void>
  /** «Я здесь новый» — назвать местного человека. */
  onRename: (name: string) => void
  /** Закрыли, не ответив. Вопрос вернётся при следующем открытии. */
  onDismiss: () => void
}) {
  const лист = useRef<HTMLDialogElement>(null)
  const [шаг, setШаг] = useState<Шаг>({ вид: 'выбор' })
  const [имя, setИмя] = useState('')
  const [занято, setЗанято] = useState(false)
  const pending = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [retryWinner, setRetryWinner] = useState<string | null>(null)

  // Открываем сами: лист существует ровно тогда, когда вопрос есть.
  useEffect(() => {
    const el = лист.current
    if (el && !el.open) el.showModal()
  }, [])

  const другие = people.filter((p) => p.id !== mine.id)
  const счёт = tally(mine.id)
  const переедет = describeTally(счёт)
  const тёзка = nameTakenBy(people, mine.id, имя)
  const имяГодно = имя.trim() !== '' && тёзка === null

  const закрыть = () => {
    if (pending.current) return
    лист.current?.close()
    onDismiss()
  }

  async function присоединить(winner: string) {
    if (pending.current) return
    pending.current = true
    setЗанято(true)
    setError(null)
    setRetryWinner(winner)
    try {
      await onJoin(winner)
      лист.current?.close()
    } catch {
      setError('Не удалось сохранить объединение. Люди и их записи не изменены. Повторите попытку.')
    } finally {
      pending.current = false
      setЗанято(false)
    }
  }

  return (
    <dialog
      ref={лист}
      className="sheet"
      data-busy={занято ? 'true' : undefined}
      aria-label="Этот телефон чей"
      onCancel={(event) => {
        // «Назад» и Esc закрывают, но ответом не считаются: вопрос вернётся
        // при следующем открытии. Ловушки здесь быть не должно — человек может
        // не знать ответа прямо сейчас.
        event.preventDefault()
        закрыть()
      }}
      onClick={(event) => {
        if (event.target === лист.current) закрыть()
      }}
    >
      <div className="sheet__body">
        {занято && <p role="status">Объединяю записи…</p>}
        {error && <div className="sheet__note sheet__note--warn" role="alert">{error}{retryWinner && <button type="button" className="btn" onClick={() => void присоединить(retryWinner)}>Повторить объединение</button>}</div>}
        {шаг.вид === 'выбор' && (
          <>
            <h2 className="sheet__ask">Этот телефон чей?</h2>
            <div className="sheet__note">
              Обмен принёс дневник семьи. Отметьте себя — записи с этого телефона лягут вам, а не ещё одному
              человеку в списке.
            </div>
            <fieldset className="sheet__list" disabled={занято} style={{ border: 0, padding: 0, margin: 0 }}>
              {другие.map((person) => (
                <Row
                  key={person.id}
                  option={{
                    id: person.id,
                    title: distinctName(people, person, tally),
                    hint: describeTally(tally(person.id)) || undefined,
                  }}
                  chosen={null}
                  onPick={() =>
                    // Подтверждение только когда есть что терять. На свежем
                    // телефоне переезжать нечему, и лишний вопрос там — просто
                    // лишнее касание.
                    переедет === ''
                      ? void присоединить(person.id)
                      : setШаг({ вид: 'подтверждение', кто: person })
                  }
                />
              ))}
              <Row
                option={{
                  id: 'new',
                  title: 'Я здесь новый',
                  hint: 'меня в этом списке ещё нет',
                  apart: true,
                }}
                chosen={null}
                onPick={() => setШаг({ вид: 'имя' })}
              />
            </fieldset>
          </>
        )}

        {шаг.вид === 'подтверждение' && (
          <>
            <h2 className="sheet__ask">Это вы — {distinctName(people, шаг.кто, tally)}?</h2>
            {/* Необратимость названа прямо. Карта перецепки односторонняя:
                записи уедут к выбранному человеку на всех телефонах семьи, и
                разобрать это обратно будет нечем. */}
            <div className="sheet__note">
              Тогда записи с этого телефона — {переедет} — станут вашими и сойдутся с теми, что уже есть. Вернуть как
              было будет нечем.
            </div>
            <div className="row row--stack" style={{ marginTop: 'var(--space-3)' }}>
              <button
                type="button"
                className="btn btn--primary"
                disabled={занято}
                onClick={() => void присоединить(шаг.кто.id)}
              >
                {занято ? 'Объединяю…' : 'Да, это я'}
              </button>
              <button type="button" className="btn" disabled={занято} onClick={() => setШаг({ вид: 'выбор' })}>
                Назад
              </button>
            </div>
          </>
        )}

        {шаг.вид === 'имя' && (
          <>
            <h2 className="sheet__ask">Как вас зовут?</h2>
            <div className="sheet__note">
              Имя попадёт в отчёт врачу и в список семьи. Оно и отличает вас от остальных — «{ПЕРВЫЙ}» здесь не
              подойдёт: так дневник называет того, кто ещё не назвался.
            </div>
            <input
              value={имя}
              placeholder="как называть в дневнике"
              autoComplete="off"
              onChange={(event) => setИмя(event.target.value)}
              style={{ marginTop: 'var(--space-3)' }}
            />
            {тёзка && (
              <div className="sheet__note sheet__note--warn">
                Так уже зовут другого человека в этом дневнике. Двое с одним именем неразличимы нигде: ни в списке,
                ни в отчёте врачу.
              </div>
            )}
            <div className="row row--stack" style={{ marginTop: 'var(--space-3)' }}>
              <button
                type="button"
                className="btn btn--primary"
                disabled={!имяГодно}
                onClick={() => {
                  onRename(имя.trim())
                  лист.current?.close()
                }}
              >
                Готово
              </button>
              <button type="button" className="btn" onClick={() => setШаг({ вид: 'выбор' })}>
                Назад
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  )
}
