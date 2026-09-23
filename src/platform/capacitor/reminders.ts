/**
 * Напоминания о приёме через системные уведомления Android.
 *
 * Три вещи, которые здесь не очевидны и стоили бы отладки на живом телефоне.
 *
 * **Звук принадлежит каналу, а не уведомлению.** С Android 8 мелодию и
 * громкость задаёт канал уведомлений, и после создания канала сменить его звук
 * из приложения нельзя — система запоминает настройку за человеком. Поэтому под
 * каждую мелодию заводится свой канал, а выбор мелодии означает «ставить
 * напоминания в другой канал». Неиспользуемые каналы удаляются, чтобы в
 * настройках телефона не копилась свалка.
 *
 * **Время неточное — и это осознанно.** Точные будильники на Android 12+
 * требуют отдельного разрешения, а `USE_EXACT_ALARM` разрешён только
 * будильникам и календарям. Напоминание о таблетке в окне в несколько минут
 * задачу решает; выпрашивать у человека особое разрешение ради этих минут —
 * нет.
 *
 * **Уведомления переживают перезагрузку** — приёмник в манифесте плагина
 * восстанавливает расписание. Проверять это надо именно перезагрузкой: без
 * приёмника всё выглядит рабочим ровно до первого выключения телефона.
 */

import { LocalNotifications } from '@capacitor/local-notifications'
import { registerPlugin } from '@capacitor/core'
import type {
  Reminder,
  ReminderAction,
  ReminderHealth,
  ReminderPermission,
  ReminderSound,
  RemindersPort,
} from '../ports'

/** Свой нативный плагин: переходы на системные экраны. */
interface SystemSettingsPlugin {
  openChannel(options: { channelId: string }): Promise<{ opened: boolean }>
  openAppNotifications(): Promise<{ opened: boolean }>
  openAppDetails(): Promise<{ opened: boolean }>
  isBatteryRestricted(): Promise<{ restricted: boolean | null }>
  isDoNotDisturbOn(): Promise<{ on: boolean | null }>
  createMedsChannel(options: { id: string; sound?: string }): Promise<{ bypassDnd: boolean }>
  canBypassDoNotDisturb(): Promise<{ allowed: boolean }>
  openDoNotDisturbAccess(): Promise<{ opened: boolean }>
  openBatteryOptimization(): Promise<{ opened: boolean }>
}

const SystemSettings = registerPlugin<SystemSettingsPlugin>('SystemSettings')

/**
 * Мелодии. `id` — имя файла в `android/app/src/main/res/raw/`, собирается
 * генератором `tools/sounds.py`; менять список надо в обоих местах разом.
 */
const SOUNDS: ReminderSound[] = [
  { id: 'system', name: 'Как у телефона', hint: 'обычный звук уведомления' },
  { id: 'myagkiy', name: 'Мягкий', hint: 'два негромких удара' },
  { id: 'kolokolchik', name: 'Колокольчик', hint: 'слышно даже вполуха' },
  { id: 'pereliv', name: 'Перелив', hint: 'длиннее и ниже — если высокие звуки плохо слышны' },
]

/**
 * Версия в имени канала. Настройки канала система хранит за человеком, и
 * изменения в коде на уже созданный канал не действуют — новый вид канала
 * требует нового имени.
 */
const CHANNEL_PREFIX = 'omron-meds-v2-'

/**
 * Кнопки прямо в уведомлении — главный выигрыш всей затеи.
 *
 * «Принял» с заблокированного экрана это одно касание, а не «разблокировать,
 * найти приложение, найти препарат, нажать». Оговорка: приложение при этом
 * всё равно запускается — у Capacitor нет фонового обработчика для локальных
 * уведомлений, и обойти это можно только своим нативным приёмником.
 */
const ACTION_TYPE = 'omron-dose'
const SNOOZE_MIN = 15

/**
 * Потолок Android на число ожидающих будильников одного приложения.
 *
 * Ровно пятьсот, и это не «лишние отбрасываются», как считалось раньше: на
 * пятьсот первом системный сервис бросает `IllegalStateException`, плагин
 * отдаёт его в свой нативный поток, и приложение закрывается. Поймать нечем —
 * можно только не подходить к границе. Держим запас: отложенные напоминания и
 * пробное тоже занимают места.
 */
const ALARM_CAP = 470
/** Сколько мест считаем занятыми, когда пересчитать их не удалось. */
const ALARM_HEADROOM = 120

