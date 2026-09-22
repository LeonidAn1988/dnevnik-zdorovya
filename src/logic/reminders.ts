/**
 * Из аптечки — в напоминания.
 *
 * Три решения, каждое из которых видно человеку.
 *
 * **Одно напоминание на время, а не на препарат.** В восемь утра человек
 * принимает четыре таблетки; четыре уведомления подряд он смахнёт не читая, а
 * пятое пропустит. Одно со списком читается за раз и совпадает с тем, как приём
 * происходит: подошёл к аптечке один раз.
 *
 * **Повтор до отметки, но с потолком.** Первое напоминание в назначенное время,
 * затем ещё три с интервалом. Дальше — молчание: бесконечный трезвон люди
 * отключают целиком, и тогда не работает ничего. Отмеченный приём повторов не
 * порождает вовсе.
 *
 * **Каждое напоминание привязано к конкретному дню и приёму.** Не «ежедневно в
 * 8:00», а «9 сентября, утренний приём, повтор второй». Иначе снять оставшиеся
 * повторы после отметки было бы нечем: у ежедневного повторяющегося
 * уведомления нет отдельного сегодняшнего экземпляра.
 *
 * Плата за это — горизонт: напоминания расставляются на две недели вперёд и
 * продлеваются при каждом запуске приложения. Приложение, которым пользуются
 * ради напоминаний, открывают чаще, но сказать об этом в интерфейсе честнее,
 * чем промолчать.
 */

import { addDays, dayNumber, momentOf, startOfDay } from './days'
import {
  measuredSlots,
  planActiveOn,
  planDayIndex,
  planIntersects,
  planTimes,
  type MeasureSubject,
} from './course'
import { dosesOn, normalizeTimes, parseTime, perTimeOf, formatCount } from './medicines'
import type { Reminder } from '../platform/ports'
import type { Dosing } from './regimen'
import type { Person } from '../types'
import { doseAmount } from './units'

const МИНУТА = 60_000

/** Сколько раз напомнить повторно, если отметки нет. */
export const REPEATS = 3
/** Через сколько минут повторять. */
export const REPEAT_INTERVAL_MIN = 15
/** На сколько дней вперёд расставляются напоминания. */
export const HORIZON_DAYS = 14

/**
 * Потолок на число напоминаний в системе.
 *
 * Android держит не больше пятисот ожидающих будильников на приложение. Раньше
 * здесь было написано, что лишние он отбрасывает молча; это неверно и стоило
 * падения приложения: на пятьсот первом системный сервис бросает
 * `IllegalStateException`, а плагин отдаёт его в нативный поток, откуда его
 * нечем поймать. Поэтому потолок с запасом — рядом с нашими будильниками живут
 * отложенные и пробное.
 *
 * При плотном расписании граница достижима: десять приёмов в день на
 * четырнадцать дней с повторами — пятьсот шестьдесят штук. Горизонт
 * укорачивается сам, см. ниже.
 */
export const MAX_REMINDERS = 400

/**
 * Потолок номера напоминания о приёме: (2047·8+7)·1024 + 127·8 + 7 — ровно 2²⁴−1.
 *
 * Упаковка «сутки · человек · время · повтор» заполняет двадцать четыре бита без
 * дыр, поэтому всё, что выше, свободно под другой род напоминаний.
 */
export const REMINDER_ID_MAX = 16_777_215

/** Начало диапазона измерений: та же упаковка, но с двадцать пятым битом. */
export const MEASURE_ID_BASE = REMINDER_ID_MAX + 1

/**
 * Потолок измерений. Ниже `SNOOZE_BASE` (20 000 000) с запасом в два миллиона:
 * значит уборка в плагине снимает измерения теми же правилами, что и приёмы.
 */
export const MEASURE_ID_MAX = MEASURE_ID_BASE + 1_048_575

const MEAL: Record<string, string> = {
  before: 'до еды',
  after: 'после еды',
}

/** Как назвать время суток, чтобы уведомление читалось без часов на экране. */
function partOfDay(minutes: number): string {
  if (minutes < 5 * 60) return 'Ночной приём'
  if (minutes < 12 * 60) return 'Утренний приём'
  if (minutes < 17 * 60) return 'Дневной приём'
  if (minutes < 22 * 60) return 'Вечерний приём'
  return 'Приём на ночь'
}

