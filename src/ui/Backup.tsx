import { describeBackupAge, STALE_DAYS } from '../logic/backup'
import { useEffect, useRef, useState } from 'react'
import { plural } from '../logic/plural'
import { platform } from '../platform/ports'
import { Banner, Field, Reveal } from './bits'
import type { BackupStatus } from './useBackup'

/**
 * Где живут данные — словами, которые верны на этой платформе.
 *
 * В браузере дневник пропадает вместе с очисткой сайта и на iPhone сам собой
 * после недели без заходов. В установленном приложении ни того, ни другого не
 * бывает, зато он исчезает при «Очистить данные» в настройках Android и при
 * удалении приложения. Пугать не тем, что случится, — хуже, чем не пугать
 * вовсе: человек перестаёт верить предупреждениям.
 */
const isNative = () => platform().kind === 'native'

/**
 * Сохранность дневника: что защищает данные и что с этим делать.
 *
 * Формулировки нарочно без запугивания и без ложного спокойствия. Человек,
 * который ведёт дневник давления, не обязан разбираться в вытеснении хранилища
 * — ему нужно знать одно: копия есть или копии нет.
 */

export function DataSafety({
  status,
  encrypt,
  onEncryptChange,
  familyPhones = 0,
  familyCloud = false,
}: {
  status: BackupStatus
  /** Шифровать ли копию паролем. */
  encrypt: boolean
  onEncryptChange: (next: boolean) => void
  /** Сколько телефонов семьи читают эту копию. Закрытую паролем они не прочтут. */
  familyPhones?: number
  /** Подключён Яндекс.Диск: туда дневник уезжает открытым, паролю не подчиняется. */
  familyCloud?: boolean
}) {
  const { supported, target, durable, lastAt, count, busy, failed, stalled, password, locked } = status
  const [показать, setПоказать] = useState(false)
  /**
   * Набранное в поле и применённое к копиям — разные вещи, и держать их вместе
   * нельзя: каждая буква уходила бы в файл как ключ шифрования, а первая же
   * запись отмечала бы копию сохранённой. Применяем целиком — по уходу из
   * поля, по Enter и при закрытии экрана.
   */
  const [черновик, setЧерновик] = useState(password)
  const применён = черновик === password

  const свежий = useRef({ черновик, password, setPassword: status.setPassword })
  свежий.current = { черновик, password, setPassword: status.setPassword }
  useEffect(
    () => () => {
      const { черновик: draft, password: applied, setPassword } = свежий.current
      if (draft !== applied) setPassword(draft)
    },
    [],
  )

  const применить = () => {
    if (!применён) status.setPassword(черновик)
  }

  return (
    <div className="card">
      <div className="card__head">
        <h2>Копия дневника</h2>
      </div>

      {stalled && !failed && (
        <Banner tone="warning">
          <b>Последняя копия не записалась</b>
          <div style={{ marginTop: 4 }}>
            Файл на месте и доступ к нему цел — недоступна сама папка. Так бывает, когда облако не отвечает или сети
            нет. Приложение повторит само при следующем изменении.
          </div>
        </Banner>
      )}

      {failed && (
        <Banner tone="critical">
          <b>Копии перестали сохраняться</b>
          <div style={{ marginTop: 4 }}>
            Файл для копий удалён, перемещён или доступ к нему отозван. Выберите файл заново — иначе новые записи
            останутся {isNative() ? 'только внутри телефона' : 'только в браузере'}.
          </div>
        </Banner>
      )}

      <div className="stack" style={{ gap: 'var(--space-4)' }}>
        <div>
          <div style={{ marginTop: 4 }}>
            {lastAt === null ? (
              <b>копий ещё не было</b>
            ) : (
              <>
                Последняя — <b>{describeBackupAge(lastAt, Date.now())}</b>
                {status.warning === 'stale' && <span className="critical-text"> · с тех пор появились новые записи</span>}
              </>
            )}
          </div>
          {target && (
            <div className="muted" style={{ marginTop: 4 }}>
              Обновляется сама в файле <b>{target}</b>
              {encrypt ? ', закрытом паролем' : ''}.
            </div>
          )}
        </div>

        {/* Сделать копию — столбиком во всю ширину: две кнопки об одном и том
            же деле должны выглядеть одинаково, а не лесенкой по длине подписи.
            Выбор файла стоит рядом с ними, пока он не сделан: без него копия
            не обновляется сама. Когда файл выбран, отключение — редкое
            действие, и оно уезжает вниз, под объяснение. */}
        <div className="row row--stack">
          {status.canShare && (
            <button
              className="btn btn--primary"
              onClick={() => void status.shareNow()}
              disabled={busy || count === 0 || locked}
            >
              Отправить копию
            </button>
          )}
          <button
            className={status.canShare ? 'btn' : 'btn btn--primary'}
            onClick={() => void status.saveNow()}
            disabled={busy || count === 0 || locked}
          >
            Сохранить в файл
          </button>
          {supported && !target && (
            <button className="btn" onClick={() => void status.chooseTarget()} disabled={busy}>
              Выбрать файл для автокопий
            </button>
          )}
        </div>

        {supported && target && (
          <div className="row">
            <button className="btn btn--sm" onClick={() => void status.forgetTarget()} disabled={busy}>
              Отключить автокопии
            </button>
          </div>
        )}

        {supported && (
          <p className="muted" style={{ margin: 0 }}>
            Кладите файл в облачную папку — тогда копия переживёт потерю телефона.
          </p>
        )}

        {/* Шифрование не под `supported`: оно относится ко всем копиям, включая
            ручную отправку, а она работает и там, где автокопий нет. */}
        <div>
          <label className="optrow__label">
            <input
              type="checkbox"
              checked={encrypt}
              onChange={(event) => {
                onEncryptChange(event.target.checked)
                if (!event.target.checked) {
                  setЧерновик('')
                  status.setPassword('')
                }
              }}
            />
            <span className="optrow__title">
              Закрыть копию паролем
              {/*
                  Пароль закрывает только этот файл — тот, что вы сохраняете или
                  отправляете. Семейный обмен пишет свой, всегда открытый: иначе
                  другие телефоны его не прочитают. Раньше здесь стояло «тогда
                  её не прочитает и облако» — при подключённом Диске это было
                  прямой неправдой, потому что на Диск дневник уезжает открытым.
              */}
              <span className="fact__note">
                {familyCloud
                  ? 'этот файл — да, а копия для семьи на Диске остаётся открытой: иначе её не прочитают другие телефоны'
                  : familyPhones
                    ? 'закрытую паролем копию телефоны семьи не прочитают — обмен остановится'
                    : 'без пароля файл не открыть — куда бы вы его потом ни положили'}
              </span>
            </span>
          </label>

          <Reveal open={encrypt}>
            <div style={{ paddingTop: 'var(--space-3)' }}>
              {/* Кнопка «Показать» вне `Field`: тот оборачивает содержимое в
                  `label`, а кнопка внутри подписи к полю — и лишний повод
                  промахнуться, и путаница для скринридера. */}
              <div className="row" style={{ gap: 'var(--space-2)', alignItems: 'flex-end' }}>
                <div style={{ flex: '1 1 12ch' }}>
                  <Field label="Пароль копии">
                    <input
                      type={показать ? 'text' : 'password'}
                      value={черновик}
                      // Не `off`: пусть менеджер паролей предложит сохранить.
                      // Забытый пароль здесь стоит всего дневника, и записать
                      // его в надёжное место — лучшее, что человек может
                      // сделать.
                      autoComplete="new-password"
                      placeholder="придумайте и запишите"
                      onChange={(event) => setЧерновик(event.target.value)}
                      onBlur={применить}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') применить()
                      }}
                    />
                  </Field>
                </div>
                <button className="btn" type="button" onClick={() => setПоказать((v) => !v)}>
                  {показать ? 'Скрыть' : 'Показать'}
                </button>
              </div>

              {/* Одно сообщение за раз. Иначе «пароль не задан» и «пароль
                  набран, но не применён» висели бы вместе и противоречили друг
                  другу прямо на глазах у человека. */}
              <div style={{ marginTop: 'var(--space-3)' }}>
                {!применён ? (
                  <Banner tone="warning">
                    <b>Пароль набран, но ещё не применён.</b>
                    <div style={{ marginTop: 4 }}>
                      Коснитесь экрана вне поля или нажмите на клавиатуре «Готово» — тогда копия перешифруется. До
                      этого она не сохраняется.
                    </div>
                  </Banner>
                ) : locked ? (
                  <Banner tone="critical">
                    <b>Пароль не задан — копии не делаются.</b>
                    <div style={{ marginTop: 4 }}>
                      Записать открытый дневник туда, где вы ждёте зашифрованный, приложение не станет. Введите
                      пароль или снимите галку.
                    </div>
                  </Banner>
                ) : (
                  <Banner tone="warning">
                    <b>Запишите пароль и храните отдельно от телефона.</b>
                    <div style={{ marginTop: 4 }}>
                      Забытый пароль — это потеря всего дневника: восстановить копию будет нечем. Приложение его не
                      подскажет и подобрать не сможет.
                    </div>
                  </Banner>
                )}
              </div>
            </div>
          </Reveal>
        </div>

        {!supported && (
          <p className="muted" style={{ margin: 0 }}>
            {isNative()
              ? 'Android не даёт приложению писать копию в выбранный вами файл без спроса, поэтому копию нужно отправлять кнопкой.'
              : 'Этот браузер не умеет дописывать файл сам, поэтому копию нужно сохранять кнопкой.'}{' '}
            Напоминание придёт, если с последней копии пройдёт больше {STALE_DAYS}{' '}
            {plural(STALE_DAYS, 'дня', 'дней', 'дней')} с новыми записями.
          </p>
        )}

        {/* Одной строкой и только когда есть о чём предупредить: «всё хорошо»
            говорить незачем, а вот ненадёжное хранилище — повод для копии. */}
        {!isNative() && durable === false && (
          <div className="muted">
            Браузер может очистить записи при нехватке места. Добавьте приложение на домашний экран — защита включится.
          </div>
        )}
      </div>

    </div>
  )
}

