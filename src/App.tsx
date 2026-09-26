import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isBp, isGlucose, type LabTest, type Measurement, type Medicine, type Regimen, type Settings as SettingsData } from './types'
import {
  DEFAULT_SETTINGS,
  addNewMeasurements,
  clearMeasurements,
  deleteMeasurement,
  getAllTombstones,
  saveTombstones,
  getAllMeasurements,
  getAllMedicines,
  getAllRegimens,
  getAllLabs,
  putLab,
  deleteLab,
  putLabPhoto,
  deleteLabPhoto,
  deleteLabPhotosOf,
  loadSettings,
  deleteMedicine,
  deleteRegimen,
  newMedicineId,
  putMeasurements,
  putMedicine,
  restoreMeasurement,
  putRegimen,
  saveSettings,
} from './db/store'
import { PERIODS, filterByPeriod, summarize, summarizeGlucose, type PeriodKey } from './logic/stats'
import type { GlucoseTargets } from './logic/classify'
import { DayPartChart, GlucoseChart, PulseChart, TrendChart } from './ui/Charts'
import { LatestAlert, SummaryTiles } from './ui/Summary'
import { GlucoseEntry, GlucoseList, GlucoseTiles } from './ui/Glucose'
import { Readings } from './ui/Readings'
import { Restock, ShortageCard, TodayCard } from './ui/Medicines'
import { SilenceCard } from './ui/SilenceCard'
import { DeviceIcon, HelpIcon, ReportIcon, SettingsIcon } from './ui/icons'
import { mergeLab } from './logic/merge'
import { fillMissingFromCopy, mergeRestoredSettings, takesPersonalFrom } from './logic/io'
import { depthOf, pathOf, pop, prune, push, rootStack, tabOf, tapTab, toTab, TOOL_ITEMS, type Node, type Stack } from './logic/nav'
import { platform } from './platform/ports'
import { normalizeSettings, SUBSCREENS, type Subscreen } from './logic/settings'
import { medicinesForReminder } from './logic/reminders'
import { measurePlanOf, measureSubjects, setMeasurePlan } from './logic/course'
import { Onboarding } from './ui/Onboarding'
import { PersonSwitch } from './ui/People'
import { activePersonOf, deviceUserOf, glucoseTargetsOf, intakesOfPerson, mergePeople, redirectPerson, targetsOf, intakeSlotsOf } from './logic/people'
import { dosings, newRegimenId, orphanRegimens } from './logic/regimen'
import { Intake } from './ui/Intake'
import { Cabinet } from './ui/Cabinet'
import { Entry } from './ui/Entry'
import { Sync } from './ui/Sync'
import {
  countAlerts,
  markTakenAt,
  stockOf,
  parseTime,
  pendingToday,
  startOfDay,
  undoTaken,
  foldHistory,
} from './logic/medicines'
import type { ImportResult } from './logic/io'
import { applyDisplay, applyTheme } from './ui/theme'
import { useBackup } from './ui/useBackup'
import { useFamilySync } from './ui/useFamilySync'
import { useReminders } from './ui/useReminders'
import { BackupNudge } from './ui/Backup'
import { UpdateNudge } from './ui/Update'
import { useUpdate } from './ui/useUpdate'
import { ВЕРСИЯ } from './ui/version'
import { GuideScreen, Settings } from './ui/Settings'
import { Report } from './ui/Report'
import { Memo } from './ui/Memo'
import { Labs } from './ui/Labs'
import { describeDue, labsDue, labsOf, newPhotoId, nextDue, withResolvedDue } from './logic/labs'
import { shrink } from './ui/photo'
import { plural } from './logic/plural'
import { Compare } from './ui/Compare'
import { Course } from './ui/Course'
import { Tour } from './ui/Tour'
import { tourByKey } from './logic/tour'
import { Banner, NavRow, Reveal, Working } from './ui/bits'

/**
 * Разделы нижней навигации.
 *
 * Раньше давление, сахар и лекарства прятались за сегментированным
 * переключателем внутри «Записей» — до нужного дневника было два касания.
 * Теперь каждый живёт своим пунктом. `section` связывает пункт с настройкой
 * видимости: у одного пользователя все три дневника, у другого только лекарства.
 *
 * Короткая подпись — для нижней строки на телефоне, где на пункт приходится
 * около 70px. Значков без подписей здесь нет намеренно: пожилые их не узнают.
 */
const TABS = [
  { key: 'overview', label: 'Обзор', short: 'Обзор', section: 'overview' },
  { key: 'bp', label: 'Давление', short: 'Давление', section: 'bp' },
  { key: 'glucose', label: 'Сахар', short: 'Сахар', section: 'glucose' },
  { key: 'intake', label: 'Приём лекарств', short: 'Приём', section: 'intake' },
  { key: 'cabinet', label: 'Аптечка', short: 'Аптечка', section: 'cabinet' },
] as const

/**
 * Разделы вне нижней строки: к ним обращаются редко, значок в шапке достаточен.
 *
 * Ключи, подписи и якоря — из `TOOL_ITEMS` (`logic/nav.ts`), оттуда же их берёт
 * гайд-курс. Здесь к ним добавляются только значки: это разметка.
 *
 * Справка — четвёртой и последней: три прежние остаются там, где их уже
 * выучили. В настройках она тоже есть, но там до неё шесть строк и прокрутка,
 * а за помощью идут не тогда, когда готовы искать.
 */
const ЗНАЧКИ: Record<string, () => React.ReactElement> = {
  sync: DeviceIcon,
  report: ReportIcon,
  settings: SettingsIcon,
  guide: HelpIcon,
}
const TOOLS = TOOL_ITEMS.map((item) => ({ ...item, Icon: ЗНАЧКИ[item.key] }))

/**
 * Памятка — экран-инструмент без кнопки в шапке.
 *
 * В шапке три места и они заняты. Памятку открывают из аптечки, где человек и
 * задумывается «а что мне на неделю раскладывать», — и возвращают туда же.
 */
/** Сколько держать предложение вернуть удалённую запись, мс. */
/**
 * Строка раздела анализов на «Обзоре».
 *
 * Про сроки, а не про результаты: «просрочен» — это факт о списке человека, а
 * не суждение о его здоровье. Числа приложение не оценивает вовсе.
 */
function описатьАнализы(labs: LabTest[], regimens: Regimen[], now: number): string {
  if (labs.length === 0) return 'ничего не заведено'
  const горят = labsDue(labs, regimens, now)
  if (горят.length > 0) return `сдать: ${горят.map((t) => t.name).join(', ')}`
  const ближайший = labs
    .map((t) => ({ t, когда: nextDue(t, regimens, now) }))
    .filter((x): x is { t: LabTest; когда: number } => x.когда !== null)
    .sort((a, b) => a.когда - b.когда)[0]
  if (!ближайший) return `${labs.length} ${plural(labs.length, 'анализ', 'анализа', 'анализов')}, без срока`
  return `${ближайший.t.name} — ${describeDue(ближайший.t, regimens, now)?.toLowerCase() ?? ''}`
}

const UNDO_WINDOW = 30_000

const СКРЫТЫЕ_ИНСТРУМЕНТЫ = ['memo', 'labs'] as const

type TabKey = (typeof TABS)[number]['key'] | (typeof TOOLS)[number]['key'] | (typeof СКРЫТЫЕ_ИНСТРУМЕНТЫ)[number]

/** Разделы из шапки: они ложатся поверх вкладки, а не заменяют её. */
const ИНСТРУМЕНТЫ = new Set<string>([...TOOLS.map((item) => item.key), ...СКРЫТЫЕ_ИНСТРУМЕНТЫ])

function PeriodPicker({ value, onChange }: { value: PeriodKey; onChange: (next: PeriodKey) => void }) {
  // `--fill` — равные доли и перенос подписи. В проекте он заведён ровно на
  // случай крупного системного шрифта, но этот переключатель его не
  // использовал: при 130 % «Всё время» начинало выходить за край.
  return (
    <div className="segmented segmented--fill" role="group" aria-label="Период">
      {PERIODS.map((item) => (
        <button key={item.key} aria-pressed={value === item.key} onClick={() => onChange(item.key)}>
          {item.label}
        </button>
      ))}
    </div>
  )
}

