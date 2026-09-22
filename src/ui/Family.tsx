/**
 * Семья: обмен дневниками между телефонами без сервера.
 *
 * Устроено из двух половин, каждая из которых уже была по отдельности. Свой
 * дневник телефон пишет в файл — это обычная копия. Здесь добавляется вторая
 * половина: файлы других телефонов, которые приложение читает при каждом
 * открытии и сливает с местным.
 *
 * Экран нарочно говорит, чего обмен не делает. Он не мгновенный: между двумя
 * телефонами стоит облачный клиент. Он не работает, пока приложение закрыто:
 * там наш код не выполняется вовсе. Человек, ожидающий большего, решит, что
 * приложение сломалось, — а оно работает ровно как обещано.
 */

import type { BackupSource } from '../platform/ports'
import { describeBackupAge } from '../logic/backup'
import { useState } from 'react'
import { BackBar, Banner, Field } from './bits'
import { authUrl, fileLabel } from '../logic/yandex'
import { canShareFile, copyTextOut, shareTextOut } from '../logic/io'
import type { FamilySyncStatus } from './useFamilySync'
import { describeMerge } from './useFamilySync'

/**
 * Подключение Яндекс.Диска в два шага.
 *
 * Ключ приложение получить само не может: секрета у него нет и быть не должно —
 * он лежал бы прямо в установленном приложении. Поэтому Яндекс показывает ключ
 * человеку, а тот его вставляет. Один раз примерно на год.
 */
/**
 * Передать ключ на второй телефон.
 *
 * Без этого настройка обрывалась на середине: ключ Яндекс показывает один раз
 * на своей странице, в приложении он дальше не виден, а нужен на каждом
 * телефоне семьи. Переписывать шестьдесят знаков с экрана на экран человек не
 * станет — и правильно сделает.
 */
function KeyHandoff({ ключ }: { ключ: string }) {
  const [видно, setВидно] = useState(false)
  const [что, setЧто] = useState<'copied' | 'failed' | null>(null)

  return (
    <div style={{ marginTop: 'var(--space-4)' }}>
      <div className="tile__label" style={{ marginBottom: 'var(--space-2)' }}>
        Подключить ещё телефон
      </div>
      <div className="muted">Вставьте на нём этот же ключ — там, где вы вставляли его здесь.</div>
      <div className="row" style={{ marginTop: 'var(--space-3)' }}>
        <button
          className="btn"
          onClick={() => {
            void copyTextOut(ключ).then((ok) => {
              setЧто(ok ? 'copied' : 'failed')
              setTimeout(() => setЧто(null), 2500)
            })
          }}
        >
          Скопировать ключ
        </button>
        {canShareFile() && (
          <button className="btn" onClick={() => void shareTextOut(ключ, 'Ключ дневника здоровья')}>
            Отправить
          </button>
        )}
        <button className="btn btn--sm" onClick={() => setВидно((v) => !v)}>
          {видно ? 'Скрыть' : 'Показать'}
        </button>
      </div>
      {что === 'copied' && <div className="muted" style={{ marginTop: 'var(--space-2)' }}>Ключ скопирован.</div>}
      {что === 'failed' && (
        <div className="muted" style={{ marginTop: 'var(--space-2)' }}>Скопировать не вышло — нажмите «Показать».</div>
      )}
      {видно && <div className="keyline">{ключ}</div>}
      <div className="muted" style={{ marginTop: 'var(--space-2)' }}>
        Ключ открывает папку с дневниками семьи. Отправляйте только своим.
      </div>
    </div>
  )
}