const NUDGE_TITLE = {
  never: 'Дневник существует в одном экземпляре',
  behind: 'Новые записи ещё не в копии',
  stale: 'Резервная копия устарела',
} as const

/** Предупреждение на главном экране — там, где его увидят, а не в настройках. */
export function BackupNudge({
  status,
  onOpenSettings,
  onDismiss,
}: {
  status: BackupStatus
  onOpenSettings: () => void
  /** «Понятно»: убрать баннер на неделю. Сигнал останется точкой на кнопке. */
  onDismiss: () => void
}) {
  if (status.warning === null) return null

  const explain = {
    never: isNative()
      ? 'Записи есть только на этом телефоне. Если удалить приложение или потерять телефон, дневник пропадёт.'
      : 'Записи есть только в этом браузере. Если очистить его данные или потерять устройство, дневник пропадёт.',
    behind: `Вне копии ${status.behind} ${plural(status.behind, 'запись', 'записи', 'записей')}. Отправьте копию — телефон спросит, куда.`,
    stale: `С последней копии прошло больше ${STALE_DAYS} ${plural(STALE_DAYS, 'дня', 'дней', 'дней')}, и за это время появились новые записи.`,
  }[status.warning]

  return (
    // «Копий ещё не было» — не тревога, а обычное состояние сразу после
    // установки. Жёлтый треугольник тут обесценивает сам знак: если им
    // помечено всё подряд, его перестают замечать и там, где он к месту.
    <Banner tone={status.warning === 'never' ? 'info' : 'warning'}>
      <b>{NUDGE_TITLE[status.warning]}</b>
      <div style={{ marginTop: 4 }}>{explain}</div>
      {status.locked && (
        <div className="critical-text" style={{ marginTop: 4 }}>
          Копии закрыты паролем, а пароль не задан — пока он не введён в настройках, копия не сделается.
        </div>
      )}
      <div className="row" style={{ marginTop: 'var(--space-3)' }}>
        <button
          className="btn btn--primary"
          onClick={() => void (status.canShare ? status.shareNow() : status.saveNow())}
          disabled={status.busy || status.locked}
        >
          {status.canShare ? 'Отправить копию' : 'Сохранить копию'}
        </button>
        <button className="btn" onClick={onOpenSettings}>
          Настроить
        </button>
        <button className="btn btn--sm" onClick={onDismiss}>
          Скрыть на неделю
        </button>
      </div>
    </Banner>
  )
}
