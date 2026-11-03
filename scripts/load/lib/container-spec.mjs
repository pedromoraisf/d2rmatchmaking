// The `docker` argument arrays of the run (design.md § Pure rules, § Images and TLS, § Byte meter and sink; LB-01, LB-02).
// Pure: every builder returns an array of arguments for the `docker` CLI, never a shell string, and nothing here reads the
// environment of the process. Secrets never reach an argument: the Postgres password and the API's `DATABASE_URL` travel
// in an env-file whose path is the argument, and the orchestrator writes that file at mode 0600. Every builder passes its
// result through `assertSafe`, the publish guard: only the meter and the sink publish, and only on loopback.

import { isAbsolute } from 'node:path';

const PREFIX = 'd2rmm-load';
const ROLES = ['postgres', 'sink', 'api', 'meter', 'migrate', 'k6'];

/** The limits of the containers when the environment sets none (spec Assumptions "Container limits"). */
export const DEFAULT_LIMITS = Object.freeze({ cpus: '0.5', memory: '512m', k6Memory: '1500m' });

const CPUS_PATTERN = /^\d+(\.\d+)?$/;
const MEMORY_PATTERN = /^\d+[mg]$/;
const RUN_ID_PATTERN = /^[a-z0-9]{8}$/;
const PASSWORD_PATTERN = /^[A-Za-z0-9]{16,}$/;
const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const TLS_MODE = 'sslmode=verify-full';

export const POSTGRES_PORT = 5432;
export const DATABASE_NAME = 'postgres';
export const SINK_OTLP_PORT = 4318;
export const SINK_CONTROL_PORT = 9101;
export const METER_PORT = 8080;
export const METER_CONTROL_PORT = 9100;

const TOKEN_IN_CONTAINER = '/run/d2rmm/token';
const CA_IN_CONTAINER = '/run/d2rmm-ca/ca.crt';
const LOAD_IN_CONTAINER = '/load';
const WORK_IN_CONTAINER = '/work';
const OTLP_ENDPOINT = `http://127.0.0.1:${SINK_OTLP_PORT}`;

/** The API's environment, the only names it may get (LB-02). `DATABASE_URL` travels in the env-file, never in an argument. */
const API_ENVIRONMENT_KEYS = [
  'D2RMM_ENV',
  'ENABLE_STAGING_ENDPOINTS',
  'SITE_ORIGIN',
  'PORT',
  'DATABASE_URL',
  'NODE_EXTRA_CA_CERTS',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
];
const API_ENVIRONMENT_FILE_KEYS = ['DATABASE_URL'];

/** The Render start command, read from `render.yaml`: the API image runs the same entry. */
const API_ENTRY = ['node', '--import', './apps/api/src/main/instrument.ts', 'apps/api/src/main/render.ts'];
const MIGRATE_ENTRY = ['node', 'apps/api/src/main/migrate.ts'];

/**
 * The Postgres start command: a throwaway CA and a server certificate made inside the container for the container's name
 * (`$1`, passed as an argument, never interpolated), the CA key deleted, the server key owned by `postgres` at mode 0600,
 * then the stock entrypoint with TLS on. The script is a constant.
 */
const POSTGRES_TLS_SCRIPT = [
  'set -eu',
  'umask 077',
  'mkdir -p /tls && chmod 755 /tls && cd /tls',
  'openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 1 -subj /CN=d2rmm-load-ca -keyout ca.key -out ca.crt',
  'openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -subj "/CN=$1" -keyout server.key -out server.csr',
  'printf "subjectAltName=DNS:%s\\n" "$1" > san.cnf',
  'openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 1 -extfile san.cnf -out server.crt',
  'rm -f ca.key ca.srl server.csr san.cnf',
  'chown postgres:postgres server.key',
  'chmod 600 server.key',
  'chmod 644 server.crt ca.crt',
  'exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tls/server.crt -c ssl_key_file=/tls/server.key',
].join('\n');

/** The only host ports the run publishes: the meter's two and the sink's one, each on 127.0.0.1 (LB-01, LB-02). */
const PUBLISH_PATTERN = /^127\.0\.0\.1:(\d*):(\d+)$/;
const SECRET_TEXT =
  /(DATABASE_URL|POSTGRES_PASSWORD|PASSWORD|TOKEN|SECRET|COOKIE|AUTHORIZATION)=|\bBearer\s|postgres:\/\/[^\s@]+:[^\s@]+@/i;