function CloudConnect({ onConnect }: { onConnect: (pasted: string) => Promise<boolean> }) {
  const [вставлено, setВставлено] = useState('')
  const [идёт, setИдёт] = useState(false)

  return (
    <div className="stack" style={{ gap: 'var(--space-3)' }}>
      <div className="muted">Один ключ на все телефоны семьи.</div>

      {/* Кнопка, поле, кнопка — по порядку действий. Объяснение, почему это
          устроено именно так, лежит под «Как это работает»: человек, который
          пришёл настраивать, читать про папки приложения не собирался. */}
      <a className="btn btn--primary" href={authUrl()} target="_blank" rel="noopener noreferrer">
        1. Получить ключ на Яндексе
      </a>
      <Field label="2. Вставьте сюда ключ, который покажет Яндекс">
        <input
          value={вставлено}
          onChange={(event) => setВставлено(event.target.value)}
          placeholder="вставьте ключ"
          autoComplete="off"
        />
      </Field>
      <button
        className="btn btn--primary"
        disabled={идёт || вставлено.trim() === ''}
        onClick={() => {
          setИдёт(true)
          void onConnect(вставлено).finally(() => {
            setИдёт(false)
            setВставлено('')
          })
        }}
      >
        {идёт ? 'Подключаю…' : '3. Подключить'}
      </button>

      <details>
        <summary>Как это работает</summary>
        <div className="muted" style={{ marginTop: 'var(--space-2)' }}>
          Ключ открывает приложению одну папку на Диске — ту, что оно само и заведёт. Остального Диска оно не видит.
          Папка принадлежит аккаунту, чей ключ вставлен, поэтому ключ у семьи один: с разными аккаунтами у каждого будет
          своя папка, и друг друга вы не увидите. Отдельный аккаунт под это удобнее, чем тот, где ваша почта. Делиться
          папкой средствами Яндекса не нужно и бесполезно — приложению доступна только своя.
        </div>
      </details>
    </div>
  )
}

