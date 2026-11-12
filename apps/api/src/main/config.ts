// The only reader of process.env in the API (design.md § Composition roots; AWS-31). Every other file takes its settings
// through the composition root's arguments.

export type DeployEnvironment = 'local' | 'staging' | 'production';

const ENVIRONMENTS: ReadonlySet<string> = new Set<DeployEnvironment>(['local', 'staging', 'production']);
const SEMVER = /^\d+\.\d+\.\d+$/;

export interface Config {
  /** `DATABASE_URL`: the local or Neon connection string. Undefined when unset. */
  readonly databaseUrl: string | undefined;
  readonly port: number;
  readonly host: string;
  /** `SITE_ORIGIN`: the exact origin of the site, checked by `requireSameOrigin`. */
  readonly siteOrigin: string;
  /** `ENABLE_STAGING_ENDPOINTS`, default false. */
  readonly stagingEndpoints: boolean;
  /** `D2RMM_ENV`, default `local`. */
  readonly environment: DeployEnvironment;
  /** `AGENT_MIN_VERSION`, default `0.0.0`. */
  readonly agentMinVersion: string;
  /** `TRUST_PROXY_HOPS`, default 1 (Render has one proxy in front of the API). */
  readonly trustProxyHops: number;
  /** `ROOM_DROP_TOLERANCE_SECONDS`, default 60: how long a member's agent or site stream may be away before they leave their room (FR-32). */
  readonly roomDropToleranceSeconds: number;
  /** `D2RMM_ACCEPTANCE` is exactly `true`: the acceptance stack asked for the test controls. */
  readonly acceptance: boolean;
  /** `D2RMM_ACCEPTANCE` is set at all, to any value. The Render root refuses any such value (AD-045). */
  readonly acceptanceSet: boolean;
  /** `TEST_CONTROL_SECRET`, the header value the test controls require. */
  readonly testControlSecret: string | undefined;
  readonly telemetry: TelemetryConfig;
  /** Battle.net sign-in settings: defined only when both `BNET_CLIENT_ID` and `BNET_CLIENT_SECRET` are set (IDB-06). */
  readonly bnet: BnetSettings | undefined;
}

/** The default of `ROOM_DROP_TOLERANCE_SECONDS` (LBR-08). */
export const DEFAULT_ROOM_DROP_TOLERANCE_SECONDS = 60;

export interface BnetSettings {
  /** `BNET_CLIENT_ID`. */
  readonly clientId: string;
  /** `BNET_CLIENT_SECRET`: never echoed, logged or put in an error body. */
  readonly clientSecret: string;
  /** `BNET_OAUTH_BASE_URL`, default `https://oauth.battle.net`: https, or http on a loopback host, with no user info. */
  readonly baseUrl: string;
}

export interface TelemetryConfig {
  /** `OTEL_EXPORTER_OTLP_ENDPOINT`: `https`, or `http` on a loopback host, never with user info. Undefined when unset. */
  readonly endpoint: string | undefined;
  /** `OTEL_EXPORTER_OTLP_HEADERS`, parsed. Only the SDK exporters and the relay's forwarder receive it; never logged. */
  readonly headers: Readonly<Record<string, string>>;
  /** `OTEL_TRACES_SAMPLER_ARG`, the sampling ratio as text in `[0, 1]`, default `0.1`. */
  readonly samplerArg: string;
  /** `OTEL_METRIC_EXPORT_INTERVAL` in milliseconds, default 60000. */
  readonly intervalMs: number;
}

type Environment = Readonly<Record<string, string | undefined>>;

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '[::1]']);
/** A dotted IPv4 address in 127.0.0.0/8: four parts, the first 127, each part checked to 255 by `isLoopbackHost`. */
const IPV4_LOOPBACK = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const DEFAULT_SAMPLER_ARG = '0.1';
const DEFAULT_BNET_OAUTH_BASE_URL = 'https://oauth.battle.net';

function flag(name: string, raw: string | undefined): boolean {
  if (raw === undefined || raw === 'false') {
    return false;
  }
  if (raw === 'true') {
    return true;
  }
  throw new Error(`${name} must be true or false`);
}

