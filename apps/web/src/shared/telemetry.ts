// The site's telemetry composition (OBS-04, OBS-44; design § Site telemetry). It is off unless the build sets
// `VITE_TELEMETRY` to `on`: a disabled start installs no provider and no exporter, and the API client's fetcher then
// sends no `traceparent`. The spans reach the relay through the same-origin Pages proxy.
import { navigationSpan, startWebTelemetry } from '@d2rmm/telemetry/web';

export { tracedAction, tracingFetcher } from '@d2rmm/telemetry/web';

export const TELEMETRY_RELAY_PATH = '/api/v1/telemetry/traces';
const SITE_SERVICE_VERSION = '0.0.0';

/** The build-time settings the site reads, typed as Vite types `import.meta.env`. */
export interface TelemetryEnv {
  readonly VITE_TELEMETRY?: string;
  readonly VITE_TELEMETRY_RATIO?: string;
  readonly MODE: string;
}

/** The page location the navigation spans read: the pathname alone is ever recorded. */
export interface NavigationTarget {
  readonly location: { readonly pathname: string };
  addEventListener(type: 'popstate', listener: () => void): void;
  removeEventListener(type: 'popstate', listener: () => void): void;
}

export function telemetryOn(env: TelemetryEnv): boolean {
  return env.VITE_TELEMETRY === 'on';
}

/**
 * Records a `web.navigation` span for the page now and on each `popstate`, with the pathname alone. Returns the function
 * that removes the listener.
 */
export function traceNavigation(target: NavigationTarget): () => void {
  navigationSpan(target.location.pathname);
  const onPopState = () => {
    navigationSpan(target.location.pathname);
  };
  target.addEventListener('popstate', onPopState);
  return () => {
    target.removeEventListener('popstate', onPopState);
  };
}

/** Starts the site's traces when the build turns telemetry on, and traces the navigation. Otherwise it does nothing. */
export function startSiteTelemetry(env: TelemetryEnv, target: NavigationTarget): void {
  if (!telemetryOn(env)) {
    return;
  }
  startWebTelemetry({
    enabled: true,
    ...(env.VITE_TELEMETRY_RATIO === undefined ? {} : { ratio: env.VITE_TELEMETRY_RATIO }),
    relayPath: TELEMETRY_RELAY_PATH,
    serviceVersion: SITE_SERVICE_VERSION,
    environment: env.MODE,
  });
  traceNavigation(target);
}
