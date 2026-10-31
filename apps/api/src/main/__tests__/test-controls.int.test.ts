// The redelivery test control (AD-062) in process: the recording handler sits on the same bus the control publishes on,
// so the real `onMatchFormed` consumer and the test both see every delivery. Child processes cannot be observed this way.
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  createMigratedTestDatabase,
  type MigratedTestDatabase,
} from '../../../test/support/migrated-database.ts';
import { migrateToLatest } from '../../platform/postgres/migrator.ts';
import { buildApp, type AppDatabase, type BuiltApp } from '../app.ts';
import { ClockScheduler, NodeRandomSource, RandomUuidGenerator } from '../runtime.ts';
import { ControllableClock, registerTestControls, TEST_CONTROL_HEADER } from '../test-controls.ts';

const START = new Date('2026-10-31T12:00:00.000Z');
const SITE_ORIGIN = 'https://site.example';
const SECRET = `secret-${randomBytes(12).toString('hex')}`;
const REDELIVER = '/__test/redeliver-match-formed';

let migrated: MigratedTestDatabase<AppDatabase>;
const closers: (() => Promise<void>)[] = [];

beforeAll(async () => {
  migrated = await createMigratedTestDatabase<AppDatabase>();
});

afterEach(async () => {
  while (closers.length > 0) {
    await closers.pop()?.();
  }
});

afterAll(async () => {
  await migrated.close();
});

/** A fresh database named `acc_w<n>` on the run's container, migrated: what the acceptance stack creates per worker. */
async function openAcceptanceDatabase(): Promise<{ db: Kysely<AppDatabase>; name: string }> {
  const name = `acc_w${randomInt(1_000_000_000)}`;
  const admin = new pg.Client({ connectionString: inject('postgresAdminUrl') });
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }
  const url = new URL(migrated.url);
  url.pathname = `/${name}`;
  const db = new Kysely<AppDatabase>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url.toString() }) }),
  });
  closers.push(() => db.destroy());
  await migrateToLatest(db);
  return { db, name };
}

/** The app as `buildApp` makes it. `controls` registers the test controls the way `local.ts` does. */
async function startApp(
  db: Kysely<AppDatabase>,
  controls?: { readonly name: string; readonly host: string },
): Promise<BuiltApp> {
  const silentSink = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const clock = new ControllableClock(START);
  const built = await buildApp({
    db,
    config: { stagingEndpoints: true, minAgentVersion: '0.0.1', siteOrigin: SITE_ORIGIN, trustProxyHops: 1 },
    clock,
    scheduler: new ClockScheduler(clock),
    random: new NodeRandomSource(),
    ids: new RandomUuidGenerator(),
    logSink: silentSink,
  });
  if (controls !== undefined) {
    registerTestControls(built.app, {
      db,
      clock,
      secret: SECRET,
      database: controls,
      stores: built.stores,
      hub: built.hub,
      relay: built.relay,
      bus: built.bus,
    });
  }
  closers.push(() => built.app.close());
  return built;
}

/** A player name no other test uses: the database of a test is shared by the tests of its file. */
function uniquePlayerName(): string {
  return `p${randomUUID().replaceAll('-', '').slice(0, 14)}`;
}

/** Signs a test player in on the site and returns the session cookie. */
async function sessionFor(app: BuiltApp): Promise<string> {
  const response = await app.app.inject({
    method: 'POST',
    url: '/v1/auth/test-login',
    headers: { origin: SITE_ORIGIN, 'content-type': 'application/json' },
    payload: { name: uniquePlayerName() },
  });
  expect(response.statusCode).toBe(200);
  const header = response.headers['set-cookie'];
  const setCookie = Array.isArray(header) ? (header[0] ?? '') : String(header ?? '');
  return setCookie.split(';')[0] ?? '';
}

/** The site's test match: 202 with the match id, then the relay has published it and the consumers have run. */
async function formMatch(app: BuiltApp, cookie: string): Promise<string> {
  const response = await app.app.inject({
    method: 'POST',
    url: '/v1/staging/match-formed',
    headers: { origin: SITE_ORIGIN, 'content-type': 'application/json', cookie },
    payload: {},
  });
  expect(response.statusCode).toBe(202);
  await app.relay.settled();
  return (JSON.parse(response.body) as { matchId: string }).matchId;
}

