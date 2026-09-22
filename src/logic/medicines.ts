import type { Medicine, Regimen } from '../types'
import type { Dosing } from './regimen'
import { daysLeftOf, regimenFinished } from './regimen'
import { plural } from './plural'

/**
 * Правила аптечки: когда препарат кончается и когда истекает срок.
 *
 * Приложение считает упаковки и даты — и только. Оно не советует, что принимать,
 * не меняет дозировки и не толкует назначения врача; формулировки предупреждений
 * поэтому описательные («срок истёк 12 мая»), а не побудительные.
 *
 * Без DOM и без React: файл переезжает на нативные платформы как есть.
 */


/**
 * Что нужно знать о курсе, чтобы разложить дозы по дням.
 *
 * Узкий набор полей, а не весь `Regimen`: тогда одна и та же функция принимает
 * и сам курс, и совмещённое представление `Dosing`, и её не приходится звать
 * по-разному из расписания и из аптечки.
 */
type Расписание = Pick<
  Regimen,
  'times' | 'perTime' | 'rhythm' | 'plan' | 'planFrom' | 'since' | 'startedAt' | 'taken' | 'endsAt'
>

/** Схема дозы: чем она задана и с какого дня считается. */
type Схема = Pick<Regimen, 'plan' | 'planFrom' | 'startedAt' | 'since'>

/** За сколько дней до конца срока годности пора покупать замену. */
export const EXPIRY_SOON_DAYS = 30

/** На сколько дней запаса предупреждаем. Неделя — чтобы успеть дойти до аптеки. */
export const SUPPLY_SOON_DAYS = 7

/**
 * За сколько дней предупреждать о рецептурном препарате.
 *
 * Семь дней — это срок для валерьянки: сходить в аптеку. За рецептом сначала
 * надо попасть к врачу, а это запись на неделю вперёд, у льготников ещё и
 * отдельный визит за выпиской. Перерыв в гипотензивном препарате стоит дороже
 * лишней строки в списке покупок, поэтому счёт идёт на две недели.
 */
export const SUPPLY_SOON_RX_DAYS = 14

/** За сколько дней предупреждать об этой коробке. */
export function soonDaysOf(medicine: Medicine): number {
  return medicine.rx ? SUPPLY_SOON_RX_DAYS : SUPPLY_SOON_DAYS
}

export type MedicineAlertKind =
  /** Срок годности истёк. */
  | 'expired'
  /** Кончился: остаток ноль. */
  | 'out'
  /** Запаса меньше недели. */
  | 'low'
  /** Срок годности истекает в ближайший месяц. */
  | 'expiring'

export interface MedicineAlert {
  kind: MedicineAlertKind
  /** Дни до события: до конца срока или до конца запаса. Отрицательные — уже позади. */
  days: number
}

// Начало дня переехало в `days.ts`: теми же сутками считает и планировщик
// напоминаний, и расписание измерений, а импортировать их друг у друга значит
// завести кольцо. Реэкспорт оставлен — на него ссылается десяток файлов.
import { addDays, daysBetween, startOfDay } from './days'
import { intakeOn, rhythmDuty } from './rhythm'
import { packUnit, toPackUnits } from './units'
export { startOfDay }

/**
 * Срок годности вводится месяцем, а не датой: на упаковке печатают «05/2027»,
 * и препарат годен весь этот месяц. Хранится последний годный день — иначе
 * предупреждение приходило бы на месяц раньше, чем нужно.
 */
export function monthToExpiry(value: string): number | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  // Нулевой день следующего месяца — последний день текущего.
  return new Date(year, month, 0).getTime()
}