export default function App() {
  const [measurements, setMeasurements] = useState<Measurement[]>([])
  const [medicines, setMedicines] = useState<Medicine[]>([])
  const [regimens, setRegimens] = useState<Regimen[]>([])
  const [labs, setLabs] = useState<LabTest[]>([])
  /**
   * «Сейчас» с точностью до минуты.
   *
   * Сроки анализов считаются от этого значения, а `Date.now()` в разметке —
   * новое число на каждую отрисовку: мемоизация внутри экрана обнулялась бы
   * при каждом нажатии.
   */
  const минута = Math.floor(Date.now() / 60_000) * 60_000
  const [settings, setSettings] = useState<SettingsData>(DEFAULT_SETTINGS)
  const [period, setPeriod] = useState<PeriodKey>('30d')
  /**
   * Где человек находится — стек экранов, а не одна вкладка.
   *
   * Дно стека всегда нижняя вкладка; разделы из шапки и подэкраны настроек
   * ложатся поверх. Из этого следует поведение аппаратной «Назад»: она снимает
   * верхний узел, а когда снимать нечего — сворачивает приложение. Раньше
   * глубины не существовало вовсе, и «Назад» из середины настроек выбрасывала
   * человека на рабочий стол.
   */
  const [stack, setStack] = useState<Stack>(() => rootStack('overview'))
  const stackRef = useRef<Stack>(stack)
  stackRef.current = stack
  /** Растёт при повторном нажатии на активную вкладку — сигнал разделу вернуться в начало. */
  const [rootSignal, setRootSignal] = useState(0)
  /** Стартовый экран из настроек применяется один раз, после загрузки данных. */
  const started = useRef(false)
  /** Приложение открылось нажатием по напоминанию — стартовый экран не навязываем. */
  const openedByReminder = useRef(false)
  /** День из напоминания: экран приёма обязан открыться именно на нём. */
  const [reminderDay, setReminderDay] = useState<number | null>(null)
  const [ready, setReady] = useState(false)
  /** Хранилище не ответило. Молчать нельзя: экран «Загрузка…» висел бы вечно. */
  const [storageFailed, setStorageFailed] = useState(false)
  /**
   * Хранилище отказало при записи.
   *
   * Отдельно от `storageFailed`: тот про чтение при запуске и показывается
   * вместо всего приложения. Здесь дневник работает, но последнее действие не
   * сохранилось, и молчать об этом нельзя — человек решит, что отметил приём.
   */
  const [saveFailed, setSaveFailed] = useState<string | null>(null)
  const [undo, setUndo] = useState<Measurement | null>(null)
  // ReturnType, а не number: в браузере таймер это число, в Node — объект.
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  /**
   * Какой экран показывать. Раздел из шапки лежит поверх вкладки, поэтому,
   * пока он открыт, показывается он, а вкладка ждёт под ним и получает
   * человека обратно по «Назад».
   */
  const инструмент = stack.find((node) => node.kind === 'sub' && ИНСТРУМЕНТЫ.has(node.sub))
  const tab = ((инструмент && инструмент.kind === 'sub' ? инструмент.sub : tabOf(stack)) || 'overview') as TabKey

  /**
   * Какой подэкран настроек открыт и чей человек внутри «Людей».
   *
   * Узел настроек лежит на стеке первым, подэкран — вторым: путь читается как
   * «intake/settings/backup». Значение приходит сюда, а не хранится в самих
   * настройках, потому что на подэкран ведут глубокие ссылки с «Обзора», где
   * настройки ещё не отрисованы.
   */
  // С конца, а не с начала: на стеке может лежать «settings/family/backup», и
  // первый найденный подэкран — это тот, с которого ушли, а не тот, что открыт.
  // Кнопка «К копии дневника» на экране «Семья» из-за этого не открывала ничего.
  const узелПодэкрана = [...stack]
    .reverse()
    .find((node, i, arr) => node.kind === 'sub' && arr.length - 1 - i > 0 && !ИНСТРУМЕНТЫ.has(node.sub))
  const подэкранНастроек =
    узелПодэкрана && узелПодэкрана.kind === 'sub' && (SUBSCREENS as readonly string[]).includes(узелПодэкрана.sub)
      ? (узелПодэкрана.sub as Subscreen)
      : null
  const узелЧеловека = stack.find((node) => node.kind === 'person')
  const открытыйЧеловек = узелЧеловека && узелЧеловека.kind === 'person' ? узелЧеловека.id : null

  /**
   * Открыть экран выбранного человека прямо из баннера «нет кнопки прибора».
   * Одно нажатие вместо «Настройки → Люди → нужный человек».
   */
  const кНастройкамЧеловека = useCallback(() => {
    const кто = activePersonOf(settingsRef.current)
    setStack([
      ...rootStack(tabOf(stackRef.current)),
      { kind: 'sub', sub: 'settings' },
      { kind: 'sub', sub: 'people' },
      ...(кто ? [{ kind: 'person', id: кто.id } as Node] : []),
    ])
  }, [])

  /** Шаг знакомства: тоже узел стека, чтобы «Назад» возвращала на первый шаг. */
  const узелШага = stack.find((node) => node.kind === 'step')
  const шагЗнакомства: 1 | 2 = узелШага && узелШага.kind === 'step' && узелШага.step === 2 ? 2 : 1

  /** Что открыто поверх аптечки. Форма выше карточки: из неё возвращаются в карточку. */
  const узелКарточки = stack.find((node) => node.kind === 'card')
  const узелФормы = stack.find((node) => node.kind === 'form')
  const открытаяКоробка =
    узелКарточки && узелКарточки.kind === 'card' ? { id: узелКарточки.id, edit: узелКарточки.edit } : null
  const открытаяФорма = узелФормы && узелФормы.kind === 'form' ? { id: узелФормы.id } : null

  /**
   * Открыть раздел. Нижняя вкладка заменяет стек целиком, раздел из шапки
   * ложится поверх текущей вкладки — «Назад» из настроек вернёт туда, откуда
   * человек в них зашёл, а не на «Обзор».
   */
  const setTab = useCallback((key: TabKey) => {
    setStack((текущий) =>
      ИНСТРУМЕНТЫ.has(key)
        ? [...rootStack(tabOf(текущий)), { kind: 'sub', sub: key } as Node]
        : rootStack(key),
    )
  }, [])

  /**
   * Идущий гайд-курс.
   *
   * Живёт здесь, а не в настройках, откуда его запускают: курс сам открывает
   * разделы и лежит поверх всего приложения, включая нижнюю навигацию.
   */
  const [курс, setКурс] = useState<string | null>(null)
  /** Идёт объединение людей — показываем полосу занятости. */
  const [слияние, setСлияние] = useState(false)
  // Ссылка, а не значение: `назад` подписана на системную кнопку один раз, и
  // пересобирать её на каждую смену шага нельзя — подписка бы копилась.
  const курсRef = useRef<string | null>(курс)
  курсRef.current = курс
  // Обязательно `useMemo`: `tourByKey` собирает курс заново на каждый вызов, а
  // курс сам просит открыть раздел — новый объект на каждую перерисовку дал бы
  // бесконечный круг «сменили раздел → перерисовка → снова сменили раздел».
  const идущийКурс = useMemo(
    () => (курс ? tourByKey(курс, settings, { reminders: platform().reminders.isSupported() }) : null),
    [курс, settings],
  )

  /** Открыть что-то поверх текущего экрана: карточку, форму, подэкран. */
  const открыть = useCallback((node: Node) => setStack((текущий) => push(текущий, node)), [])

  /**
   * Коробка из другого раздела: с «Обзора» и из списка покупок.
   *
   * Стек собирается целиком, а не кладётся поверх текущего: «Назад» из карточки
   * обязана вернуть в аптечку, где эта коробка лежит, а не на «Обзор», где её
   * уже нет в списке — она же только что перестала заканчиваться.
   */
  const открытьКоробку = useCallback(
    (id: string) => setStack([...rootStack('cabinet'), { kind: 'card', id, edit: 'left' }]),
    [],
  )

  /** Снять уровень. `false` — снимать нечего, платформа свернёт приложение. */
  const назад = useCallback(() => {
    // Курс снимается раньше листов и экранов: он лежит поверх всего, и
    // системная «Назад» при нём означает «хватит подсказок», а не «на уровень
    // выше в приложении, которое сейчас не видно».
    if (курсRef.current !== null) {
      setКурс(null)
      return true
    }
    // Открытый лист выбора снимается первым. Пока подписан слушатель
    // `backButton`, WebView своё поведение не применяет, и системная «Назад»
    // до `<dialog>` не доходит: без этой строки лист висел бы поверх экрана,
    // а нажатие уносило человека на уровень выше — проверено на Mate 60 Pro.
    const лист = document.querySelector('dialog[open]')
    if (лист instanceof HTMLDialogElement) {
      лист.close()
      return true
    }
    const следующий = pop(stackRef.current)
    if (!следующий) return false
    setStack(следующий)
    return true
  }, [])

  // Единственное место, где приложение узнаёт о системной «Назад». Слот один:
  // накопить подписки при перерисовке нельзя, иначе одно нажатие снимало бы
  // несколько уровней разом.
  useEffect(() => platform().nav.onBack(назад), [назад])

  // Единственное место, где о глубине узнаёт платформа: забыть вызов негде.
  useEffect(() => platform().nav.sync(depthOf(stack)), [stack])

  useEffect(() => {
    /**
     * Хранилище может не ответить вовсе: другая вкладка держит обновление схемы,
     * браузер вытеснил базу, приватный режим запретил её. Запрос при этом не
     * падает, а просто молчит — без срока приложение остаётся на «Загрузка…»
     * навсегда, и человек думает, что потерял все записи.
     */
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('хранилище не ответило')), 8000),
    )

    Promise.race([
      Promise.all([getAllMeasurements(), loadSettings(), getAllMedicines(), getAllRegimens(), getAllLabs()]),
      timeout,
    ]).then(([stored, loaded, pills, курсы, анализы]) => {
      setMeasurements(stored)
      setMedicines(pills)
      setRegimens(курсы)
      setLabs(анализы)
      // Дневник сахара включается сам, если данные по нему уже есть.
      setSettings(loaded.trackGlucose || stored.some(isGlucose) ? { ...loaded, trackGlucose: true } : loaded)
      // Стартовый экран применяется один раз при загрузке: дальше человек
      // переключается сам, и возвращать его к «своему» экрану было бы навязчиво.
      //
      // Нажатие по уведомлению — тоже «дальше»: приложение при этом запускается
      // с нуля, и система отдаёт событие раньше, чем дочитывается база. Без
      // этой оговорки человек, нажавший на напоминание, попадал не на экран
      // приёма, а на «Обзор» — и не понимал, куда делась таблетка.
      if (!started.current) {
        started.current = true
        const стартовый = toTab(loaded.startTab, TABS.map((item) => item.key))
        if (стартовый && !openedByReminder.current) setTab(стартовый as TabKey)
      }
      setReady(true)

      // Владелец проставляется явно, а не выводится на лету.
      //
      // Препараты, заведённые до появления людей, ничьи. Пока человек один, это
      // незаметно, а на втором превращается в вопрос без ответа: чья коробка.
      // Разбирать это, когда людей уже двое, поздно — и человек, и приложение
      // одинаково не знают.
      //
      // Свёртка истории — там же: препарат, который перестали отмечать, иначе
      // не свернулся бы никогда, а история нужна именно у него.
      //
      // Отметки живут шестьдесят дней. Препарат, который перестали отмечать,
      // иначе не свернулся бы никогда: свёртка живёт в обработчике отметки, а
      // отметок больше нет. Ровно у него история и нужна — врач спрашивает про
      // курс, который закончился.
      void (async () => {
        // Человека у курса проставляем и чиним: пусто у курсов, разобранных из
        // коробок, заведённых до появления людей, а указывать на удалённого он
        // может после удаления. Оба случая ведут к первому в списке — ровно
        // это и обещает окно подтверждения при удалении.
        /*
         * Человека проставляем только пустому курсу, и только ему.
         *
         * Пусто бывает ровно в одном случае: коробку завели до появления
         * людей, и при разборе брать человека было неоткуда. Это и чиним.
         *
         * Раньше здесь же «чинился» курс, указывающий на кого-то, кого нет в
         * списке, — его переводили первому. Так нельзя: список людей приходит
         * из настроек, а настройки при неудачном стечении могут оказаться
         * неполными, и тогда эта строка молча переписывает человека у половины
         * курсов. На живом дневнике это однажды и случилось: пять курсов
         * сменили владельца без единого нажатия.
         *
         * Что станет с курсами удалённого человека, решает само удаление —
         * там, где человек это видит и подтверждает (`People.tsx`).
         */
        const первый = loaded.people?.[0]?.id ?? null
        const обработанные = курсы.map((r) => {
          const свёрнут = foldHistory(r, Date.now())
          return !свёрнут.person && первый ? { ...свёрнут, person: первый } : свёрнут
        })
        const изменились = обработанные.filter((r, i) => r !== курсы[i])
        // Курс без коробки показывать не из чего, а в базе он мешает: следующий
        // обмен разнесёт его по семье снова. Коробку удалили — уходит и курс.
        const осиротевшие = orphanRegimens(pills, обработанные)
        if (изменились.length === 0 && осиротевшие.length === 0) return
        for (const item of изменились) await putRegimen(item).catch(() => undefined)
        for (const item of осиротевшие) await deleteRegimen(item.id).catch(() => undefined)
        setRegimens(await getAllRegimens())
      })()
    }).catch(() => setStorageFailed(true))
    return () => clearTimeout(undoTimer.current)
  }, [])

  // Тему ставит и скрипт в index.html — до первой отрисовки. Здесь она
  // приводится в соответствие с настройками: они главный источник истины.
  /*
   * Оформление применяется только после того, как настройки прочитаны.
   *
   * Раньше эффект срабатывал и на монтировании — с умолчаниями, потому что
   * база читается асинхронно. А умолчания это «как в системе» и «обычный
   * размер»: применение стирало и атрибуты, уже поставленные скриптом в
   * index.html, и дубликат в localStorage, из которого тот скрипт читает.
   * Экран мигал, а закройся приложение до конца загрузки — выбор пропадал
   * совсем. До готовности трогать нечего: скрипт всё поставил верно.
   */
  useEffect(() => {
    if (!ready) return
    applyTheme(settings.theme)
  }, [ready, settings.theme])

  useEffect(() => {
    if (!ready) return
    applyDisplay(settings.textScale, settings.density)
  }, [ready, settings.textScale, settings.density])

  const refresh = useCallback(async () => setMeasurements(await getAllMeasurements()), [])
  const refreshMedicines = useCallback(async () => {
    const [коробки, курсы, анализы] = await Promise.all([getAllMedicines(), getAllRegimens(), getAllLabs()])
    setMedicines(коробки)
    setRegimens(курсы)
    setLabs(анализы)
  }, [])

  const handleAdd = useCallback(
    async (item: Measurement) => {
      // Записанное руками принадлежит тому, чей дневник открыт: кнопка прибора
      // здесь ни при чём, её могли и не назначать вовсе.
      const кто = activePersonOf(settingsRef.current)
      // Отказ хранилища здесь показывался только для лекарств; измерение
      // молча пропадало, а экран показывал старое. Тот же баннер и здесь.
      try {
        await putMeasurements([кто ? { ...item, person: кто.id } : item])
        setSaveFailed(null)
      } catch (caught) {
        setSaveFailed(caught instanceof Error ? caught.message : String(caught))
        throw caught
      }
      await refresh()
    },
    [refresh],
  )

  const handleImport = useCallback(
    async (incoming: Measurement[]) => {
      const added = await addNewMeasurements(incoming)
      await refresh()
      return added.length
    },
    [refresh],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      const victim = measurements.find((m) => m.id === id) ?? null
      try {
        await deleteMeasurement(id)
        setSaveFailed(null)
      } catch (caught) {
        setSaveFailed(caught instanceof Error ? caught.message : String(caught))
        throw caught
      }
      await refresh()
      setUndo(victim)
      clearTimeout(undoTimer.current)
      // Полминуты, а не восемь секунд. Баннер стоит в потоке страницы, ничего
      // собой не закрывает, и лишнее время ему ничего не стоит. А вот восьми
      // секунд человеку в семьдесят пять не хватает: заметить строку, понять,
      // что удалил не то, и дотянуться — это дольше.
      undoTimer.current = setTimeout(() => setUndo(null), UNDO_WINDOW)
    },
    [measurements, refresh],
  )

  /**
   * Правка записи. Идентификатор не меняется даже при правке времени — и это
   * важно: повторная выгрузка с прибора пропускает записи, чьи идентификаторы
   * уже есть, поэтому исправление переживёт следующую синхронизацию.
   */
  const handleUpdate = useCallback(
    async (next: Measurement) => {
      try {
        await putMeasurements([next])
        setSaveFailed(null)
      } catch (caught) {
        setSaveFailed(caught instanceof Error ? caught.message : String(caught))
        throw caught
      }
      await refresh()
    },
    [refresh],
  )

  const handleUndo = useCallback(async () => {
    if (!undo) return
    // Не `putMeasurements`: та не пускает обратно то, у чего есть надгробие, а
    // надгробие только что поставило удаление. Кнопка из-за этого молча не
    // работала — баннер закрывался, запись не возвращалась.
    await restoreMeasurement(undo)
    await refresh()
    setUndo(null)
  }, [undo, refresh])

  const handleClearAll = useCallback(async () => {
    await clearMeasurements()
    await refresh()
    setUndo(null)
  }, [refresh])

  /**
   * Записать настройки.
   *
   * Принимает и готовый объект, и правку — как `setState`. Правка нужна там,
   * где новое состояние строится из прежнего: раньше такие места брали основу
   * из `settingsRef.current`, а реф присваивается в теле рендера. Рендер,
   * который React выбросил, реф всё равно перезаписывал, и в запись могла уехать
   * устаревшая основа — вплоть до пустого списка людей из настроек по
   * умолчанию. Через правку устаревшая основа невыразима: её отдаёт сам React.
   *
   * Всё проходит через `normalizeSettings`: выбранный человек обязан
   * существовать в списке, и чинится это в одном месте, а не в каждом
   * вызывающем.
   */
  const updateSettings = useCallback((next: SettingsData | ((prev: SettingsData) => SettingsData)) => {
    setSettings((prev) => {
      const готово = normalizeSettings(typeof next === 'function' ? next(prev) : next)
      void saveSettings(готово)
      return готово
    })
  }, [])

  /** Курсы — из ссылки: обработчик анализа не должен пересоздаваться от них. */
  const regimensRef = useRef(regimens)
  regimensRef.current = regimens

  /** Настройки читаются из ссылки: восстановление не должно пересоздаваться при каждой правке. */
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  /**
   * Восстановление из резервной копии. В отличие от импорта измерений, здесь
   * возвращается всё, что человек вводил руками: дневник, аптечка, настройки.
   *
   * Слияние только добавляющее. Копия — снимок прошлого, и перезаписывать ею
   * то, что уже есть на этом устройстве, значит откатывать более свежие правки.
   */
  const handleRestore = useCallback(
    async (incoming: ImportResult) => {
      // Надгробия применяем первыми, до всякой записи. Иначе удалённое на
      // другом устройстве сначала добавится, а потом исчезнет — человек увидит
      // «добавлено 12 записей» и не найдёт их. И наоборот: своё удаление не
      // должно вернуться из чужой копии, поэтому запись их уже не пропустит.
      if (incoming.tombstones.length > 0) {
        await saveTombstones(incoming.tombstones)
        for (const grave of incoming.tombstones) {
          if (grave.kind === 'measurement') await deleteMeasurement(grave.id)
          else if (grave.kind === 'regimen') await deleteRegimen(grave.id)
          else if (grave.kind === 'lab') await deleteLab(grave.id)
          else await deleteMedicine(grave.id)
        }
      }

      // Отметку времени у восстановленных записей не трогаем: она пришла из
      // файла и говорит, когда правку сделали на самом деле.
      const added = await addNewMeasurements(incoming.measurements, false)

      const local = await getAllMedicines()
      const known = new Map(local.map((m) => [m.id, m]))
      const buried = new Set((await getAllTombstones()).map((t) => t.id))
      const freshMedicines = incoming.medicines.filter((m) => !known.has(m.id) && !buried.has(m.id))
      for (const item of freshMedicines) await putMedicine(item, false)
      // Известные коробки не заменяем, но дописываем им то, что прежние версии
      // теряли при восстановлении: владельца, даты, историю. Остаток и
      // отметки остаются местными.
      // Курсы приёма — тем же порядком: новые добавляем, известным дописываем
      // то, чего у них нет. Курс осиротевшей коробки не берём: он не к чему.
      const местныеКурсы = await getAllRegimens()
      const знакомыеКурсы = new Map(местныеКурсы.map((r) => [r.id, r]))
      const естьКоробка = new Set([...local.map((m) => m.id), ...freshMedicines.map((m) => m.id)])
      for (const item of incoming.regimens) {
        if (buried.has(item.id) || !естьКоробка.has(item.medicineId)) continue
        const свой = знакомыеКурсы.get(item.id)
        if (!свой) {
          await putRegimen(item, false)
          continue
        }
        const filled = fillMissingFromCopy(свой, item)
        // Без свежего штампа: дописанные поля пришли из копии со своим временем,
        // и пометить курс «сейчас» значило бы сделать его свежее любой чужой
        // правки при следующем семейном обмене.
        if (filled !== свой) await putRegimen(filled, false)
      }

      // Анализы: новые добавляем, знакомым дописываем результаты.
      //
      // Именно дописываем, а не пропускаем: результаты — накопитель, и копия
      // может знать то, чего нет здесь. Человек восстанавливается из копии как
      // раз тогда, когда потерял телефон, и бросить половину чисел значит
      // обмануть его ровно в этот момент. Слиянием занимается `mergeLab` —
      // тот же, что и в семейном обмене, чтобы правила не разошлись.
      const местныеАнализы = await getAllLabs()
      const знакомыеАнализы = new Map(местныеАнализы.map((t) => [t.id, t]))
      for (const item of incoming.labs) {
        if (buried.has(item.id)) continue
        const свой = знакомыеАнализы.get(item.id)
        if (!свой) {
          await putLab(item, false)
          continue
        }
        const слито = mergeLab(свой, item)
        // Без свежего штампа: пришедшее из копии уже имеет свой, и пометить его
        // «сейчас» значит сделать его свежее любой чужой правки при обмене.
        if (слито) await putLab(слито, false)
      }

      let settingsRestored = false
      // В отдельную переменную: внутри правки сужение типа по `if` теряется.
      const изФайла = incoming.settings
      if (изФайла) {
        // Что из настроек брать из файла, решает `mergeRestoredSettings`:
        // устройство своё (тема, размер, копии, ключ прибора), семья — только
        // если здесь её ещё нет. Раньше чужой файл затирал и людей, и цели.
        updateSettings((prev) => mergeRestoredSettings(prev, изФайла))
        // «Восстановлены» — только если из файла взято личное. Чужой файл
        // оставляет своих людей и цели, и сообщение обязано это сказать.
        settingsRestored = takesPersonalFrom(settingsRef.current, изФайла)
      }

      await refresh()
      await refreshMedicines()
      return { added: added.length, medicines: freshMedicines.length, settingsRestored }
    },
    [refresh, refreshMedicines, updateSettings],
  )

  /**
   * Сохранить коробку и, если он есть, её курс приёма.
   *
   * Одним обработчиком, а не двумя: форма правит и то и другое сразу, а
   * коробка без курса и курс без коробки в ней не заводятся. Порядок важен —
   * сначала коробка: курс ссылается на неё, и запись наоборот оставила бы на
   * миг курс, которому не к чему привязаться.
   */
  const handleSaveMedicine = useCallback(
    async (item: Medicine, курс?: Regimen | null) => {
      try {
        const id = item.id || newMedicineId()
        await putMedicine({ ...item, id })
        if (курс) {
          // День заведения проставляется здесь и только здесь — в единственном
          // месте, где курс появляется. Без него расписание распространилось бы
          // на всё прошлое, и свежий препарат показал бы пропуски за два
          // месяца назад.
          const человек = курс.person || activePersonOf(settingsRef.current)?.id || ''
          await putRegimen(
            курс.id
              ? { ...курс, medicineId: id, person: человек }
              : { ...курс, id: newRegimenId(Date.now()), medicineId: id, person: человек, since: Date.now() },
          )
        }
        setSaveFailed(null)
      } catch (caught) {
        setSaveFailed(caught instanceof Error ? caught.message : String(caught))
        // Пробрасываем дальше: форма обязана остаться открытой и сказать своё.
        throw caught
      }
      await refreshMedicines()
    },
    [refreshMedicines],
  )

  /**
   * Человека удаляют — его курсы переходят названному.
   *
   * Явным действием в момент удаления, а не починкой при следующем запуске:
   * окно подтверждения обещает именно это, и обещание держит тот, кто его
   * дал. Коробки не трогаем — они ничьи и остаются в общей аптечке.
   */
  const handleDeletePerson = useCallback(
    async (who: string, to: string) => {
      const курсы = await getAllRegimens()
      for (const курс of курсы) {
        if (курс.person === who) await putRegimen({ ...курс, person: to })
      }
      // Анализы переходят туда же, куда курсы: удаление человека не должно
      // стирать записанные числа — их вводили руками и восстановить неоткуда.
      const анализы = await getAllLabs()
      for (const анализ of анализы) {
        if (анализ.owner === who) await putLab({ ...анализ, owner: to })
      }
      await refreshMedicines()
    },
    [refreshMedicines],
  )

  /** Убрать курс приёма, оставив коробку в аптечке. */
  const handleDeleteRegimen = useCallback(
    async (id: string) => {
      await deleteRegimen(id)
      await refreshMedicines()
    },
    [refreshMedicines],
  )

  const handleSaveLab = useCallback(
    async (item: LabTest) => {
      try {
        // Дату, посчитанную от конца курса, закрепляем в самой записи: иначе
        // после удаления курса заморозка вернёт не её, а то, что стояло в форме.
        await putLab(withResolvedDue(item, regimensRef.current))
        setSaveFailed(null)
      } catch (caught) {
        setSaveFailed(caught instanceof Error ? caught.message : String(caught))
      }
      await refreshMedicines()
    },
    [refreshMedicines],
  )

  const handleDeleteLab = useCallback(
    async (id: string) => {
      // Снимки уходят вместе с анализом: иначе на телефоне остаются мегабайты,
      // до которых из приложения больше не добраться.
      await deleteLabPhotosOf(id).catch(() => undefined)
      await deleteLab(id)
      await refreshMedicines()
    },
    [refreshMedicines],
  )

  /**
   * Снимок бланка. Уменьшение здесь, а не в хранилище: с камеры приходит
   * двенадцать мегапикселей, и класть их в базу целиком значит съесть память
   * телефона за десяток бланков.
   */
  const handleAddPhoto = useCallback(async (test: LabTest, file: File) => {
    const уменьшенный = await shrink(file)
    await putLabPhoto({
      id: newPhotoId(Date.now()),
      labId: test.id,
      day: startOfDay(Date.now()),
      blob: уменьшенный.blob,
      width: уменьшенный.width,
      height: уменьшенный.height,
      bytes: уменьшенный.bytes,
    })
  }, [])

  const handleDeletePhoto = useCallback(async (id: string) => {
    await deleteLabPhoto(id)
  }, [])

  /**
   * Отметить или снять отметку приёма.
   *
   * Препарат читается из хранилища, а не берётся из пропса экрана. Пропс —
   * слепок последней отрисовки, и два нажатия подряд собирали новое состояние
   * из одного и того же слепка: вторая отметка строилась на препарате без
   * первой и стирала её. Особенно верно для «Принял всё», где нажатие одно, а
   * отметок несколько.
   */
  const handleMarkTaken = useCallback(
    async (regimenId: string, plannedTs: number, undo = false) => {
      const [cabinet, курсы] = await Promise.all([getAllMedicines(), getAllRegimens()])
      const курс = курсы.find((r) => r.id === regimenId)
      const коробка = курс && cabinet.find((item) => item.id === курс.medicineId)
      if (!курс || !коробка) return
      const now = Date.now()
      try {
        if (undo) {
          await putRegimen(undoTaken(курс, plannedTs))
        } else {
          // Расход считается по всем курсам этой коробки: из одной упаковки
          // могут принимать двое, и остаток у них общий.
          const соседи = dosings([коробка], курсы.filter((r) => r.medicineId === коробка.id))
          const { box, regimen } = markTakenAt(коробка, курс, соседи, plannedTs, now)
          await putRegimen(regimen)
          if (box !== коробка) await putMedicine(box)
        }
        setSaveFailed(null)
      } catch (caught) {
        setSaveFailed(caught instanceof Error ? caught.message : String(caught))
      }
      await refreshMedicines()
    },
    [refreshMedicines],
  )

  /**
   * Убрать коробку из аптечки — вместе со всеми курсами, которые из неё пьют.
   *
   * Оставить курс сиротой нельзя: показывать назначение без препарата не из
   * чего, а следующий семейный обмен разнёс бы его по телефонам снова.
   */
  const handleDeleteMedicine = useCallback(
    async (id: string) => {
      const курсы = await getAllRegimens()
      for (const курс of курсы) if (курс.medicineId === id) await deleteRegimen(курс.id)
      await deleteMedicine(id)
      await refreshMedicines()
    },
    [refreshMedicines],
  )


  /**
   * Развёрнутые предупреждения прячутся на неделю.
   *
   * Баннер, висящий до устранения причины, доносит ровно один раз: дальше его
   * перестают читать, и в тот день, когда он окажется важным, не заметят.
   * Точка на кнопке при этом остаётся — сигнал никуда не девается.
   */
  const nudgeHidden = useMemo(
    () => ({
      backup: Date.now() < (settings.nudgesUntil?.backup ?? 0),
      cabinet: Date.now() < (settings.nudgesUntil?.cabinet ?? 0),
      reminders: Date.now() < (settings.nudgesUntil?.reminders ?? 0),
    }),
    [settings.nudgesUntil],
  )

  const snoozeNudge = useCallback(
    (kind: 'backup' | 'cabinet' | 'reminders') => {
      const until = Date.now() + 7 * 24 * 60 * 60 * 1000
      updateSettings((prev) => ({
        ...prev,
        nudgesUntil: { ...prev.nudgesUntil, [kind]: until },
      }))
    },
    [updateSettings],
  )

  const backup = useBackup(measurements, medicines, regimens, labs, settings, updateSettings, ready)

  /*
   * Обновление без магазина.
   *
   * Приложение раздаётся файлом, и до сих пор обновиться можно было только
   * получив APK от владельца. На семье из нескольких телефонов это значит, что
   * часть из них вечно на старой версии — а старая ломает обмен (§24б) и
   * молчит об этом.
   */
  const обновление = useUpdate(ВЕРСИЯ)

  /**
   * Семейный обмен: читаем копии других телефонов при каждом открытии.
   *
   * Свой файл при этом пишет обычная автокопия — отдельного канала для «своего»
   * не нужно, это тот же файл, который человек уже выбрал.
   */
  const family = useFamilySync({
    ready,
    settings,
    onSettings: updateSettings,
    /*
     * Всё состояние — одним блоком, как на стартовой загрузке.
     *
     * Прежде здесь стояли два `await` подряд: `refresh()`, потом
     * `refreshMedicines()`. Это два раздельных рендера, и между ними экран
     * заведомо рассогласован — измерения уже новые, курсы ещё старые, а если
     * перед тем ещё и записаны новые люди, то и люди новые при старых курсах.
     * Ровно в такое окно и попала чужая карточка «Сегодня» (BACKLOG §24и).
     */
    onChanged: async (people) => {
      const [изм, коробки, курсы, анализы] = await Promise.all([
        getAllMeasurements(),
        getAllMedicines(),
        getAllRegimens(),
        getAllLabs(),
      ])
      setMeasurements(изм)
      setMedicines(коробки)
      setRegimens(курсы)
      setLabs(анализы)
      if (people) updateSettings((prev) => ({ ...prev, people }))
    },
  })

  /**
   * Чем приложение занято прямо сейчас — одной строкой под шапкой.
   *
   * Порядок важен: сначала то, ради чего человек ждёт (чтение чужих копий при
   * открытии), потом фоновое (запись своей копии). Двух строк сразу быть не
   * должно — мелькание хуже молчания.
   */
  const занятость = слияние
    ? 'Объединяю людей…'
    : family.busy
      ? 'Идёт чтение записей семьи…'
      : backup.busy
        ? 'Сохраняется копия дневника…'
        : null
  /** Копия просрочена — точка на «Настройках» горит и после «Понятно». */
  const settingsMark = backup.warning !== null

  // Напоминания живут здесь, а не на экране настроек: расписание правится в
  // аптечке, и пересобирать набор надо в тот же момент, а не при следующем
  // заходе в настройки.
  /**
   * «Принял» нажато прямо в уведомлении.
   *
   * Отмечаются все препараты этого приёма, у которых отметки ещё нет: в
   * уведомлении они перечислены вместе, и человек, нажимая одну кнопку, имеет
   * в виду именно их. Отметка ставится на **назначенное** время, а не на
   * текущее, — иначе повтор в 8:45 записался бы отдельным приёмом.
   */
  /**
   * Объединить двух людей.
   *
   * Порядок записи обязателен: сначала измерения и коробки, и только потом
   * настройки. Сорвись запись на полпути при обратном порядке — записи
   * указывали бы на человека, которого в списке уже нет, и стали бы невидимы
   * у всех сразу.
   *
   * Читаем из хранилища, а не из состояния экрана: то же правило, что у
   * отметки приёма — состояние могло не догнать.
   */
  const handleMergePeople = useCallback(async (loser: string, winner: string, dropMeasurements = false) => {
    // Сотни записей меняют владельца и получают свежую отметку правки: на
    // медленном телефоне это заметная пауза, и молчать про неё нельзя.
    setСлияние(true)
    try {
      const [настройки, изм, курсы, анализы] = await Promise.all([
        loadSettings(),
        getAllMeasurements(),
        getAllRegimens(),
        getAllLabs(),
      ])
      const слито = mergePeople(настройки, изм, курсы, анализы, { loser, winner }, { dropMeasurements })
      if (!слито) return
      if (слито.measurements.length > 0) await putMeasurements(слито.measurements)
      // Удаление, а не очистка: `deleteMeasurement` оставляет надгробие, и
      // стёртое не вернётся с другого телефона при следующем обмене.
      for (const id of слито.removed) await deleteMeasurement(id)
      for (const item of слито.regimens) await putRegimen(item)
      // Анализы переносятся здесь же, а не только при удалении человека: до
      // этой правки слияние оставляло их с мёртвым владельцем, и они пропадали
      // с экрана вместе со своими снимками бланков.
      for (const item of слито.labs) await putLab(item)
      updateSettings((prev) => ({ ...prev, ...настройки, ...слито.settings }))
      await refresh()
      await refreshMedicines()
    } finally {
      setСлияние(false)
    }
  }, [])

  const handleReminderTaken = useCallback(
    async (day: number, slot: string, person?: string) => {
      const minutes = parseTime(slot)
      if (minutes === null) return
      // День приводим к местной полуночи заново. Уведомление несёт момент,
      // посчитанный в том поясе, где оно ставилось; после перелёта или перевода
      // часов простое сложение дало бы время из другого дня, и отметка легла бы
      // не на тот приём.
      const planned = startOfDay(day) + minutes * 60_000
      const now = Date.now()

      // Аптечка читается из хранилища, а не берётся из состояния экрана.
      //
      // Это не перестраховка. Нажатие «Принял» на заблокированном экране
      // запускает приложение с нуля, и система отдаёт удержанное событие
      // раньше, чем успевает прочитаться база: в состоянии в этот момент
      // пустой список, цикл не делает ни одного оборота, отметка не ставится,
      // а следом приходят три повтора «приём не отмечен». То есть главный
      // сценарий, ради которого кнопка и делалась, молча не работал.
      const [коробки, курсы] = await Promise.all([getAllMedicines(), getAllRegimens()])
      const cabinet = dosings(коробки, курсы)

      // Уведомление теперь на человека: отмечаем только его таблетки. Раньше
      // одно «Принял» ставило отметку каждому, у кого таблетка на это время, —
      // сын отмечал отцовский Метформин, а повторы к отцу не приходили.
      //
      // Люди читаются из хранилища по той же причине, что и аптечка: на
      // холодном старте действие приходит раньше, чем прочитаны настройки, и
      // в состоянии ещё пустой список — фильтр по человеку не нашёл бы никого.
      const настройки = await loadSettings()
      const { people } = настройки
      // Карточку могли показать до объединения людей: она несёт идентификатор,
      // которого больше нет, и без перецепки «Принял» по ней молча не отметил
      // бы ничего.
      person = redirectPerson(person, настройки.mergedPeople) ?? undefined
      // Карточка, поставленная ещё прежней версией, человека не несёт. При
      // одном человеке гадать нечего; при нескольких не отмечать всем разом,
      // а открыть экран приёма — там видно, чью таблетку отмечать.
      if (!person && people.length > 1) {
        setTab('intake')
        return
      }
      /*
       * Коробку накапливаем между отметками, а не берём каждый раз исходную.
       *
       * Одним «Принял» может отметиться несколько курсов — например, когда
       * двое пьют из одной упаковки и их курсы после удаления человека
       * достались одному. Собирая каждую отметку от первоначального снимка,
       * вторая списывала бы остаток от того же числа, что и первая, и одна
       * таблетка оставалась бы неучтённой. Тот же капкан, что на экране приёма.
       */
      const свежие = new Map(коробки.map((m) => [m.id, m]))
      for (const приём of medicinesForReminder(cabinet, people, slot, day, now, person)) {
        const коробка = свежие.get(приём.boxId)
        const курс = курсы.find((r) => r.id === приём.regimenId)
        if (!коробка || !курс) continue
        const соседи = cabinet.filter((п) => п.boxId === коробка.id)
        const { box, regimen } = markTakenAt(коробка, курс, соседи, planned, now)
        await putRegimen(regimen)
        if (box !== коробка) {
          свежие.set(box.id, box)
          await putMedicine(box)
        }
      }
      await refreshMedicines()
      setTab('intake')
    },
    [refreshMedicines],
  )

  /**
   * Коробка вместе с курсом — то, чем оперирует расписание.
   *
   * Считается один раз на отрисовку: экраны спрашивают об этом десятки раз, а
   * складывать два списка в каждом значило бы складывать их по-разному.
   */
  const приёмы = useMemo(() => dosings(medicines, regimens), [medicines, regimens])

  /*
   * Кому напоминать измерить давление. Свой переключатель, а не общий: курс
   * измерений бывает у того, кто таблеток не пьёт вовсе.
   *
   * Через `useMemo` — не ради скорости: без него массив новый на каждую
   * отрисовку, и внести его в зависимости эффекта было бы нельзя. А без этого
   * напоминания об измерении не обновлялись вовсе: у того, кто не принимает
   * лекарств, ни одна зависимость эффекта не менялась ни от нового измерения,
   * ни от правки расписания, ни от самого переключателя.
   */
  const subjects = useMemo(
    () => (settings.measureRemindOn ? measureSubjects(settings, measurements, Date.now()) : []),
    [settings, measurements],
  )

  useReminders({
    // Все курсы, а не только выбранного человека: напоминание жене должно
    // прийти и тогда, когда на экране открыт дневник мужа. Приложение одно на
    // телефоне, и молчать про чужую таблетку оно не вправе.
    medicines: приёмы,
    // Кому напоминать измерить давление. Свой переключатель, а не общий:
    // курс измерений бывает у того, кто таблеток не пьёт вовсе.
    subjects: subjects,
    // Анализы всех, а не только выбранного: телефон один на семью.
    labs,
    regimens,
    enabled: settings.remindersOn,
    people: settings.people,
    sound: settings.reminderSound,
    repeat: settings.remindersRepeat,
    ready,
    onOpen: (day, about) => {
      openedByReminder.current = true
      setReminderDay(startOfDay(day))
      /*
       * Ведём туда, куда позвали.
       *
       * Раньше любое нажатие открывало экран приёма таблеток — и то, что
       * звало измерить давление, и то, что звало сдать анализ. Человек нажимал
       * на «Измерить давление» и попадал в список таблеток.
       *
       * Род `undefined` — карточка из сборки, где его ещё не было: такие
       * ведём как приём, это прежнее поведение.
       */
      setTab(about === 'measure' ? 'bp' : about === 'lab' ? 'labs' : 'intake')
    },
    // Третий аргумент — человек. Замыкание из двух параметров совместимо по типу,
    // и TypeScript не заметил бы потерю: проверка сквозной проводки — в тестах
    // `medicinesForReminder`, а не здесь.
    onTaken: (day, slot, person) => {
      openedByReminder.current = true
      setReminderDay(startOfDay(day))
      void handleReminderTaken(day, slot, person)
    },
  })

  /**
   * Кого показываем и какой памятью прибора он пользуется.
   *
   * Память — свойство человека, а не он сам: тонометр помнит двоих, а людей в
   * дневнике может быть больше. У кого памяти нет, у того дневник давления
   * пустой, и это нормальное состояние — лекарства и приём у него работают как
   * у всех.
   */
  const person = useMemo(() => activePersonOf(settings), [settings])
  const deviceUser = deviceUserOf(person)

  /**
   * Цели — человека, а не дневника.
   *
   * Отчёт для врача уходит из приложения на бумаге, и считать в нём проценты
   * по чужой норме нельзя: у жены может быть 130/80 там, где у мужа 140/90.
   * У кого личных цифр нет, берутся общие — как было до этой версии.
   */
  const targets = useMemo(() => targetsOf(person, settings), [person, settings])
  const glucoseTargets: GlucoseTargets = useMemo(() => glucoseTargetsOf(person, settings), [person, settings])

  /**
   * Курсы приёма выбранного человека.
   *
   * Отбор живёт в ядре и на «человека нет» отвечает пустым списком — см.
   * `intakesOfPerson`. Здесь он стоял встроенным и отдавал в этом случае курсы
   * всех, то есть чужие приёмы под своим именем.
   */
  const myIntakes = useMemo(() => intakesOfPerson(приёмы, person?.id ?? null), [приёмы, person])

  /** Анализы выбранного человека. Пока человек один — все. */
  const myLabs = useMemo(() => labsOf(labs, person?.id ?? null), [labs, person])

  /** Аптечка дома целиком: коробка с 0.27.0 ничья, её курсы — рядом. */
  const stock = useMemo(() => stockOf(medicines, приёмы), [medicines, приёмы])

  /**
   * Тревоги аптечки — по коробкам, которые касаются этого человека.
   *
   * Это его курсы и коробки, которые не принимает никто: просроченная пачка в
   * общем шкафу — дело каждого, а чужой кончающийся препарат — нет. Точка на
   * вкладке и баннер горят у того, кто открыт; считать их по всему дому
   * значило звать человека разобраться с чужим лекарством, а своё при этом
   * молчало бы.
   */
  const myStock = useMemo(
    () =>
      person
        ? stock.filter((s) => s.intakes.length === 0 || s.intakes.some((п) => п.person === person.id))
        : stock,
    [stock, person],
  )
  const medicineAlerts = useMemo(() => countAlerts(myStock, Date.now()), [myStock])

  /**
   * Пометки на вкладках указывают туда, где дело, и только по своим записям.
   *
   * Раньше одна пометка на «Приёме» зажигалась и от неотмеченного приёма, и от
   * кончающегося препарата. Человек шёл на «Приём» из-за амлодипина, а про
   * амлодипин там ничего нет — про него на «Аптечке». А считались обе по всей
   * семье: точка горела у жены из-за отцовской таблетки.
   */
  const intakeMark = useMemo(
    () => pendingToday(myIntakes.filter((п) => !п.autoDeduct), Date.now()) > 0,
    [myIntakes],
  )
  const cabinetMark = medicineAlerts > 0

  /**
   * Записи выбранного человека.
   *
   * У записей, сделанных с 0.8.0, есть человек — они принадлежат ему, даже
   * если кнопку прибора потом переназначили. У прежних поля нет, и они
   * по-прежнему следуют за кнопкой: так же, как до этой версии.
   */
  const mine = useMemo(
    () =>
      measurements.filter((m) =>
        m.person ? m.person === person?.id : deviceUser !== null && m.user === deviceUser,
      ),
    [measurements, deviceUser, person],
  )
  const bpAll = useMemo(() => mine.filter(isBp), [mine])
  const glucoseAll = useMemo(() => mine.filter(isGlucose), [mine])

  const bpScoped = useMemo(() => filterByPeriod(bpAll, period), [bpAll, period])
  const glucoseScoped = useMemo(() => filterByPeriod(glucoseAll, period), [glucoseAll, period])

  const summary = useMemo(
    () => summarize(bpScoped, targets.sys, targets.dia),
    [bpScoped, targets],
  )
  const glucoseSummary = useMemo(() => summarizeGlucose(glucoseScoped, glucoseTargets), [glucoseScoped, glucoseTargets])

  const latestBp = bpAll.length ? bpAll[bpAll.length - 1] : null
  const showGlucose = (settings.trackGlucose || glucoseAll.length > 0) && settings.sections.glucose

  /**
   * Видимые разделы нижней строки.
   *
   * Состав меняется только прямым действием в настройках — исчезающие и
   * появляющиеся вкладки сбивают с толку сильнее, чем лишний пункт. Скрыть
   * можно любой раздел, включая обзор: он собран из сводок давления и сахара и
   * при выключенных дневниках пуст.
   *
   * Пустым список стать не должен — настройки не отдают последний раздел. Но
   * файл резервной копии приходит снаружи, и если в нём выключено всё, лучше
   * показать обзор, чем приложение без единой вкладки.
   */
  const shownTabs = TABS.filter((item) =>
    item.section === 'glucose' ? showGlucose : settings.sections[item.section],
  )
  const visibleTabs = shownTabs.length > 0 ? shownTabs : TABS.filter((item) => item.key === 'overview')

  /**
   * Если раздел спрятали прямо из-под ног, уходим на первый оставшийся.
   *
   * Без этого человек остаётся на экране, которого больше нет в навигации:
   * содержимое видно, а вернуться некуда — ни одна вкладка не подсвечена.
   * То же при стартовом экране, указывающем на скрытый раздел.
   */
  // Скрытые инструменты (памятка) тоже существуют, хоть кнопки в шапке у них
  // и нет: без этой проверки открытие памятки сбрасывало человека на «Обзор».
  const tabExists =
    visibleTabs.some((item) => item.key === tab) ||
    TOOLS.some((item) => item.key === tab) ||
    (СКРЫТЫЕ_ИНСТРУМЕНТЫ as readonly string[]).includes(tab)
  const fallbackTab = visibleTabs[0].key
  useEffect(() => {
    if (!tabExists) setStack(rootStack(fallbackTab))
  }, [tabExists, fallbackTab])

  /**
   * День из напоминания живёт ровно один заход на «Приём».
   *
   * Раньше он не сбрасывался никогда: нажав на вечернее уведомление о вчерашнем
   * приёме, человек попадал во вчера — и попадал туда снова каждый раз, когда
   * возвращался на «Приём» с другой вкладки. Экран инициализируется этим днём
   * при монтировании, а переход между вкладками его размонтирует.
   */
  const наПриёме = tab === 'intake'
  useEffect(() => {
    if (!наПриёме && reminderDay !== null) {
      setReminderDay(null)
      openedByReminder.current = false
    }
  }, [наПриёме, reminderDay])

  // Коробка могла исчезнуть, пока человек был в её карточке: восстановление из
  // копии применяет чужие удаления. Оставить его на экране пустой карточки
  // нельзя, а показывать «препарат не найден» незачем — возвращаем к списку.
  const идентификаторыКоробок = medicines.map((item) => item.id).join(',')
  useEffect(() => {
    setStack((текущий) => {
      const есть = new Set(идентификаторыКоробок ? идентификаторыКоробок.split(',') : [])
      return prune(текущий, (node) =>
        node.kind === 'card' ? есть.has(node.id) : node.kind === 'form' ? node.id === null || есть.has(node.id) : true,
      )
    })
  }, [идентификаторыКоробок])
  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? ''
  // Имя пациента в отчёте — имя человека, а не подпись кнопки на приборе.
  // «Я» именем в документе не считается: в отчёте, который несут врачу, это
  // выглядит так, будто дневник вели не глядя. Отчёт попросит вписать имя.
  const patientName = person?.name?.trim() || 'Пользователь'

  // Знакомство — до всего остального, но только на пустом дневнике: тому, кто
  // обновился с записями, знакомиться не с чем, и показывать ему анкету значит
  // спрашивать о том, что он уже решил.
  if (ready && !settings.onboarded && measurements.length === 0 && medicines.length === 0) {
    return (
      <Onboarding
        settings={settings}
        onApply={(patch) => {
          updateSettings((prev) => ({ ...prev, ...patch }))
          // Знакомство кончилось — стек начинается заново, с выбранного
          // раздела. Иначе шаг знакомства остался бы под приложением, и первое
          // нажатие «Назад» уходило бы в пустоту.
          setStack(rootStack(toTab(patch.startTab, TABS.map((item) => item.key)) ?? tabOf(stackRef.current)))
        }}
        шаг={шагЗнакомства}
        onШаг={(next) => (next === 1 ? назад() : открыть({ kind: 'step', step: next }))}
      />
    )
  }

  if (storageFailed) {
    return (
      <div className="app">
        <header className="topbar">
          <div className="topbar__title">
            <h1>Дневник здоровья</h1>
          </div>
        </header>
        <div className="card">
          <div className="card__head">
            <h2>Не удалось открыть хранилище</h2>
          </div>
          <p style={{ margin: '0 0 var(--space-4)' }}>
            Браузер не отдал сохранённые записи. Чаще всего это значит, что дневник открыт ещё в одной вкладке и она
            держит базу — закройте лишние вкладки и попробуйте снова.
          </p>
          <p className="muted" style={{ margin: '0 0 var(--space-4)' }}>
            Записи при этом никуда не делись. Если повторится и после перезапуска браузера — восстановите дневник из
            резервной копии: приложение читает её обычным файлом.
          </p>
          <button className="btn btn--primary" onClick={() => window.location.reload()}>
            Попробовать снова
          </button>
        </div>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="app">
        <header className="topbar">
          <div className="topbar__title">
            <h1>Дневник здоровья</h1>
          </div>
        </header>
        {/* Полоса, а не одно слово: на телефоне отца дневник открывается не
            мгновенно, и статичное «Загрузка…» неотличимо от зависшего экрана. */}
        <Working label="Открываю дневник…" />
      </div>
    )
  }

  /**
   * Отказ хранилища при записи — на весь экран, поверх любой вкладки.
   *
   * Показывается везде, а не только там, где нажали: человек мог нажать
   * «Принял» и уйти на другую вкладку, а приём при этом не сохранился.
   */
  const saveBanner = (
    <Reveal open={saveFailed !== null}>
      <div className="no-print" style={{ paddingBottom: 'var(--space-3)' }}>
        <Banner tone="critical">
          <b>Последнее изменение не сохранилось</b>
          <div style={{ marginTop: 4 }}>
            Телефон отказал в записи. Чаще всего это нехватка места. Освободите место и повторите — до этого дневник
            показывает старые данные.
          </div>
          <button className="btn btn--sm" style={{ marginTop: 'var(--space-3)' }} onClick={() => setSaveFailed(null)}>
            Понятно
          </button>
        </Banner>
      </div>
    </Reveal>
  )

  const undoBanner = (
    <Reveal open={undo !== null}>
      <div className="no-print" style={{ paddingBottom: 'var(--space-3)' }}>
        <Banner tone="info">
          <div className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
            <span>Запись удалена.</span>
            <button className="btn" onClick={handleUndo}>
              Вернуть
            </button>
          </div>
        </Banner>
      </div>
    </Reveal>
  )

  return (
    // `data-nav` — путь по стеку экранов («settings/backup»). Нужен проверкам:
    // судить о том, куда попал человек, по тексту экрана нельзя — свёрнутое
    // содержимое остаётся в разметке.
    <div className="app" data-nav={pathOf(stack)}>
      <header className="topbar">
        <div className="topbar__title">
          <h1>Дневник здоровья</h1>
          <span className="topbar__sub">давление, сахар и лекарства</span>
        </div>

        {/* Прибор, отчёт и настройки — редкие разделы. В нижней строке они
            вытеснили бы ежедневные, а прятать ежедневное нельзя.

            Значок и подпись вместе, а не то или другое. Значок опознаётся
            быстрее и делает кнопку кнопкой — без него три слова в ряд читались
            как строка текста. Подпись обязательна: шестерёнку узнают не все, а
            бургер спрятал бы три пункта ради места, которого хватает. */}
        <nav className="tools no-print" aria-label="Служебные разделы" data-tour="tools">
          {TOOLS.map((item) => (
            <button
              key={item.key}
              className="tool"
              data-tour={item.tour}
              aria-current={tab === item.key ? 'page' : undefined}
              onClick={() => setTab(item.key)}
            >
              <item.Icon />
              <span>{item.label}</span>
              {item.key === 'settings' && settingsMark && <span className="tab__mark" aria-hidden="true" />}
            </button>
          ))}
        </nav>
      </header>

      {/* Между шапкой и вкладками: смена человека меняет всё, что ниже, и
          выглядеть частью одного экрана она не должна. Появляется, только
          когда людей больше одного. */}
      <Working label={занятость} />

      {/* В настройках полосы нет: всё личное живёт внутри «Людей», и
          переключатель здесь только сбивал бы с толку — он не меняет ничего из
          того, что видно на экране. */}
      {/* Кнопки «Все» в аптечке больше нет: с 0.27.0 аптечка и так общая на
          дом. Полоса людей остаётся ради приёма, давления и отчёта — они
          общими быть не могут. */}
      {tab !== 'settings' && (
        <PersonSwitch
          settings={settings}
          onChange={(fields) => updateSettings((prev) => ({ ...prev, ...fields }))}
        />
      )}

      <nav
        className="tabs"
        aria-label="Разделы дневника"
        data-tour="tabs"
        style={{ ['--tab-count' as string]: visibleTabs.length }}
      >
        {visibleTabs.map((item) => (
          <button
            key={item.key}
            className="tab"
            aria-current={tab === item.key ? 'page' : undefined}
            aria-label={item.label}
            onClick={() => {
              // Повторное нажатие по своей же вкладке возвращает раздел в
              // начало: из карточки препарата — к списку, из формы — назад. Так
              // ведут себя нижние панели в iOS и Android, и человек, зашедший
              // вглубь, жмёт именно сюда. Без этого вкладка подсвечена, а экран
              // всё тот же, и выход приходится искать.
              //
              // Когда человек уже на корне своей вкладки, навигации не
              // происходит — экрану уходит сигнал вернуться к сегодняшнему дню.
              const { stack: следующий, toRoot } = tapTab(stackRef.current, item.key)
              setStack(следующий)
              if (toRoot) setRootSignal((value) => value + 1)
            }}
          >
            <span className="tab__full">{item.label}</span>
            <span className="tab__short">{item.short}</span>
            {((item.key === 'intake' && intakeMark) || (item.key === 'cabinet' && cabinetMark)) && (
              <span className="tab__mark" aria-hidden="true" />
            )}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className="stack">
          <LatestAlert latest={latestBp} />

          {/* Приглашение пройти курс. Один раз и только здесь: на «Обзоре»
              человек оказывается первым делом, а закрыв приглашение, найдёт
              курс в настройках. */}
          {!settings.guideOffered && (
            <div className="card">
              <div className="card__head">
                <h2>Показать, как всё устроено?</h2>
              </div>
              <p className="muted">
                Приложение само откроет нужный раздел и обведёт кнопку, о которой рассказывает. Меньше минуты.
                Откажетесь — курс останется в настройках, в «Как пользоваться».
              </p>
              <div className="row row--stack">
                <button
                  className="btn btn--primary"
                  onClick={() => {
                    updateSettings((prev) => ({ ...prev, guideOffered: true }))
                    setКурс('basics')
                  }}
                >
                  Показать
                </button>
                {/* Не «Не сейчас»: карточка больше не появится никогда, а
                    «не сейчас» обещает, что предложение вернётся. */}
                <button
                  className="btn"
                  onClick={() => updateSettings((prev) => ({ ...prev, guideOffered: true }))}
                >
                  Больше не предлагать
                </button>
              </div>
            </div>
          )}

          {/* Сначала то, что не зависит от давления: приём на сегодня, что
              кончается, что купить, копия. Раньше всё это стояло внутри
              условия «есть измерения», и человек, который ведёт только
              аптечку, видел пустой экран с советом открыть тонометр. */}
          <TodayCard medicines={myIntakes} personId={person?.id ?? null} onOpen={() => setTab('intake')} />

          <ShortageCard stock={myStock} onOpen={() => setTab('cabinet')} onPick={открытьКоробку} />

          <Restock stock={myStock} pharmacies={settings.pharmacies ?? []} onPick={открытьКоробку} />

          {/* Молчание своих. Только когда обмен настроен и людей больше одного:
              без обмена чужих записей взяться неоткуда, и блок говорил бы о
              пустоте, которая пустотой и должна быть. */}
          <UpdateNudge состояние={обновление} />

          <SilenceCard
            people={settings.people}
            measurements={measurements}
            medicines={regimens}
            activePerson={settings.activePerson}
            enabled={family.sources.length > 0 || family.cloud.connected}
            onPick={(id) => updateSettings((prev) => ({ ...prev, activePerson: id }))}
          />

          {/* Напоминания выключены, а расписание уже задано.
              Выключены они по умолчанию намеренно: приложение не вправе само
              начать звонить человеку. Но и молчать нельзя — знакомство обещает
              «расписание приёма, напоминания», форма препарата пишет
              «напоминания не перестанут приходить», а строка в настройках
              четвёртая сверху, и до неё не доходят. Предлагаем ровно тогда,
              когда человек уже показал, что ему это нужно: часы приёма
              заданы. */}
          {!nudgeHidden.reminders &&
            !settings.remindersOn &&
            platform().reminders.isSupported() &&
            regimens.some((r) => (r.times ?? []).length > 0) && (
              <Banner tone="info">
                <b>Напоминать о приёме?</b>
                <div style={{ marginTop: 4 }}>
                  Часы приёма заданы, но напоминания выключены — телефон о таблетках не напомнит.
                </div>
                <div className="row" style={{ marginTop: 'var(--space-3)' }}>
                  <button
                    className="btn btn--primary btn--sm"
                    onClick={() => updateSettings((prev) => ({ ...prev, remindersOn: true }))}
                  >
                    Включить напоминания
                  </button>
                  <button className="btn btn--sm" onClick={() => snoozeNudge('reminders')}>
                    Скрыть на неделю
                  </button>
                </div>
              </Banner>
            )}

          {!nudgeHidden.backup && (
            <BackupNudge
              status={backup}
              // Открываем сразу «Копию дневника»: баннер говорит про копию, и
              // высаживать человека в корень настроек значит заставлять искать
              // то, о чём его только что спросили.
              onOpenSettings={() =>
                setStack([
                  ...rootStack(tabOf(stackRef.current)),
                  { kind: 'sub', sub: 'settings' },
                  { kind: 'sub', sub: 'backup' },
                ])
              }
              onDismiss={() => snoozeNudge('backup')}
            />
          )}

          {/* Анализы живут своим экраном: в шапке четыре кнопки, внизу пять

              вкладок, и шестой строке места нет. Вход стоит до всякой ветки:

              он оказался внутри «есть хоть одно измерение», и у того, кто ещё

              ничего не мерил, раздела не было вовсе — при том что напоминания

              сдать анализ ему приходили. */}

          <div className="card">

            <ul className="pills">

              <NavRow

                title="Анализы"

                value={описатьАнализы(myLabs, regimens, минута)}

                onOpen={() => setTab('labs')}

              />

            </ul>

          </div>


          {bpAll.length + glucoseAll.length === 0 ? (
            <div className="card">
              <div className="card__head">
                <h2>Измерений пока нет</h2>
              </div>
              {/* Кнопки, а не описание маршрута: человек нажимает, а не ищет. */}
              <div className="row row--stack">
                {deviceUser !== null && (
                  <button className="btn btn--primary" onClick={() => setTab('sync')}>
                    Выгрузить с прибора
                  </button>
                )}
                <button className={deviceUser !== null ? 'btn' : 'btn btn--primary'} onClick={() => setTab('bp')}>
                  Записать давление
                </button>
              </div>
            </div>
          ) : (
            <>
              {(summary || glucoseSummary) && (
                <div className="row no-print">
                  <PeriodPicker value={period} onChange={setPeriod} />
                </div>
              )}

              {summary && (
                <>
                  <SummaryTiles summary={summary} targetSys={targets.sys} targetDia={targets.dia} />

                  <div className="card">
                    <div className="card__head">
                      <h2>Динамика давления</h2>
                      <span className="muted">точки — измерения, линия — среднее за 7 дней</span>
                    </div>
                    <TrendChart readings={bpScoped} targetSys={targets.sys} targetDia={targets.dia} />
                  </div>

                  <div className="grid grid--two">
                    <div className="card">
                      <div className="card__head">
                        <h2>По времени суток</h2>
                      </div>
                      <DayPartChart readings={bpScoped} />
                    </div>
                    <div className="card">
                      <div className="card__head">
                        <h2>Пульс</h2>
                        <span className="muted">ударов в минуту</span>
                      </div>
                      <PulseChart readings={bpScoped} />
                    </div>
                  </div>
                </>
              )}

              {glucoseSummary && (
                <>
                  <GlucoseTiles summary={glucoseSummary} targets={glucoseTargets} />
                  <div className="card">
                    <div className="card__head">
                      <h2>Динамика сахара</h2>
                      <span className="muted">ммоль/л, линия — среднее за 7 дней</span>
                    </div>
                    <GlucoseChart readings={glucoseScoped} targets={glucoseTargets} />
                  </div>
                </>
              )}

              {!summary && !glucoseSummary && (
                <div className="card">
                  <div className="card__head">
                    <h2>За этот период записей нет</h2>
                  </div>
                  <div className="row">
                    <button className="btn" onClick={() => setPeriod('all')}>
                      Показать всё время
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'bp' && (
        <div className="stack">
          {/* Форма записи показывается всем.
              Кнопок у тонометра две, а людей в семье сколько угодно: раньше
              жена и дети видели вместо формы баннер «записывать давление здесь
              пока некуда» и кнопку «Назначить кнопку прибора», которая вела в
              тупик — свободных кнопок не было. Записать 120/80 с клавиатуры
              тонометр не нужен. */}
          <Entry user={deviceUser} onAdd={handleAdd} />
          {deviceUser === null && (
            <Banner tone="info">
              <b>Выгрузка с прибора этому человеку недоступна.</b>
              <div style={{ marginTop: 4 }}>
                Тонометр помнит двоих, и обе кнопки заняты. Записывать давление руками это не мешает.
              </div>
              <div className="row" style={{ marginTop: 'var(--space-3)' }}>
                <button className="btn btn--sm" onClick={кНастройкамЧеловека}>
                  Кому назначены кнопки
                </button>
              </div>
            </Banner>
          )}
          {undoBanner}
          <div className="card">
            <div className="card__head">
              <h2>История давления</h2>
              <span className="muted">
                {bpScoped.length} из {bpAll.length}
              </span>
            </div>
            <div className="row no-print" style={{ marginBottom: 'var(--space-3)' }} data-tour="bp-period">
              <PeriodPicker value={period} onChange={setPeriod} />
            </div>
            <Readings readings={bpScoped} onDelete={handleDelete} onUpdate={handleUpdate} />
          </div>

          {/* Курс от врача — сразу под историей: человек приходит сюда от
              врача с назначением «две недели утром и вечером». */}
          <Course
            plan={measurePlanOf(person, settings)}
            readings={bpAll.map((r) => r.ts)}
            onChange={(next) =>
              updateSettings((prev) => ({
                ...prev,
                ...setMeasurePlan(prev, prev.people.length > 1 ? prev.activePerson : null, next),
              }))
            }
          />

          {/* «Стало ли лучше» — вопрос, ради которого дневник и ведут.
              Стоит под историей, а не над ней: сначала то, что человек пришёл
              записать или посмотреть, и только потом размышления. */}
          <Compare readings={bpAll} medicines={myIntakes} />
        </div>
      )}

      {tab === 'glucose' && (
        <div className="stack">
          {/* Запись сахара кнопки на тонометре не требует и не требовала:
              глюкометр к ней отношения не имеет вовсе. Форма показывается
              всем — как и на «Давлении». */}
          <GlucoseEntry user={deviceUser} targets={glucoseTargets} onAdd={handleAdd} />
          {undoBanner}
          <div className="card">
            <div className="card__head">
              <h2>История сахара</h2>
              <span className="muted">
                {glucoseScoped.length} из {glucoseAll.length}
              </span>
            </div>
            <div className="row no-print" style={{ marginBottom: 'var(--space-3)' }}>
              <PeriodPicker value={period} onChange={setPeriod} />
            </div>
            <GlucoseList
              readings={glucoseScoped}
              targets={glucoseTargets}
              onDelete={handleDelete}
              onUpdate={handleUpdate}
            />
          </div>
        </div>
      )}

      {saveBanner}

      {tab === 'intake' && (
        <>
          <Intake
            medicines={myIntakes}
            onMark={handleMarkTaken}
            toRoot={rootSignal}
            openDay={reminderDay}
            имя={settings.people.length > 1 ? (person?.name.trim() ?? null) : null}
          />
          {/* Запасная дверь в анализы — только когда «Обзор» спрятан.
              Единственный вход в анализы живёт на «Обзоре», а его можно
              выключить в настройках: раздел оставался без двери, при том что
              напоминания сдать анализ продолжали приходить. «Приём» выбран не
              случайно — это второй экран про обязательства по дням. */}
          {!settings.sections.overview && (
            <div className="card">
              <ul className="pills">
                <NavRow
                  title="Анализы"
                  value={описатьАнализы(myLabs, regimens, минута)}
                  onOpen={() => setTab('labs')}
                />
              </ul>
            </div>
          )}
        </>
      )}

      {tab === 'cabinet' && (
        <>
          {undoBanner}
          <Cabinet
            stock={stock}
            regimens={regimens}
            intakeSlots={intakeSlotsOf(person, settings)}
            people={settings.people}
            activePerson={person?.id ?? ''}
            onSave={handleSaveMedicine}
            onDelete={handleDeleteMedicine}
            onStopRegimen={handleDeleteRegimen}
            pharmacies={settings.pharmacies ?? []}
            card={открытаяКоробка}
            form={открытаяФорма}
            onOpenCard={(id, edit) => открыть({ kind: 'card', id, edit })}
            onEditCard={(id) => открыть({ kind: 'form', id })}
            onAdd={() => открыть({ kind: 'form', id: null })}
            onMemo={() => setTab('memo')}
            onBack={назад}
          />
        </>
      )}

      {tab === 'sync' && (
        <Sync
          pairingKey={settings.pairingKey}
          people={settings.people}
          person={person}
          onPairingKey={(next) => updateSettings((prev) => ({ ...prev, pairingKey: next }))}
          onImport={handleImport}
          onImportGlucose={handleImport}
          onGoManual={() => setTab('bp')}
          showGlucose={showGlucose}
        />
      )}

      {/* Справка из шапки — тот же список курсов, что в настройках. Экран один
          и компонент один: разойтись двум спискам помощи было бы делом времени. */}
      {tab === 'guide' && (
        <GuideScreen settings={settings} onStartTour={setКурс} onBack={назад} />
      )}

      {tab === 'memo' && (
        <Memo
          medicines={myIntakes}
          slots={intakeSlotsOf(person, settings)}
          person={settings.people.length > 1 ? (person?.name?.trim() ?? null) : null}
          onBack={назад}
        />
      )}

      {tab === 'labs' && (
        <Labs
          labs={labs}
          regimens={regimens}
          person={person?.id ?? ''}
          personName={settings.people.length > 1 ? (person?.name?.trim() ?? null) : null}
          now={минута}
          onSave={handleSaveLab}
          onDelete={handleDeleteLab}
          onAddPhoto={handleAddPhoto}
          onDeletePhoto={handleDeletePhoto}
          onBack={назад}
        />
      )}

      {tab === 'report' && (
        <Report
          readings={bpScoped}
          summary={summary}
          glucoseReadings={glucoseScoped}
          glucoseSummary={glucoseSummary}
          glucoseTargets={glucoseTargets}
          patient={patientName}
          onFixName={кНастройкамЧеловека}
          periodLabel={periodLabel}
          targetSys={targets.sys}
          targetDia={targets.dia}
          period={period}
          medicines={myIntakes}
          labs={myLabs}
          measurePlan={measurePlanOf(person, settings)}
          onPeriodChange={setPeriod}
        />
      )}

      {tab === 'settings' && (
        <Settings
          settings={settings}
          onChange={updateSettings}
          regimens={regimens}
          update={обновление}
          labs={labs}
          intakes={приёмы}
          measurements={measurements}
          onRestore={handleRestore}
          onClearAll={handleClearAll}
          family={family}
          screen={подэкранНастроек}
          person={открытыйЧеловек}
          onStartTour={setКурс}
          onMerge={handleMergePeople}
          onDeletePerson={handleDeletePerson}
          onOpen={(next) => открыть({ kind: 'sub', sub: next })}
          onOpenPerson={(id) => открыть({ kind: 'person', id })}
          onBack={назад}
          backup={backup}
        />
      )}

      {/* Курс лежит поверх всего приложения и сам переключает разделы: он
          объясняет настоящие кнопки, а не картинки с ними. */}
      {идущийКурс && (
        <Tour tour={идущийКурс} onTab={(next) => setTab(next as TabKey)} onClose={() => setКурс(null)} />
      )}
    </div>
  )
}
