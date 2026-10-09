import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { dosing } from '../src/logic/regimen'
import { TodayCard } from '../src/ui/Medicines'
import { Intake, type DayPart } from '../src/ui/Intake'
import type { MealTimer } from '../src/types'

const now = new Date('2026-08-15T10:30:00+03:00').getTime()
const day = new Date(now).setHours(0, 0, 0, 0)
const at = (time: string) => {
  const [hour, minute] = time.split(':').map(Number)
  return new Date(day).setHours(hour, minute, 0, 0)
}
const make = (name: string, id: string, time: string, options: {
  taken?: boolean; autoDeduct?: boolean; meal?: 'before' | 'after' | 'during' | 'any'; mealMinutes?: number
} = {}) => dosing({
  id: `m-${id}`, name, dose: '5 мг', left: 30, expires: null, kind: undefined,
  stockUnit: 'piece', doseUnit: 'piece', leftAt: day,
}, {
  id, medicineId: `m-${id}`, person: 'p1', since: day, startedAt: day,
  times: [time], perTime: 1, autoDeduct: options.autoDeduct,
  meal: options.meal, mealMinutes: options.mealMinutes,
  taken: options.taken ? [at(time)] : undefined,
})

declare global {
  interface Window { setDailyFixture: (kind: string) => void; setDailyMark?: (taken: boolean) => void; dailyActions: unknown[]; dailyTimers: MealTimer[] }
}

function Fixture({ kind }: { kind: string }) {
  const scenario = kind.replace(/-intake$/, '')
  const [screen, setScreen] = useState<'overview' | 'intake'>(kind.endsWith('-intake') ? 'intake' : 'overview')
  const [openPart, setOpenPart] = useState<DayPart | null>(null)
  const [markTaken, setMarkTaken] = useState(true)
  window.setDailyMark = scenario === 'transition' ? setMarkTaken : undefined
  const actions = window.dailyActions
  const intakes = scenario === 'future'
    ? [make('Вечерний препарат', 'evening', '20:00'), make('Поздний препарат', 'late', '21:00')]
    : scenario === 'available'
      ? [make('Утренний препарат', 'morning', '08:00')]
        : scenario === 'automatic-window'
          ? [make('Автоматический ранний', 'auto-early', '08:00', { autoDeduct: true }), make('Ручной поздний', 'manual-late', '11:45')]
        : scenario === 'automatic'
        ? [make('Автоматический препарат', 'auto', '08:00', { autoDeduct: true })]
        : scenario === 'complete'
          ? [make('Утренний препарат', 'complete', '08:00', { taken: true })]
          : scenario === 'transition'
            ? [make('Утренний препарат', 'transition', '08:00', { taken: markTaken })]
          : scenario === 'mixed'
            ? [make('Утренний препарат', 'morning', '08:00', { taken: markTaken }), make('Вечерний препарат', 'evening', '20:00')]
          : scenario === 'priority'
            ? [make('Утренний препарат', 'priority-morning', '08:00', { taken: true }), make('Дневной препарат', 'priority-day', '12:00'), make('Вечерний препарат', 'priority-evening', '20:00')]
          : scenario === 'timer'
            ? [make('Утренний препарат', 'timer', '08:00', { taken: true, meal: 'before', mealMinutes: 20 })]
          : scenario === 'timer-cancel'
            ? [make('Утренний препарат', 'timer', '08:00', { taken: true, meal: 'before', mealMinutes: 20 })]
          : scenario === 'timer-priority'
            ? [make('Утренний препарат', 'timer', '08:00', { taken: true, meal: 'before', mealMinutes: 20 }), make('Дневной препарат', 'priority-day', '12:00'), make('Вечерний препарат', 'priority-evening', '20:00')]
          : [make('Утренний препарат', 'morning', '08:00', { taken: true }), make('Вечерний препарат', 'evening', '20:00')]
  const timers: MealTimer[] = scenario === 'timer' || scenario === 'timer-priority' || scenario === 'timer-cancel' ? [{
    id: 'timer1', regimenId: 'timer', plannedAt: at('08:00'), person: 'p1', medicineName: 'Утренний препарат',
    kind: 'eat', startedAt: now, dueAt: now + 20 * 60_000,
  }, ...(scenario === 'timer-cancel' ? [
    { id: 'wrong-kind', regimenId: 'timer', plannedAt: at('08:00'), person: 'p1', medicineName: 'Wrong kind', kind: 'dose' as const, startedAt: now, dueAt: now + 5 * 60_000 },
    { id: 'wrong-person', regimenId: 'timer', plannedAt: at('08:00'), person: 'p2', medicineName: 'Wrong person', kind: 'eat' as const, startedAt: now, dueAt: now + 5 * 60_000 },
    { id: 'cancelled', regimenId: 'timer', plannedAt: at('08:00'), person: 'p1', medicineName: 'Cancelled', kind: 'eat' as const, startedAt: now, dueAt: now + 5 * 60_000, cancelledAt: now - 1 },
    { id: 'expired', regimenId: 'timer', plannedAt: at('08:00'), person: 'p1', medicineName: 'Expired', kind: 'eat' as const, startedAt: now - 5 * 60_000, dueAt: now },
  ] : [])] : []
  const [activeTimers, setActiveTimers] = useState(timers)
  window.dailyTimers = activeTimers
  const open = (part?: DayPart) => { setOpenPart(part ?? null); setScreen('intake') }
  return <div className="app" data-nav={screen}>
    {screen === 'overview'
      ? <TodayCard medicines={intakes} personId="p1" onOpen={open} title="Приёмы сегодня" modern condensed now={now} />
      : <Intake medicines={intakes} modern scopeKey="p1" onMark={async (id, planned, undo) => { actions.push({ kind: 'mark', args: [id, planned, undo] }); if (scenario === 'transition' || scenario === 'mixed') setMarkTaken(!undo) }}
          onMealTimer={async (...args) => { actions.push({ kind: 'timer', args }) }} onCancelMealTimer={id => { actions.push({ kind: 'cancel-timer', args: [id] }); setActiveTimers(current => current.map(timer => timer.id === id ? { ...timer, cancelledAt: now } : timer)) }} mealTimers={activeTimers}
          openPart={openPart} onPartOpened={() => setOpenPart(null)} />}
  </div>
}

const root = createRoot(document.getElementById('root')!)
window.dailyActions = []
window.setDailyFixture = kind => { window.dailyActions = []; root.render(<Fixture key={kind} kind={kind} />) }
window.setDailyFixture('future')