const DOCKER_SOCKET = /docker\.sock/;
const LOAD_DIR_PATTERN = /(^|\/)scripts\/load(\/|$)/;
/** Docker flags that take their value as the next argument (the rest are switches or positional). */
const VALUE_FLAGS = new Set([
  '-p',
  '--publish',
  '-P',
  '--network',
  '--net',
  '--pid',
  '--ipc',
  '--userns',
  '-v',
  '--volume',
  '--mount',
  '-e',
  '--env',
  '--env-file',
  '--name',
  '--label',
  '--cpus',
  '--memory',
]);

function roleOf(role) {
  if (!ROLES.includes(role)) {
    throw new TypeError(`unknown container role: ${String(role)}`);
  }
  return role;
}

function checkRunId(runId) {
  if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) {
    throw new TypeError('a run id is eight characters from a-z0-9');
  }
  return runId;
}

function portOf(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new RangeError(`${name} is a port number, got ${String(value)}`);
  }
  return value;
}

/** A path that goes into an argument: absolute, and free of the separators the CLI reads (`:` in `-v`, `,` in `--mount`). */
function absoluteOf(name, value) {
  if (typeof value !== 'string' || !isAbsolute(value) || /[:,\r\n]/.test(value)) {
    throw new TypeError(`${name} is an absolute path with no ':' or ','`);
  }
  return value;
}

function mountOf(source, target, mode) {
  return `${absoluteOf('a mount source', source)}:${target}:${mode}`;
}

function valueOf(raw, fallback, pattern, name) {
  const value = raw === undefined || raw === '' ? fallback : raw;
  if (typeof value !== 'string' || !pattern.test(value) || !(Number.parseFloat(value) > 0)) {
    throw new RangeError(
      `${name} must be a positive value of the form ${pattern.source}, got ${String(raw)}`,
    );
  }
  return value;
}

/**
 * The container limits from the environment: `LOAD_CPUS` (default 0.5), `LOAD_MEMORY` (default 512m) and `LOAD_K6_MEMORY`
 * (default 1500m). A value that does not match its strict pattern, or is not positive, is refused.
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ cpus: string, memory: string, k6Memory: string }}
 */
export function limitsFrom(env = {}) {
  return {
    cpus: valueOf(env.LOAD_CPUS, DEFAULT_LIMITS.cpus, CPUS_PATTERN, 'LOAD_CPUS'),
    memory: valueOf(env.LOAD_MEMORY, DEFAULT_LIMITS.memory, MEMORY_PATTERN, 'LOAD_MEMORY'),
    k6Memory: valueOf(env.LOAD_K6_MEMORY, DEFAULT_LIMITS.k6Memory, MEMORY_PATTERN, 'LOAD_K6_MEMORY'),
  };
}

function limitsOf(limits) {
  return {
    cpus: valueOf(limits.cpus, DEFAULT_LIMITS.cpus, CPUS_PATTERN, 'cpus'),
    memory: valueOf(limits.memory, DEFAULT_LIMITS.memory, MEMORY_PATTERN, 'memory'),
    k6Memory: valueOf(limits.k6Memory, DEFAULT_LIMITS.k6Memory, MEMORY_PATTERN, 'k6Memory'),
  };
}

/** The container name of a role: `d2rmm-load-<runId>-<role>`. */
export function containerNameOf(runId, role) {
  return `${PREFIX}-${checkRunId(runId)}-${roleOf(role)}`;
}

/** The network name of a run: `d2rmm-load-<runId>-net`. */
export function networkNameOf(runId) {
  return `${PREFIX}-${checkRunId(runId)}-net`;
}

/** The label every resource of a run carries: `d2rmm-load=<runId>`. */
export function labelOf(runId) {
  return `${PREFIX}=${checkRunId(runId)}`;
}

function common(runId, role) {
  return ['--name', containerNameOf(runId, role), '--label', labelOf(runId)];
}

function publishOk(value) {
  if (typeof value !== 'string' || !PUBLISH_PATTERN.test(value)) {
    throw new TypeError(`a published port is 127.0.0.1:<port or empty>:<port>, got ${String(value)}`);
  }
}

