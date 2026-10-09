import { useEffect, useRef, useState } from 'react'
import type { Medicine } from '../types'
import { MedicineForm } from './MedicineForm'

/** A separate native dialog and form, above the still-mounted course draft. */
export function CourseMedicineDialog({ name, draftKey, onSave, onClose }: {
  name: string
  draftKey: string
  onSave: (medicine: Medicine) => Promise<void>
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const el = dialog.current!
    const previousFocus = document.activeElement
    el.showModal()
    title.current?.focus()
    return () => {
      el.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])
  return <dialog ref={dialog} className="sheet course-medicine-dialog" aria-label="Новый препарат для курса"
    data-busy={busy ? 'true' : undefined} onClose={() => { if (dialog.current && !dialog.current.open) onClose() }} onCancel={event => { if (busy) event.preventDefault() }}>
    <div className="sheet__body">
      <h2 ref={title} tabIndex={-1}>Добавить препарат в аптечку</h2>
      <p className="muted">После добавления вернётесь к курсу. Его настройки сохранятся.</p>
      <MedicineForm draftKey={`course:${draftKey}`} initialName={name} saveLabel="Добавить в аптечку"
        onCancel={onClose} onSave={async medicine => {
          setBusy(true)
          try { await onSave(medicine) } finally { setBusy(false) }
        }} />
    </div>
  </dialog>
}
