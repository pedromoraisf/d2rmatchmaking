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

/** A room of the player's test match, whose host has a character named `name`. Returns the room id and the agent token. */
async function roomWithCharacter(name: string): Promise<{ roomId: string; token: string }> {
  const cookie = await sessionFor(app);
  const token = await tokenFor(app, cookie);
  const match = await app.app.inject({
    method: 'POST',
    url: '/v1/staging/match-formed',
    headers: { origin: SITE_ORIGIN, 'content-type': 'application/json', cookie },
    payload: {},
  });
  expect(match.statusCode).toBe(202);
  await app.relay.settled();
  const room = (await app.app.inject({ method: 'GET', url: '/v1/me/room', headers: { cookie } })).json() as {
    roomId: string;
    members: { accountId: string }[];
  };
  const accountId = room.members[0]?.accountId ?? '';
  const inserted = await database.db
    .insertInto('identity.characters')
    .values({
      account_id: accountId,
      name,
      class: 'sorceress',
      level: 85,
      hardcore: false,
      ladder: null,
      era: null,
      unlocked_difficulties: ['normal', 'nightmare', 'hell'],
      read_at: new Date('2026-10-31T12:00:00.000Z'),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await database.db
    .updateTable('lobby.members')
    .set({ character_id: inserted.id })
    .where('room_id', '=', room.roomId)
    .where('account_id', '=', accountId)
    .execute();
  return { roomId: room.roomId, token };
}

function sightingOf(value: string, key: string) {
  return {
    idempotencyKey: key,
    type: 'PLAYER_JOINED_SEEN',
    run: 1,
    value,
    confidence: 0.9,
    capturedAt: '2026-10-31T12:00:00.000Z',
  };
}

/** Every row of every table of the `lobby` schema, found in `information_schema`, as JSON text: a table added later is scanned too. */
async function lobbyRows(): Promise<string[]> {
  const tables = await sql<{ table_name: string }>`
    select table_name from information_schema.tables where table_schema = 'lobby' and table_type = 'BASE TABLE'`.execute(
    database.db,
  );
  const rows: string[] = [];
  for (const { table_name: table } of tables.rows) {
    const found = await sql<{
      row: string;
    }>`select to_json(t)::text as row from ${sql.table(`lobby.${table}`)} t`.execute(database.db);
    rows.push(...found.rows.map((entry) => entry.row));
  }
  return rows;
}

/** A second member of the room with a character of this name: two members, so a name can stand for both. */
async function addMemberWithCharacter(roomId: string, name: string): Promise<void> {
  const cookie = await sessionFor(app);
  const accountId = (await app.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie } })).json() as {
    accountId?: string;
    id?: string;
  };
  const account = accountId.accountId ?? accountId.id ?? '';
  const inserted = await database.db
    .insertInto('identity.characters')
    .values({
      account_id: account,
      name,
      class: 'paladin',
      level: 80,
      hardcore: false,
      ladder: null,
      era: null,
      unlocked_difficulties: ['normal', 'nightmare', 'hell'],
      read_at: new Date('2026-10-31T12:00:00.000Z'),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await database.db
    .insertInto('lobby.members')
    .values({
      room_id: roomId,
      account_id: account,
      character_id: inserted.id,
      role: 'member',
      join_order: 2,
      confirmed_run: null,
      left_at: null,
    })
    .execute();
}

describe('a chat name leaves no trace (SNM-04)', () => {
  it('is in no span, log line, answer or row, on every path of the observation route', async () => {
    const { roomId, token } = await roomWithCharacter(STORED);
    const send = (payload: unknown) =>
      app.app.inject({
        method: 'POST',
        url: `/v1/lobby-rooms/${roomId}/observations`,
        headers: {
          authorization: `Bearer ${token}`,
          'x-agent-version': AGENT_VERSION,
          'content-type': 'application/json',
        },
        payload: payload as object,
      });
    const sighting = (value: string, key: string, type = 'PLAYER_JOINED_SEEN') => ({
      ...sightingOf(value, key),
      type,
    });

    const answers = [];
    // Matched, joined and left; a miss; a replay of each; an unknown type; a value that breaks the rule (illegal character,
    // too long); and a body past the limit.
    answers.push(await send(sighting(MISREAD, 'k-join')));
    answers.push(await send(sighting(MISREAD, 'k-left', 'PLAYER_LEFT_SEEN')));
    answers.push(await send(sighting('Qwvkjh', 'k-miss')));
    answers.push(await send(sighting(MISREAD, 'k-join')));
    answers.push(await send(sighting('Qwvkjh', 'k-miss')));
    answers.push(await send(sighting('Vqkjwz', 'k-unknown', 'SOMETHING_ELSE')));
    answers.push(await send(sighting('Xqjz3pk', 'k-illegal')));
    answers.push(await send(sighting('Qzxjvkwpyqzxjvkw', 'k-long')));
    answers.push(
      await send({
        ...sighting('Pqzxkjv', 'k-big'),
        signals: { pad: 1 },
        filler: `Pqzxkjv${'x'.repeat(5 * 1024)}`,
      }),
    );
    const statuses = answers.map((answer) => answer.statusCode);
    expect(statuses.slice(0, 6)).toEqual([202, 202, 202, 202, 202, 202]);
    expect(statuses.slice(6, 8)).toEqual([400, 400]);
    expect(statuses[8]).toBe(413);

    // The ambiguous path: a second member holds the same name, so the read stands for both.
    await addMemberWithCharacter(roomId, STORED);
    answers.push(await send(sighting(MISREAD, 'k-ambiguous')));
    expect(answers.at(-1)?.statusCode).toBe(202);

    const observed: Observed = {
      spans: exporter.getFinishedSpans(),
      logs: logLines,
      responses: answers.map((answer) => answer.body),
      rows: [...(await rowsWritten()), ...(await lobbyRows())],
    };
    for (const [read, canonical] of [
      [MISREAD, STORED],
      ['Qwvkjh', 'Zzzzzz'],
      ['Vqkjwz', 'Zzzzzz'],
      ['Xqjz3pk', 'Zzzzzz'],
      ['Qzxjvkwpyqzxjvkw', 'Zzzzzz'],
      ['Pqzxkjv', 'Zzzzzz'],
    ] as const) {
      expect(findLeaks(read, canonical, observed), read).toEqual([]);
    }
    // The span says only which of three words the match was, and the ambiguous path was reached.
    const words = new Set(
      exporter
        .getFinishedSpans()
        .filter((span) => span.name === 'lobby.record-observation')
        .map((span) => span.attributes['d2r.observation.match']),
    );
    expect(words).toEqual(new Set(['matched', 'none', 'ambiguous', undefined]));
    // Only the two matched sightings left a row, and each holds the member's join order.
    const kept = await sql<{
      value: string;
      type: string;
    }>`select value, type from lobby.observations order by type`.execute(database.db);
    expect(kept.rows).toEqual([
      { value: '1', type: 'PLAYER_JOINED_SEEN' },
      { value: '1', type: 'PLAYER_LEFT_SEEN' },
    ]);
    // Every answer to a valid sighting is the same, a match or not (security review of #101).
    expect(new Set(answers.slice(0, 5).map((answer) => answer.body)).size).toBe(1);
  });
});

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