function mountOk(value) {
  const [source = '', , mode = ''] = String(value).split(':');
  if (LOAD_DIR_PATTERN.test(source) && !mode.split(',').includes('ro')) {
    throw new TypeError('the scripts/load directory is mounted read-only, never writable');
  }
}

/** A `--mount` value is comma-separated `key=value` pairs: the source is `source=` or `src=`. */
function mountFlagOk(value) {
  const text = String(value);
  const source = /(?:^|,)(?:source|src)=([^,]*)/.exec(text)?.[1] ?? '';
  const readOnly = /(?:^|,)(?:readonly|ro)(?:,|$)/.test(text);
  if (LOAD_DIR_PATTERN.test(source) && !readOnly) {
    throw new TypeError('the scripts/load directory is mounted read-only, never writable');
  }
}

/** One flag and the value it carries: `--flag=value` inline, or the next argument for the flags that take one. */
function flagOf(args, index) {
  const arg = args[index];
  const equals = arg.indexOf('=');
  if (arg.startsWith('-') && equals > 0) {
    return { flag: arg.slice(0, equals), value: arg.slice(equals + 1), consumed: 0 };
  }
  if (VALUE_FLAGS.has(arg)) {
    return { flag: arg, value: args[index + 1], consumed: 1 };
  }
  return { flag: arg, value: undefined, consumed: 0 };
}

function checkFlag(flag, value) {
  switch (flag) {
    case '-p':
    case '--publish':
      publishOk(value);
      return;
    case '-P':
    case '--publish-all':
      throw new TypeError('--publish-all would publish every port');
    case '--network':
    case '--net':
    case '--pid':
    case '--ipc':
    case '--userns':
      if (value === 'host') {
        throw new TypeError(`${flag} host shares the host's namespace`);
      }
      return;
    case '--privileged':
      throw new TypeError('--privileged is never used');
    case '-v':
    case '--volume':
      mountOk(value);
      return;
    case '--mount':
      mountFlagOk(value);
      return;
    default:
      return;
  }
}

/**
 * The publish guard (LB-01, LB-02; design.md § Byte meter and sink). Throws when an argument list would expose more than
 * loopback: a publish that is not `127.0.0.1:<port or empty>:<port>`, `--network host`, `--privileged`, a mount of the
 * Docker socket, a writable mount of `scripts/load`, or secret text in an argument. Returns the list when it is safe.
 * @param {string[]} args
 * @returns {string[]}
 */
export function assertSafe(args) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new TypeError('a docker argument list is an array of strings');
  }
  for (const arg of args) {
    if (DOCKER_SOCKET.test(arg)) {
      throw new TypeError('the Docker socket is never mounted into a container of the run');
    }
    if (SECRET_TEXT.test(arg)) {
      throw new TypeError('secret text is never passed in a docker argument');
    }
  }
  for (let index = 0; index < args.length; index += 1) {
    const { flag, value, consumed } = flagOf(args, index);
    checkFlag(flag, value);
    index += consumed;
  }
  return args;
}

/** `docker network create` for the run's network. */
export function networkArgs(runId) {
  return assertSafe(['network', 'create', '--label', labelOf(runId), networkNameOf(runId)]);
}

/**
 * The env-file text of the given entries: one `KEY=value` line each. The orchestrator writes it at mode 0600.
 * @param {Record<string, string>} entries
 * @returns {string}
 */
export function envFileText(entries) {
  return Object.entries(entries)
    .map(([key, value]) => {
      if (!ENV_KEY_PATTERN.test(key) || typeof value !== 'string' || /[\r\n]/.test(value)) {
        throw new TypeError(`${key} is not a valid env-file entry`);
      }
      return `${key}=${value}\n`;
    })
    .join('');
}

/**
 * The Postgres connection string of the run: the container's name, port 5432, `sslmode=verify-full`, and the random
 * password. The password is letters and digits, so it needs no escaping.
 * @param {{ runId: string, password: string }} input
 * @returns {string}
 */
export function databaseUrlOf({ runId, password }) {
  if (typeof password !== 'string' || !PASSWORD_PATTERN.test(password)) {
    throw new TypeError('the Postgres password is at least 16 letters and digits');
  }
  const host = containerNameOf(runId, 'postgres');
  return `postgres://postgres:${password}@${host}:${POSTGRES_PORT}/${DATABASE_NAME}?${TLS_MODE}`;
}

