import type { EngineSettings } from '../app/settings';

interface Props {
  settings: EngineSettings;
  onChange: (patch: Partial<EngineSettings>) => void;
}

export function SettingsPanel({ settings, onChange }: Props) {
  return (
    <div className="panel settings" role="group" aria-label="Settings">
      <label className="settings-name">
        <span>
          <b>Name for star show</b>
          <small>Enter a name to write in light (up to 24 characters).</small>
        </span>
        <input
          type="text"
          value={settings.displayName}
          maxLength={24}
          aria-label="Name for star show"
          onChange={(e) => onChange({ displayName: e.target.value.slice(0, 24) })}
        />
      </label>
      <label>
        <input type="checkbox" checked={settings.lowEffects} onChange={(e) => onChange({ lowEffects: e.target.checked })} />
        <span>
          <b>Low-effects mode</b>
          <small>Fewer particles and lower resolution for weaker computers.</small>
        </span>
      </label>
      <label>
        <input type="checkbox" checked={settings.reducedFlash} onChange={(e) => onChange({ reducedFlash: e.target.checked })} />
        <span>
          <b>Reduced motion &amp; flashing</b>
          <small>Softer glow, slower twinkling, no bright bursts.</small>
        </span>
      </label>
      <label>
        <input type="checkbox" checked={settings.showDebug} onChange={(e) => onChange({ showDebug: e.target.checked })} />
        <span>
          <b>Show tracking debug</b>
          <small>Draw hand / face landmarks and performance numbers.</small>
        </span>
      </label>
    </div>
  );
}
