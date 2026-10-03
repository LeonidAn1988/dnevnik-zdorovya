import { useEffect, useRef, useState } from 'react'
import type { BpReading, GlucoseReading, Person } from '../types'
import { readingId } from '../db/store'
import { DEFAULT_PAIRING_KEY } from '../ble/protocol'
import {
  downloadRecords,
  getKnownDevices,
  inspectDevice,
  isBluetoothEnabled,
  isBluetoothSupported,
  isCancellation,
  pairDevice,
  pickDevice,
  PairingRequiredError,
  type DeviceRecord,
  type GattDevice,
} from '../ble/session'
import { BleLog, logToText, useBleLog } from './BleLog'
import { memoryHint, memoryTight, memoryUse, type MemoryUse } from '../logic/memory'
import { Banner, Field, Reveal } from './bits'
import { GlucoseSync } from './GlucoseSync'
import { download } from '../logic/io'
import { platform } from '../platform/ports'
import { plural } from '../logic/plural'

const FULL_DATE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const DAY = 86_400_000

function toReading(record: DeviceRecord, people: Person[], device?: string): BpReading {
  const ts = record.date.getTime()
  // Человек берётся не активный, а тот, за кем закреплена эта кнопка прибора:
  // выгружают обычно обе памяти разом, и записи второй кнопки принадлежат не
  // тому, кто сейчас смотрит на экран.
  const чей = people.find((p) => p.deviceUser === record.user)
  return {
    kind: 'bp',
    id: readingId(record.user, ts),
    ts,
    sys: record.sys,
    dia: record.dia,
    bpm: record.bpm > 0 ? record.bpm : null,
    ihb: record.ihb,
    mov: record.mov,
    user: record.user,
    ...(чей ? { person: чей.id } : {}),
    ...(device ? { device } : {}),
    source: 'device',
  }
}

interface SyncOutcome {
  total: number
  added: number
  newestTs: number | null
  clockSkewMs: number | null
  /** Занятость памяти по каждой кнопке прибора. */
  memory: MemoryUse[]
}

type Busy = null | 'download' | 'pair' | 'inspect'

/**
 * Отказы Bluetooth по-русски и с выходом.
 *
 * Свои протокольные ошибки приложение и так пишет словами, но самые частые
 * отказы прилетают от радиомодуля и от системного моста: «GATT Server is
 * disconnected», «Connection Attempt Failed», «NetworkError». Показывать их как
 * есть — это тупик: ни причины, ни следующего шага, да ещё и по-английски.
 * Здесь у каждого частого отказа есть причина и действие.
 */
function explainBleError(message: string): { причина: string; действие: string } | null {
  const m = message.toLowerCase()
  if (m.includes('disconnect') || m.includes('gatt server')) {
    return {
      причина: 'Прибор отключился, не договорив.',
      действие: 'Он засыпает примерно через минуту. Нажмите кнопку Bluetooth на тонометре и повторите сразу.',
    }
  }
  if (m.includes('connection attempt failed') || m.includes('connectgatt') || m.includes('timeout')) {
    return {
      причина: 'Прибор не отозвался.',
      действие: 'Нажмите кнопку Bluetooth на тонометре — значок связи должен мигать — и повторите.',
    }
  }
  if (m.includes('networkerror') || m.includes('unreachable')) {
    return {
      причина: 'Соединение с прибором оборвалось.',
      действие: 'Поднесите телефон ближе к тонометру и повторите.',
    }
  }
  if (m.includes('not supported') || m.includes('unsupported')) {
    return {
      причина: 'Это устройство не поддерживает подключение к тонометру.',
      действие: 'Выгрузку нужно делать с телефона, где есть Bluetooth.',
    }
  }
  if (m.includes('permission') || m.includes('denied')) {
    return {
      причина: 'Система не дала доступ к Bluetooth.',
      действие: 'Разрешите приложению «Устройства поблизости» в настройках телефона и повторите.',
    }
  }
  return null
}

