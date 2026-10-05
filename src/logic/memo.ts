/**
 * Памятка на холодильник.
 *
 * Отец инструкций не читает и в телефон лишний раз не заглядывает, а лист на
 * кухне работает: жена по нему раскладывает таблетницу, он по нему сверяется,
 * приехавший родственник по нему понимает, что происходит. Приложение до сих
 * пор печатало только отчёт врачу — мелкими таблицами и на языке врача.
 *
 * **Чего памятка не делает.** Отмеченное карандашом не возвращается в дневник:
 * приложение будет считать пропуски там, где их не было. Поэтому лист — это
 * шпаргалка, а не второй дневник, и на нём обязана стоять дата: он устаревает
 * в тот день, когда врач поменял дозу.
 */

import type { IntakeSlot } from '../types'
import type { Dosing } from './regimen'
import { addDays } from './days'
import { regimenFinished } from './regimen'
import { doseChangeOn, formatCount, perTimeOf, shortForm, timesOf } from './medicines'
import { doseUnit, toPackUnits, unitsOf } from './units'
import { describeRhythm, intakeOn } from './rhythm'

/** Сколько дней в клетках для карандаша. Неделя — шаг таблетницы. */
export const MEMO_DAYS = 7

/** Один приём в памятке: время и что в нём. */
export interface MemoSlot {
  title: string
  time: string
  items: { name: string; dose: string; count: string; form: string; meal: string; mealOrder: number; dayCounts: (string | null)[]; rhythm: string | null }[]
  /**
   * В какие из ближайших дней в этом приёме вообще что-то есть.
   *
   * Нужно клеткам под карандаш: у препарата через день половина клеток
   * означает «не принимать», и пустая клетка тут врёт — по ней поставят
   * галочку. Считается по всему приёму: если в нём осталось хоть что-то,
   * клетка рабочая.
   */
  days: boolean[]
}

/** Сколько всего отсчитать в таблетницу на неделю. */
export interface MemoTotal {
  name: string
  dose: string
  /** Сколько на всю неделю — в единицах приёма этой формы выпуска. */
  pieces: number
  /** Как эти единицы называются: «шт.», «капель», «доз». */
  unit: string
  /** Хватит ли нынешнего остатка. `null` — остаток неизвестен. */
  enough: boolean | null
}

export interface Memo {
  slots: MemoSlot[]
  totals: MemoTotal[]
  /**
   * У кого-то из препаратов доза меняется внутри недели.
   *
   * Тогда лист верен не всю неделю, и об этом надо сказать: человек, который
   * разложил таблетницу по нему, иначе разложит неверно.
   */
  doseChanges: string[]
}


/**
 * Собрать памятку на неделю вперёд от сегодня.
 *
 * Считаем по тем же правилам, что и всё остальное в аптечке: доза берётся на
 * каждый день отдельно, потому что схема приёма может её менять.
 */
