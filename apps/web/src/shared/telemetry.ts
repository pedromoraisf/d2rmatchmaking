// The site's telemetry composition (OBS-04, OBS-44, OBT-01, OBT-07; ADR 037). Telemetry starts in every build (AD-098 is
// lifted); `VITE_TELEMETRY=off` is the one way to turn it off. The tier comes from the API's boot configuration at run
// time, not from the build: the site is built once and promoted (ADR 033). Until the tier is read, and when it cannot be
// read, the site is in the production tier. The spans reach the relay through the same-origin Pages proxy.
import type { TelemetryTier } from '@d2rmm/telemetry';
import { navigationSpan, setWebJourney, startWebTelemetry } from '@d2rmm/telemetry/web';
import { setTier } from './telemetry-tier.ts';

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

/** Telemetry is on in every build unless the build sets `VITE_TELEMETRY` to `off`. */
export function telemetryOn(env: TelemetryEnv): boolean {
  return env.VITE_TELEMETRY !== 'off';
}

/** The ids of one person's journey, as the site knows them (OBT-07). Every field is optional. */
export interface SiteJourney {
  readonly accountId?: string | undefined;
  readonly roomId?: string | undefined;
  readonly ticketId?: string | undefined;
  readonly readyCheckId?: string | undefined;
  /** The signed-in BattleTag (or test name); recorded in the full tier only. */
  readonly battletag?: string | undefined;
}

/**
 * The span attributes of a journey in `tier`: the ids in both tiers, the BattleTag in the full tier only. The exporter
 * redacts the BattleTag key again in production (OBT-08).
 */
export function journeyAttributes(
  journey: SiteJourney,
  tier: TelemetryTier,
): Record<string, string | undefined> {
  return {
    'd2r.account.id': journey.accountId,
    'd2r.room.id': journey.roomId,
    'd2r.ticket.id': journey.ticketId,
    'd2r.ready_check.id': journey.readyCheckId,
    'd2r.account.battletag': tier === 'full' ? journey.battletag : undefined,
  };
}

/** Tells the spans started from now on whose journey they belong to. Call it again whenever an id changes. */
export function setSiteJourney(journey: SiteJourney, tier: TelemetryTier): void {
  setWebJourney(journeyAttributes(journey, tier));
}

/** How the tier is read: the API's `telemetryTier`, or `null` when it cannot be read. */
export type TierReader = () => Promise<TelemetryTier | null>;

const TIER_READ_ATTEMPTS = 5;
const TIER_READ_BACKOFF_MS = 3000;

/**
 * Reads the tier, retrying while the API wakes (a sleeping API takes up to a minute). An unreadable tier is
 * `production` (OBT-01).
 */
export async function readTier(
  read: TierReader,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<TelemetryTier> {
  for (let attempt = 1; attempt <= TIER_READ_ATTEMPTS; attempt += 1) {
    const tier = await read().catch(() => null);
    if (tier !== null) return tier;
    if (attempt < TIER_READ_ATTEMPTS) await sleep(TIER_READ_BACKOFF_MS * attempt);
  }
  return 'production';
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

/**
 * Starts the site's traces unless the build turns them off, with the tier the API reports, and traces the navigation.
 * Resolves to the tier in use. The page renders without waiting for it.
 */
export async function startSiteTelemetry(
  env: TelemetryEnv,
  target: NavigationTarget,
  read: TierReader,
  sleep?: (ms: number) => Promise<void>,
): Promise<TelemetryTier> {
  if (!telemetryOn(env)) {
    return 'production';
  }
  const tier = await readTier(read, sleep);
  setTier(tier);
  startWebTelemetry({
    enabled: true,
    ...(env.VITE_TELEMETRY_RATIO === undefined ? {} : { ratio: env.VITE_TELEMETRY_RATIO }),
    relayPath: TELEMETRY_RELAY_PATH,
    serviceVersion: SITE_SERVICE_VERSION,
    // The boot configuration carries the tier only, so the site names its environment by it: staging is the full tier.
    environment: tier === 'full' ? 'staging' : 'production',
    tier,
  });
  traceNavigation(target);
  return tier;
}
