/**
 * Обновление приложения: что нового и кнопка поставить.
 *
 * Показывает не «доступна версия 0.41.0», а то, что в ней изменилось, — теми же
 * словами, что человек прочтёт потом в истории версий. Номер версии сам по себе
 * никого не убеждает обновляться; «теперь видно, какой телефон семьи отстал» —
 * убеждает.
 *
 * Двумя местами. Полный блок — в «О приложении», рядом с историей версий, где
 * его ищут осознанно. Короткая карточка — на «Обзоре», потому что осознанно
 * туда никто не ходит, а обновиться надо всем.
 */

import type { Release } from '../logic/changelog'
import { splitBold } from '../logic/changelog'
import { АДРЕС_СТРАНИЦЫ } from '../logic/update'
import { platform } from '../platform/ports'
import { Banner } from './bits'
import type { UpdateState } from './useUpdate'

function Изменения({ releases }: { releases: Release[] }) {
  return (
    <>
      {releases.map((выпуск) => (
        <div key={выпуск.version} style={{ marginTop: 'var(--space-3)' }}>
          {/* Номер версии подписью, а не заголовком: человек пропустил,
              возможно, три выпуска, и главное здесь — сами изменения, а не
              нумерация. */}
          <div className="tile__label">
            {выпуск.version} · {выпуск.date}
          </div>
          <ul className="changes">
            {выпуск.items.map((item) => (
              <li key={item}>
                {splitBold(item).map((кусок, i) =>
                  кусок.bold ? <b key={i}>{кусок.text}</b> : <span key={i}>{кусок.text}</span>,
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  )
}

/** Кнопки и всё, что приложение говорит по ходу установки. */
function Действия({ состояние, короткая }: { состояние: UpdateState; короткая?: boolean }) {
  const { этап, доля, ошибка, некудаРазрешить } = состояние
  const занято = этап !== 'нет'

  return (
    <>
      <div className="row row--stack" style={{ marginTop: 'var(--space-3)' }}>
        <button className="btn btn--primary" disabled={занято} onClick={() => void состояние.обновить()}>
          {этап === 'качаем'
            ? `Скачиваю… ${Math.round(доля * 100)}%`
            : этап === 'ставим'
              ? 'Открываю установщик…'
              : 'Обновить'}
        </button>
        {короткая && !занято && (
          <button className="btn btn--sm" onClick={состояние.отложить}>
            Не сейчас
          </button>
        )}
      </div>

      {этап === 'качаем' && (
        <div className="supply" aria-hidden="true">
          <div className="supply__track">
            <div className="supply__fill" style={{ width: `${Math.round(доля * 100)}%` }} />
          </div>
        </div>
      )}

      {этап === 'ставим' && (
        <div className="muted" style={{ marginTop: 'var(--space-2)' }}>
          Дальше спросит сам телефон. Записи не пропадут: новая версия встаёт поверх прежней.
        </div>
      )}

      {/* Первый раз телефон спросит разрешение ставить приложения из этого
          источника. Это не наша прихоть, и объяснить надо до того, как человек
          увидит незнакомое системное окно. */}
      {некудаРазрешить && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <Banner tone="warning">
            <b>Телефон не открыл нужный экран</b>
            <div style={{ marginTop: 4 }}>
              Настройки телефона → «Приложения» → «Дневник здоровья» → «Установка неизвестных приложений».
            </div>
          </Banner>
        </div>
      )}

      {ошибка && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <Banner tone="warning">
            <b>Не получилось обновить</b>
            <div style={{ marginTop: 4 }}>{ошибка}</div>
            <div style={{ marginTop: 4 }}>
              Можно скачать файл со{' '}
              <a href={АДРЕС_СТРАНИЦЫ} target="_blank" rel="noopener noreferrer" onClick={(e) => {
                e.preventDefault()
                void platform().files.openExternal(АДРЕС_СТРАНИЦЫ)
              }}>
                страницы загрузок
              </a>{' '}
              и поставить руками — как раньше.
            </div>
          </Banner>
        </div>
      )}
    </>
  )
}

/** Полный блок для «О приложении». */
export function UpdateBlock({ состояние }: { состояние: UpdateState }) {
  if (!platform().update.canSelfUpdate()) return null

  if (состояние.свежие.length === 0) {
    return (
      <div className="card">
        <div className="card__head">
          <h2>Обновление</h2>
        </div>
        <div className="muted">
          {состояние.проверяем ? 'Проверяю…' : 'Установлена последняя версия.'}
        </div>
        <div className="row" style={{ marginTop: 'var(--space-3)' }}>
          <button className="btn btn--sm" disabled={состояние.проверяем} onClick={() => void состояние.проверить()}>
            Проверить ещё раз
          </button>
        </div>
        {состояние.ошибка && (
          <div className="muted" style={{ marginTop: 'var(--space-2)' }}>
            Не удалось проверить: {состояние.ошибка}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="card">
      {/* Номер версии — только в подписи выпуска ниже: в заголовке он стоял
          вторым разом и читался как другая версия. */}
      <div className="card__head">
        <h2>Есть новая версия</h2>
      </div>
      <Изменения releases={состояние.свежие} />
      <Действия состояние={состояние} />
    </div>
  )
}

/**
 * Короткая карточка для «Обзора».
 *
 * Не показывается, если человек сказал «не сейчас» про эту самую версию:
 * следующая спросит заново, а эта больше не трогает.
 */
export function UpdateNudge({ состояние }: { состояние: UpdateState }) {
  if (!platform().update.canSelfUpdate()) return null
  if (состояние.свежие.length === 0 || состояние.отложено) return null

  const сколько = состояние.свежие.length
  return (
    <div className="card">
      <div className="card__head">
        <h2>Есть новая версия</h2>
      </div>
      <div className="muted">
        {сколько === 1
          ? 'Вышла после той, что у вас стоит.'
          : `С вашей версии вышло ${сколько} обновления.`}
      </div>
      {/* Только свежий выпуск: на «Обзоре» карточка не должна разрастаться на
          пол-экрана. Остальное — в «О приложении». */}
      <Изменения releases={состояние.свежие.slice(0, 1)} />
      <Действия состояние={состояние} короткая />
    </div>
  )
}
