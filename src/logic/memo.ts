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

import type { IntakeSlot, Medicine } from '../types'
import { doseChangeOn, formatCount, perTimeOf, shortForm } from './medicines'
import { describeRhythm, intakeOn } from './rhythm'

/** Сколько дней в клетках для карандаша. Неделя — шаг таблетницы. */
export const MEMO_DAYS = 7

/** Один приём в памятке: время и что в нём. */
export interface MemoSlot {
  title: string
  time: string
  items: { name: string; dose: string; count: string; form: string; rhythm: string | null }[]
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
  /** Штук на всю неделю. */
  pieces: number
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

const DAY = 24 * 60 * 60 * 1000

/**
 * Собрать памятку на неделю вперёд от сегодня.
 *
 * Считаем по тем же правилам, что и всё остальное в аптечке: доза берётся на
 * каждый день отдельно, потому что схема приёма может её менять.
 */
export function buildMemo(medicines: Medicine[], slots: IntakeSlot[], now: number): Memo {
  const день = startOfDay(now)
  const порядок = new Map(slots.map((slot, i) => [slot.time, i]))

  // Собираем приёмы по времени, а не по кнопке: у препарата время может быть
  // своё, не совпадающее ни с одной кнопкой.
  const поВремени = new Map<string, MemoSlot>()
  const итоги = new Map<string, MemoTotal>()
  const смены: string[] = []

  for (const medicine of medicines) {
    const times = (medicine.times ?? []).filter(Boolean)
    if (times.length === 0) continue

    const заПриём = perTimeOf(medicine, день)
    if (заПриём <= 0) continue

    for (const time of times) {
      const slot = поВремени.get(time) ?? {
        title: slots.find((s) => s.time === time)?.title ?? time,
        time,
        items: [],
        days: Array.from({ length: MEMO_DAYS }, () => false),
      }
      slot.items.push({
        name: medicine.name,
        dose: medicine.dose ?? '',
        count: formatCount(заПриём),
        form: shortForm(medicine.form),
        // Ритм приписан к самому препарату, а не к приёму: в одном приёме может
        // стоять ежедневный препарат и препарат через день, и подпись на весь
        // приём сказала бы неправду об одном из них.
        rhythm: describeRhythm(medicine.rhythm),
      })
      for (let i = 0; i < MEMO_DAYS; i++) {
        if (intakeOn(medicine.rhythm, день + i * DAY) && perTimeOf(medicine, день + i * DAY) > 0) slot.days[i] = true
      }
      поВремени.set(time, slot)
    }

    // На неделю: доза каждого дня отдельно — курс мог кончиться в среду.
    // Неприёмные дни ритма в счёт не идут, иначе в таблетницу отсчитают вдвое
    // больше, чем нужно, и запас кончится раньше, чем покажет приложение.
    let штук = 0
    for (let i = 0; i < MEMO_DAYS; i++) {
      const текущий = день + i * DAY
      if (!intakeOn(medicine.rhythm, текущий)) continue
      штук += perTimeOf(medicine, текущий) * times.length
      if (i > 0 && doseChangeOn(medicine, текущий) !== null) смены.push(medicine.name)
    }
    if (штук > 0) {
      итоги.set(medicine.id, {
        name: medicine.name,
        dose: medicine.dose ?? '',
        pieces: штук,
        enough: medicine.left === null || medicine.left === undefined ? null : medicine.left >= штук,
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
    slots: slotsOut,
    totals: [...итоги.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    doseChanges: [...new Set(смены)],
  }
}

function startOfDay(ts: number): number {
  const date = new Date(ts)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}