/**
 * Отложенные напоминания живут в своём диапазоне идентификаторов и **не
 * снимаются** пересборкой набора.
 *
 * Иначе выходило так: человек нажал «Отложить», приложение от этого нажатия
 * запустилось, пересобрало набор — и первым делом сняло всё ожидающее, включая
 * только что отложенное. Просьба «напомни через пятнадцать минут» исчезала в
 * ту же секунду, в которую была высказана.
 */
/*
 * Граница обязана лежать выше самого большого идентификатора напоминания, иначе
 * они начнут выдавать себя за отложенные — и перестанут сниматься вовсе.
 *
 * `reminderId` считает так: `((день % 2048) * 8 + человек) * 1024 + приём * 8 +
 * повтор`, то есть не больше (2 047 · 8 + 7) · 1024 + 127 · 8 + 7 = 16 777 215. Прежняя граница в 900 000
 * этот потолок не покрывала: номер дня растёт на единицу в сутки, и примерно
 * через двадцать один месяц идентификаторы перевалили бы за неё. С этого дня
 * `cancelAll` и уборка лишнего молча пропускали бы каждое напоминание, а в
 * шторке копились бы приёмы за давно прошедшие дни.
 *
 * Найдено на живом телефоне при разборе застрявших уведомлений.
 */
/**
 * Отложенные считаются от `SNOOZE_BASE`, а не от потолка приёмных номеров.
 *
 * Прежде было `SNOOZE_BASE + id % (REMINDER_ID_MAX + 1)`. На приёмных номерах
 * это то же самое число, но у измерений номера выше 2²⁴, и остаток давал бы
 * чужой отложенный: измерение 17 000 000 и приём 222 784 получили бы один и тот
 * же, и второе стёрло бы первое. Заодно чинится и старое: повторное «Отложить»
 * на уже отложенном раньше уезжало на третий номер, теперь остаётся на своём.
 */
const SNOOZE_BASE = 20_000_000
/** Пробное — выше обоих диапазонов: уборка «лишних» смотрит только ниже SNOOZE_BASE. */
const PREVIEW_ID = SNOOZE_BASE * 2 + 1

/**
 * Мелодия, выбранная в последний раз. Нужна отложенному напоминанию: оно
 * создаётся в ответ на нажатие, когда настроек под рукой нет, а прийти обязано
 * тем же звуком, что и остальные — иначе человек его не узнает.
 */
let lastSound = 'system'

let actionsReady: Promise<void> | null = null

function registerActions(): Promise<void> {
  if (!actionsReady) {
    actionsReady = LocalNotifications.registerActionTypes({
      types: [
        {
          id: ACTION_TYPE,
          actions: [
            { id: 'taken', title: 'Принял' },
            { id: 'snooze', title: `Отложить ${SNOOZE_MIN} мин` },
          ],
        },
      ],
    }).catch(() => {
      actionsReady = null
    })
  }
  return actionsReady
}

const channelId = (soundId: string) => CHANNEL_PREFIX + soundId

function toPermission(display: string): ReminderPermission {
  if (display === 'granted') return 'granted'
  if (display === 'denied') return 'denied'
  return 'prompt'
}

/**
 * Создать канал под выбранную мелодию и убрать остальные наши каналы.
 *
 * Удаление не косметика: иначе в системных настройках уведомлений копятся
 * четыре одинаковых по названию канала, и человек правит громкость не у того.
 */
async function ensureChannel(soundId: string, cleanup = true) {
  const wanted = channelId(soundId)
  // Канал создаёт наш нативный код, а не плагин: плагин не умеет `bypassDnd`,
  // а без него в режиме «Не беспокоить» напоминание приходит молча. Там же
  // звук объявляется будильником, а не письмом, — громкость идёт по той шкале,
  // на которую человек и рассчитывает.
  await SystemSettings.createMedsChannel({
    id: wanted,
    ...(soundId === 'system' ? {} : { sound: soundId }),
  })

  // Уборка лишних каналов — только когда мелодию выбрал человек. Из обработчика
  // «Отложить» её звать нельзя: там выбранная мелодия неизвестна, и уборка
  // снесла бы канал вместе с громкостью, которую человек себе выставил.
  if (!cleanup) return

  const { channels } = await LocalNotifications.listChannels()
  for (const channel of channels) {
    if (channel.id.startsWith(CHANNEL_PREFIX) && channel.id !== wanted) {
      await LocalNotifications.deleteChannel({ id: channel.id }).catch(() => undefined)
    }
  }
}

