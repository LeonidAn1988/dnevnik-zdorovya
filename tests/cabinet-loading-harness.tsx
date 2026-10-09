import React from 'react'
import { createRoot } from 'react-dom/client'
import { Cabinet } from '../src/ui/Cabinet'

declare global {
  interface Window { setCabinetLoading: (loading: boolean) => void }
}

const props = {
  stock: [], regimens: [], intakeSlots: [], people: [], activePerson: '',
  onSave: async () => '', onSaveRegimen: async () => {}, onDelete: async () => {},
  onStopRegimen: async () => {}, onOpenCard: () => {}, onEditCard: () => {},
  onOpenSaved: () => {}, onAdd: () => {}, onOpenRegimen: () => {},
  onRepeatRegimen: () => {}, onAddCourseMedicine: () => {}, onCloseCourseMedicine: () => {},
  onMemo: () => {}, onBack: () => {},
}

const root = createRoot(document.getElementById('root')!)
window.setCabinetLoading = loading => root.render(<Cabinet {...props} loading={loading} />)
window.setCabinetLoading(true)