/**
 * Строка одного препарата внутри уведомления: «Лозартан 50 мг — 2 шт., после еды».
 *
 * Имя человека ставится впереди и только когда людей в дневнике больше одного.
 * Одному оно ни к чему — он и так знает, чьи таблетки; а в семье уведомление
 * «Периндоприл, 1 шт.» в восемь утра не говорит главного: кому пить.
 */
export function doseLine(medicine: Dosing, owner?: string | null, day?: number): string {
  // Доза берётся на день: со схемой она меняется, и «1 шт.» в уведомлении на
  // неделе половинок — это прямая инструкция принять лишнее.
  const count = perTimeOf(medicine, day)
  const имя = [medicine.name, medicine.dose].filter(Boolean).join(' ')
  const голова = owner ? `${owner}: ${имя}` : имя
  const хвост = [doseAmount(medicine, count, formatCount(count)), medicine.meal ? MEAL[medicine.meal] ?? '' : '']
    .filter(Boolean)
    .join(', ')
  return хвост ? `${голова} — ${хвост}` : голова
}

/**
 * Короткая строка для свёрнутого уведомления.
 *
 * В свёрнутом виде Android показывает одну строку и обрезает остальное
 * многоточием: при двух препаратах человек видел первый и «…». Здесь названия
 * без дозировок — они умещаются, и сразу понятно, сколько всего ждёт.
 * Подробности с дозировками остаются в развёрнутом виде.
 */
