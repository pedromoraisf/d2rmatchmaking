// The worker-scoped stack of the acceptance suite (design.md § Acceptance stack, AD-045). Started lazily by the first
// scenario that needs it, once per worker: database `acc_w<n>` on the run's Postgres container, two API processes
// (staging endpoints on and off, both on the same database) and two `wrangler pages dev` servers serving the built
// site, each proxying /api/* to its API. Everything runs as child processes: the suite talks to it through HTTP and
// the browser only (rule acceptance-is-black-box). Before each scenario, both APIs are reset (support/world.ts).
import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { createServer, type Socket } from 'node:net';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { POSTGRES_URL_ENV } from './global-setup.ts';

/** The repository root: this file is in tests/acceptance/support. */
const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

/** Starting one process and its HTTP readiness check may take this long. */
const READY_TIMEOUT_MS = 90_000;
const READY_POLL_MS = 150;
const CONTROL_HEADER = 'x-test-control';
/** The metric export interval of the traced API, in milliseconds (the design's 5 s for the trace scenarios). */
const TRACED_METRIC_INTERVAL_MS = 5_000;
/** A site build of the traced stack may take this long. */
const BUILD_TIMEOUT_MS = 180_000;
/** How often the traced API's clock follows the wall clock while a scenario runs (`followWallClock`). */
const WALL_CLOCK_TICK_MS = 500;
/** The header the traced API sends to its OTLP endpoint (a test value; the local backend ignores it). */
export const TRACED_BACKEND_HEADER = 'x-acceptance-backend=present';
/** The compatibility date of the local Pages Functions (the wrangler default of this version). */
const WRANGLER_COMPATIBILITY_DATE = '2026-10-23';

/** One served origin of the stack: its API (direct, for the agent and the tests) and its site (the browser's origin). */
export interface Endpoint {
  /** `http://127.0.0.1:<port>`: the API process. */
  readonly api: string;
  /** `http://127.0.0.1:<port>`: the wrangler server that serves the site and proxies /api/* to `api`. */
  readonly site: string;
}

export interface Stack {
  /** The API with staging endpoints on (test sign-in, test matches). */
  readonly staging: Endpoint;
  /** The API with staging endpoints off (AWS-03). */
  readonly plain: Endpoint;
  /** Resets both APIs: truncates the worker database and clears their memory stores and streams (AD-045). */
  reset(): Promise<void>;
  /** Moves the controllable clock of both APIs forward by `ms`. */
  advanceClock(ms: number): Promise<void>;
  /**
   * Redelivers the newest MatchFormed of the worker database on the staging API's bus, as an at-least-once relay
   * would (AD-062). Resolves once the consumers have run.
   */
  redeliverMatchFormed(): Promise<void>;
  /** Estimated API clock in epoch ms: the start of the API processes plus every advance so far. */
  apiClockMs(): number;
  /** Stops every child process and returns when they have exited. */
  close(): Promise<void>;
}

interface Managed {
  readonly name: string;
  readonly child: ChildProcess;
  readonly output: () => string;
}

/** Returns a free loopback port. The port is released before the caller binds it, a small race the suite accepts. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('no loopback port was assigned'));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

/**
 * Starts a child process in its own process group, so that closing the stack also stops the processes it spawns
 * (wrangler starts workerd). Only a minimal environment is passed: no secrets of the host reach the children.
 */
