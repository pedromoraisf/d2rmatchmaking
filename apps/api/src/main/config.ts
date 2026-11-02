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
  /** `D2RMM_ACCEPTANCE` is exactly `true`: the acceptance stack asked for the test controls. */
  readonly acceptance: boolean;
  /** `D2RMM_ACCEPTANCE` is set at all, to any value. The Render root refuses any such value (AD-045). */
  readonly acceptanceSet: boolean;
  /** `TEST_CONTROL_SECRET`, the header value the test controls require. */
  readonly testControlSecret: string | undefined;
  readonly telemetry: TelemetryConfig;
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
const DEFAULT_SAMPLER_ARG = '0.1';

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

/** A loopback host may use plain http; every other endpoint must be https. The refusal never echoes the endpoint. */
function endpointOf(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') {
    return undefined;
  }
  const refuse = (): never => {
    throw new Error(
      'OTEL_EXPORTER_OTLP_ENDPOINT must be https, or http on a loopback host, with no user info',
    );
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
  const loopback = LOOPBACK_HOSTS.has(url.hostname) || url.hostname.startsWith('127.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    return refuse();
  }
  return raw;
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
  return {
    databaseUrl: databaseUrl === '' ? undefined : databaseUrl,
    port: integer('PORT', env['PORT'], 8787, 0),
    host: env['HOST'] ?? '127.0.0.1',
    siteOrigin: env['SITE_ORIGIN'] ?? 'http://localhost:8788',
    stagingEndpoints: flag('ENABLE_STAGING_ENDPOINTS', env['ENABLE_STAGING_ENDPOINTS']),
    environment: rawEnvironment as DeployEnvironment,
    agentMinVersion,
    trustProxyHops: integer('TRUST_PROXY_HOPS', env['TRUST_PROXY_HOPS'], 1, 0),
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
