import type { Measurement, Person, Regimen } from '../types'
import { silence, silenceText } from '../logic/silence'
import { ChevronIcon } from './icons'

/**
 * Блок «Свои» на «Обзоре»: у кого в дневнике тишина.
 *
 * Появляется только когда обмен настроен и людей больше одного — иначе чужим
 * записям взяться неоткуда. И только когда есть что сказать: пустой блок
 * «у всех всё хорошо» занимал бы место, ничего не сообщая.
 *
 * Говорим о записях, а не о человеке: «измерений нет 4 дня», не «отец не
 * мерил». Разница не в вежливости — приложение и правда знает только про
 * записи. Отец мог уехать на дачу, телефон мог остаться без сети, а ключ Диска
 * мог отвалиться, и все три случая выглядят отсюда одинаково.
 */
export function SilenceCard({
  people,
  measurements,
  medicines,
  activePerson,
  enabled,
  onPick,
}: {
  people: Person[]
  measurements: Measurement[]
  medicines: Regimen[]
  activePerson: string
  /** Настроен ли обмен: без него блок не показываем. */
  enabled: boolean
  onPick: (personId: string) => void
}) {
  if (!enabled || people.length <= 1) return null

  const молчат = silence(people, measurements, medicines, activePerson, Date.now())
  if (молчат.length === 0) return null

  return (
    <div className="card">
      <div className="card__head">
        <h2>Свои</h2>
        <span className="muted">давно нет записей</span>
      </div>
      <ul className="shortage">
        {молчат.map(({ person, bp, intake }) => {
          // Говорим только о том, о чём расчёт сказал, что молчит. Коробок нет
          // — про приём молчим совсем, а не пишем «нет ни одной отметки».
          const что = [bp && silenceText(bp.days, 'bp'), intake && silenceText(intake.days, 'intake')]
            .filter(Boolean)
            .join(' · ')
          return (
            <li key={person.id}>
              <button type="button" className="shortage__row" onClick={() => onPick(person.id)}>
                <span className="shortage__name">{person.name || 'Без имени'}</span>
                <span className="shortage__why">{что}</span>
                <ChevronIcon />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
