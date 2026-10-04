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

import type { Medicine, QuantityUnit } from '../types'
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
type UnitMedicine = Pick<Medicine, 'form' | 'stockUnit' | 'doseUnit' | 'dropsPerMl'>

export const UNIT_LABELS: Record<QuantityUnit, string> = {
  piece: 'Штуки', sachet: 'Саше / пакетики', ml: 'Миллилитры', g: 'Граммы',
  drop: 'Капли', dose: 'Дозы', ampoule: 'Ампулы',
}
const LABELS: Record<QuantityUnit, [string, string, string]> = {
  piece: ['шт.', 'шт.', 'шт.'], sachet: ['саше', 'саше', 'саше'], ml: ['мл', 'мл', 'мл'],
  g: ['г', 'г', 'г'], drop: ['капля', 'капли', 'капель'], dose: ['доза', 'дозы', 'доз'],
  ampoule: ['амп.', 'амп.', 'амп.'],
}
export function legacyUnits(medicine: Pick<Medicine, 'form'>): { stockUnit: QuantityUnit; doseUnit: QuantityUnit } {
  const group = formGroup(medicine.form ?? '')
  const stockUnit: QuantityUnit = group === 'drops' || group === 'syrup' ? 'ml' : group === 'inj' ? 'ampoule' : group === 'ointment' ? 'g' : group === 'spray' ? 'dose' : 'piece'
  return { stockUnit, doseUnit: group === 'drops' ? 'drop' : stockUnit }
}
/** Legacy numbers retain their original meaning. New records choose units explicitly. */
export function stockUnitOf(m: UnitMedicine): QuantityUnit { return m.stockUnit ?? legacyUnits(m).stockUnit }
export function doseUnitOf(m: UnitMedicine): QuantityUnit { return m.doseUnit ?? legacyUnits(m).doseUnit }
export function unitsOf(medicine: UnitMedicine): FormUnits {
  const stock = stockUnitOf(medicine), dose = doseUnitOf(medicine)
  if (!medicine.stockUnit && !medicine.doseUnit) return ПО_ГРУППАМ[formGroup(medicine.form ?? '')] ?? ШТУКИ
  return { pack: LABELS[stock][2], packLabel: `В упаковке, ${LABELS[stock][2]}`, dose: LABELS[dose], doseLabel: `За приём, ${LABELS[dose][2]}`, fractional: !['drop', 'dose'].includes(dose) }
}
export function dosesPerPackUnit(m: UnitMedicine): number {
  if (stockUnitOf(m) === doseUnitOf(m)) return 1
  if (stockUnitOf(m) === 'ml' && doseUnitOf(m) === 'drop') {
    if (m.stockUnit && !(m.dropsPerMl && m.dropsPerMl > 0)) return NaN
    return m.dropsPerMl && m.dropsPerMl > 0 ? m.dropsPerMl : DROPS_PER_ML
  }
  return NaN
}
export function needsDropSize(m: UnitMedicine): boolean { return stockUnitOf(m) === 'ml' && doseUnitOf(m) === 'drop' }
export function doseUnit(m: UnitMedicine, count: number): string { return plural(Math.round(count), ...unitsOf(m).dose) }
export function packUnit(m: UnitMedicine): string { return unitsOf(m).pack }
export function toPackUnits(m: UnitMedicine, doses: number): number { return doses / dosesPerPackUnit(m) }
export function dosesInPack(m: UnitMedicine & Pick<Medicine, 'packSize'>): number | null {
  const n = (m.packSize ?? 0) * dosesPerPackUnit(m)
  return n > 0 && Number.isFinite(n) ? n : null
}
export function doseAmount(m: UnitMedicine, count: number, formatted: string): string {
  if (doseUnitOf(m) === 'piece' && count === 1) return ''
  return `${formatted} ${doseUnit(m, count)}`
}