/**
 * The API's environment from its allow-list. Nothing else is read or copied: no process environment, no acceptance
 * control (`D2RMM_ACCEPTANCE` is never set), the loopback exporter and the CA path the run mounts.
 * @param {{ siteOrigin: string, port: number, databaseUrl: string }} input
 * @returns {Record<string, string>}
 */
export function apiEnvironment({ siteOrigin, port, databaseUrl }) {
  if (typeof siteOrigin !== 'string' || /[\r\n]/.test(siteOrigin)) {
    throw new TypeError('SITE_ORIGIN is one line of text');
  }
  if (typeof databaseUrl !== 'string' || !databaseUrl.includes(TLS_MODE)) {
    throw new TypeError(`DATABASE_URL must carry ${TLS_MODE}`);
  }
  return {
    D2RMM_ENV: 'staging',
    ENABLE_STAGING_ENDPOINTS: 'true',
    SITE_ORIGIN: siteOrigin,
    PORT: String(portOf('PORT', port)),
    DATABASE_URL: databaseUrl,
    NODE_EXTRA_CA_CERTS: CA_IN_CONTAINER,
    OTEL_EXPORTER_OTLP_ENDPOINT: OTLP_ENDPOINT,
  };
}

/**
 * `docker run` of the Postgres 17 container with TLS. The password arrives through `envFile`; the server certificate is
 * made inside the container. The container publishes nothing.
 * @param {{ runId: string, image: string, envFile: string }} input
 * @returns {string[]}
 */
export function postgresArgs({ runId, image, envFile }) {
  return assertSafe([
    'run',
    '-d',
    ...common(runId, 'postgres'),
    '--network',
    networkNameOf(runId),
    '--env-file',
    absoluteOf('envFile', envFile),
    image,
    'sh',
    '-c',
    POSTGRES_TLS_SCRIPT,
    'postgres-tls',
    containerNameOf(runId, 'postgres'),
  ]);
}

/**
 * `docker run` of the sink. It owns the API's network namespace (the API joins it), so the OTLP port and the control port
 * live here. Only the control port is published, on loopback.
 * @param {{ runId: string, image: string, loadDir: string, tokenFile: string }} input
 * @returns {string[]}
 */
export function sinkArgs({ runId, image, loadDir, tokenFile }) {
  return assertSafe([
    'run',
    '-d',
    ...common(runId, 'sink'),
    '--network',
    networkNameOf(runId),
    '-p',
    `127.0.0.1:${SINK_CONTROL_PORT}:${SINK_CONTROL_PORT}`,
    '-v',
    mountOf(loadDir, LOAD_IN_CONTAINER, 'ro'),
    '-v',
    mountOf(tokenFile, TOKEN_IN_CONTAINER, 'ro'),
    image,
    'node',
    `${LOAD_IN_CONTAINER}/containers/sink.mjs`,
    '--listen',
    `127.0.0.1:${SINK_OTLP_PORT}`,
    '--control',
    `0.0.0.0:${SINK_CONTROL_PORT}`,
    '--token-file',
    TOKEN_IN_CONTAINER,
  ]);
}

/**
 * `docker run` of the API under test. It joins the sink's network namespace, so it exports to loopback, and it has the
 * CPU and memory limits. Its secrets come from the env-file; every other allow-listed variable is an `-e` pair. The
 * container publishes nothing.
 * @param {{
 *   runId: string,
 *   image: string,
 *   environment: Record<string, string>,
 *   envFile: string,
 *   caFile: string,
 *   limits?: { cpus: string, memory: string, k6Memory: string },
 * }} input
 * @returns {string[]}
 */
