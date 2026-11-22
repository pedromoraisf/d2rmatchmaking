// The telemetry tier the site runs in, read once from the API's boot configuration (OBT-01). Until it is known, and
// whenever it cannot be read, the site is in the production tier: the stricter tier is the safe failure. A tiny store, so
// the frame can show the recording notice (OBT-12) when the tier arrives.
import type { TelemetryTier } from '@d2rmm/telemetry';

let current: TelemetryTier = 'production';
const listeners = new Set<() => void>();

export function currentTier(): TelemetryTier {
  return current;
}

export function setTier(next: TelemetryTier): void {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

export function subscribeTier(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