export function Sync({
  pairingKey,
  people,
  person,
  onPairingKey,
  onImport,
  onImportGlucose,
  onGoManual,
  showGlucose,
}: {
  pairingKey: string
  /** Кому принадлежат кнопки прибора: записи расходятся по людям при выгрузке. */
  people: Person[]
  /** Кто выбран сейчас — ему записывается сахар: у глюкометра кнопок нет. */
  person: Person | null
  /** Правка ключа доступа к прибору: живёт здесь, а не в настройках. */
  onPairingKey: (next: string) => void
  onImport: (readings: BpReading[]) => Promise<number>
  onImportGlucose: (readings: GlucoseReading[]) => Promise<number>
  onGoManual: () => void
  showGlucose: boolean
}) {
  const { lines, log, clear } = useBleLog()
  const [device, setDevice] = useState<GattDevice | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  /** До первого прочитанного блока длительность неизвестна — показываем «идёт», а не проценты. */
  const [connecting, setConnecting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Какое действие сорвалось: «Повторить» обязано повторить именно его. */
  const [failedKind, setFailedKind] = useState<Exclude<Busy, null> | null>(null)
  const [needsPairing, setNeedsPairing] = useState(false)
  const [paired, setPaired] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [showDebug, setShowDebug] = useState(false)
  const [radioOff, setRadioOff] = useState(false)
  /** На Android поиск прибора молчит, пока выключена геолокация, — и об этом никто не догадается. */
  const [locationOff, setLocationOff] = useState(false)

  const resultRef = useRef<HTMLDivElement>(null)
  const supported = isBluetoothSupported()

  useEffect(() => {
    if (!supported) return
    const check = () => {
      void isBluetoothEnabled().then((enabled) => setRadioOff(enabled === false))
      void platform().bluetooth.isLocationBlockingScan?.().then((blocked) => setLocationOff(blocked === true))
    }
    check()
    getKnownDevices().then((known) => {
      if (known.length === 1) setDevice(known[0])
    })

    /**
     * Состояние радиомодуля перепроверяется при возвращении в приложение.
     *
     * Раньше здесь стоял единственный вопрос при открытии экрана, а человеку
     * предлагалось «обновить страницу». В установленном приложении обновлять
     * нечего — страницы нет; человек уходит включать Bluetooth в настройках и
     * возвращается к тому же предупреждению. Теперь оно исчезает само.
     */
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [supported])

  // Итог появляется под кнопками, но на телефоне может оказаться ниже сгиба.
  useEffect(() => {
    if (!outcome && !error && !needsPairing && !paired) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    resultRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [outcome, error, needsPairing, paired])

  async function ensureDevice(): Promise<GattDevice> {
    if (device) return device
    const picked = await pickDevice(showAll)
    setDevice(picked)
    return picked
  }

  async function run(kind: Exclude<Busy, null>, action: (device: GattDevice) => Promise<void>) {
    setBusy(kind)
    setError(null)
    setFailedKind(null)
    setNeedsPairing(false)
    setPaired(false)
    setProgress(0)
    setConnecting(kind === 'download')
    try {
      const target = await ensureDevice()
      await action(target)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      if (caught instanceof PairingRequiredError) {
        setNeedsPairing(true)
        log('warn', `прибор отклонил ключ, код статуса ${caught.statusCode}`)
      } else if (!isCancellation(caught)) {
        // Закрытый пользователем системный диалог выбора — не ошибка, молчим.
        setError(message)
        setFailedKind(kind)
        log('error', message)
      }
    } finally {
      setBusy(null)
      setConnecting(false)
    }
  }

  const handleDownload = () =>
    run('download', async (target) => {
      setOutcome(null)
      const { records } = await downloadRecords(target, pairingKey, log, (p) => {
        setConnecting(false)
        setProgress(p.fraction)
      })
      const readings = records.map((record) => toReading(record, people, target.id))
      const added = await onImport(readings)
      const newestTs = readings.length ? Math.max(...readings.map((r) => r.ts)) : null
      setOutcome({
        total: readings.length,
        added,
        newestTs,
        clockSkewMs: newestTs === null ? null : Date.now() - newestTs,
        // Считаем по записям прибора, а не по дневнику: в дневник попадает и
        // введённое руками, а память прибора занимают только его замеры.
        memory: memoryUse(records.map((r) => ({ user: r.user, ts: r.date.getTime() }))),
      })
    })

  const handlePair = () =>
    run('pair', async (target) => {
      await pairDevice(target, pairingKey, log)
      setOutcome(null)
      setPaired(true)
      log('info', 'сопряжение завершено — теперь можно выгружать историю')
    })

  const handleInspect = () => run('inspect', (target) => inspectDevice(target, log))

  if (!supported) {
    return (
      <div className="stack">
        <Banner tone="warning">
          <b>Этот браузер не умеет подключаться к тонометру.</b>
          <div style={{ marginTop: 4 }}>
            Выгрузка по Bluetooth работает в Chrome и Edge на Android, macOS, Windows и Linux. В Safari и в любом
            браузере на iPhone и iPad такой возможности нет — это ограничение самой системы, а не приложения.
          </div>
        </Banner>

        <div className="card">
          <div className="card__head">
            <h2>Что можно делать здесь</h2>
          </div>
          <p style={{ margin: '0 0 var(--space-4)', color: 'var(--text-secondary)' }}>
            Дневник, графики и отчёт для врача работают полностью. Измерения можно вносить руками, а историю с
            тонометра — выгрузить на компьютере и перенести сюда файлом.
          </p>
          <div className="row">
            <button className="btn btn--primary" onClick={onGoManual}>
              Записать измерение
            </button>
          </div>
        </div>
      </div>
    )
  }

  const skewDays = outcome?.clockSkewMs != null ? Math.round(outcome.clockSkewMs / DAY) : 0
  const downloading = busy === 'download'

  return (
    <div className="stack">
      {radioOff && (
        <Banner tone="warning">Bluetooth выключен. Включите его — приложение заметит это само.</Banner>
      )}
      {locationOff && !radioOff && (
        <Banner tone="warning">
          <b>Поиск прибора не работает: выключена геолокация.</b>
          <div style={{ marginTop: 4 }}>Android не ищет устройства рядом без неё — так устроена система.</div>
          <div className="row" style={{ marginTop: 'var(--space-3)' }}>
            <button className="btn btn--sm" onClick={() => void platform().bluetooth.openLocationSettings?.()}>
              Включить геолокацию
            </button>
          </div>
        </Banner>
      )}

      <div className="card">
        <div className="card__head">
          <h2>Выгрузка с тонометра</h2>
          {device && <span className="muted">{device.name ?? 'устройство выбрано'}</span>}
        </div>

        <div className="row">
          <button
            className="btn btn--primary"
            onClick={handleDownload}
            disabled={busy !== null}
            data-loading={downloading}
            data-tour="sync-start"
          >
            {downloading ? 'Идёт выгрузка…' : 'Подключить и выгрузить'}
          </button>
          <button className="btn" onClick={handlePair} disabled={busy !== null}>
            {busy === 'pair' ? 'Сопряжение…' : 'Сопряжение'}
          </button>
          {device && (
            <button className="btn btn--sm" onClick={() => setDevice(null)} disabled={busy !== null}>
              Другое устройство
            </button>
          )}
        </div>

        {downloading && (
          <div style={{ marginTop: 'var(--space-4) ' }}>
            <div className={connecting ? 'progress progress--indeterminate' : 'progress'}>
              <div className="progress__bar" style={connecting ? undefined : { width: `${Math.round(progress * 100)}%` }} />
            </div>
            <div className="muted" style={{ marginTop: 'var(--space-2)' }} role="status" aria-live="polite">
              {connecting
                ? 'Связь с прибором, проверка ключа…'
                : progress >= 1
                  ? 'Прочитано, идёт запись в дневник…'
                  : `Выгрузка из памяти прибора — ${Math.round(progress * 100)}%. Не выключайте Bluetooth на тонометре.`}
            </div>
          </div>
        )}

        {/* Итог и ошибки — сразу под кнопками, до инструкции: иначе на телефоне
            результат оказывается за краем экрана и остаётся незамеченным. */}
        <div ref={resultRef} style={{ scrollMarginTop: 120 }}>
          <Reveal open={needsPairing}>
            <div style={{ paddingTop: 'var(--space-4)' }} role="alert">
              <Banner tone="info">
                <b>Нужно разовое сопряжение</b>
                <div style={{ marginTop: 4 }}>
                  Тонометр не принял ключ: он ещё не сопряжён с этим приложением, либо в нём остался ключ от Omron
                  Connect. Это делается один раз.
                </div>
                <ol className="steps" style={{ marginTop: 'var(--space-2)' }}>
                  <li>
                    Удерживайте кнопку Bluetooth на приборе около двух секунд, пока на экране не замигает <kbd>P</kbd>.
                  </li>
                  <li>Нажмите кнопку ниже и снова выберите прибор в списке.</li>
                </ol>
                <button className="btn btn--primary" onClick={handlePair} disabled={busy !== null} style={{ marginTop: 'var(--space-3)' }}>
                  {busy === 'pair' ? 'Сопряжение…' : 'Сопрячь сейчас'}
                </button>
              </Banner>
            </div>
          </Reveal>

          <Reveal open={paired}>
            <div style={{ paddingTop: 'var(--space-4)' }} role="status">
              <Banner tone="good">
                <b>Прибор сопряжён</b>
                <div style={{ marginTop: 4 }}>
                  Больше это делать не придётся. Нажмите кнопку Bluetooth на тонометре ещё раз — коротко, без
                  удержания — и выгрузите историю.
                </div>
                <button className="btn btn--primary" onClick={handleDownload} disabled={busy !== null} style={{ marginTop: 'var(--space-3)' }}>
                  Подключить и выгрузить
                </button>
              </Banner>
            </div>
          </Reveal>

          <Reveal open={error !== null}>
            <div style={{ paddingTop: 'var(--space-4)' }} role="alert">
              {error &&
                (() => {
                  const разбор = explainBleError(error)
                  return (
                    <Banner tone="critical">
                      <b>{разбор ? разбор.причина : 'Не получилось'}</b>
                      <div style={{ marginTop: 4 }}>{разбор ? разбор.действие : error}</div>
                      <div className="row" style={{ marginTop: 'var(--space-3)', gap: 'var(--space-2)' }}>
                        {/* Повторяем то, что сорвалось, а не выгрузку всегда.
                            Раньше после неудачного сопряжения кнопка запускала
                            чтение памяти — то есть человек нажимал «Повторить»
                            и получал другой отказ, ничего не поняв. */}
                        <button
                          className="btn btn--sm btn--primary"
                          onClick={failedKind === 'pair' ? handlePair : handleDownload}
                          disabled={busy !== null}
                        >
                          {failedKind === 'pair' ? 'Повторить сопряжение' : 'Повторить'}
                        </button>
                        <button className="btn btn--sm" onClick={() => setShowDebug((v) => !v)}>
                          {showDebug ? 'Скрыть подробности' : 'Подробности'}
                        </button>
                      </div>
                      {разбор && showDebug && (
                        <div className="muted" style={{ marginTop: 'var(--space-2)', wordBreak: 'break-word' }}>
                          {error}
                        </div>
                      )}
                    </Banner>
                  )
                })()}
            </div>
          </Reveal>

          <Reveal open={outcome !== null}>
            <div style={{ paddingTop: 'var(--space-4)' }} role="status">
              {outcome && (
                <Banner tone={outcome.added > 0 ? 'good' : 'info'}>
                  <b>
                    {outcome.added > 0
                      ? `Добавлено новых измерений: ${outcome.added}`
                      : 'Новых измерений нет — всё уже в дневнике'}
                  </b>
                  <div style={{ marginTop: 4 }}>
                    Прочитано из памяти прибора: {outcome.total}.
                    {outcome.newestTs && <> Последнее — {FULL_DATE.format(outcome.newestTs)}.</>}
                  </div>
                  {/* Память прибора — кольцевая: набралась сотня, и он молча
                      затирает самое старое. Голое «прочитано 100» об этом не
                      говорило, а человек, выгружающий раз в квартал, приносил
                      врачу месяц вместо трёх и не знал об этом. */}
                  {outcome.memory.map((use) => (
                    <div key={use.user} style={{ marginTop: 4 }} data-tight={memoryTight(use) ? '' : undefined}>
                      {outcome.memory.length > 1 && <b>Кнопка {use.user}. </b>}
                      {memoryHint(use)}
                    </div>
                  ))}
                </Banner>
              )}
            </div>
          </Reveal>
        </div>

        {/* Пока прибор не выбран, инструкция открыта: без неё непонятно, что
            нажимать на самом тонометре. Дальше она сворачивается — человек уже
            знает, а место на экране нужнее кнопкам. */}
        <details open={device === null} style={{ marginTop: 'var(--space-5)' }}>
          <summary>Как выгрузить</summary>
          <ol className="steps" style={{ marginTop: 'var(--space-3)' }}>
            <li>Нажмите кнопку Bluetooth на тонометре — замигает значок связи.</li>
            <li>
              Нажмите <b>«Подключить и выгрузить»</b> и выберите прибор — он называется <kbd>BLEsmart_…</kbd>
            </li>
          </ol>
        </details>
      </div>

      {outcome?.clockSkewMs != null && Math.abs(outcome.clockSkewMs) > DAY && (
        <Banner tone="warning">
          <b>Сверьте дату последнего измерения</b>
          <div style={{ marginTop: 4 }}>
            Последнее измерение датировано {FULL_DATE.format(outcome.newestTs!)} — на {Math.abs(skewDays)}{' '}
            {plural(Math.abs(skewDays), 'день', 'дня', 'дней')} {skewDays > 0 ? 'раньше' : 'позже'} сегодняшней даты.
            Если измерение было в другое время, проверьте дату и время на тонометре. Возраст записи сам по себе не означает сбой часов.
          </div>
        </Banner>
      )}

      {showGlucose && (
        <GlucoseSync
          onImport={onImportGlucose}
          log={log}
          person={person?.id ?? null}
          deviceUser={person?.deviceUser ?? null}
          device={device?.id}
        />
      )}

      {/* Всё, что нужно раз в жизни и только когда что-то не работает, — под
          одной свёрткой. В настройках этому не место: там его искал бы каждый,
          а нужно оно тому, у кого прибор не подключается. */}
      <div className="card">
        <details>
          <summary>Если не подключается</summary>

          <div className="stack" style={{ gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
            <div>
              <Field label="Ключ доступа к тонометру">
                <input
                  value={pairingKey}
                  spellCheck={false}
                  onChange={(e) => onPairingKey(e.target.value.trim())}
                  style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                />
              </Field>
              <div className="row" style={{ marginTop: 'var(--space-3)' }}>
                <button
                  className="btn btn--sm"
                  onClick={() => onPairingKey(DEFAULT_PAIRING_KEY)}
                  disabled={pairingKey === DEFAULT_PAIRING_KEY}
                >
                  Вернуть значение по умолчанию
                </button>
              </div>
              <div className="muted" style={{ marginTop: 'var(--space-2)' }}>
                Этот ключ приложение предъявляет прибору. Менять его нужно, только если вы сопрягали прибор с
                собственным значением.
              </div>
            </div>

            <ЖурналОбмена
              lines={lines}
              showAll={showAll}
              setShowAll={setShowAll}
              showDebug={showDebug}
              setShowDebug={setShowDebug}
              onInspect={handleInspect}
              busy={busy !== null}
              onClear={clear}
            />
          </div>
        </details>
      </div>
    </div>
  )
}

/** Журнал обмена: нужен при разборе отказов, поэтому лежит под свёрткой. */
function ЖурналОбмена({
  lines,
  showAll,
  setShowAll,
  showDebug,
  setShowDebug,
  onInspect,
  busy,
  onClear,
}: {
  lines: ReturnType<typeof useBleLog>['lines']
  showAll: boolean
  setShowAll: (next: boolean) => void
  showDebug: boolean
  setShowDebug: (next: boolean) => void
  onInspect: () => void
  busy: boolean
  onClear: () => void
}) {
  return (
    <div>
        <div className="card__head">
          <h3>Журнал обмена</h3>
          <div className="row">
            <label className="badge">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              показывать все устройства
            </label>
            <label className="badge">
              <input type="checkbox" checked={showDebug} onChange={(e) => setShowDebug(e.target.checked)} />
              подробно
            </label>
          </div>
        </div>

        <BleLog lines={lines} showDebug={showDebug} />

        <div className="row" style={{ marginTop: 'var(--space-3)' }}>
          <button className="btn btn--sm" onClick={onInspect} disabled={busy}>
            Характеристики прибора
          </button>
          <button className="btn btn--sm" onClick={onClear} disabled={lines.length === 0}>
            Очистить
          </button>
          <button
            className="btn btn--sm"
            onClick={() => download('omron-ble-log.txt', logToText(lines), 'text/plain')}
            disabled={lines.length === 0}
          >
            Сохранить журнал
          </button>
        </div>
        <div className="muted" style={{ marginTop: 'var(--space-2)' }}>
          Включите «подробно», если что-то пойдёт не так: в журнал попадут все пакеты обмена.
        </div>
    </div>
  )
}
