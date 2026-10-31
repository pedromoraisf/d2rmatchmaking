import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  createMigratedTestDatabase,
  type MigratedTestDatabase,
} from '../../../test/support/migrated-database.ts';
import { createTestDatabase, type TestDatabase } from '../../../test/support/postgres.ts';
import { FakeClock, FakeScheduler } from '../../shared-kernel/index.ts';
import { buildApp, type AppDatabase, type BuiltApp } from '../app.ts';
import { NodeRandomSource, RandomUuidGenerator } from '../runtime.ts';

/** The API package root: the composition roots are scripts run from here. */
const API_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SECRET = `secret-${randomBytes(12).toString('hex')}`;
const SITE_ORIGIN = 'https://site.example';

let database: TestDatabase;
let migrated: MigratedTestDatabase<AppDatabase>;
const running: Running[] = [];

interface Running {
  readonly url: string;
  stop(): Promise<void>;
}

beforeAll(async () => {
  database = await createTestDatabase();
  migrated = await createMigratedTestDatabase<AppDatabase>();
});

afterEach(async () => {
  while (running.length > 0) {
    await running.pop()?.stop();
  }
});

afterAll(async () => {
  await migrated.close();
  await database.close();
});

/** The environment of a child process: nothing inherited but PATH, so no stray variable reaches it. */
function childEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return { PATH: process.env['PATH'] ?? '', ...overrides };
}

/** Stops a child process and waits for it to exit. */
async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  await once(child, 'exit');
}

/** Starts a composition root as a child process and resolves with its loopback address once it listens. */
function startRoot(script: string, env: Record<string, string>): Promise<Running> {
  return new Promise<Running>((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(API_ROOT, script)], {
      cwd: API_ROOT,
      env: childEnv(env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${script} did not listen in time: ${stderr}`));
    }, 20_000);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      const url = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(stdout)?.[1];
      if (url !== undefined) {
        clearTimeout(timer);
        const handle: Running = { url, stop: () => stopChild(child) };
        running.push(handle);
        resolve(handle);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`${script} exited with ${String(code)}: ${stderr}`));
    });
  });
}

/** Runs a composition root until it exits on its own and returns its exit code and stderr. */
async function runToExit(
  script: string,
  env: Record<string, string>,
): Promise<{ code: number | null; stderr: string }> {
  const child = spawn(process.execPath, [path.join(API_ROOT, script)], {
    cwd: API_ROOT,
    env: childEnv(env),
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const [code] = await once(child, 'exit');
  return { code: code as number | null, stderr };
}

/** The local root's environment: the given database, acceptance on, and the run's secret. */
function acceptanceEnv(databaseUrl: string): Record<string, string> {
  return {
    DATABASE_URL: databaseUrl,
    D2RMM_ENV: 'local',
    PORT: '0',
    D2RMM_ACCEPTANCE: 'true',
    TEST_CONTROL_SECRET: SECRET,
  };
}

/** A fresh database named `acc_w<n>`, as the acceptance stack creates one per worker. */
async function createAcceptanceDatabase(): Promise<string> {
  const name = `acc_w${randomInt(1_000_000_000)}`;
  const admin = new pg.Client({ connectionString: inject('postgresAdminUrl') });
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }
  const url = new URL(database.url);
  url.pathname = `/${name}`;
  return url.toString();
}

describe('composition roots', () => {
  it('local.ts started as a child process answers /healthz', async () => {
    const local = await startRoot('src/main/local.ts', {
      DATABASE_URL: database.url,
      D2RMM_ENV: 'local',
      PORT: '0',
    });

    const response = await fetch(`${local.url}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('render refuses staging endpoints outside staging', async () => {
    const outcome = await runToExit('src/main/render.ts', {
      DATABASE_URL: database.url,
      D2RMM_ENV: 'production',
      ENABLE_STAGING_ENDPOINTS: 'true',
      PORT: '0',
    });

    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toContain('ENABLE_STAGING_ENDPOINTS=true needs D2RMM_ENV=staging');
  });

  it('render refuses to start when D2RMM_ACCEPTANCE is set, whatever its value', async () => {
    const outcome = await runToExit('src/main/render.ts', {
      DATABASE_URL: database.url,
      D2RMM_ENV: 'staging',
      D2RMM_ACCEPTANCE: 'false',
      PORT: '0',
    });

    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toContain('D2RMM_ACCEPTANCE is set');
  });

  it('the Render app has no /__test route', async () => {
    const clock = new FakeClock(new Date('2026-10-31T12:00:00.000Z'));
    const built: BuiltApp = await buildApp({
      db: migrated.db,
      config: {
        stagingEndpoints: false,
        minAgentVersion: '0.0.0',
        siteOrigin: SITE_ORIGIN,
        trustProxyHops: 1,
      },
      clock,
      scheduler: new FakeScheduler(clock),
      random: new NodeRandomSource(),
      ids: new RandomUuidGenerator(),
    });
    try {
      const response = await built.app.inject({
        method: 'POST',
        url: '/__test/reset',
        headers: { 'x-test-control': SECRET },
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await built.app.close();
    }
  });

  it('reset without the secret answers 403', async () => {
    const local = await startRoot('src/main/local.ts', acceptanceEnv(database.url));

    const response = await fetch(`${local.url}/__test/reset`, { method: 'POST' });
    expect(response.status).toBe(403);
  });

  it('reset against a database not named acc_w<n> is refused', async () => {
    const local = await startRoot('src/main/local.ts', acceptanceEnv(database.url));

    const response = await fetch(`${local.url}/__test/reset`, {
      method: 'POST',
      headers: { 'x-test-control': SECRET },
    });
    expect(response.status).toBe(403);
  });

  it('the clock control moves time only with the secret', async () => {
    const local = await startRoot('src/main/local.ts', acceptanceEnv(database.url));
    const body = JSON.stringify({ advanceMs: 1000 });

    const refused = await fetch(`${local.url}/__test/clock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(refused.status).toBe(403);

    const moved = await fetch(`${local.url}/__test/clock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-control': SECRET },
      body,
    });
    expect(moved.status).toBe(204);
  });

  it('reset on an acceptance database empties the tables', async () => {
    const url = await createAcceptanceDatabase();
    const local = await startRoot('src/main/local.ts', acceptanceEnv(url));
    const pool = new pg.Pool({ connectionString: url });
    try {
      await pool.query(
        `insert into identity.accounts (id, battletag, display_name, test_key, created_at)
         values (gen_random_uuid(), 'Reset#test', 'Reset', 'reset', now())`,
      );
      const before = await pool.query<{ count: string }>('select count(*) from identity.accounts');
      expect(before.rows[0]?.count).toBe('1');

      const response = await fetch(`${local.url}/__test/reset`, {
        method: 'POST',
        headers: { 'x-test-control': SECRET },
      });
      expect(response.status).toBe(204);

      const after = await pool.query<{ count: string }>('select count(*) from identity.accounts');
      expect(after.rows[0]?.count).toBe('0');
    } finally {
      await pool.end();
    }
  });
});
