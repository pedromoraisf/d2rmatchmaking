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
}

type Environment = Readonly<Record<string, string | undefined>>;

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
  };
}