export function shortBody(names: string[]): string {
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} и ${names[1]}`
  return `${names[0]}, ${names[1]} и ещё ${names.length - 2}`
}

export const formatSlot = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/**
 * Идентификатор уведомления: система адресует их числами, и число обязано
 * однозначно восстанавливаться из «день + приём + номер повтора». Иначе снять
 * повторы после отметки нечем.
 *
 * Разрядность выбрана с запасом и укладывается в 32 бита: 2048 суток (пять с
 * половиной лет) × 128 приёмов × 8 повторов.
 */
export function reminderId(day: number, slotIndex: number, step: number, personIndex = 0): number {
  // Разряд человека — между днём и приёмом: у каждого человека на каждое время
  // своё уведомление, и номера не должны сталкиваться. До восьми человек;
  // потолок идентификатора — (2047 · 8 + 7) · 1024 + 127 · 8 + 7 = 16 777 215.
  return ((dayNumber(day) % 2048) * 8 + (personIndex % 8)) * 1024 + (slotIndex % 128) * 8 + (step % 8)
}

/**
 * Номер напоминания об измерении.
 *
 * Та же упаковка, что у приёма, но плотнее: 2048 суток × 8 человек × 8 времён ×
 * 8 повторов — двадцать бит поверх двадцати четырёх. Диапазоны не пересекаются
 * по построению: любой приёмный номер меньше `MEASURE_ID_BASE`, любой
 * измерительный — не меньше.
 */
export function measureId(day: number, slotIndex: number, step: number, personIndex = 0): number {
  return (
    MEASURE_ID_BASE +
    ((((dayNumber(day) % 2048) * 8 + (personIndex % 8)) * 8 + (slotIndex % 8)) * 8 + (step % 8))
  )
}


export interface ReminderOptions {
  /** Повторять, пока приём не отмечен. */
  repeat: boolean
  /** Насколько дней вперёд расставлять. */
  horizonDays?: number
  /**
   * Чей препарат — идентификатор человека.
   *
   * Когда людей больше одного, на каждое время ставится **своё уведомление
   * каждому человеку**, с именем в заголовке и его идентификатором внутри.
   * Раньше одно уведомление собирало таблетки всех, а «Принял» в нём отмечало
   * приём каждому, у кого таблетка на это время: сын отмечал отцовский
   * Метформин, повторы к отцу не приходили, в отчёт врачу уходила ложная
   * регулярность. Функция, а не словарь: список людей живёт в настройках, а
   * этот модуль о настройках знать не должен.
   */
  personOf?: (medicine: Dosing) => string | null
  /** Имя человека по идентификатору — для заголовка уведомления. */
  personName?: (personId: string) => string | null
}

/**
 * Собрать набор напоминаний.
 *
 * Препараты без расписания не попадают сюда вовсе: они принимаются по
 * потребности, и напоминать о них не о чем. Уже отмеченные приёмы пропускаются,
 * прошедшие моменты — тоже: система показала бы их немедленно, все скопом.
 */
/**
 * Сколько уведомлений о приёме даёт один день.
 *
 * Сумма по людям, а не произведение: у отца три приёма, у сына один — это
 * четыре уведомления в день, а не шесть. Вынесено наружу, потому что общий
 * бюджет считается вместе с измерениями.
 */
export function dosesPerDay(medicines: Dosing[], options: ReminderOptions): number {
  const шагов = options.repeat ? REPEATS + 1 : 1
  const персоны: (string | null)[] = options.personOf
    ? [...new Set(medicines.map((medicine) => options.personOf!(medicine)))]
    : [null]
  const поЛюдям = персоны.length > 1
  return персоны.reduce((sum, персона) => {
    const свои = поЛюдям ? medicines.filter((m) => options.personOf!(m) === персона) : medicines
    const времён = new Set(свои.flatMap((m) => normalizeTimes(m.times ?? []).filter((t) => parseTime(t) !== null))).size
    return sum + времён * шагов
  }, 0)
}

export function buildReminders(
  medicines: Dosing[],
  now: number,
  options: ReminderOptions = { repeat: true },
): Reminder[] {
  // Общий список времён приёма: по нему считается номер приёма, а он входит в
  // идентификатор. Список обязан зависеть только от расписания, иначе
  // идентификаторы поедут при любой правке аптечки.
  const времена = [
    ...new Set(
      medicines.flatMap((medicine) =>
        normalizeTimes(medicine.times ?? []).filter((time) => parseTime(time) !== null),
      ),
    ),
  ].sort()
  if (!времена.length) return []

  // Люди, у которых есть таблетки. Один человек — одно уведомление на время,
  // как и раньше; несколько — по уведомлению каждому.
  const персоны: (string | null)[] = options.personOf
    ? [...new Set(medicines.map((medicine) => options.personOf!(medicine)))]
    : [null]
  const поЛюдям = персоны.length > 1
  const шагов = options.repeat ? REPEATS + 1 : 1

  // Горизонт зависит от того, сколько уведомлений он порождает. Четырнадцать
  // дней на четверых с четырьмя приёмами и повторами — 672 штуки при потолке в
  // 450: система выбросила бы произвольную половину. Укорачиваем горизонт
  // заранее, не короче трёх дней; набор пересобирается при каждом пробуждении
  // приложения, так что до конца горизонта он не дотягивает никогда.
  // Считаем по каждому человеку его времена, а не всех людей на все времена:
  // у отца три приёма, у сына один — это четыре уведомления в день, а не шесть.
  const наДень = Math.max(1, dosesPerDay(medicines, options))
  // Нижняя граница в три дня относится к расчётному потолку, а не к заданному
  // горизонту: явно попросили один день — ставим один. Пробить потолок она не
  // может: набор всё равно обрезается по `MAX_REMINDERS` перед возвратом, и
  // ближние дни в нём остаются целиком.
  const horizon = Math.min(options.horizonDays ?? HORIZON_DAYS, Math.max(3, Math.floor(MAX_REMINDERS / наДень)))

  const набор: Reminder[] = []

  const первый = new Date(now)
  первый.setHours(0, 0, 0, 0)

  for (let сдвиг = 0; сдвиг < horizon; сдвиг++) {
    // Календарные сутки, а не «плюс двадцать четыре часа»: в ночь перевода
    // часов сложение метки времени либо повторяет день, либо перескакивает
    // через него, и горизонт теряет сутки целиком.
    const дата = addDays(первый, сдвиг)
    const день = дата.getTime()

    персоны.forEach((персона, personIndex) => {
    времена.forEach((time, slotIndex) => {
      const минуты = parseTime(time)!
      const момент = momentOf(дата, минуты)

      // Что из назначенного на этот приём ещё не отмечено. Отмеченное в списке
      // не показываем: человек уже принял, напоминать об этом — путать.
      const ждут = medicines.filter((medicine) => {
        if (поЛюдям && options.personOf!(medicine) !== персона) return false
        if (!normalizeTimes(medicine.times ?? []).includes(time)) return false
        const slot = dosesOn(medicine, день, now).find((item) => item.time === time)
        // Приёма в этот день нет вовсе — это не «ещё не отмечено», а «принимать
        // нечего»: выходной ритма, перерыв в схеме или законченный курс. Прежде
        // отсутствие приёма считалось ожиданием, и препарат, отменённый врачом
        // неделю назад, продолжал звать себя принять две недели вперёд.
        return slot ? slot.takenAt === null : false
      })
      if (!ждут.length) return

      const поПорядку = [...ждут].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      // Отмечать руками нужно не всё: автосписываемое уходит из остатка по
      // расписанию, и кнопки «Принял» у него нет.
      const естьЧтоОтмечать = ждут.some((medicine) => !medicine.autoDeduct)
      // Имя человека — в заголовке, а не в каждой строке: уведомление теперь
      // одно на человека, и внутри него все таблетки его.
      const подробно = поПорядку.map((medicine) => doseLine(medicine, null, день)).join('\n')
      const коротко = shortBody(поПорядку.map((medicine) => medicine.name))
      const имя = поЛюдям && персона ? (options.personName?.(персона) ?? null) : null
      const кому = имя ? `${имя} · ` : ''

      for (let step = 0; step < шагов; step++) {
        const at = момент + step * REPEAT_INTERVAL_MIN * МИНУТА
        // Прошедшее не ставим: система вывалила бы всё разом при первом же
        // запуске приложения.
        if (at <= now) continue
        набор.push({
          id: reminderId(день, slotIndex, step, personIndex),
          kind: 'dose',
          person: персона ?? undefined,
          markable: естьЧтоОтмечать,
          // Повтор говорит по-человечески, а не служебным «не отмечен»: слово
          // «отметить» — из устройства приложения, а человеку нужно про
          // таблетки.
          title: step === 0 ? `${кому}${partOfDay(минуты)} — ${time}` : `${кому}Не забудьте: приём в ${time}`,
          body: коротко,
          details: подробно,
          at,
          slot: time,
          day: день,
          step,
        })
      }
    })
    })
  }

  // Ближайшие важнее дальних: сортируем по времени и обрезаем хвост.
  набор.sort((a, b) => a.at - b.at)
  return набор.length > MAX_REMINDERS ? набор.slice(0, MAX_REMINDERS) : набор
}

/** Ближайшие времена приёма — интерфейсу, чтобы показать, что именно расставлено. */
export function reminderTimes(medicines: Dosing[]): string[] {
  return [
    ...new Set(
      medicines.flatMap((medicine) =>
        normalizeTimes(medicine.times ?? []).filter((time) => parseTime(time) !== null),
      ),
    ),
  ].sort()
}


/**
 * Какие препараты отметить по «Принял» из уведомления.
 *
 * Чистая функция, чтобы проводку было чем проверить: `person` из уведомления
 * терялся на одном из звеньев, TypeScript молчал (параметр необязательный), и
 * «Принял» отца отмечал таблетки сына. Отбирает препараты названного человека
 * с этим временем, ещё не отмеченные на этот день; без `person` — всех, как у
 * одиночного дневника. Список людей больше не нужен — человек записан в самом
 * курсе, — но остался в подписи: его передают все вызывающие, и убирать
 * параметр ради одной строки значило бы трогать их все.
 */
export function medicinesForReminder(
  cabinet: Dosing[],
  people: Person[],
  slot: string,
  day: number,
  now: number,
  person?: string,
): Dosing[] {
  void people
  return cabinet.filter((medicine) => {
    // Человек теперь у самого курса и пустым не бывает — гадать по коробке,
    // как раньше, больше не нужно.
    if (person && medicine.person !== person) return false
    if (!normalizeTimes(medicine.times ?? []).includes(slot)) return false
    const dose = dosesOn(medicine, day, now).find((item) => item.time === slot)
    // Как и при постановке напоминаний: нет приёма — нечего и показывать.
    return dose ? dose.takenAt === null : false
  })
}

/**
 * Как назвать измерение по времени суток. Близнец `partOfDay` для приёма.
 */
function partOfMeasure(minutes: number): string {
  if (minutes < 5 * 60) return 'Ночное измерение'
  if (minutes < 12 * 60) return 'Утреннее измерение'
  if (minutes < 18 * 60) return 'Дневное измерение'
  return 'Вечернее измерение'
}

/**
 * Сколько уведомлений об измерении даёт один день.
 *
 * Курс, начинающийся завтра, обязан войти в бюджет уже сегодня: иначе горизонт
 * посчитается по сегодняшней разрежённости, а завтра набор перевалит за потолок.
 * Поэтому смотрим, задевает ли расписание предельный горизонт, а не сегодняшний
 * день.
 */
export function measuresPerDay(subjects: MeasureSubject[], now: number, шагов: number): number {
  const первый = startOfDay(now)
  const последний = addDays(new Date(первый), HORIZON_DAYS - 1).getTime()
  return subjects.reduce((sum, subject) => {
    const времена = planTimes(subject.plan)
    return времена.length && planIntersects(subject.plan, первый, последний) ? sum + времена.length * шагов : sum
  }, 0)
}

/**
 * Из расписаний измерений — в напоминания.
 *
 * От приёма отличий ровно три. Слот закрывает не отметка, а само измерение —
 * и закрывает по окну суток, чтобы утренний замер не гасил вечернее
 * напоминание. Курс кончается сам. И отмечать в уведомлении нечего: цифры
 * давления в кнопку не помещаются, поэтому кнопки «Принял» у измерения нет.
 */
export function buildMeasureReminders(
  subjects: MeasureSubject[],
  now: number,
  options: ReminderOptions = { repeat: true },
): Reminder[] {
  const шагов = options.repeat ? REPEATS + 1 : 1
  const horizon = options.horizonDays ?? HORIZON_DAYS
  const набор: Reminder[] = []
  const первый = new Date(now)
  первый.setHours(0, 0, 0, 0)

  for (let сдвиг = 0; сдвиг < horizon; сдвиг++) {
    const дата = addDays(первый, сдвиг)
    const день = дата.getTime()

    for (const subject of subjects) {
      const времена = planTimes(subject.plan)
      if (времена.length === 0 || !planActiveOn(subject.plan, день)) continue

      const закрыты = measuredSlots(subject.plan, subject.readings, день)
      const сделано = закрыты.filter(Boolean).length
      const номерДня = planDayIndex(subject.plan, день)
      const кому = subject.name ? `${subject.name} · ` : ''
      const курс = subject.plan.days !== null

      времена.forEach((time, slotIndex) => {
        // Измерение в этом окне уже есть — напоминать не о чем. Это же снимает
        // и оставшиеся повторы: набор пересобирается при каждой новой записи.
        if (закрыты[slotIndex]) return
        const минуты = parseTime(time)
        if (минуты === null) return
        const момент = momentOf(дата, минуты)

        for (let step = 0; step < шагов; step++) {
          const at = момент + step * REPEAT_INTERVAL_MIN * МИНУТА
          if (at <= now) continue
          набор.push({
            id: measureId(день, slotIndex, step, subject.index),
            kind: 'measure',
            person: subject.person ?? undefined,
            // Ждём действия — измерения. Признак нужен плагину, чтобы
            // «напомни через 15 минут» снялось, когда мерить уже не надо.
            markable: true,
            title:
              step === 0
                ? `${кому}${partOfMeasure(минуты)} — ${time}`
                : `${кому}Не забудьте: измерить давление в ${time}`,
            body: курс ? `День ${номерДня} из ${subject.plan.days}` : 'Измерить давление',
            details: курс
              ? `День ${номерДня} из ${subject.plan.days} · сегодня ${сделано} из ${времена.length}`
              : 'Измерить давление и записать в дневник',
            at,
            slot: time,
            day: день,
            step,
          })
        }
      })
    }
  }
  return набор
}

export interface PlanInput {
  medicines: Dosing[]
  subjects: MeasureSubject[]
  now: number
  options?: ReminderOptions
}

/**
 * Единственный вход планировщика: оба рода напоминаний одним набором.
 *
 * Раздельно их ставить нельзя — плагин снимает всё, чего нет в поданном
 * массиве, и второй вызов стёр бы первый. Здесь же считается общий бюджет:
 * горизонт от суммарной плотности, а не от лекарственной, иначе курс молча
 * съел бы хвост напоминаний о таблетках, а платформа обрезала бы набор не там.
 */
export function planReminders({ medicines, subjects, now, options = { repeat: true } }: PlanInput): Reminder[] {
  const шагов = options.repeat ? REPEATS + 1 : 1
  const наДень = Math.max(1, dosesPerDay(medicines, options) + measuresPerDay(subjects, now, шагов))
  const horizon = Math.min(options.horizonDays ?? HORIZON_DAYS, Math.max(3, Math.floor(MAX_REMINDERS / наДень)))
  const общий: ReminderOptions = { ...options, horizonDays: horizon }

  const набор = [...buildReminders(medicines, now, общий), ...buildMeasureReminders(subjects, now, общий)]
  // Ближайшие важнее дальних: сортируем по времени и режем хвост.
  набор.sort((a, b) => a.at - b.at)
  return набор.length > MAX_REMINDERS ? набор.slice(0, MAX_REMINDERS) : набор
}
