// The handle of the SDK that the preload started, and its shutdown for the roots' signal handlers (design.md § API
// bootstrap). It has no side effect on import: the preload registers the handle, the roots only shut it down.
import type { TelemetryHandle } from '@d2rmm/telemetry/node';

let current: TelemetryHandle | undefined;

/** Called by the preload once the SDK runs. */
export function registerTelemetryHandle(handle: TelemetryHandle): void {
  current = handle;
}

/** Flushes and stops the SDK when one runs; a no-op when telemetry is off. */
export async function shutdownTelemetry(): Promise<void> {
  await current?.shutdown();
}
