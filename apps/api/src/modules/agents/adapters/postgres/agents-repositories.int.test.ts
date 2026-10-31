import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  type MigratedTestDatabase,
} from '../../../../../test/support/migrated-database.ts';
import {
  FakeClock,
  type IdGenerator,
  type RandomSource,
  type Transaction,
  type UnitOfWork,
} from '../../../../shared-kernel/index.ts';
import { Agent } from '../../domain/agent.ts';
import { PairingCode } from '../../domain/pairing-code.ts';
import { createRequestPairingCode } from '../../application/request-pairing-code.ts';
import { FakeSecretHasher } from '../../application/testing/fake-secret-hasher.ts';
import { MemoryRateLimitStore } from '../memory/memory-rate-limit-store.ts';
import { PostgresAgentRepository } from './postgres-agent-repository.ts';
import { PostgresPairingCodeRepository } from './postgres-pairing-code-repository.ts';
import type { AgentsDatabase } from './schema.ts';

const NOW = new Date('2026-10-31T12:00:00.000Z');
const FIVE_MINUTES_MS = 5 * 60 * 1000;

let database: MigratedTestDatabase<AgentsDatabase>;
let agents: PostgresAgentRepository;
let codes: PostgresPairingCodeRepository;

beforeAll(async () => {
  database = await createMigratedTestDatabase<AgentsDatabase>();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.pool.query('delete from agents.pairing_codes');
  await database.pool.query('delete from agents.agents');
  await database.pool.query('delete from identity.sessions');
  await database.pool.query('delete from identity.accounts');
  const clock = new FakeClock(NOW);
  agents = new PostgresAgentRepository(database.db, clock);
  codes = new PostgresPairingCodeRepository(database.db, clock);
});

/** Runs the work in a real transaction and hands it the opaque token, as the platform's unit of work does. */
async function inTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  return database.db.transaction().execute((trx) => work(trx as unknown as Transaction));
}

async function insertAccount(): Promise<string> {
  const id = randomUUID();
  await database.pool.query(
    `insert into identity.accounts (id, battletag, display_name, created_at) values ($1, $2, 'PlayerOne', now())`,
    [id, `${id}#test`],
  );
  return id;
}

/** A RandomSource whose `int` draws come from a queue, so a test chooses the pairing codes. */
class QueuedRandom implements RandomSource {
  readonly #ints: number[];

  constructor(ints: readonly number[]) {
    this.#ints = [...ints];
  }

  int(): number {
    return this.#ints.shift() ?? 0;
  }

  /** Real bytes: each claim secret must differ, since the schema makes `claim_secret_hash` unique. */
  bytes(n: number): Uint8Array {
    return new Uint8Array(randomBytes(n));
  }
}

describe('Agents Postgres repositories', () => {
  it('two concurrent claims return the token once', async () => {
    const accountId = await insertAccount();
    const agent = new Agent({ id: randomUUID(), claimSecretHash: 'claim-hash' }).pair(accountId, NOW);
    await inTransaction((tx) => agents.insert(tx, agent));

    const claims = await Promise.all([
      agents.claimTokenAtomically('claim-hash', 'token-hash-a', NOW),
      agents.claimTokenAtomically('claim-hash', 'token-hash-b', NOW),
    ]);

    expect(claims.filter((claim) => claim !== null)).toEqual([{ agentId: agent.id, accountId }]);
    const stored = await agents.findById(agent.id);
    expect(['token-hash-a', 'token-hash-b']).toContain(stored?.tokenHash);
  });

  it('a claim for an unpaired or revoked agent updates no row', async () => {
    const accountId = await insertAccount();
    const unpaired = new Agent({ id: randomUUID(), claimSecretHash: 'unpaired-hash' });
    const revoked = new Agent({ id: randomUUID(), claimSecretHash: 'revoked-hash' })
      .pair(accountId, NOW)
      .revoke(NOW);
    await inTransaction(async (tx) => {
      await agents.insert(tx, unpaired);
      await agents.insert(tx, revoked);
    });

    expect(await agents.claimTokenAtomically('unpaired-hash', 'token-hash-u', NOW)).toBeNull();
    expect(await agents.claimTokenAtomically('revoked-hash', 'token-hash-r', NOW)).toBeNull();
    expect((await agents.findById(unpaired.id))?.tokenHash).toBeUndefined();
    expect((await agents.findById(revoked.id))?.tokenHash).toBeUndefined();
  });

  it('an expired unused code with the same digits is replaced', async () => {
    const oldAgent = new Agent({ id: randomUUID(), claimSecretHash: 'old-claim' });
    const newAgent = new Agent({ id: randomUUID(), claimSecretHash: 'new-claim' });
    await inTransaction(async (tx) => {
      await agents.insert(tx, oldAgent);
      await agents.insert(tx, newAgent);
      await codes.insert(
        tx,
        new PairingCode({
          agentId: oldAgent.id,
          code: '424242',
          expiresAt: new Date(NOW.getTime() - 60_000),
        }),
      );
    });

    const fresh = new PairingCode({
      agentId: newAgent.id,
      code: '424242',
      expiresAt: new Date(NOW.getTime() + FIVE_MINUTES_MS),
    });
    await inTransaction((tx) => codes.insert(tx, fresh));

    const rows = await database.pool.query<{ agent_id: string }>(
      `select agent_id from agents.pairing_codes where code = '424242' and used_at is null`,
    );
    expect(rows.rows).toEqual([{ agent_id: newAgent.id }]);
  });

  it('a live duplicate code is retried', async () => {
    const clock = new FakeClock(NOW);
    const uow: UnitOfWork = {
      run: (work) => database.db.transaction().execute((trx) => work(trx as unknown as Transaction)),
    };
    const ids: IdGenerator = { next: () => randomUUID() };
    const deps = {
      agents,
      codes,
      rateLimits: new MemoryRateLimitStore(),
      hasher: new FakeSecretHasher(),
      clock,
      ids,
      uow,
    };
    const requestPairingCode = createRequestPairingCode({ ...deps, random: new QueuedRandom([424242]) });
    const first = await requestPairingCode({ ip: '203.0.113.10' });

    // The first draw repeats the live code 424242; the use case must draw again and take 535353.
    const retried = createRequestPairingCode({ ...deps, random: new QueuedRandom([424242, 535353]) });
    const second = await retried({ ip: '203.0.113.11' });

    expect(first).toMatchObject({ ok: true, value: { code: '424242' } });
    expect(second).toMatchObject({ ok: true, value: { code: '535353' } });
    const live = await database.pool.query<{ code: string }>(
      `select code from agents.pairing_codes where used_at is null order by code`,
    );
    expect(live.rows.map((row) => row.code)).toEqual(['424242', '535353']);
  });
});
