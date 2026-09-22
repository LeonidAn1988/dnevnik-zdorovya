/**
 * Разбор коробки старого образца на коробку и курс приёма.
 *
 * До 0.27.0 `Medicine` держал и то и другое сразу. Разбор нужен в трёх местах
 * и обязан быть одинаковым во всех: при обновлении базы, при чтении старой
 * резервной копии и при обмене с телефоном, где стоит прежняя версия.
 *
 * Идентификатор курса выводится из идентификатора коробки, а не берётся
 * случайным. Иначе два телефона, обновившиеся порознь, развели бы один и тот
 * же курс в два, и следующий же обмен положил бы в дневник двойные приёмы.
 */

import type { Medicine, Regimen } from '../types'

/** Коробка, какой она была до 0.27.0: с полями курса внутри. */
export type LegacyMedicine = Medicine &
  Partial<Omit<Regimen, 'id' | 'medicineId' | 'person'>> & {
    /** Чей препарат. В новой модели коробка ничья, а человек — у курса. */
    owner?: string
  }

/** Поля, которые уехали из коробки в курс. Перечислены явно — чтобы не забыть. */
const ПОЛЯ_КУРСА = [
  'times',
  'perTime',
  'meal',
  'rhythm',
  'plan',
  'planFrom',
  'perDay',
  'autoDeduct',
  'since',
  'startedAt',
  'taken',
  'history',
  'foldedUntil',
] as const

/** Идентификатор курса, выведенный из коробки. Одинаков на всех телефонах. */
export function regimenIdFor(medicineId: string): string {
  return `r-${medicineId}`
}

/**
 * Разобрать коробку старого образца.
 *
 * Курс заводится, если у коробки был владелец или хоть что-то про приём.
 * Владелец был проставлен у всего, что заведено после появления людей, поэтому
 * на практике курс получает каждая коробка — и это правильно: раньше коробка
 * без человека не существовала, и молча терять «чьё это» нельзя.
 *
 * Курс без расписания — нормальное состояние: препарат по потребности.
 */
export function splitBox(старая: LegacyMedicine, кому: string | null): { box: Medicine; regimen: Regimen | null } {
  const box: Medicine = { ...(старая as Medicine) }
  const запись = box as unknown as Record<string, unknown>
  for (const поле of ПОЛЯ_КУРСА) delete запись[поле]
  delete запись.owner

  const естьПриём = ПОЛЯ_КУРСА.some((поле) => старая[поле] !== undefined)
  if (!естьПриём && старая.owner === undefined) return { box, regimen: null }

  // Человек неизвестен только в одном случае: в дневнике нет ни одного. Тогда
  // курс всё равно заводится с пустым человеком — расписание и отметки дороже
  // аккуратности поля, а первый же запуск проставит владельца.
  const человек = старая.owner ?? кому ?? ''
  const regimen: Regimen = { id: regimenIdFor(старая.id), medicineId: старая.id, person: человек }
  for (const поле of ПОЛЯ_КУРСА) {
    const значение = старая[поле]
    if (значение !== undefined) (regimen as unknown as Record<string, unknown>)[поле] = значение
  }
  // Время правки наследуется от коробки: обмену нужно знать, чья запись свежее,
  // а другого источника у разобранного курса нет.
  if (старая.updatedAt !== undefined) regimen.updatedAt = старая.updatedAt
  return { box, regimen }
}

/** Разобрать всю аптечку старого образца разом. */
export function splitBoxes(
  старые: LegacyMedicine[],
  кому: string | null,
): { boxes: Medicine[]; regimens: Regimen[] } {
  const boxes: Medicine[] = []
  const regimens: Regimen[] = []
  for (const старая of старые) {
    const { box, regimen } = splitBox(старая, кому)
    boxes.push(box)
    if (regimen) regimens.push(regimen)
  }
  return { boxes, regimens }
}

/** Похоже ли, что коробка ещё старого образца и её надо разбирать. */
export function needsSplit(коробка: LegacyMedicine): boolean {
  return коробка.owner !== undefined || ПОЛЯ_КУРСА.some((поле) => коробка[поле] !== undefined)
}
