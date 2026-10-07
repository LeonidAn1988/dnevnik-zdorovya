import type { Settings } from '../types'
import { DISPLAY_PRESETS, displayPresetOf, displayPresetPatch } from '../logic/settings'

export function DisplayPresets({ settings, onPatch }: {
  settings: Pick<Settings, 'textScale' | 'density'>
  onPatch: (patch: Pick<Settings, 'textScale' | 'density'>) => void
}) {
  const selected = displayPresetOf(settings)
  return (
    <div className="display-presets">
      <div className="tile__label">Режим интерфейса</div>
      <div className="display-presets__choices" role="group" aria-label="Режим интерфейса">
        {DISPLAY_PRESETS.map(preset => (
          <button key={preset.key} className="display-presets__choice" aria-pressed={selected === preset.key}
            onClick={() => onPatch(displayPresetPatch(preset.key))}>
            <span className="display-presets__title">{preset.title}</span>
            <span className="display-presets__hint">{preset.hint}</span>
          </button>
        ))}
      </div>
      <p className="muted display-presets__note" aria-live="polite">
        {selected ? 'Все функции доступны в обоих режимах.' : 'Размер и отступы настроены вручную.'}
      </p>
    </div>
  )
}