/** Records the outbox id of every durable event the bus delivers with the given type, in delivery order. */
function recordDurable(app: BuiltApp, type: 'MatchFormed'): bigint[] {
  const delivered: bigint[] = [];
  app.bus.subscribe(type, (event) => {
    if (event.kind === 'durable') {
      delivered.push(event.id);
    }
  });
  return delivered;
}

/** The redelivery control, called with the given header value (or none). */
function redeliver(app: BuiltApp, secret?: string) {
  return app.app.inject({
    method: 'POST',
    url: REDELIVER,
    headers: secret === undefined ? {} : { [TEST_CONTROL_HEADER]: secret },
  });
}

/** The outbox ids of the MatchFormed rows of a database, oldest first. */
async function matchFormedIds(db: Kysely<AppDatabase>): Promise<string[]> {
  const rows = await db
    .selectFrom('platform.outbox')
    .select('id')
    .where('event_type', '=', 'MatchFormed')
    .orderBy('id')
    .execute();
  return rows.map((row) => row.id);
}

/** How many rooms of the database a match has. */
async function roomsOfMatch(db: Kysely<AppDatabase>, matchId: string): Promise<number> {
  const rows = await db.selectFrom('lobby.rooms').select('id').where('match_id', '=', matchId).execute();
  return rows.length;
}

describe('the match-formed redelivery control (AD-062)', () => {
  it('redelivers the newest match with its original outbox id, and the consumer makes no second room', async () => {
    const { db, name } = await openAcceptanceDatabase();
    const app = await startApp(db, { name, host: '127.0.0.1' });
    const delivered = recordDurable(app, 'MatchFormed');
    const matchId = await formMatch(app, await sessionFor(app));
    const [outboxId] = await matchFormedIds(db);
    expect(outboxId).toBeDefined();
    expect(delivered).toStrictEqual([BigInt(outboxId ?? '')]);

    const response = await redeliver(app, SECRET);

    expect(response.statusCode).toBe(204);
    // The control awaits the bus, so both deliveries are recorded when it answers.
    expect(delivered).toStrictEqual([BigInt(outboxId ?? ''), BigInt(outboxId ?? '')]);
    expect(await roomsOfMatch(db, matchId)).toBe(1);
  });

  it('answers 404 no-match and publishes nothing when no MatchFormed exists', async () => {
    const { db, name } = await openAcceptanceDatabase();
    const app = await startApp(db, { name, host: 'localhost' });
    const delivered = recordDurable(app, 'MatchFormed');

    const response = await redeliver(app, SECRET);

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toStrictEqual({ error: 'no-match' });
    expect(delivered).toStrictEqual([]);
  });

  it('answers 403 without the secret or with a wrong one, and publishes nothing', async () => {
    const { db, name } = await openAcceptanceDatabase();
    const app = await startApp(db, { name, host: '127.0.0.1' });
    const delivered = recordDurable(app, 'MatchFormed');
    await formMatch(app, await sessionFor(app));
    expect(delivered).toHaveLength(1);

    const missing = await redeliver(app);
    const wrong = await redeliver(app, `${SECRET}x`);

    expect(missing.statusCode).toBe(403);
    expect(JSON.parse(missing.body)).toStrictEqual({ error: 'forbidden' });
    expect(wrong.statusCode).toBe(403);
    expect(delivered).toHaveLength(1);
  });

  it('answers 403 against a database not named acc_w<n>, and publishes nothing', async () => {
    // The shared migrated database: a real match exists, so only the database guard can refuse the redelivery.
    const app = await startApp(migrated.db, { name: migrated.name, host: '127.0.0.1' });
    const delivered = recordDurable(app, 'MatchFormed');
    await formMatch(app, await sessionFor(app));
    expect(delivered).toHaveLength(1);

    const response = await redeliver(app, SECRET);

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toStrictEqual({ error: 'forbidden' });
    expect(delivered).toHaveLength(1);
  });

  it('the app built the way render.ts builds it has no redelivery route', async () => {
    const app = await startApp(migrated.db);

    const response = await redeliver(app, SECRET);

    expect(response.statusCode).toBe(404);
  });
});
