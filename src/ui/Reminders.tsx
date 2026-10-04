/**
 * Раздел настроек: напоминания о приёме лекарств.
 *
 * Экран для пожилого человека, и от этого здесь всё. Одно решение на строку,
 * состояние названо словами, а не значком. Мелодию можно послушать до выбора —
 * иначе выбирать приходится по названию, а «Перелив» на слух не угадаешь.
 *
 * Отдельно проговорено энергосбережение. Huawei, Xiaomi и Samsung усыпляют
 * фоновые приложения, и напоминание просто не приходит — молча. Это самая
 * частая причина «уведомления не работают» на Android, и человек имеет право
 * узнать о ней от приложения, а не от форума.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { HORIZON_DAYS, REPEAT_INTERVAL_MIN, REPEATS, reminderTimes, soundScreenHint } from '../logic/reminders'
import { plural } from '../logic/plural'
import { describeMeasurePlan, planTimes, type MeasureSubject } from '../logic/course'
import type { Person, SoundScreen } from '../types'
import type { Dosing } from '../logic/regimen'
import { platform } from '../platform/ports'
import type { ReminderHealth, ReminderPermission } from '../platform/ports'

import { NumberField } from './NumberField'
import { Banner, Reveal } from './bits'

export function Reminders({
  medicines,
  supplyWarningDays = 7,
  expiryWarningDays = 7,
  enabled,
  sound,
  repeat,
  measureOn,
  subjects,
  family,
  people = [],
  selectedPeople = people.map(p => p.id),
  onPatch,
}: {
  supplyWarningDays?: number
  expiryWarningDays?: number
  medicines: Dosing[]
  enabled: boolean
  sound: string
  repeat: boolean
  /** Напоминать ли измерить давление. Свой переключатель, а не общий. */
  measureOn: boolean
  /** Те же актуальные расписания всех людей, что использует планировщик. */
  subjects: readonly MeasureSubject[]
  family: boolean
  people?: Person[]
  selectedPeople?: readonly string[]
  onPatch: (patch: {
    supplyWarningDays?: number
    expiryWarningDays?: number
    remindersOn?: boolean
    reminderSound?: string
    remindersRepeat?: boolean
    measureRemindOn?: boolean
    reminderPeople?: string[]
  }) => void
}) {
  const измерения = subjects.flatMap(subject => planTimes(subject.plan))
  const описание = subjects.map(subject =>
    `${subject.name ? `${subject.name}: ` : ''}${describeMeasurePlan(subject.plan)}`).join('; ')
  const port = platform().reminders
  const supported = port.isSupported()
  const sounds = port.sounds()

  const [permission, setPermission] = useState<ReminderPermission | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState<string | null>(null)
  /**
   * Какой системный экран открылся в ответ на кнопку.
   *
   * Не «получилось или нет»: нужного экрана канала на части прошивок нет вовсе,
   * и человек оказывается в общих настройках приложения. Раньше приложение
   * этого не знало и молчало — теперь говорит, что он увидит и куда нажимать.
   */
  const [soundScreen, setSoundScreen] = useState<SoundScreen | null>(null)
  /** Идёт настройка громкости: звонит подряд, пока не нажмут «Хватит». */
  const [стопГромкости, setСтопГромкости] = useState<(() => Promise<void>) | null>(null)
  const volumeStop = useRef<(() => Promise<void>) | null>(null)
  const volumeStarting = useRef(false)
  const volumeRequest = useRef(0)
  const mounted = useRef(true)
  /**
   * Не открылся системный экран энергосбережения или «Не беспокоить».
   *
   * У звука своя подсказка — там важно не «открылось ли», а какой именно экран
   * открылся. Здесь достаточно факта: эти кнопки ведут ровно в одно место.
   */
  const [noSettings, setNoSettings] = useState(false)
  const [batteryRestricted, setBatteryRestricted] = useState<boolean | null>(null)
  const [exact, setExact] = useState<boolean | null>(null)
  const [quiet, setQuiet] = useState<boolean | null>(null)
  const [canBypass, setCanBypass] = useState<boolean | null>(null)
  const [health, setHealth] = useState<ReminderHealth | null>(null)

  const времена = reminderTimes(medicines)

  // Уходя с экрана, снимаем оставшиеся пробные звонки: человек уже не
  // настраивает громкость, а телефон бы ещё звонил полминуты.
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      void volumeStop.current?.()
    }
  }, [])

  function остановитьГромкость() {
    volumeRequest.current++
    void volumeStop.current?.()
    volumeStop.current = null
    setСтопГромкости(null)
  }

  async function проверитьГромкость() {
    if (volumeStarting.current || volumeStop.current) return
    volumeStarting.current = true
    const request = ++volumeRequest.current
    setSoundScreen(null)
    try {
      const stop = await port.previewLoop(sound)
      if (!mounted.current || request !== volumeRequest.current) { void stop(); return }
      volumeStop.current = stop
      setСтопГромкости(() => stop)
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      volumeStarting.current = false
    }
  }

  useEffect(() => {
    остановитьГромкость()
  }, [sound])

  useEffect(() => {
    if (!enabled && !measureOn) остановитьГромкость()
  }, [enabled, measureOn])

  const обновить = useCallback(async () => {
    if (!supported) return
    setPermission(await port.permission())
    setBatteryRestricted(await port.isBatteryRestricted())
    setExact(await port.exactTiming())
    setQuiet(await port.isQuietModeOn())
    setCanBypass(await port.canBypassQuietMode())
    setHealth(await port.health(sound))
  }, [port, supported, sound])

  useEffect(() => {
    void обновить()
  }, [обновить])

  // Разрешение могли выдать в настройках телефона, не закрывая приложение.
  // Без этой проверки раздел продолжал бы требовать разрешения, которое есть.
  useEffect(() => {
    if (!supported) return
    const слушать = () => {
      if (document.visibilityState === 'visible') void обновить()
    }
    document.addEventListener('visibilitychange', слушать)
    return () => document.removeEventListener('visibilitychange', слушать)
  }, [supported, обновить])

  /**
   * Показать настоящее пробное напоминание, а не проиграть файл.
   *
   * Звук уведомления идёт своей громкостью, отдельной от музыки, и подчиняется
   * тихому режиму. Проиграв файл плеером, мы дали бы услышать не то, что
   * прозвучит в восемь утра, — и человек настроил бы громкость не ту.
   */
  function проверить(id: string) {
    setChecking(id)
    void port.preview(id).finally(() => window.setTimeout(() => setChecking(null), 2500))
  }

  /**
   * Включить напоминания об измерении.
   *
   * Разрешение спрашивается тем же способом и по тому же правилу — только по
   * нажатию. Своё, а не общее с лекарствами: человек может пить таблетки без
   * напоминаний и при этом вести назначенный врачом курс измерений.
   */
  async function включитьИзмерения(next: boolean) {
    setError(null)
    if (!next) {
      onPatch({ measureRemindOn: false })
      return
    }
    setBusy(true)
    try {
      const ответ = permission === 'granted' ? permission : await port.requestPermission()
      setPermission(ответ)
      if (ответ !== 'granted') {
        setError('Телефон не дал разрешения показывать уведомления. Без него напоминания приходить не будут.')
        return
      }
      onPatch({ measureRemindOn: true })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  async function включить(next: boolean) {
    setError(null)
    if (!next) {
      onPatch({ remindersOn: false })
      return
    }
    setBusy(true)
    try {
      // Спрашивать разрешение можно только по нажатию — здесь это оно и есть.
      const ответ = permission === 'granted' ? permission : await port.requestPermission()
      setPermission(ответ)
      if (ответ !== 'granted') {
        setError('Телефон не дал разрешения показывать уведомления. Без него напоминания приходить не будут.')
        return
      }
      onPatch({ remindersOn: true })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const stockWarningSettings = (
      <details>
        <summary>Когда предупреждать о запасах аптечки</summary>
        <p className="muted">Общие сроки для препаратов без индивидуальной настройки. В карточке препарата можно задать свои.</p>
        <div className="grid grid--two">
          <NumberField label="До конца запаса, дней" value={String(supplyWarningDays)} onChange={v => { const raw=typeof v === 'function' ? v(String(supplyWarningDays)) : v; const n=Number(raw); if (raw.trim() && Number.isInteger(n) && n>=0 && n<=365) onPatch({supplyWarningDays:n}) }} min={0} max={365} start={7} />
          <NumberField label="До конца годности, дней" value={String(expiryWarningDays)} onChange={v => { const raw=typeof v === 'function' ? v(String(expiryWarningDays)) : v; const n=Number(raw); if (raw.trim() && Number.isInteger(n) && n>=0 && n<=365) onPatch({expiryWarningDays:n}) }} min={0} max={365} start={7} />
        </div>
      </details>
  )

  const noRecipients = people.length > 0 && selectedPeople.length === 0
  const audienceSettings = people.length > 0 && (family || noRecipients) ? (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 'var(--space-4) 0', minWidth: 0 }}>
      <legend className="fact__label">Чьи напоминания получать</legend>
      <p className="muted" style={{ margin: 0 }}>Выбор действует только на этом устройстве.</p>
      <button className="btn btn--sm" type="button" onClick={() => onPatch({ reminderPeople: undefined })}>Все</button>
      {people.map(person => <label key={person.id} className="optrow__label" style={{ minHeight: 'var(--tap)', alignItems: 'center' }}>
        <input type="checkbox" checked={selectedPeople.includes(person.id)} onChange={event => onPatch({ reminderPeople: people.filter(p => p.id === person.id ? event.target.checked : selectedPeople.includes(p.id)).map(p => p.id) })} />
        <span className="optrow__title">{person.name.trim() || 'Без имени'}</span>
      </label>)}
      {selectedPeople.length === 0 && <p className="muted" role="status">Никто не выбран. Напоминания о лекарствах, измерениях и анализах, уведомления таймеров и предупреждения о запасе не придут.</p>}
    </fieldset>
  ) : null

  // ── в браузере напоминаний не существует ────────────────────────────────
  if (!supported) {
    return (
      <div className="card stack">
        <div className="card__head">
          <h2>Напоминания о приёме</h2>
        </div>
        <div className="muted">
          Браузер не умеет напоминать по расписанию: страница должна быть открыта, а ночью и при закрытой вкладке
          напоминание не придёт. Поэтому здесь расписание выгружается в календарь телефона — кнопка в аптечке.
          <div style={{ marginTop: 'var(--space-2)' }}>
            Настоящие напоминания со звуком есть в приложении для Android.
          </div>
        </div>
        {audienceSettings}
        {stockWarningSettings}
      </div>
    )
  }

  const anyOn = enabled || measureOn

  return (
    <div className="card">
      <div className="card__head">
        <h2>Напоминания</h2>
      </div>
      {audienceSettings}

      <label className="optrow__label">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={(event) => void включить(event.target.checked)}
        />
        <span className="optrow__title">
          Напоминать принять лекарства
          <span className="fact__note">
            {noRecipients ? 'выберите человека выше' : времена.length
              ? времена.join(', ')
              : 'укажите время приёма в аптечке'}
          </span>
        </span>
      </label>

      {/* Второй род напоминаний. Отдельным переключателем, а не общим: курс
          измерений бывает у того, кто таблеток не пьёт вовсе, а лишние
          уведомления быстрее всего приучают не смотреть на телефон. */}
      <label className="optrow__label" style={{ marginTop: 'var(--space-4)' }}>
        <input
          type="checkbox"
          checked={measureOn}
          disabled={busy}
          onChange={(event) => void включитьИзмерения(event.target.checked)}
        />
        <span className="optrow__title">
          Напоминать измерить давление
          <span className="fact__note">
            {noRecipients ? 'выберите человека выше' : измерения.length
              ? описание
              : 'расписание — в разделе «Давление»'}
          </span>
        </span>
      </label>

      {/* Расписания нет — напоминать не о чем, и это надо сказать прямо,
          а не оставлять человека с включённым переключателем и тишиной.

          Схема измерений тоже считается расписанием: с ней напоминать есть о
          чём, даже когда в аптечке пусто. Без этой оговорки человек, задавший
          курс от врача, читал бы «напоминать не о чем» при работающих
          напоминаниях — и решил бы, что ничего не включилось. */}
      <Reveal open={!noRecipients && enabled && времена.length === 0 && !(measureOn && измерения.length > 0)}>
        <div style={{ paddingTop: 'var(--space-4)' }}>
          <Banner tone="info">
            <b>Напоминать пока не о чем</b>
            <div style={{ marginTop: 4 }}>Укажите часы приёма у препарата в аптечке.</div>
          </Banner>
        </div>
      </Reveal>
      <Reveal open={!noRecipients && measureOn && измерения.length === 0}>
        <div style={{ paddingTop: 'var(--space-4)' }}>
          <Banner tone="info">
            <b>Нет расписания измерений</b>
            <div style={{ marginTop: 4 }}>Задайте его в разделе «Давление»: «Врач попросил вести дневник».</div>
          </Banner>
        </div>
      </Reveal>

      {/* Разрешение могли отозвать в настройках телефона уже после включения.
          Молчать об этом нельзя: переключатель стоит в положении «напоминать»,
          а напоминания не приходят — и человек об этом узнаёт по пропущенной
          таблетке. */}
      <Reveal open={anyOn && permission !== null && permission !== 'granted' && !error}>
        <div style={{ paddingTop: 'var(--space-4)' }}>
          <Banner tone="warning">
            <b>Напоминания выключены телефоном</b>
            <div style={{ marginTop: 4 }}>Разрешите уведомления в настройках приложения.</div>
            <button
              className="btn btn--sm"
              style={{ marginTop: 'var(--space-3)' }}
              onClick={() => void port.openBatterySettings().then((ok) => setNoSettings(!ok))}
            >
              Открыть настройки приложения
            </button>
          </Banner>
        </div>
      </Reveal>

      {/*
        Нажали кнопку, а системный экран не открылся — так бывает на
        нестандартных прошивках. Молчать нельзя: человек решит, что нажал мимо,
        и будет жать ещё.
      */}
      <Reveal open={noSettings}>
        <div style={{ paddingTop: 'var(--space-4)' }}>
          <Banner tone="warning">
            <b>Телефон не открыл нужный экран</b>
            <div style={{ marginTop: 4 }}>Настройки телефона → «Приложения» → «Дневник здоровья».</div>
          </Banner>
        </div>
      </Reveal>

      <Reveal open={!!error}>
        <div style={{ paddingTop: 'var(--space-4)' }}>
          <Banner tone="warning">
            <b>Не удалось выполнить действие</b>
            <div style={{ marginTop: 4 }}>{error}</div>
            <button
              className="btn btn--sm"
              style={{ marginTop: 'var(--space-3)' }}
              onClick={() => void port.openBatterySettings().then((ok) => setNoSettings(!ok))}
            >
              Открыть настройки приложения
            </button>
          </Banner>
        </div>
      </Reveal>

      <Reveal open={anyOn && permission === 'granted'}>
        <div className="stack" style={{ paddingTop: 'var(--space-5)', gap: 'var(--space-4)' }}>
          <Reveal open={enabled}>
            <label className="optrow__label">
              <input
                type="checkbox"
                checked={repeat}
                onChange={(event) => onPatch({ remindersRepeat: event.target.checked })}
              />
              <span className="optrow__title">
                Повторять напоминание о лекарстве
                <span className="fact__note">
                  ещё {REPEATS} {plural(REPEATS, 'раз', 'раза', 'раз')} каждые {REPEAT_INTERVAL_MIN}{' '}
                  {plural(REPEAT_INTERVAL_MIN, 'минуту', 'минуты', 'минут')}, если приём не отмечен
                </span>
              </span>
            </label>
          </Reveal>

          <details>
            <summary>Звук: {sounds.find(item => item.id === sound)?.name ?? 'Как у телефона'}</summary>
          <div className="stack" style={{ gap: 'var(--space-2)' }}>
            {sounds.map((item) => (
              <div key={item.id} className="optrow">
                <label className="optrow__label">
                  <input
                    type="radio"
                    name="reminder-sound"
                    checked={sound === item.id}
                    onChange={() => {
                      остановитьГромкость()
                      onPatch({ reminderSound: item.id })
                    }}
                  />
                  <span className="optrow__title">
                    {item.name}
                    <span className="fact__note">{item.hint}</span>
                  </span>
                </label>
                {item.id !== 'silent' && <button
                  className="btn btn--sm optrow__action"
                  onClick={() => проверить(item.id)}
                  aria-label={`${checking === item.id ? 'Слушайте' : 'Послушать'}: ${item.name}`}
                >
                  {checking === item.id ? 'Слушайте…' : 'Послушать'}
                </button>}
              </div>
            ))}
          </div>
          </details>

          {/*
            Громкость настраивается ушами, и это не упрощение, а единственный
            способ: Android не отдаёт громкость канала ни одним API, прочитать
            её приложению нечем. Зато звук напоминания объявлен будильником, а
            громкость будильника на любом телефоне крутится качелькой на боку —
            пока звучит. Поэтому главная кнопка здесь звонит подряд, а переход
            на системный экран остался вторым способом.
          */}
          {sound !== 'silent' && <div>
            <div style={{ fontSize: 'var(--fs-2)', fontWeight: 600 }}>Громкость</div>

            <div className="row row--stack" style={{ marginTop: 'var(--space-3)' }}>
              {стопГромкости ? (
                <button
                  className="btn btn--primary"
                  onClick={остановитьГромкость}
                >
                  Остановить звук
                </button>
              ) : (
                <button
                  className="btn btn--primary"
                  onClick={() => void проверитьГромкость()}
                >
                  Проверить громкость
                </button>
              )}
              <button
                className="btn btn--sm"
                onClick={() => {
                  остановитьГромкость()
                  void port.openSoundSettings(sound).then(setSoundScreen)
                }}
              >
                Настройки звука телефона
              </button>
            </div>

            {стопГромкости && (
              <div style={{ marginTop: 'var(--space-3)' }}>
                <Banner tone="info">
                  <b>Звучит.</b>
                  <div style={{ marginTop: 4 }}>
                    Настройте громкость кнопками на боку телефона.
                  </div>
                </Banner>
              </div>
            )}

            {/* Подсказка по тому экрану, который открылся на самом деле. */}
            {soundScreen && (
              <div style={{ marginTop: 'var(--space-3)' }}>
                <Banner tone={soundScreen === 'none' ? 'warning' : 'info'}>
                  <b>{soundScreenHint(soundScreen)!.title}</b>
                  <div style={{ marginTop: 4 }}>{soundScreenHint(soundScreen)!.body}</div>
                </Banner>
              </div>
            )}

          </div>}

          <details>
            <summary>Если напоминания не приходят</summary>
            <p className="muted">
              В уведомлении о лекарстве есть «Принял» и «Отложить». Отметка отменяет оставшиеся повторы этого приёма.
            </p>
            <div className="muted" style={{ marginTop: 'var(--space-2)' }}>
              У каждой мелодии своя громкость: телефон держит её отдельно для каждой. Сменили мелодию — настройте
              заново.
            </div>
            <div className="muted" style={{ marginTop: 'var(--space-2)' }}>
              {health && health.scheduled > 0 && health.until
                ? `Сейчас в телефоне ${health.scheduled} ${plural(health.scheduled, 'напоминание', 'напоминания', 'напоминаний')}, последнее — ${new Intl.DateTimeFormat('ru-RU', {
                    day: 'numeric',
                    month: 'long',
                  }).format(health.until)}. Список продлевается каждый раз, когда вы открываете приложение.`
                : `Напоминания расставляются на ${HORIZON_DAYS} ${plural(HORIZON_DAYS, 'день', 'дня', 'дней')} вперёд и продлеваются каждый раз, когда вы открываете приложение.`}
            </div>
          </details>

          {health?.channelOff && (
            <Banner tone="critical">
              <b>Напоминания выключены в настройках телефона</b>
              <div style={{ marginTop: 4 }}>Расписание стоит, но ни одно напоминание не появится.</div>
              <button
                className="btn btn--sm"
                style={{ marginTop: 'var(--space-3)' }}
                onClick={() => void port.openSoundSettings(sound).then(setSoundScreen)}
              >
                Включить уведомления
              </button>
            </Banner>
          )}

          {/*
            «Не беспокоить» делает напоминание беззвучным, а беззвучное
            напоминание о лекарстве равно отсутствующему. Проверено на живом
            телефоне: уведомление пришло вовремя и молча.
          */}
          {sound !== 'silent' && quiet === true && canBypass !== true && (
            <Banner tone="warning">
              <b>Сейчас включён режим «Не беспокоить»</b>
              <div style={{ marginTop: 4 }}>Напоминание придёт без звука — его легко не заметить.</div>
              <button
                className="btn btn--sm"
                style={{ marginTop: 'var(--space-3)' }}
                onClick={() => void port.requestQuietModeBypass().then((ok) => setNoSettings(!ok))}
              >
                Разрешить звучать в тихом режиме
              </button>
            </Banner>
          )}

          {/*
            Точное время. Без разрешения система выдаёт будильник с окном,
            которое растёт со временем: измерено на HUAWEI — десять минут у
            ближайшего напоминания, двадцать две у следующего. Повторы через
            пятнадцать минут при таком разбросе слипаются.

            Спрашиваем здесь, а не в момент сохранения настроек: рядом видно
            зачем, и человек решает сам.
          */}
          {exact === false && (
            <Banner tone="warning">
              <b>Точное время не разрешено</b>
              <div style={{ marginTop: 4 }}>Система может задерживать напоминания.</div>
              <button
                className="btn btn--sm"
                style={{ marginTop: 'var(--space-3)' }}
                onClick={() => void port.requestExactTiming().then(value => {
                  setExact(value)
                  window.dispatchEvent(new Event('reminder-permissions-changed'))
                })}
              >
                Разрешить точное время
              </button>
            </Banner>
          )}

          {/*
            Главная причина молчащих напоминаний на Android — и проверено на
            живом телефоне, что причина настоящая: HUAWEI выгружает приложение,
            как только гаснет экран.

            Предупреждение показывается, только когда ограничение действительно
            стоит. Постоянно висящий тревожный блок перестают читать, и в тот
            день, когда он окажется правдой, его не заметят.
          */}
          {batteryRestricted === true && (
            <Banner tone="warning">
              <b>Телефон ограничивает работу приложения</b>
              <div style={{ marginTop: 4 }}>
                Так бывает, когда телефон «усыпляет» приложение: напоминание не приходит вовсе.
              </div>
              <button
                className="btn btn--sm"
                style={{ marginTop: 'var(--space-3)' }}
                onClick={() => void port.openBatterySettings().then((ok) => setNoSettings(!ok))}
              >
                Разрешить работу без ограничений
              </button>
              <div className="muted" style={{ marginTop: 'var(--space-2)' }}>
                На Huawei, Xiaomi и Samsung разрешите ещё и в «Батарея» → «Запуск приложений».
              </div>
            </Banner>
          )}
        </div>
      </Reveal>
      {stockWarningSettings}
    </div>
  )
}
