/**
 * О приложении и что изменилось.
 *
 * Номер версии человеку нужен ровно в двух случаях: когда он спрашивает, почему
 * что-то работает не так, и когда его об этом спрашивают в ответ. Поэтому он
 * стоит подписанной строкой, а не мелким серым числом в углу карточки.
 *
 * История показывает свежую запись целиком и прячет прежние под раскрывашку.
 * Девять версий подряд читать незачем: человека интересует, что поменялось со
 * вчерашнего дня, а полная история нужна раз в год и по делу.
 */

import type { Release } from '../logic/changelog'
import { PURPOSE } from '../logic/disclaimer'

function Items({ items }: { items: string[] }) {
  return (
    <ul className="changes">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

export function About({ releases }: { releases: Release[] }) {
  const [latest, ...older] = releases

  return (
    <>
      <div className="card">
        <div className="card__head">
          <h2>О приложении</h2>
        </div>

        {latest && (
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <div className="tile__label">Версия</div>
            <div style={{ marginTop: 4, fontWeight: 600 }}>
              {latest.version} <span className="muted nowrap">от {latest.date}</span>
            </div>
          </div>
        )}

        <p>
          Дневник давления, сахара и лекарств. Читает историю прямо из тонометра Omron RS7 Intelli IT и никуда её не
          отправляет.
        </p>

        {/* Назначение пишем прямо и первым делом: это то, по чему приложение
            судят в первую очередь. Одной строкой «не медизделие» здесь не
            обойтись — важно сказать, что оно делает и чего не делает. */}
        <div className="tile__label" style={{ marginTop: 'var(--space-4)' }}>Назначение и ограничения</div>
        <p style={{ marginTop: 'var(--space-2)' }}>{PURPOSE}</p>
        <p>
          Категории давления — по шкале ESC/ESH, принятой в клинических рекомендациях; это справочная разметка, а не
          диагноз. Оценка сахара даётся относительно целевых значений, которые вы внесли сами — обычно со слов врача.
        </p>
        <p>
          При крайних значениях приложение показывает общие рекомендации — то, что при них обычно делают. Это не
          назначение вам: если врач назначил другой порядок действий, держитесь его.
        </p>
        <p style={{ marginBottom: 0 }}>
          <b>Приложение не ставит диагноз, не назначает лечение и не заменяет обращение к врачу.</b>
        </p>

        <details style={{ marginTop: 'var(--space-4)' }}>
          <summary>Как это работает</summary>
          <div className="muted" style={{ marginTop: 'var(--space-2)' }}>
            Выгрузка работает только на чтение: единственная запись в прибор за всё время — разовый ключ сопряжения.
            Часы тонометра приложение не переставляет. Разбор протокола основан на открытом проекте{' '}
            <a href="https://github.com/userx14/omblepy" target="_blank" rel="noreferrer">
              omblepy
            </a>{' '}
            (лицензия MIT).
          </div>
        </details>
      </div>

      {latest && (
        <div className="card">
          {/* Ни версии, ни даты в заголовке: и то и другое стоит строкой выше,
              в «О приложении», и повторять их здесь значит написать одно и то
              же дважды подряд. Прежние версии свои подписи несут сами — там
              они и нужны, чтобы понять, к чему относится список. */}
          <div className="card__head">
            <h2>Что изменилось</h2>
          </div>

          <Items items={latest.items} />

          {older.length > 0 && (
            /* Родной `details`, а не своя раскрывашка: он открывается без
               скрипта, ищется поиском по странице и печатается раскрытым. */
            <details style={{ marginTop: 'var(--space-2)' }}>
              <summary>Прежние версии</summary>
              <div className="stack" style={{ gap: 'var(--space-4)', marginTop: 'var(--space-2)' }}>
                {older.map((release) => (
                  <div key={release.version}>
                    {/* Свой цвет: `h3` в проекте служит приглушённой подписью,
                        а здесь это заголовок записи — тусклее собственного
                        списка он быть не должен. */}
                    <h3 style={{ margin: 0, fontSize: 'var(--fs-2)', color: 'var(--text-primary)' }}>
                      {release.version} <span className="muted nowrap">от {release.date}</span>
                    </h3>
                    <Items items={release.items} />
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </>
  )
}
