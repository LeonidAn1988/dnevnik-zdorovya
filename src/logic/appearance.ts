import type { InterfaceStyle } from '../types'

/** Device presentation only. These IDs never enter medical calculations. */
export const INTERFACE_STYLES = ['classic', 'modern', 'journal', 'rhythm', 'clear'] as const
export type ConceptStyle = 'journal' | 'rhythm' | 'clear'

export const CONCEPT_STYLES: { key: ConceptStyle; title: string; hint: string }[] = [
  { key: 'journal', title: 'Живой дневник', hint: 'Спокойные строки, тёплые цвета и дневниковые заголовки' },
  { key: 'rhythm', title: 'Ритм', hint: 'Временная шкала и чёткая структура дня' },
  { key: 'clear', title: 'Ясно', hint: 'Ближайшее действие на первом плане' },
]

export function normalizeInterfaceStyle(value: unknown): InterfaceStyle {
  return INTERFACE_STYLES.includes(value as InterfaceStyle) ? value as InterfaceStyle : 'classic'
}

export function isConceptStyle(value: unknown): value is ConceptStyle {
  return value === 'journal' || value === 'rhythm' || value === 'clear'
}

export function appearanceTitle(style: InterfaceStyle): string {
  return CONCEPT_STYLES.find(item => item.key === style)?.title
    ?? (style === 'modern' ? 'Современный' : 'Привычный')
}