export function buildMemo(medicines: Dosing[], slots: IntakeSlot[], now: number): Memo {
  const день = startOfDay(now)
  const порядок = new Map(slots.map((slot, i) => [slot.time, i]))

  // Собираем приёмы по времени, а не по кнопке: у препарата время может быть
  // своё, не совпадающее ни с одной кнопкой.
  const поВремени = new Map<string, MemoSlot>()
  const итоги = new Map<string, MemoTotal>()
  const смены: string[] = []

  for (const medicine of medicines) {
    if (medicine.stoppedAt !== undefined && now >= medicine.stoppedAt) continue
    const times = [...new Set(Array.from({length: MEMO_DAYS}, (_,i) => timesOf(medicine, addDays(new Date(день),i).getTime())).flat())]
    if (times.length === 0) continue

    const заПриём = Array.from({length: MEMO_DAYS}, (_, i) => perTimeOf(medicine, addDays(new Date(день), i).getTime())).find(amount => amount > 0) ?? 0
    if (заПриём <= 0) continue
    // Курс с назначенным концом кончается и здесь. Схемный конец ловится
    // строкой выше через дозу, а `endsAt` — нет, и лист на холодильник
    // назначал неделю отменённого препарата.
    if (regimenFinished(medicine, день)) continue

    for (const time of times) {
      const slot = поВремени.get(time) ?? {
        title: slots.find((s) => s.time === time)?.title ?? time,
        time,
        items: [],
        days: Array.from({ length: MEMO_DAYS }, () => false),
      }
      const dayCounts = Array.from({length: MEMO_DAYS}, (_, i) => {
        const day = addDays(new Date(день), i).getTime()
        const amount = perTimeOf(medicine, day)
        if (!timesOf(medicine, day).includes(time) || !intakeOn(medicine.rhythm, day) || regimenFinished(medicine, day) || amount <= 0) return null
        return unitsOf(medicine).dose[0] === 'шт.' ? formatCount(amount) : `${formatCount(amount)} ${doseUnit(medicine, amount)}`
      })
      if (!dayCounts.some(Boolean)) continue
      slot.items.push({
        dayCounts,
        name: medicine.name,
        dose: medicine.dose ?? '',
        // У таблеток единица подразумевается: «Конкор 5 мг — 1» на кухонном
        // листе понятно без «шт.», а колонка узкая. У всего остального число
        // без единицы врёт: «Вигантол — 2» это два чего, миллилитра или капли.
        count:
          unitsOf(medicine).dose[0] === 'шт.'
            ? formatCount(заПриём)
            : `${formatCount(заПриём)} ${doseUnit(medicine, заПриём)}`,
        form: shortForm(medicine.form),
        // Ритм приписан к самому препарату, а не к приёму: в одном приёме может
        // стоять ежедневный препарат и препарат через день, и подпись на весь
        // приём сказала бы неправду об одном из них.
        rhythm: describeRhythm(medicine.rhythm),
        meal: medicine.meal === 'before' ? (medicine.mealMinutes ? `За ${medicine.mealMinutes} мин до еды` : 'До еды') : medicine.meal === 'after' ? (medicine.mealMinutes ? `Через ${medicine.mealMinutes} мин после еды` : 'После еды') : medicine.meal === 'during' ? 'Во время еды' : 'Независимо от еды',
        mealOrder: medicine.meal === 'before' ? 0 : medicine.meal === 'during' ? 2 : medicine.meal === 'after' ? 3 : 1,
      })
      for (let i = 0; i < MEMO_DAYS; i++) {
        const сутки = addDays(new Date(день), i).getTime()
        if (timesOf(medicine, сутки).includes(time) && intakeOn(medicine.rhythm, сутки) && perTimeOf(medicine, сутки) > 0 && !regimenFinished(medicine, сутки))
          slot.days[i] = true
      }
      поВремени.set(time, slot)
    }

    // На неделю: доза каждого дня отдельно — курс мог кончиться в среду.
    // Неприёмные дни ритма в счёт не идут, иначе в таблетницу отсчитают вдвое
    // больше, чем нужно, и запас кончится раньше, чем покажет приложение.
    let штук = 0
    for (let i = 0; i < MEMO_DAYS; i++) {
      const текущий = addDays(new Date(день), i).getTime()
      if (!intakeOn(medicine.rhythm, текущий) || regimenFinished(medicine, текущий)) continue
      штук += perTimeOf(medicine, текущий) * timesOf(medicine, текущий).length
      if (i > 0 && (doseChangeOn(medicine, текущий) !== null || timesOf(medicine, текущий).join() !== timesOf(medicine, addDays(new Date(текущий), -1).getTime()).join())) смены.push(medicine.name)
    }
    if (штук > 0) {
      итоги.set(medicine.regimenId, {
        name: medicine.name,
        dose: medicine.dose ?? '',
        pieces: штук,
        unit: doseUnit(medicine, штук),
        // Остаток хранится в единицах упаковки, потребность посчитана в
        // единицах приёма. У капель это миллилитры против капель, и без
        // пересчёта флакон на двести капель выглядел бы пустым против
        // четырнадцати.
        enough:
          medicine.left === null || medicine.left === undefined
            ? null
            : medicine.left >= toPackUnits(medicine, штук),
      })
    }
  }

  const slotsOut = [...поВремени.values()].sort((a, b) => {
    const ai = порядок.get(a.time)
    const bi = порядок.get(b.time)
    // Кнопки идут в своём порядке, «чужие» времена — после них, по часам.
    if (ai !== undefined && bi !== undefined) return ai - bi
    if (ai !== undefined) return -1
    if (bi !== undefined) return 1
    return a.time.localeCompare(b.time)
  })

  return {
    slots: slotsOut.map(slot => ({...slot, items: [...slot.items].sort((a,b) => a.mealOrder-b.mealOrder)})),
    totals: [...итоги.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    doseChanges: [...new Set(смены)],
  }
}

function startOfDay(ts: number): number {
  const date = new Date(ts)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** A shareable message and saved UTF-8 file use the same model as the printed sheet. */
export function memoText(memo: Memo, now: number, person?: string | null): string {
  const date = new Intl.DateTimeFormat('ru-RU', {day:'numeric',month:'long',year:'numeric'})
  const lines = [`Приём лекарств${person ? ` — ${person}` : ''}`, `Памятка составлена ${date.format(now)}. На ${MEMO_DAYS} дней.`, '']
  for (const slot of memo.slots) {
    lines.push(`${slot.title === slot.time ? slot.time : `${slot.title} · ${slot.time}`}`)
    for (const item of slot.items) {
      const days = item.dayCounts.map((count, i) => count ? `${date.format(addDays(new Date(now), i))}: ${count}` : null).filter(Boolean).join('; ')
      const schedule = item.dayCounts.every(count => count === item.count) ? `ежедневно — ${item.count}` : days
      lines.push(`• ${item.name}${item.dose ? ` ${item.dose}` : ''}; ${item.meal}${item.rhythm ? `; ${item.rhythm}` : ''}`, `  ${schedule}`)
    }
    lines.push('')
  }
  if (memo.doseChanges.length) lines.push(`На неделе меняется схема приёма: ${memo.doseChanges.join(', ')}. Сверьтесь с актуальным курсом.`)
  lines.push('Памятка не заменяет назначение врача. После изменения курса составьте новую. Отметки на бумаге не попадают в дневник.')
  return lines.join('\n')
}
