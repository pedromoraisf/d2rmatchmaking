// The worker-scoped stack of the acceptance suite (design.md § Acceptance stack, AD-045). Started lazily by the first
// scenario that needs it, once per worker: database `acc_w<n>` on the run's Postgres container, two API processes
// (staging endpoints on and off, both on the same database) and two `wrangler pages dev` servers serving the built
// site, each proxying /api/* to its API. Everything runs as child processes: the suite talks to it through HTTP and
// the browser only (rule acceptance-is-black-box). Before each scenario, both APIs are reset (support/world.ts).
import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
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

  const apiEnv = (port: number, staging: boolean, site: string): Record<string, string> => ({
    PATH: process.env['PATH'] ?? '',
    HOME: process.env['HOME'] ?? '',
    DATABASE_URL: databaseUrl,
    PORT: String(port),
    HOST: '127.0.0.1',
    SITE_ORIGIN: site,
    ENABLE_STAGING_ENDPOINTS: staging ? 'true' : 'false',
    AGENT_MIN_VERSION: '0.0.1',
    D2RMM_ACCEPTANCE: 'true',
    D2RMM_ENV: 'local',
    TEST_CONTROL_SECRET: controlSecret,
  });

  try {
    // The staging API migrates the database first; the plain API starts after it, so the two never migrate at once.
    const staging = launch('staging api', process.execPath, ['src/main/local.ts'], {
      cwd: path.join(repoRoot, 'apps', 'api'),
      env: apiEnv(ports.stagingApi, true, origins.stagingSite),
    });
    managed.push(staging);
    await waitFor(staging, `${origins.stagingApi}/healthz`, (status) => status === 200);

    const plain = launch('plain api', process.execPath, ['src/main/local.ts'], {
      cwd: path.join(repoRoot, 'apps', 'api'),
      env: apiEnv(ports.plainApi, false, origins.plainSite),
    });
    managed.push(plain);
    await waitFor(plain, `${origins.plainApi}/healthz`, (status) => status === 200);

    const wrangler = path.join(repoRoot, 'apps', 'web', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
    // Wrangler keeps its bundling temp files in `.wrangler/` under its working directory, and Pages finds the functions
    // under that same directory. The working directory is the private state directory, reached through a `functions`
    // link, so those temp files never appear in the repository: dependency-cruiser (`pnpm arch`, HF-05) crawls the
    // repository while the stack runs, and a temp file it lists can be gone by the time it reads it.
    symlinkSync(path.join(repoRoot, 'apps', 'web', 'functions'), path.join(stateDir, 'functions'), 'dir');
    // Every wrangler needs its own inspector port: the default one is shared by all workers of the run.
    for (const [name, site, api, port, inspector] of [
      ['staging site', origins.stagingSite, origins.stagingApi, ports.stagingSite, await freePort()],
      ['plain site', origins.plainSite, origins.plainApi, ports.plainSite, await freePort()],
    ] as const) {
      const serverArgs = [
        wrangler,
        'pages',
        'dev',
        path.join(repoRoot, 'apps', 'web', 'dist'),
        '--ip',
        '127.0.0.1',
        '--port',
        String(port),
        '--inspector-port',
        String(inspector),
        // Local storage is private to this stack: workers share no workerd state directory.
        '--persist-to',
        path.join(stateDir, name.replace(' ', '-')),
        '--compatibility-date',
        WRANGLER_COMPATIBILITY_DATE,
        '--binding',
        `API_ORIGIN=${api}`,
        '--show-interactive-dev-session=false',
        '--log-level=warn',
      ];
      const server = launch(name, process.execPath, serverArgs, {
        cwd: stateDir,
        env: {
          PATH: process.env['PATH'] ?? '',
          HOME: process.env['HOME'] ?? '',
          WRANGLER_SEND_METRICS: 'false',
          CI: '1',
        },
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
