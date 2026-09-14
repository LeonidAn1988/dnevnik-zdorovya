/**
 * Единицы измерения по форме выпуска.
 *
 * Аптечка считала всё штуками: «10 шт. в упаковке», «2 шт. за приём», «осталось
 * 6 шт.». Для таблеток и капсул это правда, для всего остального — нет. У
 * капель на упаковке написано «10 мл», принимают их каплями, а расходуются они
 * миллилитрами; у спрея на баллоне «200 доз»; у ампул — ампулы.
 *
 * **Главная тонкость — у капель единица приёма и единица упаковки разные.**
 * Везде ещё можно было обойтись подменой подписи, а здесь нужен пересчёт: чтобы
 * списать с десяти миллилитров две капли, надо знать, сколько капель в
 * миллилитре. Постоянной это число не является: фармакопейная капля — 1/20 мл,
 * но у масляных растворов она мельче. У «Вигантола» (0,5 мг/мл, то есть 20 000
 * МЕ в миллилитре) инструкция обещает 500 МЕ в капле — это сорок капель в
 * миллилитре, вдвое против стандарта. Поэтому коэффициент здесь поле со
 * значением по умолчанию, а не вшитая константа, и рядом с ним написано, где
 * посмотреть настоящее.
 *
 * **Что при этом не меняется — смысл хранимых чисел.** `packSize` и `left`
 * по-прежнему в единицах упаковки, `perTime` — в единицах приёма. У таблеток
 * это одно и то же, поэтому старые записи остаются верными и переносить ничего
 * не нужно.
 */

import type { Medicine } from '../types'
import { formGroup } from './drugs'
import { plural } from './plural'

/** Фармакопейная капля — двадцатая доля миллилитра. Отсюда считаем, пока не поправят. */
export const DROPS_PER_ML = 20

/** Как называются единицы у одной группы форм. */
export interface FormUnits {
  /** Единица упаковки в краткой записи: «мл», «шт.», «г». */
  pack: string
  /** Подпись поля «сколько в упаковке». */
  packLabel: string
  /** Единица приёма в трёх формах: 1 капля, 2 капли, 5 капель. */
  dose: [string, string, string]
  /** Подпись поля «за один приём». */
  doseLabel: string
  /** Дробят ли единицу приёма: половину таблетки принимают, половину капли — нет. */
  fractional: boolean
}

const ШТУКИ: FormUnits = {
  pack: 'шт.',
  packLabel: 'Штук в пачке',
  dose: ['шт.', 'шт.', 'шт.'],
  doseLabel: 'Штук за приём',
  fractional: true,
}

/**
 * Единицы по группам форм выпуска. Группы те же, что у поиска в справочнике, —
 * заводить второй список значило бы рано или поздно их разойтись.
 */
const ПО_ГРУППАМ: Record<string, FormUnits> = {
  tab: ШТУКИ,
  cap: ШТУКИ,
  drops: {
    pack: 'мл',
    packLabel: 'Миллилитров во флаконе',
    dose: ['капля', 'капли', 'капель'],
    doseLabel: 'Капель за приём',
    // Половина капли не отмеряется ничем.
    fractional: false,
  },
  syrup: {
    pack: 'мл',
    packLabel: 'Миллилитров во флаконе',
    dose: ['мл', 'мл', 'мл'],
    doseLabel: 'Миллилитров за приём',
    fractional: true,
  },
  inj: {
    pack: 'амп.',
    packLabel: 'Ампул в упаковке',
    dose: ['амп.', 'амп.', 'амп.'],
    doseLabel: 'Ампул за приём',
    fractional: true,
  },
  spray: {
    pack: 'доз',
    packLabel: 'Доз в баллоне',
    dose: ['доза', 'дозы', 'доз'],
    doseLabel: 'Доз за приём',
    fractional: false,
  },
  ointment: {
    pack: 'г',
    packLabel: 'Граммов в тюбике',
    dose: ['г', 'г', 'г'],
    doseLabel: 'Граммов за приём',
    fractional: true,
  },
  other: ШТУКИ,
}

/** Единицы этого препарата. Без формы выпуска — штуки, как было всегда. */
export function unitsOf(medicine: Pick<Medicine, 'form'>): FormUnits {
  return ПО_ГРУППАМ[formGroup(medicine.form ?? '')] ?? ШТУКИ
}

/**
 * Сколько единиц приёма в одной единице упаковки.
 *
 * Единица для всех, кроме капель: миллилитр сиропа так и остаётся миллилитром,
 * а ампула ампулой. У капель — то самое число капель в миллилитре.
 */
export function dosesPerPackUnit(medicine: Pick<Medicine, 'form' | 'dropsPerMl'>): number {
  if (formGroup(medicine.form ?? '') !== 'drops') return 1
  const своё = medicine.dropsPerMl
  return Number.isFinite(своё) && (своё ?? 0) > 0 ? своё! : DROPS_PER_ML
}

/** Нужен ли этому препарату вопрос «сколько капель в миллилитре». */
export function needsDropSize(medicine: Pick<Medicine, 'form'>): boolean {
  return formGroup(medicine.form ?? '') === 'drops'
}

/**
 * Единица приёма с числом: «2 капли», «1 шт.».
 *
 * Число форматируется снаружи — половинки таблеток пишутся дробью, и знать об
 * этом единицам незачем.
 */
export function doseUnit(medicine: Pick<Medicine, 'form'>, count: number): string {
  const [одна, две, много] = unitsOf(medicine).dose
  return plural(Math.round(count), одна, две, много)
}

/** Единица упаковки: «мл», «шт.». Формы у неё одна — сокращения не склоняются. */
export function packUnit(medicine: Pick<Medicine, 'form'>): string {
  return unitsOf(medicine).pack
}

/**
 * Перевести назначенное за приём в единицы упаковки — то, чем списывается остаток.
 *
 * Две капли из флакона в десять миллилитров это не «минус два», а минус одна
 * двадцатая миллилитра. Без пересчёта флакон «кончался» за пять приёмов.
 */
export function toPackUnits(medicine: Pick<Medicine, 'form' | 'dropsPerMl'>, doses: number): number {
  return doses / dosesPerPackUnit(medicine)
}

/** Сколько приёмов в упаковке: «10 мл — это около 200 капель». */
export function dosesInPack(medicine: Pick<Medicine, 'form' | 'dropsPerMl' | 'packSize'>): number | null {
  const size = medicine.packSize
  if (!size || size <= 0) return null
  const всего = size * dosesPerPackUnit(medicine)
  return Number.isFinite(всего) ? всего : null
}

/**
 * Доза с единицей для строки приёма: «2 капли», «½ шт.», пусто.
 *
 * У таблеток единственная штука не называется: «Конкор — 1 шт.» в напоминании
 * это шум, там и так всё ясно. У капель и доз спрея — называется всегда: «1
 * капля» и «1 доза» отличают назначение от простого «прими».
 */
export function doseAmount(medicine: Pick<Medicine, 'form'>, count: number, formatted: string): string {
  const единицы = unitsOf(medicine)
  const штуки = единицы.dose[0] === 'шт.'
  if (штуки && count === 1) return ''
  return `${formatted} ${doseUnit(medicine, count)}`
}