function launch(
  name: string,
  command: string,
  args: readonly string[],
  options: { cwd: string; env: Record<string, string> },
): Managed {
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let captured = '';
  const keep = (chunk: Buffer): void => {
    captured = `${captured}${chunk.toString('utf8')}`.slice(-8_000);
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  child.on('error', (error) => {
    captured = `${captured}\n${error.message}`;
  });
  return { name, child, output: () => captured };
}

/** Polls `url` until `ready(status)` holds; throws with the process output when the time runs out. */
async function waitFor(managed: Managed, url: string, ready: (status: number) => boolean): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError = 'no answer yet';
  while (Date.now() < deadline) {
    if (managed.child.exitCode !== null) {
      throw new Error(`${managed.name} exited with ${managed.child.exitCode}\n${managed.output()}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (ready(response.status)) {
        return;
      }
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  throw new Error(`${managed.name} was not ready at ${url} (${lastError})\n${managed.output()}`);
}

/** Stops a process group and waits for its leader to exit. Stopping an exited group is a no-op. */
async function stop(managed: Managed): Promise<void> {
  const pid = managed.child.pid;
  if (pid === undefined || managed.child.exitCode !== null || managed.child.signalCode !== null) {
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    // The group is already gone.
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // Already exited.
      }
      resolve();
    }, 5_000);
    managed.child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Creates (or recreates) the worker's database on the run's Postgres container and returns its connection string. */
async function createDatabase(adminUrl: string, name: string): Promise<string> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }
  const database = new URL(adminUrl);
  database.pathname = `/${name}`;
  return database.toString();
}

/** The environment of one API process. `telemetry` is set only for the traced stack: the API then exports to `otlpEndpoint`. */
interface ApiEnvInput {
  readonly port: number;
  readonly databaseUrl: string;
  readonly site: string;
  readonly staging: boolean;
  readonly controlSecret: string;
  readonly telemetry?: { readonly otlpEndpoint: string };
}

/** Builds the minimal environment of an API process; the telemetry variables are added only when the stack asks for them. */
function apiEnv(input: ApiEnvInput): Record<string, string> {
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: process.env['HOME'] ?? '',
    DATABASE_URL: input.databaseUrl,
    PORT: String(input.port),
    HOST: '127.0.0.1',
    SITE_ORIGIN: input.site,
    ENABLE_STAGING_ENDPOINTS: input.staging ? 'true' : 'false',
    // The traced stack runs the real headless example, which reports its crate version (0.0.0, the placeholder of
    // apps/agent): the minimum is lowered for that stack only, so the example can pair. The plain stack keeps 0.0.1.
    AGENT_MIN_VERSION: input.telemetry === undefined ? '0.0.1' : '0.0.0',
    D2RMM_ACCEPTANCE: 'true',
    D2RMM_ENV: 'local',
    TEST_CONTROL_SECRET: input.controlSecret,
    ...(input.telemetry === undefined
      ? {}
      : {
          OTEL_EXPORTER_OTLP_ENDPOINT: input.telemetry.otlpEndpoint,
          // A header the relay forwards with the backend credentials. The fake backend records it (the relay scenarios).
          OTEL_EXPORTER_OTLP_HEADERS: TRACED_BACKEND_HEADER,
          // Every request is sampled in the traced stack: the trace scenarios read one trace per action (OBS-24).
          OTEL_TRACES_SAMPLER_ARG: '1.0',
          OTEL_METRIC_EXPORT_INTERVAL: String(TRACED_METRIC_INTERVAL_MS),
        }),
  };
}

/** Launches one `wrangler pages dev` server for a built site. The caller checks its readiness. */
function launchPages(input: {
  readonly name: string;
  readonly siteDir: string;
  readonly api: string;
  readonly port: number;
  readonly inspector: number;
  readonly stateDir: string;
}): Managed {
  const wrangler = path.join(repoRoot, 'apps', 'web', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const serverArgs = [
    wrangler,
    'pages',
    'dev',
    input.siteDir,
    '--ip',
    '127.0.0.1',
    '--port',
    String(input.port),
    // Every wrangler needs its own inspector port: the default one is shared by all workers of the run.
    '--inspector-port',
    String(input.inspector),
    // Local storage is private to this stack: workers share no workerd state directory.
    '--persist-to',
    path.join(input.stateDir, input.name.replace(' ', '-')),
    '--compatibility-date',
    WRANGLER_COMPATIBILITY_DATE,
    '--binding',
    `API_ORIGIN=${input.api}`,
    '--show-interactive-dev-session=false',
    '--log-level=warn',
  ];
  return launch(input.name, process.execPath, serverArgs, {
    cwd: input.stateDir,
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: process.env['HOME'] ?? '',
      WRANGLER_SEND_METRICS: 'false',
      CI: '1',
    },
  });
}

/**
 * Builds the site into `outDir` with telemetry on and the sampling ratio at 1 (the traced stack's build, OBS-44). The
 * build writes only into the stack's private directory, never into `apps/web/dist`, which the plain stack serves.
 */
async function buildTelemetrySite(outDir: string): Promise<void> {
  const vite = path.join(repoRoot, 'apps', 'web', 'node_modules', 'vite', 'bin', 'vite.js');
  const build = spawn(process.execPath, [vite, 'build', '--outDir', outDir, '--emptyOutDir'], {
    cwd: path.join(repoRoot, 'apps', 'web'),
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: process.env['HOME'] ?? '',
      VITE_TELEMETRY: 'on',
      VITE_TELEMETRY_RATIO: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const keep = (chunk: Buffer): void => {
    output = `${output}${chunk.toString('utf8')}`.slice(-8_000);
  };
  build.stdout?.on('data', keep);
  build.stderr?.on('data', keep);
  const timer = setTimeout(() => build.kill('SIGKILL'), BUILD_TIMEOUT_MS);
  const code = await new Promise<number | null>((resolve, reject) => {
    build.once('error', reject);
    build.once('exit', (exitCode) => resolve(exitCode));
  }).finally(() => clearTimeout(timer));
  if (code !== 0) {
    throw new Error(`the telemetry site did not build (exit ${code})\n${output}`);
  }
}

/** Starts the stack for one worker. `runtime` names the browser build of the run, for start-up errors. */
export async function startStack(workerIndex: number, runtime: string): Promise<Stack> {
  try {
    return await startStackProcesses(workerIndex);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`the acceptance stack of worker ${workerIndex} (${runtime}) did not start: ${message}`);
  }
}

async function startStackProcesses(workerIndex: number): Promise<Stack> {
  const adminUrl = process.env[POSTGRES_URL_ENV];
  if (adminUrl === undefined) {
    throw new Error(`${POSTGRES_URL_ENV} is not set: the acceptance global setup did not run`);
  }
  const siteBuild = path.join(repoRoot, 'apps', 'web', 'dist', 'index.html');
  if (!existsSync(siteBuild)) {
    throw new Error(`the site is not built: ${siteBuild} is missing (run pnpm --filter @d2rmm/web build)`);
  }

  const databaseName = `acc_w${workerIndex}`;
  const databaseUrl = await createDatabase(adminUrl, databaseName);
  const controlSecret = randomBytes(32).toString('base64url');
  const stateDir = mkdtempSync(path.join(tmpdir(), 'd2rmm-acc-'));
  const managed: Managed[] = [];
  const startedAt = Date.now();
  let advanced = 0;

  const ports = {
    stagingApi: await freePort(),
    plainApi: await freePort(),
    stagingSite: await freePort(),
    plainSite: await freePort(),
  };
  const origins = {
    stagingApi: `http://127.0.0.1:${ports.stagingApi}`,
    plainApi: `http://127.0.0.1:${ports.plainApi}`,
    stagingSite: `http://127.0.0.1:${ports.stagingSite}`,
    plainSite: `http://127.0.0.1:${ports.plainSite}`,
  };

  const envOf = (port: number, staging: boolean, site: string): Record<string, string> =>
    apiEnv({ port, databaseUrl, site, staging, controlSecret });

  try {
    // The staging API migrates the database first; the plain API starts after it, so the two never migrate at once.
    const staging = launch(
      'staging api',
      process.execPath,
      ['--import', './src/main/instrument.ts', 'src/main/local.ts'],
      {
        cwd: path.join(repoRoot, 'apps', 'api'),
        env: envOf(ports.stagingApi, true, origins.stagingSite),
      },
    );
    managed.push(staging);
    await waitFor(staging, `${origins.stagingApi}/healthz`, (status) => status === 200);

    const plain = launch(
      'plain api',
      process.execPath,
      ['--import', './src/main/instrument.ts', 'src/main/local.ts'],
      {
        cwd: path.join(repoRoot, 'apps', 'api'),
        env: envOf(ports.plainApi, false, origins.plainSite),
      },
    );
    managed.push(plain);
    await waitFor(plain, `${origins.plainApi}/healthz`, (status) => status === 200);

    // Wrangler keeps its bundling temp files in `.wrangler/` under its working directory, and Pages finds the functions
    // under that same directory. The working directory is the private state directory, reached through a `functions`
    // link, so those temp files never appear in the repository: dependency-cruiser (`pnpm arch`, HF-05) crawls the
    // repository while the stack runs, and a temp file it lists can be gone by the time it reads it.
    symlinkSync(path.join(repoRoot, 'apps', 'web', 'functions'), path.join(stateDir, 'functions'), 'dir');
    for (const [name, site, api, port] of [
      ['staging site', origins.stagingSite, origins.stagingApi, ports.stagingSite],
      ['plain site', origins.plainSite, origins.plainApi, ports.plainSite],
    ] as const) {
      const server = launchPages({
        name,
        siteDir: path.join(repoRoot, 'apps', 'web', 'dist'),
        api,
        port,
        inspector: await freePort(),
        stateDir,
      });
      managed.push(server);
      await waitFor(server, `${site}/api/healthz`, (status) => status === 200);
    }
  } catch (error) {
    await Promise.all(managed.map(stop));
    rmSync(stateDir, { recursive: true, force: true });
    throw error;
  }

  const apis = [origins.stagingApi, origins.plainApi];
  const controls = (url: string, body?: unknown): Promise<Response> =>
    fetch(url, {
      method: 'POST',
      headers: {
        [CONTROL_HEADER]: controlSecret,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  return {
    staging: { api: origins.stagingApi, site: origins.stagingSite },
    plain: { api: origins.plainApi, site: origins.plainSite },
    async reset() {
      for (const api of apis) {
        const answer = await controls(`${api}/__test/reset`);
        if (answer.status !== 204) {
          throw new Error(`reset of ${api} answered ${answer.status}`);
        }
      }
    },
    async advanceClock(ms: number) {
      for (const api of apis) {
        const answer = await controls(`${api}/__test/clock`, { advanceMs: ms });
        if (answer.status !== 204) {
          throw new Error(`clock advance of ${api} answered ${answer.status}`);
        }
      }
      advanced += ms;
    },
    async redeliverMatchFormed() {
      const answer = await controls(`${origins.stagingApi}/__test/redeliver-match-formed`);
      if (answer.status !== 204) {
        throw new Error(`redelivery of ${origins.stagingApi} answered ${answer.status}`);
      }
    },
    apiClockMs() {
      return startedAt + advanced;
    },
    async close() {
      await Promise.all(managed.map(stop));
      rmSync(stateDir, { recursive: true, force: true });
    },
  };
}

/** The traced stack: one staging API that exports to an OTLP endpoint, and the site built with telemetry on (OBS-24). */
export interface TracedStack {
  /** The traced API (staging endpoints on) and its site, the browser's origin for the trace scenarios. */
  readonly staging: Endpoint;
  /** Truncates the traced database and clears the API's memory stores (the reset of the plain stack, for one API). */
  reset(): Promise<void>;
  /** Moves the traced API's controllable clock forward by `ms` (its clock does not move on its own). */
  advanceClock(ms: number): Promise<void>;
  /** Estimated traced API clock in epoch ms: the start of the traced API process plus every advance so far. */
  apiClockMs(): number;
  /**
   * Moves the traced API's clock with the wall clock every half second, until the returned function is called. The API's
   * sliding windows (the relay's 60 requests a minute per account, its byte budgets) and its lookup bucket refill on that
   * clock: a frozen clock keeps every window full for the rest of the scenario, and the relay answers `429` for the agent's
   * batches. Production windows move with the wall clock; this keeps the scenario's clock the same.
   */
  followWallClock(): () => void;
  /** Stops every child process and removes the private state directory. */
  close(): Promise<void>;
}

export interface TracedStackOptions {
  /** The OTLP/HTTP endpoint the traced API exports to: the local backend, or a FakeTelemetryBackend in relay scenarios. */
  readonly otlpEndpoint: string;
}

/** Starts the traced stack. The database name is per process, so two traced stacks of one run never share a database. */
export async function startTracedStack(options: TracedStackOptions): Promise<TracedStack> {
  try {
    return await startTracedProcesses(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`the traced acceptance stack did not start: ${message}`);
  }
}

/**
 * The telemetry-on site, built once per process: the traced stacks of one worker serve the same build, so a scenario that
 * starts its own stack does not wait for a new build. The build lives in the temporary directory, outside every stack.
 */
let telemetrySiteBuild: Promise<string> | undefined;

function telemetrySite(): Promise<string> {
  telemetrySiteBuild ??= (async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'd2rmm-telemetry-site-'));
    await buildTelemetrySite(outDir);
    return outDir;
  })();
  return telemetrySiteBuild;
}

async function startTracedProcesses(options: TracedStackOptions): Promise<TracedStack> {
  const adminUrl = process.env[POSTGRES_URL_ENV];
  if (adminUrl === undefined) {
    throw new Error(`${POSTGRES_URL_ENV} is not set: the acceptance global setup did not run`);
  }
  const databaseUrl = await createDatabase(adminUrl, `acc_trace_${process.pid}`);
  const controlSecret = randomBytes(32).toString('base64url');
  const stateDir = mkdtempSync(path.join(tmpdir(), 'd2rmm-trace-'));
  const managed: Managed[] = [];
  let apiStart = Date.now();
  let advanced = 0;

  const apiPort = await freePort();
  const sitePort = await freePort();
  const origins = {
    api: `http://127.0.0.1:${apiPort}`,
    site: `http://127.0.0.1:${sitePort}`,
  };
  const followers = new Set<() => void>();
  const advance = async (ms: number): Promise<void> => {
    const answer = await fetch(`${origins.api}/__test/clock`, {
      method: 'POST',
      headers: { [CONTROL_HEADER]: controlSecret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ advanceMs: ms }),
    });
    if (answer.status !== 204) {
      throw new Error(`clock advance of ${origins.api} answered ${answer.status}`);
    }
    advanced += ms;
  };
  try {
    const siteDir = await telemetrySite();
    symlinkSync(path.join(repoRoot, 'apps', 'web', 'functions'), path.join(stateDir, 'functions'), 'dir');

    // The API clock is anchored when its process starts (`new Date()` in `startLocal`) and moves only by advances. The
    // estimate starts before the launch, so it never runs ahead of the anchor.
    apiStart = Date.now();
    const api = launch(
      'traced api',
      process.execPath,
      ['--import', './src/main/instrument.ts', 'src/main/local.ts'],
      {
        cwd: path.join(repoRoot, 'apps', 'api'),
        env: apiEnv({
          port: apiPort,
          databaseUrl,
          site: origins.site,
          staging: true,
          controlSecret,
          telemetry: { otlpEndpoint: options.otlpEndpoint },
        }),
      },
    );
    managed.push(api);
    await waitFor(api, `${origins.api}/healthz`, (status) => status === 200);

    const site = launchPages({
      name: 'traced site',
      siteDir,
      api: origins.api,
      port: sitePort,
      inspector: await freePort(),
      stateDir,
    });
    managed.push(site);
    await waitFor(site, `${origins.site}/api/healthz`, (status) => status === 200);
  } catch (error) {
    await Promise.all(managed.map(stop));
    rmSync(stateDir, { recursive: true, force: true });
    throw error;
  }

  return {
    staging: { api: origins.api, site: origins.site },
    async reset() {
      const answer = await fetch(`${origins.api}/__test/reset`, {
        method: 'POST',
        headers: { [CONTROL_HEADER]: controlSecret },
      });
      if (answer.status !== 204) {
        throw new Error(`reset of ${origins.api} answered ${answer.status}`);
      }
    },
    advanceClock: advance,
    apiClockMs() {
      return apiStart + advanced;
    },
    followWallClock() {
      let busy = false;
      const timer = setInterval(() => {
        const behind = Date.now() - (apiStart + advanced);
        if (busy || behind <= 0) return;
        busy = true;
        void advance(behind)
          .catch(() => undefined)
          .finally(() => {
            busy = false;
          });
      }, WALL_CLOCK_TICK_MS);
      const halt = (): void => {
        clearInterval(timer);
        followers.delete(halt);
      };
      followers.add(halt);
      return halt;
    },
    async close() {
      for (const stopFollowing of followers) stopFollowing();
      await Promise.all(managed.map(stop));
      rmSync(stateDir, { recursive: true, force: true });
    },
  };
}

/** The request the fake backend recorded: what the relay or the exporter sent, before any answer. */
export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingMessage['headers'];
  readonly body: Buffer;
}

