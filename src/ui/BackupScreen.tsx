/**
 * Копия дневника — один экран вместо трёх мест.
 *
 * Раньше сохранение копии, её пароль и восстановление жили в разных карточках
 * настроек, за пять экранов друг от друга, и назывались по-разному:
 * «Сохранность данных», «Импорт из файла», «Данные». Человек, у которого
 * пропали записи, искал слово «восстановить» и находил «импорт».
 *
 * Порядок сверху вниз — по частоте: что с копией сейчас, как её сделать, куда
 * складывать, пароль, как вернуть дневник. В самом низу, за подтверждением, —
 * удаление всех измерений: опасное подальше от пальца.
 */

import { useRef, useState } from 'react'
import type { Measurement, Settings as SettingsData } from '../types'
import { download, parseImportFile, toCsv, toJson, type ImportResult, takesPersonalFrom } from '../logic/io'
import { decryptBackup, isEncrypted } from '../logic/crypto'
import { Banner, BackBar, Field } from './bits'
import { DataSafety } from './Backup'
import type { BackupStatus } from './useBackup'

const today = () => new Date().toISOString().slice(0, 10)

export function BackupScreen({
  settings,
  onPatch,
  measurements,
  onRestore,
  onClearAll,
  backup,
  familyPhones = 0,
  familyCloud = false,
  onBack,
}: {
  settings: SettingsData
  onPatch: (fields: Partial<SettingsData>) => void
  measurements: Measurement[]
  onRestore: (incoming: ImportResult) => Promise<{ added: number; medicines: number; settingsRestored: boolean }>
  onClearAll: () => Promise<void>
  backup: BackupStatus
  /** Сколько телефонов семьи читают копию — пароль их отрежет. */
  familyPhones?: number
  /** Подключён Яндекс.Диск: туда дневник уезжает открытым, паролю не подчиняется. */
  familyCloud?: boolean
  onBack: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<{ tone: 'good' | 'critical'; text: string } | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  /** Зашифрованный файл, ждущий пароля. Держим текст, а не сам файл: второй раз его не прочитать. */
  const [закрытый, setЗакрытый] = useState<{ name: string; text: string } | null>(null)
  const [пароль, setПароль] = useState('')

  async function восстановить(name: string, text: string) {
    try {
      const parsed = parseImportFile(name, text)
      const { added, medicines, settingsRestored } = await onRestore(parsed)
      const parts = [`Прочитано записей: ${parsed.measurements.length}, добавлено новых: ${added}.`]
      if (medicines > 0) parts.push(`Добавлено препаратов в аптечку: ${medicines}.`)
      if (settingsRestored) parts.push('Настройки восстановлены.')
      else if (parsed.settings) parts.push('Люди, цели и часы приёма оставлены свои: в файле не все здешние люди.')
      if (parsed.skipped) parts.push(`Не удалось прочитать строк: ${parsed.skipped}.`)
      setMessage({ tone: 'good', text: parts.join(' ') })
      setЗакрытый(null)
      setПароль('')
    } catch (error) {
      setMessage({ tone: 'critical', text: error instanceof Error ? error.message : String(error) })
    }
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const text = await file.text()
    if (isEncrypted(text)) {
      setMessage(null)
      setЗакрытый({ name: file.name, text })
      return
    }
    setЗакрытый(null)
    await восстановить(file.name, text)
  }

  /** Восстановление из того файла, куда идут копии: короткий путь без выбора файла. */
  async function изФайлаКопий() {
    const text = await backup.readTarget()
    if (text === null) {
      setMessage({ tone: 'critical', text: 'Файл копии не читается: его удалили, переместили или отозвали доступ.' })
      return
    }
    if (isEncrypted(text)) {
      setMessage(null)
      setЗакрытый({ name: backup.target ?? 'копия.json', text })
      return
    }
    setЗакрытый(null)
    await восстановить('копия.json', text)
  }

  async function расшифровать() {
    if (!закрытый) return
    try {
      const открытый = await decryptBackup(закрытый.text, пароль)
      // Пароль подошёл. Если копия своя — включаем шифрование и запоминаем
      // пароль: иначе на новом телефоне зашифрованная копия перезаписалась бы
      // открытой при первой же записи. Чужую копию (отца, чтобы посмотреть)
      // открыть можно, но свои копии её паролем не закрываем.
      const разобранная = parseImportFile('копия.json', открытый)
      if (!разобранная.settings || takesPersonalFrom(settings, разобранная.settings)) {
        onPatch({ backupEncrypt: true })
        backup.setPassword(пароль)
      }
      // Имя берём исходное, но разбор всегда как JSON: зашифрованной бывает
      // только полная копия, а расширение у файла может быть любым.
      await восстановить(закрытый.name.endsWith('.json') ? закрытый.name : `${закрытый.name}.json`, открытый)
    } catch (error) {
      setMessage({ tone: 'critical', text: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <div className="stack">
      <BackBar onBack={onBack} />

      <DataSafety familyPhones={familyPhones} familyCloud={familyCloud}
        status={backup}
        encrypt={settings.backupEncrypt}
        onEncryptChange={(next) => onPatch({ backupEncrypt: next })}
      />

      <div className="card">
        <div className="card__head">
          <h2>Восстановить дневник</h2>
          <span className="muted">сейчас записей: {measurements.length}</span>
        </div>

        <div className="row row--stack">
          {/* Имя файла — подписью под кнопкой, а не в самой кнопке: «Вернуть из
              «дневник-здоровья-2026-09-01.json»» разворачивалось на две строки
              и читалось как ошибка вёрстки. */}
          {backup.target && (
            <button className="btn btn--primary" onClick={() => void изФайлаКопий()}>
              Вернуть из копии
            </button>
          )}
          <button className={backup.target ? 'btn' : 'btn btn--primary'} onClick={() => fileRef.current?.click()}>
            Выбрать другой файл
          </button>
          <input ref={fileRef} type="file" accept=".csv,.json,.tsv,text/csv,application/json" onChange={handleFile} hidden />
        </div>

        <div className="muted" style={{ marginTop: 'var(--space-3)' }}>
          {backup.target ? <>Из файла «{backup.target}». </> : null}
          Совпадающие записи не задваиваются, а удалённые не возвращаются.
        </div>

        {закрытый && (
          <div className="card card--inset" style={{ marginTop: 'var(--space-4)' }}>
            <div className="card__head">
              <h3>Копия закрыта паролем</h3>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>
              Файл <b>{закрытый.name}</b> зашифрован. Введите пароль, которым он был закрыт.
            </p>
            <Field label="Пароль копии">
              <input
                type="password"
                value={пароль}
                autoComplete="off"
                autoFocus
                onChange={(event) => setПароль(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void расшифровать()
                }}
              />
            </Field>
            <div className="row" style={{ marginTop: 'var(--space-3)' }}>
              <button className="btn btn--primary" onClick={() => void расшифровать()} disabled={!пароль}>
                Расшифровать и восстановить
              </button>
              <button
                className="btn"
                onClick={() => {
                  setЗакрытый(null)
                  setПароль('')
                }}
              >
                Отмена
              </button>
            </div>
          </div>
        )}

        {message && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <Banner tone={message.tone}>{message.text}</Banner>
          </div>
        )}
      </div>

      {/* Выгрузки для чужих программ свёрнуты: их берут раз в жизнь, а место
          они занимают наравне с тем, что нужно каждый день. */}
      <div className="card">
        <details>
          <summary>Для таблиц и других программ</summary>
          <div className="row row--stack" style={{ marginTop: 'var(--space-4)' }}>
            <button
              className="btn"
              onClick={() => download(`dnevnik-${today()}.csv`, toCsv(measurements), 'text/csv')}
              disabled={!measurements.length}
            >
              Таблица для Excel
            </button>
            <button
              className="btn"
              onClick={() => download(`dnevnik-${today()}.json`, toJson(measurements), 'application/json')}
              disabled={!measurements.length}
            >
              Файл с измерениями
            </button>
          </div>
          <div className="muted" style={{ marginTop: 'var(--space-3)' }}>
            Здесь только измерения. Дневник целиком переносит копия.
          </div>
        </details>
      </div>

      <div className="card">
        <div className="card__head">
          <h2>Удалить все измерения</h2>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Аптечка и расписание приёма останутся. Восстановить удалённое можно будет только из копии.
        </p>
        {confirmClear ? (
          <Banner tone="critical">
            <b>Удалить все {measurements.length} измерений? Вернуть их можно будет только из копии.</b>
            <div className="row" style={{ marginTop: 'var(--space-3)' }}>
              {/* Безопасное действие первым: подтверждение не должно вставать
                  под палец, который только что нажал «Удалить». */}
              <button className="btn" onClick={() => setConfirmClear(false)}>
                Отмена
              </button>
              <button
                className="btn btn--danger"
                onClick={async () => {
                  await onClearAll()
                  setConfirmClear(false)
                  setMessage({ tone: 'good', text: 'Все измерения удалены.' })
                }}
              >
                Да, удалить всё
              </button>
            </div>
          </Banner>
        ) : (
          <div className="row">
            <button className="btn btn--danger" onClick={() => setConfirmClear(true)} disabled={!measurements.length}>
              Удалить все измерения
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
