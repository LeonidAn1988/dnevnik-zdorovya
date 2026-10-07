import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MedicineForm } from '../src/ui/MedicineForm'
import { RegimenForm } from '../src/ui/RegimenForm'
import { Intake } from '../src/ui/Intake'
import { dosing } from '../src/logic/regimen'
import type { Medicine, Regimen } from '../src/types'

const w = window as any
const root = createRoot(document.getElementById('root')!)
const people = [{ id: 'p1', name: 'Анна' }, { id: 'p2', name: 'Борис' }]
const medicines: Medicine[] = [
  { id: 'm1', name: 'Первый', dose: '5 мг', left: 20, expires: null, doseUnit: 'piece', stockUnit: 'piece' },
  { id: 'm2', name: 'Второй', dose: '10 мг', left: 30, expires: null, doseUnit: 'piece', stockUnit: 'piece' },
]
const start = new Date(2026, 9, 7).getTime()
const course: Regimen = { id: 'r1', medicineId: 'm1', person: 'p1', times: ['08:00', '20:00'], perTime: 1, planFrom: start,
  plan: [{ days: 14, perTime: 1, times: ['08:00', '20:00'] }, { days: 30, perTime: 1, times: ['08:00'] }] }
const slots = [{ id: 'morning', title: 'Утро', time: '08:00' }, { id: 'evening', title: 'Вечер', time: '20:00' }]

function Forms({ kind, existing }: { kind: 'medicine' | 'regimen'; existing: boolean }) {
  const [visible, show] = useState(true)
  const [person, selectPerson] = useState('p1')
  const [id, select] = useState(existing ? 'm1' : 'new')
  const [boxes, setBoxes] = useState(medicines)
  const [regimen, setRegimen] = useState(course)
  w.away = () => show(false)
  w.back = () => show(true)
  w.person = selectPerson
  w.object = select
  w.syncMedicine = (patch: Partial<Medicine>) => setBoxes(previous => previous.map(item => item.id === id ? { ...item, ...patch } : item))
  w.syncRegimen = (patch: Partial<Regimen>) => setRegimen(previous => ({ ...previous, ...patch }))
  async function save(next: Medicine | Regimen) {
    w.saves.push(next)
    if (w.failSave) throw new Error('Ошибка тестовой записи')
    if (w.deferSave) await new Promise<void>(resolve => { w.finishSave = resolve })
    show(false)
  }
  return <div className="app"><section className="card">
    {visible ? kind === 'medicine'
      ? <MedicineForm medicine={boxes.find(item => item.id === id)} draftOwner={person} onSave={save} onCancel={() => show(false)} />
      : <RegimenForm regimen={existing ? regimen : undefined} medicineId="m1" medicines={boxes} people={people} activePerson={person} intakeSlots={slots} onSave={save} onCancel={() => show(false)} onAddMedicine={() => show(false)} />
      : <p>Другой раздел</p>}
  </section></div>
}

w.saves = []
w.runForm = (kind: 'medicine' | 'regimen', existing = true) => root.render(<Forms kind={kind} existing={existing} />)
w.runIntake = (empty: boolean) => root.render(<div className="app"><Intake medicines={empty ? [] : [dosing(medicines[0], { ...course, plan: undefined, times: [], perDay: 1 })]} onMark={async () => {}} onAddMedicine={() => { w.addClicked = true }} /></div>)