/** Обратно в значение для поля ввода: «2027-05». */
export function expiryToMonth(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Сколько дней хранить отметки о приёме. История за годы не нужна, а копию раздувает. */
export const KEEP_INTAKES_DAYS = 60

/**
 * Какой этап схемы действует в этот день.
 *
 * `null` — схемы нет или день раньше её начала: тогда работает обычная доза.
 * `finished` — все этапы прошли, а последний был срочным: курс окончен, и
 * принимать больше нечего.
 */
export function stageOn(
  курс: Схема,
  day: number,
): { index: number; perTime: number; endsAt: number | null; finished: boolean } | null {
  const plan = курс.plan
  if (!plan || plan.length === 0) return null
  const from = startOfDay(курс.planFrom ?? курс.startedAt ?? курс.since ?? 0)
  if (!from) return null
  const текущий = startOfDay(day)
  if (текущий < from) return null

  let начало = from
  for (let i = 0; i < plan.length; i++) {
    const этап = plan[i]
    if (этап.days === null) return { index: i, perTime: этап.perTime, endsAt: null, finished: false }
    const конец = addDays(new Date(начало), этап.days).getTime()
    if (текущий < конец) return { index: i, perTime: этап.perTime, endsAt: конец, finished: false }
    начало = конец
  }
  // Этапы кончились, а последний был срочным — курс завершён.
  return { index: plan.length, perTime: 0, endsAt: null, finished: true }
}

/**
 * Штук за один приём. По умолчанию одна — так на упаковке и в назначении чаще
 * всего. Со схемой доза зависит от дня, и день обязателен: без него вернётся
 * доза «вообще», а она в схеме бессмысленна.
 */
export function perTimeOf(курс: Схема & Pick<Regimen, 'perTime'>, day?: number): number {
  if (day !== undefined) {
    const этап = stageOn(курс, day)
    if (этап) return этап.perTime
  }
  return курс.perTime ?? 1
}

/**
 * Сегодня доза меняется — и об этом надо сказать.
 *
 * Молчаливый переход опасен: человек принимает по привычке прежнее число, а
 * назначение уже другое. Возвращает предыдущую и новую дозу либо `null`.
 */
export function doseChangeOn(курс: Схема, day: number): { from: number; to: number } | null {
  if (!курс.plan?.length) return null
  const вчера = stageOn(курс, addDays(new Date(day), -1).getTime())
  const сегодня = stageOn(курс, day)
  if (!сегодня || !вчера) return null
  if (вчера.index === сегодня.index) return null
  return { from: вчера.perTime, to: сегодня.perTime }
}

/** «½», «1½», «2» — половинки принято писать дробью, а не «0.5». */
export function formatCount(n: number): string {
  const целых = Math.floor(n)
  const остаток = n - целых
  if (Math.abs(остаток - 0.5) < 1e-9) return целых === 0 ? '½' : `${целых}½`
  if (остаток === 0) return String(целых)
  return String(n).replace('.', ',')
}

/**
 * Сколько уходит в сутки.
 *
 * Если задано расписание, суточный расход считается по нему: держать отдельно
 * список времён и число «в день» значит рано или поздно их разойтись.
 */
export function perDayOf(приём: Dosing, day: number): number | null {
  // Законченный курс не расходует ничего. Раньше день был необязательным, и
  // `supplyDays` звал без него — отсюда коробка с оконченным курсом вечно
  // числилась кончающейся и не уходила из списка покупок.
  if (regimenFinished(приём, day, stageOn(приём, day))) return 0
  const times = приём.times ?? []
  // Ритм усредняется, а не применяется к конкретному дню: это число отвечает на
  // вопрос «на сколько хватит», а не «сколько принять сегодня». При приёме через
  // день расход вдвое меньше, и без поправки «пора покупать» приходило бы вдвое
  // раньше, чем нужно. Без расписания ритма нет — тогда берётся ручное число.
  // В единицах упаковки, а не приёма: это число делит остаток, а остаток
  // хранится так, как написано на упаковке. Две капли в сутки из флакона в
  // десять миллилитров — это десятая доля миллилитра, а не двойка.
  if (times.length > 0) {
    return toPackUnits(приём, times.length * perTimeOf(приём, day) * rhythmDuty(приём.rhythm))
  }
  // Ручное число — тоже в единицах приёма, а не упаковки: человек пишет
  // «три капли в день», а не «три миллилитра». Без перевода флакон на десять
  // миллилитров «кончался» за три дня, и список покупок просил восемь штук.
  return приём.perDay == null ? null : toPackUnits(приём, приём.perDay)
}

/**
 * Остаток с поправкой на прошедшие дни.
 *
 * Подтверждённый остаток — это снимок на дату `leftAt`. Человек не правит его
 * каждый день, поэтому по нему одному предупреждение «пора заказывать» не
 * срабатывало никогда. Здесь считается ожидаемый остаток; он именно ожидаемый,
 * и в интерфейсе подписан как расчётный, а не как факт.
 */
export function projectedLeft(box: Medicine, приёмы: Dosing[], now: number): number | null {
  const { left } = box
  if (left === null) return null
  const at = box.leftAt
  if (!at) return left

  // Из одной коробки могут принимать двое — расход складывается. Пока коробка
  // и курс были одним объектом, такого случая не существовало вовсе.
  const сРасписанием = приёмы.filter((п) => normalizeTimes(п.times ?? []).length > 0)
  const безРасписания = приёмы.filter((п) => normalizeTimes(п.times ?? []).length === 0)

  let списано = 0
  // Без расписания приёмы не пересчитать — остаётся дневная норма.
  for (const приём of безРасписания) {
    /*
     * Считаем только те дни, когда курс шёл.
     *
     * Раньше брались все дни от подтверждения остатка, и курс, заведённый
     * вчера, списывал за месяц: полная пачка объявлялась кончившейся, а в
     * список покупок уходили две. Зеркально, законченный курс не списывал
     * ничего: сегодняшний расход у него ноль, и ноль множился на все дни.
     * Ветка с расписанием обе границы знает — они внутри `dosesOn`.
     */
    const от = Math.max(startOfDay(at), trackedSince(приём, now))
    const до = приём.endsAt === undefined ? startOfDay(now) : Math.min(startOfDay(now), startOfDay(приём.endsAt))
    const days = daysBetween(от, до)
    if (days <= 0) continue
    // Расход берём на день внутри курса, а не на сегодня: у законченного курса
    // сегодняшний расход ноль, и он обнулял бы всё, что было выпито за курс.
    const perDay = perDayOf(приём, от)
    if (perDay === null || perDay <= 0) continue
    списано += days * perDay
  }
  if (сРасписанием.length === 0) return Math.max(0, left - списано)

  // С расписанием считаем поштучно, а не сутками. Разница не косметическая:
  // при подённом счёте отметка приёма сбрасывала точку отсчёта, и показанный
  // остаток подскакивал вверх — человек, не отмечавший неделю, нажимал
  // «принял» и видел, что таблеток стало больше.
  for (const приём of сРасписанием) {
    for (let day = startOfDay(at); day <= startOfDay(now); day = addDays(new Date(day), 1).getTime()) {
      // Доза берётся на каждый день отдельно: со схемой она меняется по этапам.
      // И сразу в единицах упаковки — вычитать капли из миллилитров нельзя.
      const per = toPackUnits(приём, perTimeOf(приём, day))
      for (const slot of dosesOn(приём, day, now)) {
        const planned = day + parseTime(slot.time)! * 60_000
        // До подтверждения остатка — уже внутри подтверждённого числа.
        if (planned <= at) continue
        // Ещё не наступило — не потрачено.
        if (planned > now) continue
        if (slot.takenAt !== null) {
          // Отметка сама списала штуки; при автосписании — наоборот, отметка
          // остаток не трогает, и списывает как раз расчёт.
          if (приём.autoDeduct) списано += per
          continue
        }
        // Неотмеченный прошедший приём считаем принятым: нажимать «принял»
        // трижды в день согласится не всякий, а несписанный остаток врёт.
        списано += per
      }
    }
  }
  return Math.max(0, left - списано)
}

/**
 * Остаток, который показываем человеку.
 *
 * Всегда расчётный, независимо от автосписания. Полоса запаса и предупреждения
 * и так считаются по расчёту — если рядом показывать подтверждённое число,
 * получается противоречие: «6 шт.» и тут же «запас кончился». Что число
 * расчётное, видно по знаку «примерно» и подписи рядом.
 */
export function effectiveLeft(box: Medicine, приёмы: Dosing[], now: number): number | null {
  return projectedLeft(box, приёмы, now)
}

/** Показанное число — оценка, а не подтверждённый факт. */
export function isEstimated(box: Medicine, приёмы: Dosing[], now: number): boolean {
  const shown = effectiveLeft(box, приёмы, now)
  return shown !== null && box.left !== null && shown !== box.left
}

/** Когда запас кончится. `null` — считать не из чего. */
export function runsOutAt(box: Medicine, приёмы: Dosing[], now: number): number | null {
  const days = supplyDays(box, приёмы, now)
  return days === null ? null : addDays(new Date(startOfDay(now)), days).getTime()
}

/** На сколько дней хватит остатка. `null` — нечего или не из чего считать. */
export function supplyDays(box: Medicine, приёмы: Dosing[], now: number): number | null {
  // Сумма по курсам: одну коробку могут принимать двое, и тогда её хватит
  // вдвое меньше. Законченный курс даёт ноль и в сумму не идёт.
  let perDay = 0
  let считали = false
  for (const приём of приёмы) {
    const своё = perDayOf(приём, now)
    if (своё === null) continue
    считали = true
    perDay += своё
  }
  const left = projectedLeft(box, приёмы, now)
  if (left === null || !считали || perDay <= 0) return null
  return Math.floor(left / perDay)
}

/** Сколько дней до конца срока годности. Отрицательное — срок истёк. */
export function daysToExpiry(box: Pick<Medicine, 'expires'>, now: number): number | null {
  if (box.expires === null) return null
  return daysBetween(now, box.expires)
}

/**
 * Единственное предупреждение по препарату — самое существенное.
 *
 * Показывать сразу два («истёк срок» и «кончается») незачем: список превращается
 * в частокол пометок, и человек перестаёт их читать. Порядок строгий: истёкший
 * срок важнее пустой упаковки, потому что просроченное ещё и лежит в аптечке.
 */
/**
 * Сколько нужно до конца курсов. `null` — хоть один курс бессрочный.
 *
 * Отвечает на вопрос, ради которого конец курса и заводили: «докупать ли».
 * Десяти таблеток мало на месяц, но на оставшиеся три дня курса их с избытком,
 * и звать человека в аптеку за тем, что он допивает, — это ложная тревога.
 */
export function needUntilEnd(приёмы: Dosing[], now: number): number | null {
  let нужно = 0
  for (const приём of приёмы) {
    if (regimenFinished(приём, now, stageOn(приём, now))) continue
    const осталось = daysLeftOf(приём, now)
    // Бессрочный курс сводит весь счёт на нет: конца у него нет, и «хватит до
    // конца» про него сказать нечего.
    if (осталось === null) return null
    /*
     * Идём по дням, а не множим среднюю дозу на число дней.
     *
     * Среднее врёт там, где доза меняется. Курс на три недели по схеме
     * «неделя по половине, неделя по целой, дальше по две» требует 24,5
     * таблетки, а средняя сегодняшняя доза давала 10,5 — и одиннадцати
     * таблеток «хватало до конца курса». Молчание там, где нужна тревога,
     * дороже лишнего похода в аптеку.
     *
     * Ритм считается тем же `dosesOn`, что и всё остальное: «через день» даёт
     * приёмы через день, а не половину дозы каждый день.
     */
    const расписание = normalizeTimes(приём.times ?? []).length > 0
    for (let i = 0; i < осталось; i += 1) {
      const day = addDays(new Date(startOfDay(now)), i).getTime()
      if (расписание) {
        const доз = dosesOn(приём, day, now).length
        if (доз > 0) нужно += toPackUnits(приём, доз * perTimeOf(приём, day))
      } else {
        const заДень = perDayOf(приём, day)
        if (заДень !== null && заДень > 0) нужно += заДень
      }
    }
  }
  return нужно
}

export function medicineAlert(box: Medicine, приёмы: Dosing[], now: number): MedicineAlert | null {
  const expiry = daysToExpiry(box, now)
  if (expiry !== null && expiry < 0) return { kind: 'expired', days: expiry }

  // Курс кончился, а коробка цела — молчим. Просить купить ещё то, что больше
  // не принимают, бессмысленно; срок годности при этом остаётся в силе, потому
  // что просроченная пачка в тумбочке — факт о коробке, а не о назначении.
  const живые = приёмы.filter((п) => !regimenFinished(п, now, stageOn(п, now)))
  if (приёмы.length > 0 && живые.length === 0) {
    return expiry !== null && expiry <= EXPIRY_SOON_DAYS ? { kind: 'expiring', days: expiry } : null
  }

  // «Закончился» — только по подтверждённому остатку. Расчётный для этого не
  // годится: сказать «кончился», когда пачка лежит в тумбочке, значит соврать.
  if (box.left !== null && box.left <= 0) return { kind: 'out', days: 0 }

  const supply = supplyDays(box, приёмы, now)
  // Хватает до конца курса — про запас молчим. Иначе десять таблеток при трёх
  // оставшихся днях всё равно зовут в аптеку: расчёт «на сколько хватит»
  // сравнивает их с месяцем, о котором речи уже не идёт.
  if (!enoughForCourse(box, приёмы, now) && supply !== null && supply <= soonDaysOf(box)) {
    return { kind: 'low', days: supply }
  }

  if (expiry !== null && expiry <= EXPIRY_SOON_DAYS) return { kind: 'expiring', days: expiry }

  return null
}

/** Насколько срочно. Больше — важнее; для сортировки списка и выбора главного предупреждения. */
/**
 * Остатка хватает до конца всех курсов этой коробки.
 *
 * Когда живых курсов не осталось, ответ «нет»: «хватит до конца курса» про
 * законченный курс — бессмыслица, а сказать о нём есть что и без этого —
 * «курс окончен» стоит отдельной строкой.
 */
export function enoughForCourse(box: Medicine, приёмы: Dosing[], now: number): boolean {
  const живые = приёмы.filter((п) => !regimenFinished(п, now, stageOn(п, now)))
  if (живые.length === 0) return false
  const нужно = needUntilEnd(приёмы, now)
  if (нужно === null) return false
  const остаток = projectedLeft(box, приёмы, now)
  // Допуск в тысячную: у капель нужда считается дробями миллилитра, и без него
  // «ровно хватает» превращается в 1,9999999999999998 против двух.
  return остаток !== null && остаток >= нужно - 1e-3
}

export function alertWeight(alert: MedicineAlert | null): number {
  if (!alert) return 0
  return { expired: 4, out: 3, low: 2, expiring: 1 }[alert.kind]
}

/**
 * Порядок в списке: сначала требующее внимания, потом по алфавиту.
 *
 * Алфавит вторым ключом, а не дата добавления: в аптечке из полутора десятков
 * коробок ищут глазами по названию.
 */
export function sortStock(items: Stock[], now: number): Stock[] {
  return [...items].sort((a, b) => {
    const diff = alertWeight(medicineAlert(b.box, b.intakes, now)) - alertWeight(medicineAlert(a.box, a.intakes, now))
    if (diff !== 0) return diff
    return a.box.name.localeCompare(b.box.name, 'ru')
  })
}

/**
 * Коробка и то, что из неё принимают.
 *
 * Пустой список курсов — не ошибка, а обычное состояние домашней аптечки:
 * коробка стоит в шкафу, её никто сейчас не пьёт, и предупреждать о запасе не
 * о чем. Срок годности при этом всё равно считается.
 */
export interface Stock {
  box: Medicine
  intakes: Dosing[]
}

/** Разложить аптечку по коробкам: каждой — её курсы. */
export function stockOf(boxes: Medicine[], приёмы: Dosing[]): Stock[] {
  const поКоробке = new Map<string, Dosing[]>()
  for (const приём of приёмы) {
    const список = поКоробке.get(приём.boxId)
    if (список) список.push(приём)
    else поКоробке.set(приём.boxId, [приём])
  }
  return boxes.map((box) => ({ box, intakes: поКоробке.get(box.id) ?? [] }))
}

/** Сколько препаратов требуют внимания — для пометки на вкладке и плашки на обзоре. */
export function countAlerts(items: Stock[], now: number): number {
  return items.filter((s) => medicineAlert(s.box, s.intakes, now) !== null).length
}

// ── расписание и приём ─────────────────────────────────────────────────────

/** Разбирает «08:30» в минуты от полуночи. `null` — не время. */
export function parseTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/** Обратно: 510 → «08:30». Двузначные часы — чтобы строки сортировались как время. */
export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Расписание по возрастанию времени, без повторов и без мусора. */
export function normalizeTimes(times: string[]): string[] {
  const minutes = times
    .map(parseTime)
    .filter((m): m is number => m !== null)
    .sort((a, b) => a - b)
  return [...new Set(minutes)].map(formatTime)
}


/**
 * Части суток.
 *
 * Границы не «дизайнерские», а бытовые: человек мыслит «утренние таблетки», а не
 * «приём в 08:00». Карточка на часть суток даёт крупные цели нажатия и совпадает
 * с тем, как назначение проговаривает врач.
 */
export type DayPart = 'morning' | 'day' | 'evening' | 'night'

export const DAY_PARTS: DayPart[] = ['morning', 'day', 'evening', 'night']

export const DAY_PART_TITLE: Record<DayPart, string> = {
  morning: 'Утро',
  day: 'День',
  evening: 'Вечер',
  night: 'Ночь',
}

/** Утро до 12, день до 17, вечер до 22, дальше ночь. */
export function partOfDay(time: string): DayPart | null {
  const minutes = parseTime(time)
  if (minutes === null) return null
  if (minutes < 12 * 60) return 'morning'
  if (minutes < 17 * 60) return 'day'
  if (minutes < 22 * 60) return 'evening'
  return 'night'
}

export interface DoseSlot {
  time: string
  /** Отметка о приёме, если он уже сделан сегодня. */
  takenAt: number | null
  /** Время приёма уже прошло, а отметки нет. */
  overdue: boolean
}

/**
 * Что сегодня по расписанию.
 *
 * Отметка привязывается к ближайшему приёму, а не к точному времени: человек
 * принимает таблетку в 8:10 или в 7:40, и требовать попадания в минуту нельзя.
 */
export function dosesToday(курс: Расписание, now: number): DoseSlot[] {
  return dosesOn(курс, now, now)
}

/**
 * С какого дня у препарата вообще есть расписание.
 *
 * Расписание не действует задним числом. Препарат, заведённый сегодня, не был
 * пропущен вчера — его просто не было, и размечать вчера пропуском значит
 * врать человеку в лицо.
 *
 * Порядок источников:
 * 1. явная дата заведения — она есть у всего, что добавлено в аптечку;
 * 2. первая отметка о приёме — значит, к тому дню препарат уже существовал;
 * 3. ограничения нет.
 *
 * Третий случай — препараты, заведённые до появления этого поля. Считать их
 * начало сегодняшним днём нельзя: человек, который забыл отметить вчерашний
 * приём, лишился бы возможности это исправить. Пусть у старых записей всё
 * останется как было, а новые ведут себя правильно.
 */
export function trackedSince(курс: Pick<Regimen, 'since' | 'taken'>, now: number): number {
  void now
  if (курс.since !== undefined) return startOfDay(курс.since)
  const marks = курс.taken ?? []
  return marks.length ? startOfDay(Math.min(...marks)) : Number.NEGATIVE_INFINITY
}

/** Ключ месяца в свёрнутой истории: `2026-07`. Локальный месяц, а не UTC. */
export function monthKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Свернуть отметки, уходящие за горизонт хранения, в месячные итоги.
 *
 * Отметки живут шестьдесят дней и дальше выбрасываются. Просто выбросить их
 * значит потерять ответ на главный вопрос врача — «как регулярно принимаете» —
 * ровно там, где он и интересен: за год, а не за два месяца.
 *
 * Считается не по сохранившимся отметкам, а по окну между прошлой свёрткой и
 * нынешним горизонтом. Иначе назначенные дозы взялись бы неоткуда: отметка
 * говорит, что приняли, но не говорит, сколько было назначено, — а пропуск это
 * как раз разница между ними.
 *
 * Расписание берётся нынешнее, и это осознанно: свёртка идёт по горячим следам,
 * через два месяца после самих дней, поэтому расписание почти наверняка то же.
 * Пересчитывать историю позже было бы хуже — там расписание уже чужое.
 */
export function foldHistory(курс: Regimen, now: number): Regimen {
  const times = normalizeTimes(курс.times ?? [])
  const cutoff = addDays(new Date(startOfDay(now)), -(KEEP_INTAKES_DAYS - 1)).getTime()
  const marks = курс.taken ?? []

  // Откуда считать. Прошлая свёртка знает своё место; если её не было, берём
  // день заведения, а без него — первую отметку. Не знаем ничего — сворачивать
  // нечего.
  const tracked = trackedSince(курс, now)
  const fallback = Number.isFinite(tracked) ? tracked : marks.length ? startOfDay(Math.min(...marks)) : cutoff
  const from = курс.foldedUntil !== undefined ? startOfDay(курс.foldedUntil) : fallback

  if (times.length === 0 || from >= cutoff) {
    // Сворачивать нечего, но отметки за горизонтом всё равно не держим.
    const свежие = marks.filter((t) => t >= cutoff)
    const следы = (курс.untaken ?? []).filter((t) => t >= cutoff)
    const тоЖе = свежие.length === marks.length && следы.length === (курс.untaken ?? []).length
    return тоЖе ? курс : { ...курс, taken: свежие, untaken: следы.length ? следы : undefined }
  }

  const history: Record<string, { planned: number; taken: number }> = { ...(курс.history ?? {}) }
  for (let day = from; day < cutoff; day = addDays(new Date(day), 1).getTime()) {
    /*
     * Назначено за день — не длина списка времён, а то, что было назначено
     * именно в этот день.
     *
     * Прежний счёт не спрашивал ни ритм, ни схему, ни конец курса: приём через
     * день сворачивался как ежедневный, и врач видел пятьдесят процентов
     * соблюдения там, где человек не пропустил ни одной таблетки. Живой
     * `adherence` считает через `dosesOn` — теперь и свёртка тоже, иначе две
     * цифры в одном отчёте спорят друг с другом.
     */
    const назначено = dosesOn(курс, day, now).length
    if (назначено === 0) continue
    const key = monthKey(day)
    const cell = history[key] ?? { planned: 0, taken: 0 }
    history[key] = { planned: cell.planned + назначено, taken: cell.taken }
  }
  for (const mark of marks) {
    if (mark < from || mark >= cutoff) continue
    const key = monthKey(mark)
    const cell = history[key] ?? { planned: 0, taken: 0 }
    history[key] = { planned: cell.planned, taken: cell.taken + 1 }
  }

  const следы = (курс.untaken ?? []).filter((t) => t >= cutoff)
  return {
    ...курс,
    history,
    foldedUntil: cutoff,
    taken: marks.filter((t) => t >= cutoff),
    // Следы снятия чистим той же меркой: вычитать им уже нечего — отметка за
    // горизонтом свёрнута в историю, а список иначе рос бы вечно.
    untaken: следы.length ? следы : undefined,
  }
}

/** Итог по свёрнутой истории: сколько назначено и сколько принято за всё, что в ней есть. */
export function historyTotal(курс: Pick<Regimen, 'history'>): { planned: number; taken: number; months: number } {
  const cells = Object.values(курс.history ?? {})
  return {
    planned: cells.reduce((sum, c) => sum + c.planned, 0),
    taken: cells.reduce((sum, c) => sum + c.taken, 0),
    months: cells.length,
  }
}

/** За сколько минут до первого приёма карточки части суток открываются кнопки. */
export const EARLY_WINDOW_MIN = 60

/**
 * Открылось ли окно части суток — можно ли уже отмечать её приёмы.
 *
 * Раньше кнопки «Принял» и «Принял всё» у «Вечера» были живыми с самого утра,
 * а после утренней отметки становились единственными синими кнопками на
 * экране при подписи «осталось отметить: 2». Пожилой человек нажимал их в
 * десять утра: вечерние таблетки помечались принятыми, вечернее напоминание
 * гасло (отмеченное из набора исключается), а в отчёт врачу уходил приём,
 * которого не было.
 *
 * Окно открывается за час до первого приёма карточки: раннее «с ужином»
 * проходит без лишних шагов, а утро до вечера не дотягивается.
 */
export function partWindowOpen(day: number, firstTime: string, now: number): boolean {
  const minutes = parseTime(firstTime)
  if (minutes === null) return true
  return now >= startOfDay(day) + (minutes - EARLY_WINDOW_MIN) * 60_000
}

/**
 * Приёмы за произвольный день.
 *
 * `day` задаёт сутки, `now` — текущий момент: просроченным приём считается
 * только относительно настоящего времени, иначе вчерашние приёмы выглядели бы
 * просроченными даже там, где отметка стоит.
 */
export function dosesOn(курс: Расписание, day: number, now: number): DoseSlot[] {
  const times = normalizeTimes(курс.times ?? [])
  if (times.length === 0) return []

  const dayStart = startOfDay(day)
  // До дня заведения расписания не существует.
  if (dayStart < trackedSince(курс, now)) return []
  // После последнего дня курса принимать нечего.
  //
  // Проверка стоит здесь, а не только в расчёте расхода: через `dosesOn`
  // проходит весь вопрос «что сегодня принимать» — и напоминания, и экран
  // приёма, и списание остатка. Поставь её в другом месте, и телефон
  // продолжал бы звать принять отменённое, как это уже было со схемой доз.
  if (regimenFinished(курс, dayStart)) return []
  // Перерыв в схеме или конец курса по схеме: принимать в этот день нечего.
  if (perTimeOf(курс, dayStart) <= 0) return []
  // Неприёмный день ритма — «через день», выходной цикла, не тот день недели.
  // Единственная точка, где ритм превращается в отсутствие приёмов: всё
  // остальное в приложении спрашивает о приёмах именно здесь.
  if (!intakeOn(курс.rhythm, dayStart)) return []
  const завтра = addDays(new Date(dayStart), 1).getTime()
  const marks = (курс.taken ?? []).filter((t) => t >= dayStart && t < завтра).sort((a, b) => a - b)
  const planned = times.map((time) => dayStart + parseTime(time)! * 60_000)

  /**
   * Раскладываем отметки по приёмам, начиная с самых близких пар.
   *
   * Раньше разбор шёл по приёмам подряд, и каждый забирал ближайшую **свободную**
   * отметку. При двух приёмах в день и единственной вечерней отметке утренний
   * приём разбирался первым, свободна была только вечерняя отметка — и она
   * доставалась утру. Человек нажимал «принял» на вечернем препарате, а
   * отмечался утренний, которого он не принимал. Препараты с одним приёмом в
   * день не страдали: там нечего было забирать, поэтому дефект выглядел
   * выборочным.
   *
   * Теперь сначала рассматриваются все пары «приём — отметка» и разбираются от
   * самой близкой к самой далёкой. Вечерняя отметка совпадает с вечерним
   * приёмом точно, эта пара идёт первой и забирает обе стороны; утро остаётся
   * пустым, как и было на самом деле.
   *
   * Отметки различаются по номеру, а не по времени: две отметки на одну и ту же
   * минуту — разные события, и склеивать их нельзя.
   */
  const pairs: { slot: number; mark: number; gap: number }[] = []
  planned.forEach((at, slot) => {
    marks.forEach((mark, index) => pairs.push({ slot, mark: index, gap: Math.abs(mark - at) }))
  })
  // При равном расстоянии порядок задаётся явно, иначе раскладка зависела бы от
  // устойчивости сортировки в конкретном движке.
  pairs.sort((a, b) => a.gap - b.gap || a.slot - b.slot || a.mark - b.mark)

  const takenBySlot: (number | null)[] = times.map(() => null)
  const usedMarks = new Set<number>()
  for (const pair of pairs) {
    if (takenBySlot[pair.slot] !== null || usedMarks.has(pair.mark)) continue
    takenBySlot[pair.slot] = marks[pair.mark]
    usedMarks.add(pair.mark)
  }

  return times.map((time, slot) => ({
    time,
    takenAt: takenBySlot[slot],
    overdue: takenBySlot[slot] === null && now > planned[slot],
  }))
}

export type DayStatus = 'future' | 'done' | 'missed' | 'pending' | 'empty'

/**
 * Состояние дня для ленты дат.
 *
 * `missed` — время приёма прошло, а отметки нет; `pending` — день сегодняшний и
 * что-то ещё впереди. Разделять их важно: «пропустил» и «ещё не время» для
 * человека совсем разные вещи, и красить их одинаково нельзя.
 */
export function dayStatus(приёмы: Dosing[], day: number, now: number): DayStatus {
  // Препараты с автосписанием в счёт не идут — так же, как в шапке экрана
  // приёма, в признаке готовности карточки и в отчёте врачу. Кнопки «Принял» у
  // них нет вовсе, отметка не появится никогда, и такой приём навсегда
  // оставался просроченным: день в ленте краснел «есть пропуски», пока вверху
  // того же экрана стояло «всё отмечено».
  const slots = приёмы.filter((п) => !п.autoDeduct).flatMap((п) => dosesOn(п, day, now))
  if (slots.length === 0) return 'empty'
  if (startOfDay(day) > startOfDay(now)) return 'future'
  if (slots.every((s) => s.takenAt !== null)) return 'done'
  return slots.some((s) => s.overdue) ? 'missed' : 'pending'
}

/**
 * Отметить приём за прошедший день.
 *
 * Время ставится плановое, а не текущее: отмечая вчерашний восьмичасовой приём
 * в полдень следующего дня, человек сообщает, что принял его вчера утром.
 * Записать «сейчас» значило бы соврать в собственных же данных.
 */
export function markTakenAt(
  box: Medicine,
  курс: Regimen,
  приёмы: Dosing[],
  plannedTs: number,
  now: number,
): { box: Medicine; regimen: Regimen } {
  // Свёртка до добавления новой отметки: старое уходит в месячные итоги, а не
  // в никуда. Свежая отметка за горизонт не попадёт и свёрткой не тронется.
  const folded = foldHistory(курс, now)
  const taken = [...(folded.taken ?? []), plannedTs].sort((a, b) => a - b)
  // Отметив приём заново, человек отменяет своё же снятие: след надо убрать,
  // иначе слияние вычтет отметку обратно и она пропадёт при первом же обмене.
  const untaken = (folded.untaken ?? []).filter((t) => t !== plannedTs)
  const regimen: Regimen = { ...folded, taken, ...(untaken.length ? { untaken } : { untaken: undefined }) }
  if (folded.autoDeduct) return { box, regimen }

  // Отметка — это подтверждение: «на сейчас у меня столько». Поэтому за основу
  // берётся расчётный остаток, а не подтверждённый: иначе всё, что израсходовано
  // за дни без отметок, теряется, и число прыгает вверх.
  const base = projectedLeft(box, приёмы, now)
  /*
   * Списываем только то, чего расчёт ещё не посчитал.
   *
   * Всякая прошедшая доза уже внутри `base`: до подтверждения остатка — внутри
   * подтверждённого числа, после — как неотмеченный прошедший приём, который
   * `projectedLeft` считает принятым. Прежнее условие требовало ещё и
   * `plannedTs > leftAt`, и отметка задним числом списывала таблетку второй
   * раз: за каждый забытый и позже отмеченный приём остаток терял единицу, а
   * «пора покупать» приходило раньше срока.
   *
   * Остаётся один случай, когда списать надо, — отметка наперёд: будущий приём
   * расчёт не учитывает.
   */
  const учтено = !!box.leftAt && plannedTs <= now
  const left = base === null ? null : Math.max(0, base - (учтено ? 0 : toPackUnits(box, perTimeOf(курс, plannedTs))))
  /*
   * Дата подтверждения у первой отметки — время самого приёма, а не «сейчас».
   *
   * Пока даты не было, расчёт не мог списать ничего: он возвращает `left` как
   * есть. Поставить здесь «сейчас» значило бы объявить, что в это число уже
   * входят все сегодняшние приёмы, — и вторая отметка за тот же вечер не
   * списывала бы ничего. Тридцать таблеток после двух принятых оставались
   * двадцатью девятью.
   *
   * Время приёма — честная граница: всё, что было до него, в числе учтено,
   * всё, что после, расчёт спишет сам. Наперёд дальше «сейчас» не заходим.
   */
  const отметка = box.leftAt ? now : Math.min(plannedTs, now)
  return { box: { ...box, left, leftAt: отметка }, regimen }
}

/** Соблюдение режима по одному препарату. */
export interface MedicineAdherence {
  /** Курс вместе с коробкой: в отчёте нужны и название, и расписание. */
  intake: Dosing
  /** Приёмов по расписанию за учтённый срок. */
  planned: number
  /** Из них отмечено. */
  taken: number
  /** С какого дня считали именно этот препарат. */
  from: number
}

export interface AdherenceReport {
  /** Начало учтённого срока — общее, по самому раннему препарату. */
  from: number
  planned: number
  taken: number
  /** Доля отмеченных, 0..1. `null` — считать не из чего. */
  rate: number | null
  rows: MedicineAdherence[]
  /** Курсы по расписанию, у которых нет ни одной отметки. */
  unmarked: Dosing[]
  /** Препараты без расписания или со списанием по расписанию: отметок у них не бывает. */
  skipped: number
  /** Запрошенный период оказался длиннее срока хранения отметок и был урезан. */
  clipped: boolean
}

/**
 * Соблюдение режима приёма за период.
 *
 * Врачу это полезнее списка препаратов: давление держится плохо не потому, что
 * лекарство слабое, а потому, что его принимают через раз. Отметки о приёме
 * уже собираются — грех не показать.
 *
 * Три границы, без которых цифра врёт, а врач по ней меняет лечение:
 *
 * 1. Отметки хранятся `KEEP_INTAKES_DAYS` дней. Запрос «за всё время» посчитал
 *    бы годовое расписание против двух месяцев отметок и выдал бы 5%.
 * 2. Препараты с автосписанием исключены: там отметок нет по устройству, а не
 *    по нерадивости.
 * 3. Каждый препарат считается от первой своей отметки. Когда препарат завели
 *    неделю назад, месячное расписание до него не относится: приложение о нём
 *    ещё не знало. Препараты без единой отметки в долю не идут вовсе и
 *    перечисляются отдельно — «не отмечал» и «не принимал» это разные вещи, и
 *    решать, какая из них верна, приложение не вправе.
 */
export function adherence(приёмы: Dosing[], from: number, now: number): AdherenceReport {
  const horizon = addDays(new Date(startOfDay(now)), -(KEEP_INTAKES_DAYS - 1)).getTime()
  const start = Math.max(startOfDay(from), horizon)
  const clipped = startOfDay(from) < horizon

  const rows: MedicineAdherence[] = []
  const unmarked: Dosing[] = []
  let skipped = 0

  for (const приём of приёмы) {
    if (!приём.times?.length || приём.autoDeduct) {
      skipped += 1
      continue
    }
    const marks = (приём.taken ?? []).filter((t) => t >= start)
    if (marks.length === 0) {
      unmarked.push(приём)
      continue
    }

    const since = startOfDay(Math.min(...marks))
    let planned = 0
    let taken = 0
    for (let day = since; day <= startOfDay(now); day = addDays(new Date(day), 1).getTime()) {
      for (const slot of dosesOn(приём, day, now)) {
        // Приём, до которого ещё не дошло время, не пропущен и в счёт не идёт.
        if (slot.takenAt === null && !slot.overdue) continue
        planned += 1
        if (slot.takenAt !== null) taken += 1
      }
    }
    rows.push({ intake: приём, planned, taken, from: since })
  }

  const planned = rows.reduce((sum, row) => sum + row.planned, 0)
  const taken = rows.reduce((sum, row) => sum + row.taken, 0)
  rows.sort((a, b) => a.intake.name.localeCompare(b.intake.name, 'ru'))

  return {
    from: rows.length ? Math.min(...rows.map((r) => r.from)) : start,
    planned,
    taken,
    rate: planned > 0 ? taken / planned : null,
    rows,
    unmarked,
    skipped,
    clipped,
  }
}

/** Сколько доз сегодня ещё не отмечено. Для пометки на переключателе. */
export function pendingToday(приёмы: Dosing[], now: number): number {
  return приёмы.reduce((sum, п) => sum + dosesToday(п, now).filter((d) => d.takenAt === null).length, 0)
}


/**
 * Снять отметку о приёме.
 *
 * Остаток при этом не меняется — и это осознанно. Снятая отметка не означает,
 * что таблетка вернулась в упаковку: чаще всего человек отметил не тот приём и
 * тут же отметит верный. Возвращать штуки «на всякий случай» опаснее, чем не
 * возвращать: завышенный остаток отодвигает предупреждение «пора заказывать», а
 * кончившееся лекарство от давления — это не неудобство. Настоящее число всегда
 * можно ввести руками.
 */
export function undoTaken(курс: Regimen, at: number): Regimen {
  // След обязателен: отметки складываются при обмене с другими телефонами, и
  // без надгробия снятая отметка возвращалась с чужого файла, где её ещё не
  // снимали. Человек снимал её снова — и снова получал обратно.
  const следы = new Set(курс.untaken ?? [])
  следы.add(at)
  return {
    ...курс,
    taken: (курс.taken ?? []).filter((t) => t !== at),
    untaken: [...следы].sort((a, b) => a - b),
  }
}

/**
 * Правка остатка руками: пересчитали упаковку — говорим приложению точное
 * число. Это же снимает накопленную расчётную поправку: отсчёт начинается
 * заново от сегодняшнего дня.
 */
export function setLeft(box: Medicine, value: number | null, now: number): Medicine {
  return { ...box, left: value === null ? null : Math.max(0, Math.round(value)), leftAt: now }
}

/**
 * Форма коротко — для списка аптечки.
 *
 * Реестр пишет «Таблетки покрытые пленочной оболочкой», и в ежедневном списке
 * это две строки мелкого текста, из которых человеку нужно одно слово: таблетки
 * это, капли или гель. Полное название остаётся там, где важна точность, — в
 * отчёте для врача и в форме правки.
 */
export function shortForm(form: string | undefined): string {
  if (!form) return ''
  return form.trim().split(/[\s,]+/)[0].toLowerCase()
}

// ── список для заказа ──────────────────────────────────────────────────────

/** На сколько дней вперёд закупаемся. Месяц — обычный горизонт рецепта. */
export const RESTOCK_DAYS = 30

export interface RestockItem {
  medicine: Medicine
  /** Почему попал в список. */
  reason: 'out' | 'low' | 'expired' | 'expiring'
  /** Сколько штук докупить до месячного запаса. `null` — расход неизвестен. */
  need: number | null
}

const REASON_WEIGHT: Record<RestockItem['reason'], number> = { out: 4, expired: 3, low: 2, expiring: 1 }

/**
 * Что пора купить.
 *
 * Список строится из тех же правил, что и предупреждения в аптечке, — иначе
 * человек видел бы тревогу на карточке и пустой список покупок рядом. Просроченное
 * входит наравне с кончающимся: пачка есть, но принимать её нельзя, значит
 * купить всё равно нужно.
 */
export function restockList(items: Stock[], now: number): RestockItem[] {
  const list: RestockItem[] = []

  for (const { box: medicine, intakes } of items) {
    const alert = medicineAlert(medicine, intakes, now)
    if (!alert) continue

    // Суточный расход — сумма по живым курсам: коробку могут принимать двое,
    // и месячный запас у неё тогда вдвое больше.
    let perDay: number | null = null
    for (const приём of intakes) {
      const своё = perDayOf(приём, now)
      if (своё === null) continue
      perDay = (perDay ?? 0) + своё
    }
    const left = alert.kind === 'expired' ? 0 : Math.max(0, projectedLeft(medicine, intakes, now) ?? 0)
    // Докупаем до месячного запаса. Просроченное считаем за ноль: старую пачку
    // в расчёт брать нельзя.
    const need = perDay !== null && perDay > 0 ? Math.max(0, Math.ceil(RESTOCK_DAYS * perDay - left)) : null

    list.push({ medicine, reason: alert.kind, need: need === 0 ? null : need })
  }

  return list.sort((a, b) => {
    const weight = REASON_WEIGHT[b.reason] - REASON_WEIGHT[a.reason]
    return weight !== 0 ? weight : a.medicine.name.localeCompare(b.medicine.name, 'ru')
  })
}

/**
 * Список одной строкой на препарат — чтобы отправить себе или показать в аптеке.
 *
 * Простой текст, а не файл: его вставляют в мессенджер, диктуют по телефону и
 * читают с экрана у прилавка. Действующее вещество идёт следом за названием:
 * в аптеке предложат аналог, и по веществу его сверяют.
 */
export function restockText(
  list: RestockItem[],
  ownerName?: (medicine: Medicine) => string | null,
  options: { checklist?: boolean } = {},
): string {
  // Пустой квадрат перед строкой: в мессенджере это единственный способ
  // передать список делами, а не абзацем. Своего формата списка покупок ни у
  // Телеграма, ни у остальных нет — есть только текст, и он должен читаться
  // списком сам по себе.
  const метка = options.checklist ? '☐ ' : ''
  const строки = list
    .map(({ medicine, need }) => {
      // Имя владельца впереди, когда список общий на семью: у прилавка
      // спрашивают не только «что», но и «кому» — от этого зависит, брать одну
      // пачку или две одинаковых.
      const чей = ownerName?.(medicine)
      const parts = [чей ? `${чей}:` : '', medicine.name, medicine.dose, shortForm(medicine.form)].filter(Boolean)
      const inn = medicine.inn && medicine.inn !== medicine.name ? ` (${medicine.inn})` : ''
      // Штуки — основная единица, и это не случайность: размер пачки у разных
      // производителей разный, и «возьми одну пачку» в аптеке, где лежит
      // только №20, даёт двадцать таблеток при потребности в двадцать восемь.
      // Но экран считает пачками, а в тексте их не было вовсе — получателю
      // нечем перевести одно в другое. Пачки идут подсказкой следом.
      const packs = packsNeeded(medicine, need)
      const count =
        need === null
          ? ''
          : packs === null
            ? ` — ${need} ${packUnit(medicine)}`
            : ` — ${need} ${packUnit(medicine)} (${packs} ${plural(packs, 'пачка', 'пачки', 'пачек')} по ${medicine.packSize})`
      // Пометка о рецепте уезжает вместе со списком: список читают у прилавка
      // и пересылают тому, кто пойдёт в аптеку вместо вас. Узнать там, что без
      // рецепта не отпустят, — это зря потраченный поход.
      const рецепт = medicine.rx ? ' — по рецепту' : ''
      // Имя отделяем пробелом, остальное запятыми: «Отец: Метформин, 850 мг».
      const голова = чей ? `${parts[0]} ${parts.slice(1).join(', ')}` : parts.join(', ')
      return `${метка}${голова}${inn}${count}${рецепт}`
    })
    .join('\n')
  if (!options.checklist) return строки
  return `Купить в аптеке:\n${строки}`
}

/**
 * Прибавить упаковку к остатку.
 *
 * Пересчитывать пачку в уме и набирать число после каждой покупки человек не
 * станет, а несписанный остаток врёт. Размер по умолчанию — из справочника,
 * но купить можно и другую пачку: в аптеке берут то, что есть.
 *
 * Складываем с расчётным остатком, а не с подтверждённым. Подтверждённый —
 * это снимок на дату `leftAt`, и всё выпитое с тех пор в нём не учтено: пачка,
 * купленная через неделю после последней правки, добавляла бы себе ещё и эти
 * семь дней. Та же причина, по которой расчётный остаток берёт отметка приёма.
 */
export function addPack(box: Medicine, приёмы: Dosing[], now: number, size?: number): Medicine {
  const pack = size ?? box.packSize
  if (!pack || pack <= 0) return box
  const base = projectedLeft(box, приёмы, now) ?? 0
  return {
    ...box,
    left: base + Math.round(pack),
    leftAt: now,
    // Купленная пачка становится обычной: и кнопка, и список покупок должны
    // говорить о той упаковке, которую человек берёт сейчас, а не о той,
    // которую однажды подсказал справочник.
    packSize: Math.round(pack),
  }
}

/** Сколько упаковок купить: в аптеке спрашивают пачками, а не таблетками. */
export function packsNeeded(box: Pick<Medicine, 'packSize'>, need: number | null): number | null {
  if (need === null || !box.packSize || box.packSize <= 0) return null
  return Math.ceil(need / box.packSize)
}

/**
 * Что показать в строке предупреждения и рисовать ли полосу запаса.
 *
 * Правило одно на все экраны, и живёт оно здесь, а не в разметке: пока оно
 * дублировалось в списке и в карточке, полоса «Хватит на 3 дня» и точно такое
 * же предупреждение стояли друг под другом.
 *
 * Про запас говорит полоса — цветом и датой, полнее любого текста. Строка
 * предупреждения тогда свободна для следующего по важности, а это срок
 * годности: истекающий в этом месяце препарат иначе молчал бы, пока кончается.
 */
export function displayAlert(
  box: Medicine,
  приёмы: Dosing[],
  now: number,
): { alert: MedicineAlert | null; showSupply: boolean; enough: boolean } {
  const main = medicineAlert(box, приёмы, now)
  const supply = supplyDays(box, приёмы, now)
  // Полосу запаса заменяет строка «хватит до конца курса»: полоса меряет запас
  // месяцами, а вопрос стоит только до последнего дня назначения.
  const enough = enoughForCourse(box, приёмы, now)
  const showSupply = supply !== null && main?.kind !== 'expired' && !enough

  const expiry = daysToExpiry(box, now)
  const expirySoon: MedicineAlert | null =
    expiry === null
      ? null
      : expiry < 0
        ? { kind: 'expired', days: expiry }
        : expiry <= EXPIRY_SOON_DAYS
          ? { kind: 'expiring', days: expiry }
          : null

  const alert = main && !(main.kind === 'low' && showSupply) ? main : expirySoon
  return { alert, showSupply, enough }
}