export function FamilyScreen({
  family,
  target,
  onChooseTarget,
  busy,
  onBack,
}: {
  family: FamilySyncStatus
  /** Свой файл копий: без него делиться нечем. */
  target: string | null
  /** Выбрать свой файл прямо здесь — раньше за этим отправляли на другой экран. */
  onChooseTarget: () => void
  busy: boolean
  onBack: () => void
}) {
  return (
    <div className="stack">
      <BackBar onBack={onBack} />

      <div className="card">
        <div className="card__head">
          <h2>Семья</h2>
          <span className="muted">общий дневник на несколько телефонов</span>
        </div>

        {/* Яндекс.Диск — короткий путь: подключил один раз, и приложение само
            видит дневники всех своих. Файлы вручную остаются запасным путём
            для тех, у кого другое облако. */}
        <div className="tile__label" style={{ marginBottom: 'var(--space-2)' }}>Яндекс.Диск</div>
        {family.cloud.connected ? (
          <>
            <div className="muted">
              Подключён. {family.cloud.canRead
                ? 'Дневники семьи читаются и отправляются сами.'
                : 'В браузере дневник только отправляется — чужие читает приложение на телефоне.'}
            </div>
            {/* Сказать это надо там, где подключают, а не только в настройках
                копии: человек, отдающий дневник в облако, вправе знать, в каком
                он там виде. Закрыть его паролем нельзя — обмен на том и стоит,
                что другие телефоны читают файл. */}
            <div className="muted" style={{ marginTop: 'var(--space-2)' }}>
              Дневник лежит в папке приложения открытым: пароль копии на него не действует — иначе телефоны семьи
              его не прочитают.
            </div>
            {family.cloud.files.length === 1 && (
              // Один файл в общей папке — либо своих ещё не подключили, либо
              // ключи от разных аккаунтов Яндекса, и папки у всех свои. Второе
              // со стороны неотличимо от «обмен настроен», и молчать нельзя.
              <div className="muted" style={{ marginTop: 'var(--space-3)' }}>
                Здесь пока только ваш дневник. Если у своих он тоже один — ключи от разных аккаунтов, и папка у каждого
                своя. Нужен один ключ на всех.
              </div>
            )}
            {family.cloud.files.length > 0 && (
              <ul className="pills" style={{ marginTop: 'var(--space-3)' }}>
                {family.cloud.files.map((файл) => (
                  <li className="pill" key={файл.name}>
                    <div className="pill__head">
                      <span className="pill__title">
                        <span className="pill__name">{fileLabel(файл.name, файл.name === family.cloud.mine)}</span>
                      </span>
                    </div>
                    <div className="muted">
                      {файл.modified
                        ? `обновлён ${new Date(файл.modified).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`
                        : 'дата неизвестна'}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {family.cloud.legacy.length > 0 && (
              // Файл без метки установки писали версии до 0.30.0, и писать в
              // него могли сразу два телефона: у неназванного человека имя
              // файла выходило одинаковым. Сами такой не трогаем — под ним
              // может лежать чужой дневник.
              <div style={{ marginTop: 'var(--space-3)' }}>
                <Banner tone="info">
                  <div>
                    <strong>Файл старого образца: {family.cloud.legacy.join(', ')}</strong>
                  </div>
                  <div className="muted" style={{ marginTop: 'var(--space-1)' }}>
                    До этой версии два телефона с неназванным человеком писали в один файл и затирали друг друга.
                    Теперь у каждого телефона свой. Старый оставлен и по-прежнему читается — удалите его на Диске сами,
                    когда обновятся все телефоны семьи.
                  </div>
                </Banner>
              </div>
            )}

            {/* Второй телефон подключается тем же ключом — и это ровно то
                место, где настройка встала: ключ показали один раз на странице
                Яндекса, а перенести его было нечем. */}
            {family.cloud.key && <KeyHandoff ключ={family.cloud.key} />}

            <div className="row row--stack" style={{ marginTop: 'var(--space-3)' }}>
              <button className="btn btn--primary" onClick={() => void family.syncNow()} disabled={family.busy}>
                {family.busy ? 'Обмен идёт…' : 'Обменяться сейчас'}
              </button>
              <button className="btn btn--sm" onClick={family.cloud.disconnect}>
                Отключить Яндекс.Диск
              </button>
            </div>
          </>
        ) : (
          <CloudConnect onConnect={family.cloud.connect} />
        )}
        {family.cloud.error && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Banner tone="warning">{family.cloud.error}</Banner>
          </div>
        )}

        <div className="tile__label" style={{ margin: 'var(--space-5) 0 var(--space-2)' }}>
          Обмен файлами — если облако другое
        </div>
        {/* Путей два, и они не складываются. Пока это не было сказано, шаги
            «заведите общую папку» читались как продолжение Яндекс.Диска, и
            выходило, что файлы надо носить руками. */}
        <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
          Запасной путь для тех, у кого не Яндекс.Диск. Здесь общую папку заводите вы, и файлы в неё кладёт каждый
          телефон сам — через своё облако.
        </div>
        {!family.supported ? (
          <Banner tone="info">
            <b>Обмен пока только в приложении для Android.</b>
            <div style={{ marginTop: 4 }}>В браузере он появится позже.</div>
          </Banner>
        ) : (
          <>
            {/* Пошагово, потому что порядок неочевиден: сначала общая папка,
                потом свой файл в ней, и только потом чужие. Без первых двух
                шагов «Добавить телефон» не к чему приложить. */}
            {/* Инструкция открыта, пока обмен не настроен, и сворачивается,
                когда он заработал: перечитывать её незачем. */}
            <details open={!target || family.sources.length === 0}>
              <summary>Как настроить</summary>
              <ol className="steps" style={{ marginTop: 'var(--space-3)' }}>
                <li>Заведите общую папку в облаке и откройте к ней доступ своим.</li>
                <li>Создайте в ней свой файл кнопкой ниже — на каждом телефоне свой.</li>
                <li>Когда облако разнесёт файлы, добавьте сюда файлы остальных.</li>
              </ol>
            </details>

            <div className="tile__label" style={{ margin: 'var(--space-5) 0 var(--space-2)' }}>
              Ваш файл
            </div>
            {target ? (
              <div className="muted">{target}</div>
            ) : (
              <>
                <div className="muted">Не выбран — остальные телефоны прочитают пустоту.</div>
                <div className="row row--stack" style={{ marginTop: 'var(--space-3)' }}>
                  <button className="btn btn--primary" onClick={onChooseTarget} disabled={busy}>
                    Выбрать свой файл
                  </button>
                </div>
              </>
            )}

            <div className="tile__label" style={{ margin: 'var(--space-5) 0 var(--space-2)' }}>
              Телефоны семьи
            </div>

            {family.sources.length === 0 ? (
              <div className="muted">Пока ни одного — см. три шага выше.</div>
            ) : (
              <ul className="pills">
                {family.sources.map((source: BackupSource) => (
                  <li className="pill" key={source.id}>
                    <div className="pill__head">
                      <span className="pill__title">
                        <span className="pill__name">{source.name}</span>
                      </span>
                    </div>
                    {/* Дата последней записи в файле: «облако не донесло» и
                        «человек ничего не вносил» снаружи неотличимы без неё. */}
                    <div className="muted">
                      {family.freshness[source.id]
                        ? `записи по ${new Date(family.freshness[source.id]!).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`
                        : 'записей пока нет'}
                    </div>
                    <div className="row" style={{ marginTop: 'var(--space-2)' }}>
                      <button className="btn btn--sm" onClick={() => void family.removeSource(source.id)}>
                        Отключить
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="row row--stack" style={{ marginTop: 'var(--space-4)' }}>
              <button className="btn btn--primary" onClick={() => void family.addSource()} disabled={family.busy}>
                Добавить телефон
              </button>
              {family.sources.length > 0 && (
                <button className="btn" onClick={() => void family.syncNow()} disabled={family.busy}>
                  {family.busy ? 'Чтение…' : 'Прочитать сейчас'}
                </button>
              )}
            </div>

            {family.sources.length > 0 && (
              <div className="muted" style={{ marginTop: 'var(--space-4)' }}>
                Последний раз{' '}
                {family.lastAt === null ? 'ещё не читали' : describeBackupAge(family.lastAt, Date.now())} —{' '}
                {describeMerge(family.lastLog)}.
              </div>
            )}

            {family.unreadable.length > 0 && (
              <div style={{ marginTop: 'var(--space-4)' }}>
                <Banner tone="warning">
                  <b>Не удалось прочитать: {family.unreadable.join(', ')}.</b>
                  <div style={{ marginTop: 4 }}>
                    Файл могли переименовать, удалить или закрыть паролем. Добавьте его заново.
                  </div>
                </Banner>
              </div>
            )}

            {family.lastLog && family.lastLog.stockConflicts.length > 0 && (
              <div style={{ marginTop: 'var(--space-4)' }}>
                <Banner tone="warning">
                  <b>Остаток разошёлся: {family.lastLog.stockConflicts.join(', ')}.</b>
                  <div style={{ marginTop: 4 }}>
                    Два телефона посчитали упаковку по-разному. Пересчитайте и поправьте остаток руками.
                  </div>
                </Banner>
              </div>
            )}
          </>
        )}
      </div>

      {family.supported && (
        <div className="card">
          <details>
            <summary>Чего обмен не делает</summary>
            <div className="muted" style={{ marginTop: 'var(--space-3)' }}>
              Он не мгновенный: файл идёт от телефона к телефону через облако, и когда облако его перенесёт, решает
              оно. И он не идёт, пока приложение закрыто — обмен случается ровно тогда, когда вы его открываете.
              <div style={{ marginTop: 'var(--space-2)' }}>
                Удаление сильнее правки: если запись удалили на одном телефоне, она уйдёт и на остальных. Отметки
                приёма, наоборот, складываются — ни одна не пропадает.
              </div>
            </div>
          </details>
        </div>
      )}
    </div>
  )
}
