/**
 * Настройки в два уровня.
 *
 * До 0.8.0 это был один свиток из одиннадцати одинаковых карточек — восемь
 * экранов на телефоне и почти тринадцать при «Очень крупном» тексте, в порядке,
 * сложившемся по истории разработки: первым шло то, что убирает разделы из
 * нижней строки, последним — то, за чем сюда приходят.
 *
 * Теперь корень отвечает на вопрос «что здесь вообще есть»: единственный орган
 * управления — размер текста, ради которого сюда и приходит пожилой человек, —
 * и шесть строк со значениями, чтобы не открывать подэкран ради проверки.
 * Измерено: один экран обычным текстом и полтора при «Очень крупном» вместо
 * восьми и почти тринадцати. Самый длинный подэкран — копия дневника, два
 * экрана вместо десяти.
 *
 * Правила, общие для разных подэкранов, живут в `logic/settings.ts`: они
 * проверяются тестами без браузера, и разойтись двум их копиям негде.
 */

import { useState } from 'react'
import type { Measurement, Regimen, Settings as SettingsData } from '../types'
import type { Dosing } from '../logic/regimen'
import { Reminders } from './Reminders'
import type { ImportResult } from '../logic/io'
import { platform } from '../platform/ports'
import { activePersonOf, glucoseTargetsOf, targetsOf } from '../logic/people'
import { measurePlanOf } from '../logic/course'
import { BackBar, NavRow, Reveal } from './bits'
import { ChevronIcon } from './icons'
import { tours } from '../logic/tour'
import { plural } from '../logic/plural'
import { NumberField } from './NumberField'
import { About } from './About'
import { parseChangelog } from '../logic/changelog'
import changelogSource from '../../CHANGELOG.md?raw'
import { BackupScreen } from './BackupScreen'
import { FamilyScreen } from './Family'
import { PHARMACIES, describePharmacies } from '../logic/pharmacies'
import { People, PersonScreen } from './People'
import type { BackupStatus } from './useBackup'
import type { FamilySyncStatus } from './useFamilySync'
import {
  DENSITIES,
  SECTIONS,
  SUBSCREEN_TITLE,
  TEXT_SCALES,
  THEMES,
  describeBackupRow,
  describeDisplay,
  describeFamily,
  describePeople,
  describeReminders,
  describeSections,
  describeTargets,
  lockedSection,
  setGlucoseTargets,
  setTargets,
  setTrackGlucose,
  toggleSection,
  visibleSections,
  type Subscreen,
} from '../logic/settings'

/** История читается один раз: файл в бандле, и меняться в работе ему негде. */
const releases = parseChangelog(changelogSource)

type Общее = {
  settings: SettingsData
  onPatch: (fields: Partial<SettingsData>) => void
}

/**
 * Экран: тема, плотность и — в самом низу, свёрнутым — то, что меняет саму
 * навигацию. Спрятано не ради красоты: это единственное в настройках, чем
 * можно «сломать» приложение до неузнаваемости, убрав разделы снизу.
 */
