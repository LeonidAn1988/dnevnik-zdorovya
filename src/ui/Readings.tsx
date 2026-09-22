import { Fragment, useState } from 'react'
import type { BpReading } from '../types'
import { CategoryBadge } from './bits'
import { SCALE_NOTE } from '../logic/disclaimer'
import { BpEditor } from './EditRow'
import { PencilIcon, TrashIcon } from './icons'

const DATE_TIME = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

const SOURCE_LABELS: Record<BpReading['source'], string> = {
  device: 'с прибора',
  manual: 'вручную',
  import: 'из файла',
}

const ARM_LABELS: Record<string, string> = { left: 'левая рука', right: 'правая рука' }

/**
 * На широком экране — таблица, на телефоне — список карточек-строк.
 * Раскладку целиком берёт на себя CSS через data-col: разметка одна и та же,
 * поэтому печатный отчёт использует этот же компонент без оговорок.
 */
export function Readings({
  readings,
  onDelete,
  onUpdate,
}: {
  readings: BpReading[]
  onDelete?: (id: string) => void
  onUpdate?: (reading: BpReading) => Promise<void>
}) {
  const [editingId, setEditingId] = useState<string | null>(null)

  if (readings.length === 0) {
    return <div className="chart__empty">За выбранный период измерений нет</div>
  }

  const rows = [...readings].sort((a, b) => b.ts - a.ts)
  const editable = Boolean(onUpdate)
  const columns = 6 + (onDelete || editable ? 1 : 0)

  return (
    <div className="table-scroll">
      <table className="readings-table">
        <thead>
          <tr>
            <th>Дата и время</th>
            <th>Верхнее / нижнее</th>
            <th>Категория</th>
            <th>Пульс</th>
            <th>Отметки</th>
            <th>Примечание</th>
            {(onDelete || editable) && <th className="no-print" aria-label="Действия" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((reading) => {
            const marks = [
              reading.ihb && 'нерегулярный пульс',
              reading.mov && 'движение',
              reading.arm && ARM_LABELS[reading.arm],
            ].filter(Boolean)
            const editing = editingId === reading.id

            return (
              <Fragment key={reading.id}>
                <tr data-editing={editing || undefined}>
                  <td data-col="when">{DATE_TIME.format(reading.ts)}</td>
                  <td data-col="val" className="num">
                    {reading.sys}/{reading.dia}
                  </td>
                  <td data-col="cat">
                    <CategoryBadge sys={reading.sys} dia={reading.dia} />
                  </td>
                  <td data-col="bpm">
                    {reading.bpm ? `${reading.bpm} уд/мин` : <span className="dash-only">—</span>}
                  </td>
                  <td data-col="marks" className="wrap">
                    {marks.length ? marks.join(', ') : <span className="dash-only">—</span>}
                  </td>
                  <td data-col="note" className="wrap">
                    {reading.note ? `${reading.note} · ` : ''}
                    <span className="muted">{SOURCE_LABELS[reading.source]}</span>
                  </td>
                  {(onDelete || editable) && (
                    <td data-col="del" className="no-print">
                      <div className="row" style={{ gap: 'var(--space-1)', flexWrap: 'nowrap' }}>
                        {editable && (
                          <button
                            className="row-edit"
                            title="Изменить измерение"
                            aria-label={`Изменить измерение от ${DATE_TIME.format(reading.ts)}`}
                            aria-expanded={editing}
                            onClick={() => setEditingId(editing ? null : reading.id)}
                          >
                            <PencilIcon />
                          </button>
                        )}
                        {onDelete && (
                          <button
                            className="btn btn--icon"
                            title="Удалить измерение"
                            aria-label={`Удалить измерение от ${DATE_TIME.format(reading.ts)}`}
                            onClick={() => onDelete(reading.id)}
                          >
                            <TrashIcon />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>

                {editing && onUpdate && (
                  <tr data-editor="true" className="no-print">
                    <td colSpan={columns}>
                      <BpEditor
                        reading={reading}
                        onCancel={() => setEditingId(null)}
                        onSave={async (next) => {
                          await onUpdate(next)
                          setEditingId(null)
                        }}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      {/* Одна подпись на весь список, а не под каждой строкой: подпись обязана
          стоять там, где показана категория, но повторять её двадцать раз —
          это уже не честность, а шум. */}
      <div className="muted" style={{ marginTop: 'var(--space-2)' }}>
        {SCALE_NOTE}
      </div>
    </div>
  )
}