export function apiArgs({ runId, image, environment, envFile, caFile, limits = DEFAULT_LIMITS }) {
  for (const key of Object.keys(environment)) {
    if (!API_ENVIRONMENT_KEYS.includes(key)) {
      throw new TypeError(`${key} is not in the API environment allow-list`);
    }
  }
  for (const key of API_ENVIRONMENT_KEYS) {
    if (environment[key] === undefined) {
      throw new TypeError(`the API environment lacks ${key}`);
    }
  }
  if (environment['D2RMM_ENV'] !== 'staging' || environment['ENABLE_STAGING_ENDPOINTS'] !== 'true') {
    throw new TypeError('the API runs with the staging endpoints on');
  }
  const { cpus, memory } = limitsOf(limits);
  const variables = API_ENVIRONMENT_KEYS.filter((key) => !API_ENVIRONMENT_FILE_KEYS.includes(key)).flatMap(
    (key) => ['-e', `${key}=${environment[key]}`],
  );
  return assertSafe([
    'run',
    '-d',
    ...common(runId, 'api'),
    '--network',
    `container:${containerNameOf(runId, 'sink')}`,
    '--cpus',
    cpus,
    '--memory',
    memory,
    '--env-file',
    absoluteOf('envFile', envFile),
    '-v',
    mountOf(caFile, CA_IN_CONTAINER, 'ro'),
    ...variables,
    image,
    ...API_ENTRY,
  ]);
}

/**
 * `docker run` of the meter: the TCP pipe in front of the API. It publishes its proxy port and its control port on
 * loopback. The API sits in the sink's namespace, so the upstream is the sink's name and the API's port.
 * @param {{ runId: string, image: string, loadDir: string, tokenFile: string, apiPort: number }} input
 * @returns {string[]}
 */
export function meterArgs({ runId, image, loadDir, tokenFile, apiPort }) {
  return assertSafe([
    'run',
    '-d',
    ...common(runId, 'meter'),
    '--network',
    networkNameOf(runId),
    '-p',
    `127.0.0.1:${METER_PORT}:${METER_PORT}`,
    '-p',
    `127.0.0.1:${METER_CONTROL_PORT}:${METER_CONTROL_PORT}`,
    '-v',
    mountOf(loadDir, LOAD_IN_CONTAINER, 'ro'),
    '-v',
    mountOf(tokenFile, TOKEN_IN_CONTAINER, 'ro'),
    image,
    'node',
    `${LOAD_IN_CONTAINER}/containers/meter.mjs`,
    '--listen',
    `0.0.0.0:${METER_PORT}`,
    '--upstream',
    `${containerNameOf(runId, 'sink')}:${portOf('apiPort', apiPort)}`,
    '--control',
    `0.0.0.0:${METER_CONTROL_PORT}`,
    '--token-file',
    TOKEN_IN_CONTAINER,
  ]);
}

/**
 * `docker run` of the migration: the API image runs `apps/api/src/main/migrate.ts` once against the TLS database. It has
 * the database URL from the env-file and the CA, and no staging variable.
 * @param {{ runId: string, image: string, envFile: string, caFile: string }} input
 * @returns {string[]}
 */
export function migrateArgs({ runId, image, envFile, caFile }) {
  return assertSafe([
    'run',
    ...common(runId, 'migrate'),
    '--network',
    networkNameOf(runId),
    '--env-file',
    absoluteOf('envFile', envFile),
    '-v',
    mountOf(caFile, CA_IN_CONTAINER, 'ro'),
    '-e',
    `NODE_EXTRA_CA_CERTS=${CA_IN_CONTAINER}`,
    image,
    ...MIGRATE_ENTRY,
  ]);
}

/**
 * `docker run` of one k6 step. The plan and the script are mounted read-only, the output directory read-write, and no
 * port is published. The container has no secret in its arguments: the plan carries the cookies and the tokens.
 * @param {{
 *   runId: string,
 *   image: string,
 *   inDir: string,
 *   outDir: string,
 *   limits?: { cpus: string, memory: string, k6Memory: string },
 * }} input
 * @returns {string[]}
 */
export function k6Args({ runId, image, inDir, outDir, limits = DEFAULT_LIMITS }) {
  const { k6Memory } = limitsOf(limits);
  return assertSafe([
    'run',
    ...common(runId, 'k6'),
    '--network',
    networkNameOf(runId),
    '--memory',
    k6Memory,
    '-v',
    mountOf(inDir, `${WORK_IN_CONTAINER}/in`, 'ro'),
    '-v',
    mountOf(outDir, `${WORK_IN_CONTAINER}/out`, 'rw'),
    image,
    'run',
    '--no-color',
    `${WORK_IN_CONTAINER}/in/journey.mjs`,
  ]);
}
