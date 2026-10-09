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
  taken?: boolean; autoDeduct?: boolean; meal?: 'before' | 'after' | 'during' | 'any'; mealMinutes?: number; person?: string
} = {}) => dosing({
  id: `m-${id}`, name, dose: '5 мг', left: 30, expires: null, kind: undefined,
  stockUnit: 'piece', doseUnit: 'piece', leftAt: day,
}, {
  id, medicineId: `m-${id}`, person: options.person ?? 'p1', since: day, startedAt: day,
  times: [time], perTime: 1, autoDeduct: options.autoDeduct,
  meal: options.meal, mealMinutes: options.mealMinutes,
  taken: options.taken ? [at(time)] : undefined,
})

declare global {
  interface Window { setDailyFixture: (kind: string) => void; setDailyMark?: (taken: boolean) => void; setDailyPerson?: (person: string) => void; resolveDailyMark?: () => void; dailyActions: unknown[]; dailyTimers: MealTimer[] }
}

function Fixture({ kind }: { kind: string }) {
  const scenario = kind.replace(/-intake$/, '')
  const [screen, setScreen] = useState<'overview' | 'intake'>(kind.endsWith('-intake') ? 'intake' : 'overview')
  const [selectedPerson, setSelectedPerson] = useState('p1')
  const [openPart, setOpenPart] = useState<DayPart | null>(null)
  const [markTaken, setMarkTaken] = useState(scenario !== 'global-collapse-pending' && scenario !== 'focus-after-mark' && scenario !== 'focus-deferred' && scenario !== 'focus-failed' && scenario !== 'focus-bulk-failed')
  window.setDailyMark = scenario === 'transition' || scenario === 'global-collapse-pending' || scenario === 'focus-deferred' || scenario === 'focus-failed' || scenario === 'focus-bulk-failed' ? setMarkTaken : undefined
  window.setDailyPerson = scenario === 'person-switch' || scenario === 'reset-permission' ? setSelectedPerson : undefined
  window.resolveDailyMark = undefined
  const actions = window.dailyActions
  const intakes = scenario === 'empty'
    ? []
    : scenario === 'person-switch'
      ? [make('Препарат Анны', 'person-one', '08:00', { person: 'p1' }), make('Препарат Софии', 'person-two', '08:00', { person: 'p2' })]
    : scenario === 'reset-permission'
      ? [make('Вечерний препарат Анны', 'reset-one', '20:00', { person: 'p1' }), make('Вечерний препарат Софии', 'reset-two', '20:00', { person: 'p2' })]
    : scenario === 'midnight'
      ? [make('Утренний препарат', 'midnight', '08:00', { taken: true })]
    : scenario === 'focus-after-mark'
      ? [make('Утренний препарат', 'focus-after-mark', '08:00', { taken: markTaken })]
    : scenario === 'focus-deferred' || scenario === 'focus-failed'
      ? [make('Утренний препарат', scenario, '08:00', { taken: markTaken })]
    : scenario === 'focus-bulk-failed'
      ? [make('Первый препарат', 'bulk-one', '08:00', { taken: markTaken }), make('Второй препарат', 'bulk-two', '08:30', { taken: markTaken })]
    : scenario === 'future'
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
          : scenario === 'global-collapse-pending'
            ? [make('Утренний препарат', 'morning', '08:00', { taken: true }), make('Вечерний препарат', 'evening', '20:00', { taken: markTaken, meal: 'after', mealMinutes: 30 })]
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
      ? <TodayCard medicines={intakes} personId={selectedPerson} onOpen={open} title="Приёмы сегодня" modern condensed now={now} />
    : <><Intake medicines={intakes.filter(item => item.person === selectedPerson)} modern scopeKey={selectedPerson} onMark={async (id, planned, undo) => {
      actions.push({ kind: 'mark', args: [id, planned, undo] })
      if (scenario === 'focus-deferred') await new Promise<void>(resolve => { window.resolveDailyMark = () => { setMarkTaken(!undo); resolve() } })
      else if (scenario !== 'focus-failed' && scenario !== 'focus-bulk-failed' && (scenario === 'transition' || scenario === 'mixed' || scenario === 'global-collapse-pending' || scenario === 'focus-after-mark')) setMarkTaken(!undo)
    }}
          onMealTimer={async (...args) => { actions.push({ kind: 'timer', args }) }} onCancelMealTimer={id => { actions.push({ kind: 'cancel-timer', args: [id] }); setActiveTimers(current => current.map(timer => timer.id === id ? { ...timer, cancelledAt: now } : timer)) }} mealTimers={activeTimers}
          openPart={openPart} onPartOpened={() => setOpenPart(null)} />{scenario.startsWith('focus-') && <input aria-label="Other field" />}</>}
  </div>
}

const root = createRoot(document.getElementById('root')!)
window.dailyActions = []
window.setDailyFixture = kind => { window.dailyActions = []; root.render(<Fixture key={kind} kind={kind} />) }
window.setDailyFixture('future')
