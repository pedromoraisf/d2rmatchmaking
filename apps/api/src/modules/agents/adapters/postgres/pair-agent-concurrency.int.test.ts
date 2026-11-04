import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  type MigratedTestDatabase,
} from '../../../../../test/support/migrated-database.ts';
import { FakeClock, type Transaction, type UnitOfWork } from '../../../../shared-kernel/index.ts';
import { SeededRandomSource } from '../../../../shared-kernel/random-source.ts';
import { createPairingUseCases } from '../../application/agents-use-cases.ts';
import { FakeSecretHasher } from '../../application/testing/fake-secret-hasher.ts';
import { RecordingEventBus } from '../../application/testing/recording-event-bus.ts';
import { MemoryRateLimitStore } from '../memory/memory-rate-limit-store.ts';
import { PostgresAgentRepository } from './postgres-agent-repository.ts';
import { PostgresPairingCodeRepository } from './postgres-pairing-code-repository.ts';
import type { AgentsDatabase } from './schema.ts';

const NOW = new Date('2026-11-03T12:00:00.000Z');
/** A pair that has not finished by now is a deadlock on the pool, not a slow request. */
const FINISH_WITHIN_MS = 10_000;
/** Teardown never waits longer than this, so a red run ends by itself. */
const TEARDOWN_WITHIN_MS = 5_000;
const PAIRS = 8;
const POOL_MAX = 2;

let migrated: MigratedTestDatabase<AgentsDatabase>;
let pool: pg.Pool;
let db: Kysely<AgentsDatabase>;

beforeAll(async () => {
  // The migrated database supplies the schema; the pool under test is a second one on the same database.
  migrated = await createMigratedTestDatabase<AgentsDatabase>();
  // A pool smaller than the number of concurrent pairs. The default pool of the composition roots has 10 connections.
  pool = new pg.Pool({ connectionString: migrated.url, max: POOL_MAX });
  db = new Kysely<AgentsDatabase>({ dialect: new PostgresDialect({ pool }) });
});

afterAll(async () => {
  // A deadlocked pool never drains, so `end()` may never settle. Each close is bounded and its result ignored.
  await settleWithin(db.destroy(), TEARDOWN_WITHIN_MS);
  await settleWithin(migrated.close(), TEARDOWN_WITHIN_MS);
});

/** Resolves with the work's value, or rejects when it has not settled within `ms`. */
async function finishWithin<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`not finished within ${ms} ms: the pairs are waiting for a pool connection`));
    }, ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Waits for the work to settle, at most `ms`, and ignores its outcome. */
async function settleWithin(work: Promise<unknown>, ms: number): Promise<void> {
  await finishWithin(
    work.then(
      () => undefined,
      () => undefined,
    ),
    ms,
  ).catch(() => undefined);
}

/**
 * Runs the work in one real transaction on the pool and hands it the opaque token, as the platform's unit of work does
 * (`PostgresUnitOfWork`). The platform is not imported here: `platform-is-adapter` forbids it from module code.
 */
const uow: UnitOfWork = {
  run: (work) => db.transaction().execute((trx) => work(trx as unknown as Transaction)),
};

async function insertAccount(): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into identity.accounts (id, battletag, display_name, created_at) values ($1, $2, 'PlayerOne', now())`,
    [id, `${id}#test`],
  );
  return id;
}

describe('pair on a Postgres pool smaller than its concurrency', () => {
  it('concurrent pairs finish on a small pool', async () => {
    const clock = new FakeClock(NOW);
    const useCases = createPairingUseCases({
      agents: new PostgresAgentRepository(db, clock),
      codes: new PostgresPairingCodeRepository(db, clock),
      rateLimits: new MemoryRateLimitStore(),
      hasher: new FakeSecretHasher(),
      clock,
      random: new SeededRandomSource(2026),
      ids: { next: () => randomUUID() },
      uow,
      bus: new RecordingEventBus(),
    });

    // Codes are issued one by one, from distinct IPs, before the pairs race for the pool.
    const accounts: string[] = [];
    const codes: string[] = [];
    for (let i = 0; i < PAIRS; i += 1) {
      accounts.push(await insertAccount());
      const issued = await useCases.requestPairingCode({ ip: `203.0.113.${10 + i}` });
      if (!issued.ok) {
        throw new Error('the pairing code request should succeed');
      }
      codes.push(issued.value.code);
    }

    const pairs = accounts.map((accountId, i) => useCases.pairAgent({ accountId, code: codes[i] ?? '' }));
    const results = await finishWithin(Promise.all(pairs), FINISH_WITHIN_MS);

    expect(results.every((result) => result.ok)).toBe(true);
    const bound = await pool.query<{ account_id: string }>(
      `select account_id from agents.agents where account_id is not null order by account_id`,
    );
    expect(bound.rows.map((row) => row.account_id).sort()).toEqual([...accounts].sort());
  });
});
