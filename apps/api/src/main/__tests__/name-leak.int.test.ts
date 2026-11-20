// SNM-04 (API half, characters path): a misread card name that was reconciled leaves no trace. The name is sent through the
// real route and every span, log line, answer and stored row is scanned for it and for its distinctive parts.
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  type MigratedTestDatabase,
} from '../../../test/support/migrated-database.ts';
import { FakeClock, FakeScheduler } from '../../shared-kernel/index.ts';
import { buildApp, type AppDatabase, type BuiltApp } from '../app.ts';
import { NodeRandomSource, RandomUuidGenerator } from '../runtime.ts';
import { findLeaks, type Observed } from './name-leak-scan.ts';

const SITE_ORIGIN = 'https://site.example';
const AGENT_VERSION = '1.0.0';

/** Stored `Oxzqy`; the screen reads `Gxzqy` (the `O` read as `g`). Nothing else in the suite looks like either. */
const STORED = 'Oxzqy';
const MISREAD = 'Gxzqy';

const exporter = new InMemorySpanExporter();
let database: MigratedTestDatabase<AppDatabase>;
let app: BuiltApp;
let logLines: string[];

beforeAll(async () => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
  );
  database = await createMigratedTestDatabase<AppDatabase>();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  exporter.reset();
  logLines = [];
  const clock = new FakeClock(new Date('2026-10-31T12:00:00.000Z'));
  app = await buildApp({
    db: database.db,
    config: { stagingEndpoints: true, minAgentVersion: '0.0.1', siteOrigin: SITE_ORIGIN, trustProxyHops: 1 },
    clock,
    scheduler: new FakeScheduler(clock),
    random: new NodeRandomSource(),
    ids: new RandomUuidGenerator(),
    logSink: new Writable({
      write(chunk: Buffer, _encoding, callback) {
        logLines.push(chunk.toString());
        callback();
      },
    }),
  });
});

afterEach(async () => {
  await app.app.close();
});

export function bodyOf<T>(response: { readonly body: string }): T {
  return JSON.parse(response.body) as T;
}

export async function sessionFor(app: BuiltApp): Promise<string> {
  const response = await app.app.inject({
    method: 'POST',
    url: '/v1/auth/test-login',
    headers: { origin: SITE_ORIGIN, 'content-type': 'application/json' },
    payload: { name: `p${randomUUID().replaceAll('-', '').slice(0, 14)}` },
  });
  expect(response.statusCode).toBe(200);
  const header = response.headers['set-cookie'];
  return (Array.isArray(header) ? (header[0] ?? '') : String(header ?? '')).split(';')[0] ?? '';
}

/** Pairs an agent for the session and returns its token. */
export async function tokenFor(app: BuiltApp, cookie: string): Promise<string> {
  const headers = { 'x-agent-version': AGENT_VERSION };
  const issued = bodyOf<{ code: string; claimSecret: string }>(
    await app.app.inject({ method: 'POST', url: '/v1/agents/pairing-codes', headers }),
  );
  const claim = async () =>
    await app.app.inject({
      method: 'POST',
      url: '/v1/agents/pairing-codes/claim',
      headers: { ...headers, 'content-type': 'application/json' },
      payload: { claimSecret: issued.claimSecret },
    });
  await claim();
  const paired = await app.app.inject({
    method: 'POST',
    url: '/v1/agents/pair',
    headers: { origin: SITE_ORIGIN, 'content-type': 'application/json', cookie },
    payload: { code: issued.code },
  });
  expect(paired.statusCode).toBe(200);
  return bodyOf<{ token: string }>(await claim()).token;
}

/** Every row of the tables a card batch writes, as JSON text. */
async function rowsWritten(): Promise<string[]> {
  const characters = await sql<{
    row: string;
  }>`select to_json(c)::text as row from identity.characters c`.execute(database.db);
  const outbox = await sql<{ row: string }>`select to_json(o)::text as row from platform.outbox o`.execute(
    database.db,
  );
  return [...characters.rows, ...outbox.rows].map((entry) => entry.row);
}

describe('a misread card name leaves no trace (SNM-04)', () => {
  it('is in no span, log line, answer or row once it was reconciled', async () => {
    const cookie = await sessionFor(app);
    const token = await tokenFor(app, cookie);
    const card = (name: string, level: number) => ({
      name,
      class: 'sorceress',
      level,
      hardcore: false,
      unlockedDifficulties: ['normal', 'nightmare', 'hell'],
    });
    const first = await app.app.inject({
      method: 'POST',
      url: '/v1/me/characters',
      headers: {
        authorization: `Bearer ${token}`,
        'x-agent-version': '1.0.0',
        'content-type': 'application/json',
      },
      payload: { characters: [card(STORED, 85)] },
    });
    expect(first.statusCode).toBe(204);

    const answer = await app.app.inject({
      method: 'POST',
      url: '/v1/me/characters',
      headers: {
        authorization: `Bearer ${token}`,
        'x-agent-version': '1.0.0',
        'content-type': 'application/json',
      },
      payload: { characters: [card(MISREAD, 86)] },
    });
    expect(answer.statusCode).toBe(204);

    const observed: Observed = {
      spans: exporter.getFinishedSpans(),
      logs: logLines,
      responses: [answer.body, first.body],
      rows: await rowsWritten(),
    };
    expect(observed.spans.some((span) => span.name === 'identity.record-characters')).toBe(true);
    expect(findLeaks(MISREAD, STORED, observed)).toEqual([]);
  });
});
