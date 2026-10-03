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
import { splitBold } from '../logic/changelog'

function Items({ items }: { items: string[] }) {
  return (
    <ul className="changes">
      {items.map((item) => (
        <li key={item}>
          {splitBold(item).map((кусок, i) =>
            кусок.bold ? <b key={i}>{кусок.text}</b> : <span key={i}>{кусок.text}</span>,
          )}
        </li>
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

        <p>{PURPOSE} Не заменяет обращение к врачу.</p>
        <p className="muted">
          Семейный обмен передаёт дневники через ваш Яндекс.Диск. Копию можно сохранить или отправить вручную.
        </p>

        <details>
          <summary>Оценка показателей и ограничения</summary>
          <p className="muted">
            Категории давления — по шкале ESC/ESH, принятой в клинических рекомендациях; это справочная разметка, а не
            диагноз. Оценка сахара даётся относительно целевых значений, которые вы внесли сами — обычно со слов врача.
          </p>
          <p className="muted">
            При крайних значениях приложение показывает общие рекомендации. Это не назначение вам:
            если врач назначил другой порядок действий, держитесь его.
          </p>
        </details>

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
          <details>
            <summary>Что нового в версии {latest.version}</summary>
            <Items items={latest.items} />
          </details>

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