function DisplayScreen({ settings, onPatch, onBack }: Общее & { onBack: () => void }) {
  const видимые = visibleSections(settings)
  const заперт = lockedSection(settings)

  return (
    <div className="stack">
      <BackBar onBack={onBack} />

      <div className="card">
        <div className="card__head">
          <h2>Экран</h2>
        </div>

        {/* Размер текста первым: за ним сюда и приходят. В корне настроек он
            стоял отдельной карточкой, но там он единственный орган управления
            среди списка разделов — а место ему рядом с темой и плотностью. */}
        <div className="tile__label" style={{ marginBottom: 'var(--space-2)' }}>
          Размер текста
        </div>
        <div className="segmented segmented--fill segmented--stack" role="group" aria-label="Размер текста">
          {TEXT_SCALES.map(({ key, title }) => (
            <button key={key} aria-pressed={settings.textScale === key} onClick={() => onPatch({ textScale: key })}>
              {title}
            </button>
          ))}
        </div>
        <div className="sample">
          <div style={{ fontSize: 'var(--fs-3)', fontWeight: 600 }}>Утренний приём — 08:00</div>
          <div style={{ fontSize: 'var(--fs-2)', marginTop: 'var(--space-2)' }}>Периндоприл 5 мг, до еды</div>
        </div>

        <div className="tile__label" style={{ margin: 'var(--space-5) 0 var(--space-2)' }}>
          Тема
        </div>
        {/* Чипами, а не тремя равными долями: «Как в системе» в треть ширины не
            помещается и ломается пополам уже при обычном тексте. Чип переносится
            целиком и остаётся читаемым. */}
        <div className="segmented segmented--chips" role="group" aria-label="Тема оформления">
          {THEMES.map(({ key, title }) => (
            <button key={key} aria-pressed={settings.theme === key} onClick={() => onPatch({ theme: key })}>
              {title}
            </button>
          ))}
        </div>

        <div className="tile__label" style={{ margin: 'var(--space-5) 0 var(--space-2)' }}>
          Плотность
        </div>
        <div className="segmented segmented--fill" role="group" aria-label="Плотность вёрстки">
          {DENSITIES.map(({ key, title }) => (
            <button key={key} aria-pressed={settings.density === key} onClick={() => onPatch({ density: key })}>
              {title}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <details>
          <summary>Что показывать внизу — {describeSections(settings)}</summary>

          <div className="stack" style={{ gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            {SECTIONS.map((item) => (
              <label className="optrow__label" key={item.key}>
                <input
                  type="checkbox"
                  checked={settings.sections[item.key]}
                  disabled={заперт === item.key}
                  onChange={(event) => onPatch(toggleSection(settings, item.key, event.target.checked))}
                />
                <span className="optrow__title">
                  {item.title}
                  <span className="fact__note">
                    {заперт === item.key ? 'последний раздел — скрыть его нельзя' : item.hint}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <p className="muted" style={{ margin: 'var(--space-4) 0 0' }}>
            Записи скрытого раздела остаются на месте. Сахар включается на «Нормах».
          </p>

          <div style={{ marginTop: 'var(--space-5)' }}>
            <div className="tile__label" style={{ marginBottom: 'var(--space-2)' }}>
              С чего открывать приложение
            </div>
            {/* Тоже чипами: разделов до пяти, и «Приём лекарств» в равной доле
                не умещается. */}
            <div className="segmented segmented--chips" role="group" aria-label="Стартовый экран">
              {видимые.map((key) => (
                <button key={key} aria-pressed={settings.startTab === key} onClick={() => onPatch({ startTab: key })}>
                  {SECTIONS.find((item) => item.key === key)?.title ?? 'Сахар'}
                </button>
              ))}
            </div>
          </div>
        </details>
      </div>
    </div>
  )
}

/**
 * Аптеки: где искать лекарства из списка покупок.
 *
 * Приложение никуда не ходит само — оно только собирает ссылку на поиск. Про
 * наличие и цену здесь ничего не обещается: у сетей нет открытых интерфейсов,
 * и знать остаток аптеки мы не можем.
 */
function PharmaciesScreen({ settings, onPatch, onBack }: Общее & { onBack: () => void }) {
  const выбраны = settings.pharmacies ?? []
  const переключить = (id: string, on: boolean) =>
    onPatch({ pharmacies: on ? [...выбраны, id] : выбраны.filter((item) => item !== id) })

  return (
    <div className="stack">
      <BackBar onBack={onBack} />

      <div className="card">
        <div className="card__head">
          <h2>Аптеки</h2>
          <span className="muted">где искать то, что заканчивается</span>
        </div>

        <div className="stack" style={{ gap: 'var(--space-3)' }}>
          {PHARMACIES.map((item) => (
            <label className="optrow__label" key={item.id}>
              <input
                type="checkbox"
                checked={выбраны.includes(item.id)}
                onChange={(event) => переключить(item.id, event.target.checked)}
              />
              <span className="optrow__title">{item.name}</span>
            </label>
          ))}
        </div>

        <p className="muted" style={{ margin: 'var(--space-4) 0 0' }}>
          Кнопки выбранных аптек появятся у препарата и в списке покупок. Наличие и цену приложение не знает.
        </p>
      </div>
    </div>
  )
}

/**
 * Поле нормы: своя строка внутри, в настройки уходит только готовое число.
 *
 * Управлять таким полем прямо из настроек нельзя, и это не мелочь. Прежде здесь
 * стояли голые `input` с `Number(e.target.value) || 135`: поле не очищалось,
 * набранное дописывалось к прежнему, и попытка поставить назначенные врачом 120
 * давала цель 135120 — она сохранялась без проверки, а «в цели» после этого
 * показывало сто процентов всегда. Первая попытка починки — обрезать по
 * границам прямо в обработчике — сломала набор иначе: «13» на пути к «135»
 * обрезалось до минимума, и до трёх знаков было не дойти.
 *
 * Поэтому строку поле держит своё, а наружу отдаёт только то, что разобралось
 * и попало в границы. Незаконченное «12» просто не уходит никуда.
 */
function NormField({
  label,
  value,
  min,
  max,
  start,
  step,
  decimals = 0,
  onCommit,
}: {
  label: string
  value: number
  min: number
  max: number
  start: number
  step?: number
  decimals?: number
  onCommit: (next: number) => void
}) {
  const показать = (n: number) => (decimals > 0 ? n.toFixed(decimals).replace('.', ',') : String(n))
  const [текст, setТекст] = useState(() => показать(value))

  return (
    <NumberField
      label={label}
      value={текст}
      onChange={(действие) => {
        // Кнопки «−» и «+» присылают не строку, а как её изменить.
        const набрано = typeof действие === 'function' ? действие(текст) : действие
        setТекст(набрано)
        const n = Number(набрано.replace(',', '.'))
        if (набрано.trim() !== '' && Number.isFinite(n) && n >= min && n <= max) onCommit(n)
      }}
      min={min}
      max={max}
      start={start}
      step={step}
      decimals={decimals}
      size="compact"
    />
  )
}

/** Нормы: целевое давление и дневник сахара с порогами — у каждого свои. */
function TargetsScreen({ settings, onPatch, onBack }: Общее & { onBack: () => void }) {
  const кто = activePersonOf(settings)
  const цель = targetsOf(кто, settings)
  const сахар = glucoseTargetsOf(кто, settings)
  const семья = settings.people.length > 1

  return (
    <div className="stack">
      <BackBar onBack={onBack} />

      <div className="card">
        <div className="card__head">
          <h2>Целевое давление</h2>
          {семья && <span className="muted">{кто?.name.trim() || 'выбранный человек'}</span>}
        </div>

        <div className="grid grid--two">
          <NormField
            key={`sys-${кто?.id ?? 'один'}`}
            label="Верхнее"
            value={цель.sys}
            min={80}
            max={200}
            start={135}
            onCommit={(sys) => onPatch(setTargets(settings, кто?.id ?? null, { ...цель, sys }))}
          />
          <NormField
            key={`dia-${кто?.id ?? 'один'}`}
            label="Нижнее"
            value={цель.dia}
            min={40}
            max={130}
            start={85}
            onCommit={(dia) => onPatch(setTargets(settings, кто?.id ?? null, { ...цель, dia }))}
          />
        </div>
        <div className="muted" style={{ marginTop: 'var(--space-3)' }}>
          135/85 — порог для измерений дома, он ниже кабинетного 140/90. Врач мог назначить другой.
          {семья && ' У каждого человека цель своя.'}
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <h2>Дневник сахара</h2>
        </div>

        <label className="optrow__label">
          <input
            type="checkbox"
            checked={settings.trackGlucose}
            onChange={(e) => onPatch(setTrackGlucose(settings, e.target.checked))}
          />
          <span className="optrow__title">
            Вести дневник сахара
            <span className="fact__note">появится рядом с давлением и в отчёте врачу</span>
          </span>
        </label>

        <Reveal open={settings.trackGlucose}>
          <div className="grid grid--two" style={{ marginTop: 'var(--space-4)' }}>
            <NormField
              key={`fastingMax-${кто?.id ?? 'один'}`}
              label="Норма натощак, ммоль/л"
              value={сахар.fastingMax}
              min={3}
              max={20}
              start={7}
              step={0.1}
              decimals={1}
              onCommit={(fastingMax) => onPatch(setGlucoseTargets(settings, кто?.id ?? null, { ...сахар, fastingMax }))}
            />
            <NormField
              key={`postMealMax-${кто?.id ?? 'один'}`}
              label="Через 2 часа после еды"
              value={сахар.postMealMax}
              min={3}
              max={25}
              start={10}
              step={0.1}
              decimals={1}
              onCommit={(postMealMax) => onPatch(setGlucoseTargets(settings, кто?.id ?? null, { ...сахар, postMealMax }))}
            />
            <NormField
              key={`low-${кто?.id ?? 'один'}`}
              label="Порог низкого сахара"
              value={сахар.low}
              min={2}
              max={6}
              start={3.9}
              step={0.1}
              decimals={1}
              onCommit={(low) => onPatch(setGlucoseTargets(settings, кто?.id ?? null, { ...сахар, low }))}
            />
          </div>
          <div className="muted" style={{ marginTop: 'var(--space-3)' }}>
            Значения по умолчанию — общие ориентиры. При диабете цели назначает врач.
          </div>
        </Reveal>
      </div>
    </div>
  )
}

export function Settings({
  settings,
  onChange,
  measurements,
  regimens,
  intakes,
  onRestore,
  onStartTour,
  onMerge,
  onDeletePerson,
  onClearAll,
  backup,
  family,
  screen,
  person,
  onOpen,
  onOpenPerson,
  onBack,
}: {
  settings: SettingsData
  onChange: (next: SettingsData) => void
  /** Курсы приёма — экрану человека и списку напоминаний. */
  regimens: Regimen[]
  /** Они же вместе с коробками: напоминаниям нужны единицы и названия. */
  intakes: Dosing[]
  measurements: Measurement[]
  onRestore: (incoming: ImportResult) => Promise<{ added: number; medicines: number; settingsRestored: boolean }>
  onClearAll: () => Promise<void>
  backup: BackupStatus
  /** Семейный обмен: список телефонов и что принесло последнее чтение. */
  family: FamilySyncStatus
  /**
   * Какой подэкран открыт. Приходит снаружи, из стека экранов приложения: на
   * подэкран ведут и глубокие ссылки с «Обзора», где эти настройки ещё не
   * отрисованы, и аппаратная «Назад», о которой знает только приложение.
   */
  screen: Subscreen | null
  /** Человек, чей экран открыт внутри «Людей». */
  person: string | null
  onOpen: (screen: Subscreen) => void
  /** Запустить гайд-курс: подсветка идёт поверх всего приложения, не здесь. */
  onStartTour: (key: string) => void
  /** Объединить двух людей: записи переписываются в хранилище, не здесь. */
  onMerge: (loser: string, winner: string) => Promise<void>
  /** Перенести курсы удаляемого человека тому, кто останется первым. */
  onDeletePerson: (who: string, to: string) => Promise<void>
  onOpenPerson: (id: string) => void
  onBack: () => void
}) {
  const patch = (fields: Partial<SettingsData>) => onChange({ ...settings, ...fields })
  const напоминанияЕсть = platform().reminders.isSupported()

  if (screen === 'guide') return <GuideScreen settings={settings} onStartTour={onStartTour} onBack={onBack} />
  if (screen === 'display') return <DisplayScreen settings={settings} onPatch={patch} onBack={onBack} />
  if (screen === 'targets') return <TargetsScreen settings={settings} onPatch={patch} onBack={onBack} />
  if (screen === 'pharmacies') return <PharmaciesScreen settings={settings} onPatch={patch} onBack={onBack} />

  if (screen === 'people') {
    const открытый = settings.people.find((p) => p.id === person)
    if (открытый) {
      return (
        <PersonScreen
          person={открытый}
          settings={settings}
          regimens={regimens}
          measurements={measurements}
          onChange={patch}
          onMerge={onMerge}
          onDelete={onDeletePerson}
          onBack={onBack}
        />
      )
    }
    return <People settings={settings} onChange={patch} onOpenPerson={onOpenPerson} onBack={onBack} />
  }

  if (screen === 'reminders') {
    return (
      <div className="stack">
        <BackBar onBack={onBack} />
        <Reminders
          medicines={intakes}
          enabled={settings.remindersOn}
          sound={settings.reminderSound}
          repeat={settings.remindersRepeat}
          measureOn={settings.measureRemindOn}
          measurePlan={measurePlanOf(activePersonOf(settings), settings)}
          onPatch={patch}
        />
      </div>
    )
  }

  if (screen === 'backup') {
    return (
      <BackupScreen
        settings={settings}
        onPatch={patch}
        measurements={measurements}
        onRestore={onRestore}
        onClearAll={onClearAll}
        backup={backup}
        familyPhones={family.sources.length}
        onBack={onBack}
      />
    )
  }

  if (screen === 'family') {
    return (
      <FamilyScreen
        family={family}
        target={backup.target}
        busy={backup.busy}
        onChooseTarget={() => void backup.chooseTarget()}
        onBack={onBack}
      />
    )
  }

  if (screen === 'about') {
    return (
      <div className="stack">
        <BackBar onBack={onBack} />
        <About releases={releases} />
      </div>
    )
  }

  // ── корень ───────────────────────────────────────────────────────────────
  return (
    <div className="stack">
      <div className="card">
        <ul className="pills">
          <NavRow
            title={SUBSCREEN_TITLE.display}
            value={describeDisplay(settings)}
            tour="set-display"
            onOpen={() => onOpen('display')}
          />
          <NavRow
            title={SUBSCREEN_TITLE.people}
            value={describePeople(settings.people, settings.intakeTimes)}
            tour="set-people"
            onOpen={() => onOpen('people')}
          />
          <NavRow
            title={SUBSCREEN_TITLE.targets}
            value={describeTargets(settings, activePersonOf(settings))}
            tour="set-targets"
            onOpen={() => onOpen('targets')}
          />
          {/* В браузере настоящих напоминаний нет вовсе, и строки тоже. */}
          {напоминанияЕсть && (
            <NavRow
              title={SUBSCREEN_TITLE.reminders}
              value={describeReminders(settings)}
              tour="set-reminders"
              onOpen={() => onOpen('reminders')}
            />
          )}
          <NavRow
            title={SUBSCREEN_TITLE.backup}
            value={describeBackupRow(backup.lastAt, Date.now())}
            tour="set-backup"
            onOpen={() => onOpen('backup')}
          />
          <NavRow
            title={SUBSCREEN_TITLE.pharmacies}
            value={describePharmacies(settings.pharmacies ?? [])}
            tour="set-pharmacies"
            onOpen={() => onOpen('pharmacies')}
          />
          <NavRow
            title={SUBSCREEN_TITLE.family}
            value={describeFamily(family.sources.length, family.supported, backup.target !== null, family.cloud.connected)}
            tour="set-family"
            onOpen={() => onOpen('family')}
          />
          {/* «Как пользоваться» стоит над «О приложении»: и то и другое —
              справка, но одно объясняет приложение, а другое рассказывает про
              версии. Искать помощь будут выше. */}
          <NavRow
            title={SUBSCREEN_TITLE.guide}
            value="подсказки прямо на экране"
            tour="set-guide"
            onOpen={() => onOpen('guide')}
          />
          <NavRow title={SUBSCREEN_TITLE.about} value={releases[0]?.version} onOpen={() => onOpen('about')} />
        </ul>
      </div>
    </div>
  )
}

/**
 * Список курсов.
 *
 * Не один длинный курс, а несколько коротких: человек выбирает вопрос, который
 * у него есть сейчас, и видит, сколько шагов ему предстоит. Курсы про разделы,
 * которые выключены, сюда не попадают — их отсеивает `tours`.
 */
export function GuideScreen({
  settings,
  onStartTour,
  onBack,
}: {
  settings: SettingsData
  onStartTour: (key: string) => void
  onBack: () => void
}) {
  const список = tours(settings, { reminders: platform().reminders.isSupported() })

  return (
    <div className="stack">
      <BackBar onBack={onBack} />
      <div className="card">
        <div className="card__head">
          <h2>Как пользоваться</h2>
        </div>
        <p className="muted">
          Приложение само откроет нужный раздел и обведёт кнопку, о которой рассказывает. Прервать можно на любом шаге.
        </p>
        <ul className="pills">
          {список.map((курс) => (
            <li key={курс.key} className="pill">
              <button className="pill__open" onClick={() => onStartTour(курс.key)}>
                <span className="pill__head">
                  <span className="pill__title">
                    <span className="pill__name">{курс.title}</span>
                  </span>
                  <ChevronIcon />
                </span>
                <span className="pill__sub">
                  {курс.hint} · {курс.steps.length} {plural(курс.steps.length, 'шаг', 'шага', 'шагов')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
