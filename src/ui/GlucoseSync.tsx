import { useState } from 'react'
import type { GlucoseReading } from '../types'
import { deviceMeasurementId } from '../db/store'
import { downloadGlucoseRecords, isCancellation, pickGlucoseMeter, type GlucoseRecord } from '../ble/session'
import type { LogLevel } from '../ble/protocol'
import { Banner, Reveal } from './bits'

/**
 * Выгрузка с глюкометра по стандартному профилю Bluetooth.
 *
 * Отдельная карточка, а не вкладка внутри выгрузки тонометра: это другой прибор,
 * другой протокол и другой сценарий — сахар и давление меряют в разное время.
 */
export function GlucoseSync({
  onImport,
  log,
  person,
  deviceUser,
  device,
}: {
  onImport: (readings: GlucoseReading[]) => Promise<number>
  log: (level: LogLevel, message: string) => void
  /**
   * Кому записывать. У глюкометра нет двух кнопок, как у тонометра, поэтому
   * замеры принадлежат тому, чей дневник открыт. Раньше здесь стояла жёсткая
   * единица, и человек со второй кнопкой прибора или вовсе без прибора своих
   * замеров не видел никогда.
   */
  person: string | null
  deviceUser: number | null
  device?: string
}) {
  const [busy, setBusy] = useState(false)
  const [count, setCount] = useState(0)
  const [outcome, setOutcome] = useState<{ total: number; added: number; skipped: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  function toReading(record: GlucoseRecord): GlucoseReading | null {
    // Запись без значения прибору не запрещена, но в дневнике ей не место.
    if (record.mmol === null) return null
    const ts = record.date.getTime()
    return {
      kind: 'glucose',
      id: deviceMeasurementId('glucose', deviceUser ?? 1, ts),
      ts,
      mmol: record.mmol,
      // Прибор сообщает момент замера не всегда; без него ставим «до еды» —
      // норма там строже, и человек скорее поправит, чем не заметит.
      context: record.context ?? 'before-meal',
      user: deviceUser ?? 1,
      ...(person ? { person } : {}),
      ...(device ? { device } : {}),
      source: 'device',
    }
  }

  async function download() {
    setBusy(true)
    setError(null)
    setOutcome(null)
    setCount(0)
    try {
      const device = await pickGlucoseMeter()
      const { records } = await downloadGlucoseRecords(device, log, setCount)
      const readings = records.map(toReading).filter((r): r is GlucoseReading => r !== null)
      const added = await onImport(readings)
      setOutcome({ total: records.length, added, skipped: records.length - readings.length })
    } catch (caught) {
      if (!isCancellation(caught)) {
        const message = caught instanceof Error ? caught.message : String(caught)
        setError(message)
        log('error', message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="card__head">
        <h2>Выгрузка с глюкометра</h2>
      </div>

      <div className="row">
        <button className="btn btn--primary" onClick={download} disabled={busy} data-loading={busy}>
          {busy ? 'Идёт выгрузка…' : 'Попробовать подключить глюкометр'}
        </button>
      </div>

      {busy && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <div className="progress progress--indeterminate">
            <div className="progress__bar" />
          </div>
          <div className="muted" style={{ marginTop: 'var(--space-2)' }} role="status" aria-live="polite">
            {count > 0 ? `Получено замеров: ${count}` : 'Связь с прибором…'}
          </div>
        </div>
      )}

      <Reveal open={outcome !== null}>
        <div style={{ paddingTop: 'var(--space-4)' }} role="status">
          {outcome && (
            <Banner tone={outcome.added > 0 ? 'good' : 'info'}>
              <b>
                {outcome.added > 0
                  ? `Добавлено новых замеров: ${outcome.added}`
                  : 'Новых замеров нет — всё уже в дневнике'}
              </b>
              <div style={{ marginTop: 4 }}>
                Прочитано из памяти прибора: {outcome.total}.
                {outcome.skipped > 0 && <> Пропущено записей без значения: {outcome.skipped}.</>}
              </div>
            </Banner>
          )}
        </div>
      </Reveal>

      <Reveal open={error !== null}>
        <div style={{ paddingTop: 'var(--space-4)' }} role="alert">
          {error && (
            <Banner tone="critical">
              <b>Не получилось</b>
              <div style={{ marginTop: 4 }}>{error}</div>
            </Banner>
          )}
        </div>
      </Reveal>

      <ol className="steps" style={{ marginTop: 'var(--space-5)' }}>
        <li>Включите на глюкометре передачу данных — обычно это отдельная кнопка или пункт меню.</li>
        <li>
          Нажмите <b>«Попробовать подключить глюкометр»</b> и выберите прибор в списке.
        </li>
      </ol>

      {/* Только до первой удачной выгрузки: дальше человек уже сверил сам. */}
      {outcome === null && (
        <Banner tone="warning">
          <b>Первую выгрузку сверьте с экраном глюкометра.</b>
          <div style={{ marginTop: 4 }}>Эта часть ещё не проверялась на живом приборе.</div>
        </Banner>
      )}
    </div>
  )
}