/** What the fake backend answers. `refuse` closes the port, so connections are refused. */
export type FakeBackendMode = 'accept' | 'refuse' | 'hang' | 'error';

/**
 * A credential-free OTLP backend for the relay scenarios (OBS-10 to OBS-15). It records every request it receives, then
 * answers by its mode: `accept` answers 200, `error` answers 500, `hang` never answers, and `refuse` stops listening.
 */
export class FakeTelemetryBackend {
  readonly #requests: RecordedRequest[] = [];
  readonly #sockets = new Set<Socket>();
  #mode: FakeBackendMode = 'accept';
  #port = 0;
  #server: Server | undefined;

  /** Every request received so far, in arrival order. */
  get requests(): readonly RecordedRequest[] {
    return this.#requests;
  }

  /** `http://127.0.0.1:<port>`, valid after `start`. */
  get url(): string {
    return `http://127.0.0.1:${this.#port}`;
  }

  async start(): Promise<void> {
    await this.#listen();
  }

  async setMode(mode: FakeBackendMode): Promise<void> {
    if (mode === 'refuse') {
      await this.#close();
    } else if (this.#server === undefined) {
      await this.#listen();
    }
    this.#mode = mode;
  }

  async stop(): Promise<void> {
    await this.#close();
  }

  #handle(request: IncomingMessage, response: ServerResponse): void {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      this.#requests.push({
        method: request.method ?? '',
        path: request.url ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks),
      });
      if (this.#mode === 'hang') {
        return;
      }
      response.statusCode = this.#mode === 'error' ? 500 : 200;
      // Each answer closes its connection, so no client keeps a socket that a later refusal would reset.
      response.setHeader('Connection', 'close');
      response.end();
    });
  }

  #listen(): Promise<void> {
    const server = createHttpServer((request, response) => {
      this.#handle(request, response);
    });
    server.on('connection', (socket) => {
      this.#sockets.add(socket);
      socket.on('close', () => this.#sockets.delete(socket));
    });
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.#port, '127.0.0.1', () => {
        const address = server.address();
        if (address === null || typeof address === 'string') {
          reject(new Error('the fake telemetry backend has no loopback port'));
          return;
        }
        this.#port = address.port;
        this.#server = server;
        resolve();
      });
    });
  }

  #close(): Promise<void> {
    for (const socket of this.#sockets) {
      socket.destroy();
    }
    const server = this.#server;
    this.#server = undefined;
    if (server === undefined) {
      return Promise.resolve();
    }
    return new Promise((resolve) => server.close(() => resolve()));
  }
}
