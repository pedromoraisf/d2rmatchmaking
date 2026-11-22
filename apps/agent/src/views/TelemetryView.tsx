// The diagnostics part of the window (OBT-14 to OBT-17): what the diagnostics carry in this build's tier, and the one switch
// that turns the export off. The switch never touches heartbeats or observations; the notice says so.
import type { Translate } from '../shared/labels.ts';

export type TelemetryTier = 'full' | 'production';

interface TelemetryViewProps {
  enabled: boolean;
  tier: TelemetryTier;
  failed: boolean;
  translate: Translate;
  onChange: (enabled: boolean) => void;
}

export function TelemetryView({ enabled, tier, failed, translate, onChange }: TelemetryViewProps) {
  const notice = translate(tier === 'full' ? 'telemetry.noticeFull' : 'telemetry.noticeProduction');
  const heading = translate('telemetry.heading');
  const label = translate('telemetry.switch');
  const state = translate(enabled ? 'telemetry.on' : 'telemetry.off');
  const effect = translate('telemetry.effect');
  const notSaved = failed ? translate('telemetry.notSaved') : null;
  return (
    <section aria-labelledby="telemetry-heading">
      <h2 id="telemetry-heading">{heading}</h2>
      <p>{notice}</p>
      <label>
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          onChange={(event) => onChange(event.target.checked)}
        />{' '}
        {label}
      </label>
      <p aria-live="polite">{state}</p>
      <p>{effect}</p>
      {notSaved === null ? null : <p role="alert">{notSaved}</p>}
    </section>
  );
}
