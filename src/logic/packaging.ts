import { legacyUnits } from './units'

/** Packaging clarification outside the registry's physical-container count. */
export const PACKAGING_CLARIFICATIONS = [{
  name: /пепсан/i,
  form: /гель.*внутрь/i,
  stockUnit: 'sachet' as const,
  doseUnit: 'sachet' as const,
  description: 'Пепсан-Р: одно саше содержит 10 г геля. Пакетики считаются в саше; масса содержимого — отдельная величина.',
  source: 'https://base-donnees-publique.medicaments.gouv.fr/medicament/61391268/extrait',
}]
export function packagingOf(name: string, form: string) {
  return PACKAGING_CLARIFICATIONS.find(entry => entry.name.test(name) && entry.form.test(form))
}
export function newMedicineUnits(name: string, form: string) {
  const known = packagingOf(name, form)
  if (known) return {stockUnit: known.stockUnit, doseUnit: known.doseUnit}
  if (/раствор.*(внутрь|перораль|наруж|местн)/i.test(form)) return {stockUnit: 'ml' as const, doseUnit: 'ml' as const}
  return legacyUnits({form})
}