function integer(name: string, raw: string | undefined, fallback: number, minimum: number): number {
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer of at least ${minimum}`);
  }
  return value;
}

/**
 * A loopback hostname: `localhost`, `[::1]`, or a whole IPv4 address in 127.0.0.0/8 (each part 0 to 255). A name that
 * only starts with `127.` (`127.evil.example`, `127.0.0.1.nip.io`) is not loopback.
 */
function isLoopbackHost(hostname: string): boolean {
  if (LOOPBACK_HOSTS.has(hostname)) {
    return true;
  }
  const match = IPV4_LOOPBACK.exec(hostname);
  return match !== null && match.slice(1).every((part) => Number(part) <= 255);
}

/** A loopback host may use plain http; every other endpoint must be https. The refusal never echoes the endpoint. */
function endpointOf(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') {
    return undefined;
  }
  return secureUrlOf('OTEL_EXPORTER_OTLP_ENDPOINT', raw);
}

/**
 * The URL `name` holds, when it is https or http on a loopback host with no user info; otherwise a refusal that names
 * the setting and never the value (the value may carry credentials).
 */
function secureUrlOf(name: string, raw: string): string {
  const refuse = (): never => {
    throw new Error(`${name} must be https, or http on a loopback host, with no user info`);
  };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return refuse();
  }
  if (url.username !== '' || url.password !== '') {
    return refuse();
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(url.hostname))) {
    return refuse();
  }
  return raw;
}

/** `BNET_OAUTH_BASE_URL`: the default when unset or empty; otherwise the same rule as the OTLP endpoint. */
function bnetBaseUrlOf(raw: string | undefined): string {
  return raw === undefined || raw === ''
    ? DEFAULT_BNET_OAUTH_BASE_URL
    : secureUrlOf('BNET_OAUTH_BASE_URL', raw);
}

/** The Battle.net settings, or undefined unless both the client id and the client secret are set (IDB-06). */
function bnetOf(env: Environment, baseUrl: string): BnetSettings | undefined {
  const clientId = env['BNET_CLIENT_ID'];
  const clientSecret = env['BNET_CLIENT_SECRET'];
  if (clientId === undefined || clientId === '' || clientSecret === undefined || clientSecret === '') {
    return undefined;
  }
  return { clientId, clientSecret, baseUrl };
}

/** `key=value` pairs separated by commas, values percent-decoded (the OpenTelemetry environment format). */
function headersOf(raw: string | undefined): Record<string, string> {
  if (raw === undefined || raw === '') {
    return {};
  }
  const refuse = (): never => {
    throw new Error('OTEL_EXPORTER_OTLP_HEADERS must be key=value pairs separated by commas');
  };
  const headers: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const separator = pair.indexOf('=');
    const key = separator <= 0 ? '' : pair.slice(0, separator).trim();
    if (key === '') {
      refuse();
    }
    try {
      headers[key] = decodeURIComponent(pair.slice(separator + 1).trim());
    } catch {
      refuse();
    }
  }
  return headers;
}

/** The sampling ratio as text: a number in [0, 1], `0.1` when unset. A value outside the range is refused. */
function samplerArgOf(raw: string | undefined): string {
  if (raw === undefined || raw === '') {
    return DEFAULT_SAMPLER_ARG;
  }
  const ratio = Number(raw);
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new Error('OTEL_TRACES_SAMPLER_ARG must be a number from 0 to 1');
  }
  return raw;
}

/** Reads the settings from the environment. Invalid values throw; absent values take their defaults. */
export function loadConfig(env: Environment = process.env): Config {
  const rawEnvironment = env['D2RMM_ENV'] ?? 'local';
  if (!ENVIRONMENTS.has(rawEnvironment)) {
    throw new Error('D2RMM_ENV must be local, staging or production');
  }
  const agentMinVersion = env['AGENT_MIN_VERSION'] ?? '0.0.0';
  if (!SEMVER.test(agentMinVersion)) {
    throw new Error('AGENT_MIN_VERSION must be a semantic version');
  }
  const databaseUrl = env['DATABASE_URL'];
  const acceptanceRaw = env['D2RMM_ACCEPTANCE'];
  const bnetBaseUrl = bnetBaseUrlOf(env['BNET_OAUTH_BASE_URL']);
  return {
    bnet: bnetOf(env, bnetBaseUrl),
    databaseUrl: databaseUrl === '' ? undefined : databaseUrl,
    port: integer('PORT', env['PORT'], 8787, 0),
    host: env['HOST'] ?? '127.0.0.1',
    siteOrigin: env['SITE_ORIGIN'] ?? 'http://localhost:8788',
    stagingEndpoints: flag('ENABLE_STAGING_ENDPOINTS', env['ENABLE_STAGING_ENDPOINTS']),
    environment: rawEnvironment as DeployEnvironment,
    agentMinVersion,
    trustProxyHops: integer('TRUST_PROXY_HOPS', env['TRUST_PROXY_HOPS'], 1, 0),
    roomDropToleranceSeconds: integer(
      'ROOM_DROP_TOLERANCE_SECONDS',
      env['ROOM_DROP_TOLERANCE_SECONDS'],
      DEFAULT_ROOM_DROP_TOLERANCE_SECONDS,
      1,
    ),
    acceptance: acceptanceRaw === 'true',
    acceptanceSet: acceptanceRaw !== undefined,
    testControlSecret: env['TEST_CONTROL_SECRET'],
    telemetry: {
      endpoint: endpointOf(env['OTEL_EXPORTER_OTLP_ENDPOINT']),
      headers: headersOf(env['OTEL_EXPORTER_OTLP_HEADERS']),
      samplerArg: samplerArgOf(env['OTEL_TRACES_SAMPLER_ARG']),
      intervalMs: integer('OTEL_METRIC_EXPORT_INTERVAL', env['OTEL_METRIC_EXPORT_INTERVAL'], 60_000, 1),
    },
  };
}
