import { DISPLAY_PRESETS, displayPresetOf, displayPresetPatch, type DisplaySettings } from '../logic/settings'

export function DisplayPresets({ settings, onPatch }: {
  settings: DisplaySettings
  onPatch: (patch: DisplaySettings) => void
}) {
  const selected = displayPresetOf(settings)
  const preset = DISPLAY_PRESETS.find(item => item.key === selected)
  const custom = preset && (preset.textScale !== settings.textScale || preset.density !== settings.density)
  return (
    <div className="display-presets">
      <div className="tile__label">Режим интерфейса</div>
      <div className="display-presets__choices" role="group" aria-label="Режим интерфейса">
        {DISPLAY_PRESETS.map(preset => (
          <button key={preset.key} type="button" className="display-presets__choice" data-preset={preset.key} aria-pressed={selected === preset.key}
            onClick={() => onPatch(displayPresetPatch(preset.key))}>
            <span className="display-presets__title">{preset.title}</span>
            <span className="display-presets__hint">{preset.hint}</span>
          </button>
        ))}
      </div>
      <p className="muted display-presets__note" aria-live="polite">
        {custom ? 'Современный стиль · размер и отступы настроены вручную.' : selected ? 'Все функции доступны в каждом режиме.' : 'Размер и отступы настроены вручную.'}
      </p>
    </div>
  )
}