export const capacitorReminders: RemindersPort = {
  isSupported: () => true,

  async permission() {
    const { display } = await LocalNotifications.checkPermissions()
    return toPermission(display)
  },

  async requestPermission() {
    const { display } = await LocalNotifications.requestPermissions()
    return toPermission(display)
  },

  sounds: () => SOUNDS,

  async preview(soundId: string) {
    try {
      // Без уборки каналов и без смены `lastSound`: это только проба звука,
      // выбранной мелодией она не становится.
      await ensureChannel(soundId, false)
      await registerActions()
      await LocalNotifications.schedule({
        notifications: [
          {
            // Свой идентификатор вне обоих рабочих диапазонов: пробное
            // напоминание не должно ни затирать расписание, ни попадать под
            // его пересборку.
            id: PREVIEW_ID,
            title: 'Так будет звучать напоминание',
            body: 'Это проверка звука — принимать ничего не нужно',
            channelId: channelId(soundId),
            isExactNotification: false,
            isExactMandatory: false,
            schedule: { at: new Date(Date.now() + 1500), allowWhileIdle: true },
          },
        ],
      })
      return true
    } catch {
      return false
    }
  },

  async exactTiming() {
    try {
      const { exact_alarm: состояние } = await LocalNotifications.checkExactNotificationSetting()
      return состояние === 'granted'
    } catch {
      return null
    }
  },

  async requestExactTiming() {
    try {
      const { exact_alarm: состояние } = await LocalNotifications.changeExactNotificationSetting()
      return состояние === 'granted'
    } catch {
      return null
    }
  },

  /**
   * Сначала поставить новое, потом снять лишнее — не наоборот.
   *
   * Прежний порядок начинался со снятия всего набора, и между снятием и
   * постановкой в телефоне не было ни одного напоминания. Секунда, но не
   * пустая: приложение в этот момент могут выгрузить, а любая ошибка ниже по
   * ходу оставила бы человека вообще без напоминаний, и молча. Идентификаторы
   * у нас выводятся из дня и приёма, поэтому повторная постановка того же
   * идентификатора просто заменяет прежнее — снимать заранее незачем.
   */
  async schedule(reminders: Reminder[], soundId: string) {
    if (!reminders.length) {
      await this.cancelAll()
      return
    }

    // Убираем из шторки то, что уже показано, но в новом наборе не значится:
    // отмеченный приём иначе оставляет стопку карточек, и человек смотрит на
    // напоминание о том, что он уже сделал.
    try {
      const { notifications: показанные } = await LocalNotifications.getDeliveredNotifications()
      const нужные = new Set(reminders.map((item) => item.id))
      const лишние = показанные.filter((item) => item.id < SNOOZE_BASE && !нужные.has(item.id))
      if (лишние.length) await LocalNotifications.removeDeliveredNotifications({ notifications: лишние })
    } catch {
      // Не смертельно: карточка в шторке переживаема, а падать из-за неё нельзя.
    }

    await ensureChannel(soundId)
    lastSound = soundId
    await registerActions()

    // Точное время — только если человек уже разрешил. Спрашивать отсюда
    // нельзя: плагин уводит в системный экран без объяснений, посреди
    // сохранения настроек. Разрешение просится отдельно, в разделе настроек,
    // где рядом написано зачем.
    const exact = (await this.exactTiming()) === true
    /**
     * Сперва снять лишнее, потом ставить новое. Порядок принципиален.
     *
     * Раньше было наоборот, и в момент постановки в системе жили оба набора
     * сразу. Пока состав не менялся, идентификаторы совпадали и набор просто
     * переписывался поверх. А после обмена с семьёй в дневник приходят чужие
     * препараты, номер человека в идентификаторе сдвигается — и наборы больше
     * не пересекаются: 224 старых плюс 448 новых. Android держит **не больше
     * пятисот** будильников на приложение и на пятьсот первом бросает
     * `IllegalStateException` из системного сервиса. Поймать его нечем: он
     * прилетает в нативном потоке плагина, и приложение просто закрывается.
     * Владелец увидел это как «вылетает при синхронизации».
     */
    /**
     * Порядок здесь выстрадан, и менять его нельзя.
     *
     * Сначала считаем занятое **чужим** — тем, что переживёт уборку и не будет
     * переписано новым набором: отложенные, которые мы не снимаем, и пробное.
     * Это число не зависит от того, что мы решим ставить.
     *
     * Потом режем набор по потолку. И только потом убираем лишнее — сверяясь с
     * **тем, что реально ставим**, а не со всем набором.
     *
     * Прежде уборка сверялась со всем набором, а ставилась урезанная часть, и
     * между ними появлялась третья категория: номера, которые есть в наборе
     * (значит уборка их не снимает), но не попали в постановку (значит не
     * переписываются) и в «занято» не считаются. На следующем проходе они
     * складывались с новыми — и это тот самый путь к пятьсот первому
     * будильнику, от которого лечили в 0.18.3.
     */
    let занято = 0
    let ожидают: { id: number; extra?: unknown }[] = []
    let уборкаУдалась = true
    try {
      ожидают = (await LocalNotifications.getPending()).notifications
      занято = ожидают.filter(({ id }) => id >= SNOOZE_BASE).length
    } catch {
      // Не узнали, что стоит — считаем место занятым под завязку: лучше
      // поставить меньше напоминаний, чем закрыться на постановке.
      занято = ALARM_HEADROOM
      уборкаУдалась = false
    }

    // Последняя защита от потолка. Набор и так обрезан в `planReminders`, но
    // там не видно ни отложенных, ни того, что уборка могла не пройти.
    const ставим =
      reminders.length + занято > ALARM_CAP
        ? [...reminders].sort((a, b) => a.at - b.at).slice(0, Math.max(0, ALARM_CAP - занято))
        : reminders

    if (уборкаУдалась) {
      try {
        const нужные = new Set(ставим.map((item) => item.id))
        // Отложенное живёт в своём диапазоне, но просьба «напомни позже» теряет
        // смысл, когда приём уже отмечен: снимаем те, чьей пары «день + время +
        // человек» в новом наборе нет.
        // Только те приёмы, где человеку есть что отметить: слот, в котором
        // остался лишь автосписываемый препарат, ждать нечего — и отложенное по
        // нему держать незачем.
        // Род в ключе обязателен: у дневника на одного и приём, и измерение
        // стоят на 08:00, а человек у обоих пуст — без рода измерение держало
        // бы живым отложенное по уже отмеченному приёму.
        const живыеПриёмы = new Set(
          ставим
            .filter((item) => item.markable)
            .map((item) => `${item.kind}|${item.day}|${item.slot}|${item.person ?? ''}`),
        )
        const лишние = ожидают.filter(({ id, extra }) => {
          if (id >= PREVIEW_ID) return false
          if (id >= SNOOZE_BASE) {
            const e = (extra ?? {}) as { kind?: string; day?: number; slot?: string; person?: string }
            return (
              e.day !== undefined &&
              e.slot !== undefined &&
              !живыеПриёмы.has(`${e.kind ?? 'dose'}|${e.day}|${e.slot}|${e.person ?? ''}`)
            )
          }
          return !нужные.has(id)
        })
        if (лишние.length) await LocalNotifications.cancel({ notifications: лишние.map(({ id }) => ({ id })) })
      } catch {
        // Отказ уборки — не «лишнее напоминание», а снятая защита: старые
        // будильники остались, а мы собираемся поставить поверх ещё четыре
        // сотни. Ровно так и выглядела авария 0.18.3.
        уборкаУдалась = false
      }
    }

    /*
     * Не убрали старое — не ставим новое.
     *
     * Потолок в 500 будильников считает Android, а не мы: 501-й бросает
     * `IllegalStateException`, который не перехватить, и приложение закрывается
     * у человека на глазах. `ALARM_HEADROOM` ограничивает только то, что мы
     * добавляем, — а в этой ветке неизвестно, сколько уже стоит.
     *
     * Бросаем, а не возвращаемся молча: вызывающий (`useReminders`) не запомнит
     * слепок и попробует снова при следующем открытии. Пропустить один круг
     * дешевле, чем закрыться.
     */
    if (!уборкаУдалась) {
      throw new Error('не удалось снять старые напоминания — новые не ставим, чтобы не упереться в потолок')
    }

    await LocalNotifications.schedule({
      notifications: ставим.map((item) => ({
        id: item.id,
        title: item.title,
        body: item.body,
        // Развёрнутый вид: полный состав приёма с дозировками. Без этого
        // Android обрезает вторую строку многоточием, и второй препарат
        // человек просто не видит.
        largeBody: item.details,
        summaryText: item.title,
        channelId: channelId(soundId),
        // У измерения отмечать нечего: цифры давления в кнопку не помещаются,
        // а «Принял» на нём означало бы совсем другое действие.
        // Кнопки только у того, что человек отмечает. У препарата со списанием
        // по расписанию отмечать нечего: «Принял» ничего не изменит, а
        // «Отложить» снимется первой же пересборкой — отложенное по
        // неотмечаемому приёму уборка считает лишним.
        actionTypeId: item.kind === 'measure' || !item.markable ? undefined : ACTION_TYPE,
        // Приём и сутки едут вместе с уведомлением: по ним приложение поймёт,
        // какую именно отметку ставить, когда человек нажмёт «Принял».
        // Род обязателен. Кнопка «Принял» решает по одному лишь `actionId`, и
        // без рода нажатие на карточке измерения отметило бы приём таблеток:
        // 08:00 у приёма стоит по умолчанию, так что совпадение времён здесь
        // не край, а норма.
        extra: { kind: item.kind, slot: item.slot, day: item.day, step: item.step, person: item.person },
        // Два флага, и оба выяснены на живом телефоне, а не по документации.
        //
        // `isExactNotification` включаем только когда разрешение уже есть.
        // Иначе плагин уводит человека в системный экран «Будильники и
        // напоминания» прямо посреди сохранения настроек, а если разрешение
        // ещё и не объявлено — экрана нет и вызов висит навсегда, не поставив
        // ни одного напоминания. Проверено: именно так и было.
        //
        // `allowWhileIdle: true` — иначе плагин ставит будильник типа RTC,
        // который телефон **не будит**. Напоминание в восемь утра не
        // прозвучало бы, пока телефон спит на тумбочке. С этим флагом идёт
        // пробуждающий будильник, работающий и в режиме глубокого сна.
        isExactNotification: exact,
        // Не обязательное: если разрешение отзовут, напоминания должны
        // остаться — пусть неточные, — а не исчезнуть совсем.
        isExactMandatory: false,
        schedule: { at: new Date(item.at), allowWhileIdle: true },
      })),
    })

  },

  async cancelAll() {
    const { notifications } = await LocalNotifications.getPending()
    /*
     * Здесь снимаем и отложенное — в отличие от пересборки набора.
     *
     * `cancelAll` зовут, когда напоминать стало нечего вовсе: выключили
     * напоминания, кончился курс, убрали последний препарат. Просьба «напомни
     * попозже» относилась к приёму, которого больше нет; оставить её значит
     * позвать принять отменённое через пятнадцать минут — ровно то, против чего
     * заведён конец курса.
     *
     * Пробное напоминание не наше дело — оно живёт своей минутой.
     */
    const наши = notifications.filter(({ id }) => id < PREVIEW_ID)
    if (!наши.length) return
    await LocalNotifications.cancel({ notifications: наши.map(({ id }) => ({ id })) })
  },

  async health(soundId: string): Promise<ReminderHealth> {
    const пусто: ReminderHealth = { scheduled: 0, until: null, channelOff: false }
    try {
      const { notifications } = await LocalNotifications.getPending()
      const сейчас = Date.now()
      /**
       * Только то, что ещё впереди.
       *
       * Плагин ведёт свой список и вычёркивает из него, когда напоминание
       * сработало. Телефон, «усыпивший» приложение, снимает будильники мимо
       * плагина — записи остаются, будильников за ними нет. На Mate 60 Pro
       * список плагина показывал 674 при 356 живых будильниках в системе
       * (`dumpsys alarm`), и цифра успокаивала ровно там, где напоминания
       * как раз и не приходят.
       */
      const наши = notifications.filter(
        (item) =>
          item.id < SNOOZE_BASE &&
          !!item.schedule?.at &&
          new Date(item.schedule.at).getTime() > сейчас,
      )
      const сроки = наши
        .map((item) => (item.schedule?.at ? new Date(item.schedule.at).getTime() : null))
        .filter((value): value is number => value !== null)

      // Канал, выключенный человеком в шторке, обнуляет важность. Приложение
      // об этом узнать иначе не может и продолжало бы уверять, что всё в
      // порядке, пока напоминания молчат.
      const { channels } = await LocalNotifications.listChannels()
      const наш = channels.find((item) => item.id === channelId(soundId))

      return {
        scheduled: наши.length,
        until: сроки.length ? Math.max(...сроки) : null,
        channelOff: !!наш && наш.importance === 0,
      }
    } catch {
      return пусто
    }
  },

  onAction(handler: (action: ReminderAction) => void) {
    let живо = true
    const подписка = LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
      if (!живо) return
      const extra = (event.notification.extra ?? {}) as {
        kind?: string
        slot?: string
        day?: number
        person?: string
      }
      if (typeof extra.slot !== 'string' || typeof extra.day !== 'number') return

      if (event.actionId === 'snooze') {
        // Откладывание — целиком забота платформы: приложению незачем знать,
        // что человек попросил напомнить попозже, набор от этого не меняется.
        // Канал берём тот же, в котором пришло исходное уведомление: своей
        // мелодии обработчик не знает, а на холодном старте `lastSound` ещё
        // не восстановлен и указал бы на системный звук.
        const канал = event.notification.channelId ?? channelId(lastSound)
        void ensureChannel(канал.startsWith(CHANNEL_PREFIX) ? канал.slice(CHANNEL_PREFIX.length) : lastSound, false).then(() =>
          LocalNotifications.schedule({
            notifications: [
              {
                // Свой диапазон идентификаторов: отложенное не должно затирать
                // штатные напоминания и не снимается пересборкой набора.
                // Остаток берём по потолку идентификаторов, а не по круглому
                // числу: иначе два разных напоминания дали бы один и тот же
                // отложенный номер, и второе стёрло бы первое.
                id: SNOOZE_BASE + (event.notification.id % SNOOZE_BASE),
                title: event.notification.title,
                body: event.notification.body ?? '',
                channelId: канал,
                actionTypeId: ACTION_TYPE,
                extra: event.notification.extra,
                isExactNotification: false,
                isExactMandatory: false,
                schedule: { at: new Date(Date.now() + SNOOZE_MIN * 60_000), allowWhileIdle: true },
              },
            ],
          }),
        ).catch(() =>
          // Канал или планировщик отказали. Хоть без своей мелодии, но напомнить
          // обязаны: просьба человека не должна пропасть молча.
          LocalNotifications.schedule({
            notifications: [
              {
                id: SNOOZE_BASE + (event.notification.id % SNOOZE_BASE),
                title: event.notification.title,
                body: event.notification.body ?? '',
                actionTypeId: ACTION_TYPE,
                extra: event.notification.extra,
                schedule: { at: new Date(Date.now() + SNOOZE_MIN * 60_000), allowWhileIdle: true },
              },
            ],
          }).catch(() => undefined),
        )
        return
      }

      handler({
        // «Принял» — только у приёма. У измерения этой кнопки нет вовсе, но
        // проверяем и здесь: карточка могла прийти из старой сборки, где рода
        // ещё не было, и тогда «Принял» отметило бы чужие таблетки.
        kind: event.actionId === 'taken' && extra.kind !== 'measure' ? 'taken' : 'open',
        about: extra.kind === 'measure' || extra.kind === 'lab' || extra.kind === 'dose' ? extra.kind : undefined,
        slot: extra.slot,
        day: extra.day,
        person: typeof extra.person === 'string' ? extra.person : undefined,
      })
    })

    return () => {
      живо = false
      void подписка.then((item) => item.remove())
    }
  },

  async openSoundSettings(soundId: string) {
    try {
      // Канал должен существовать, иначе системный экран открывать нечего.
      await ensureChannel(soundId)
      const { opened } = await SystemSettings.openChannel({ channelId: channelId(soundId) })
      return opened
    } catch {
      try {
        const { opened } = await SystemSettings.openAppNotifications()
        return opened
      } catch {
        return false
      }
    }
  },

  async canBypassQuietMode() {
    try {
      const { allowed } = await SystemSettings.canBypassDoNotDisturb()
      return allowed
    } catch {
      return null
    }
  },

  async requestQuietModeBypass() {
    try {
      const { opened } = await SystemSettings.openDoNotDisturbAccess()
      return opened
    } catch {
      return false
    }
  },

  async isQuietModeOn() {
    try {
      const { on } = await SystemSettings.isDoNotDisturbOn()
      return on
    } catch {
      return null
    }
  },

  async isBatteryRestricted() {
    try {
      const { restricted } = await SystemSettings.isBatteryRestricted()
      return restricted
    } catch {
      return null
    }
  },

  async openBatterySettings() {
    try {
      // Сначала список исключений: там нужный переключатель виден сразу.
      const { opened } = await SystemSettings.openBatteryOptimization()
      if (opened) return true
    } catch {
      // Экрана может не быть на нестандартной прошивке — ведём в настройки
      // приложения, оттуда до батареи доходят в два шага.
    }
    try {
      const { opened } = await SystemSettings.openAppDetails()
      return opened
    } catch {
      return false
    }
  },
}
