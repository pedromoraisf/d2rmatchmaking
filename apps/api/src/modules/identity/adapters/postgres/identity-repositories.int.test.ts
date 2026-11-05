import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  type MigratedTestDatabase,
} from '../../../../../test/support/migrated-database.ts';
import { FakeClock } from '../../../../shared-kernel/index.ts';
import type { Account } from '../../domain/account.ts';
import { PostgresAccountRepository } from './postgres-account-repository.ts';
import { PostgresSessionRepository } from './postgres-session-repository.ts';
import { Sha256SecretHasher } from './sha256-secret-hasher.ts';
import type { IdentityDatabase } from './schema.ts';

const NOW = new Date('2026-10-31T12:00:00.000Z');

let database: MigratedTestDatabase<IdentityDatabase>;
let accounts: PostgresAccountRepository;
let sessions: PostgresSessionRepository;

beforeAll(async () => {
  database = await createMigratedTestDatabase<IdentityDatabase>();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.pool.query('delete from identity.sessions');
  await database.pool.query('delete from identity.accounts');
  accounts = new PostgresAccountRepository(database.db, new FakeClock(NOW));
  sessions = new PostgresSessionRepository(database.db);
});

function testAccount(name: string): Account {
  return { id: randomUUID(), battletag: `${name}#test`, displayName: name, testKey: name.toLowerCase() };
}

describe('Identity Postgres repositories', () => {
  it('inserts a test account and finds it by its test key', async () => {
    const account = testAccount('PlayerOne');
    await accounts.insertTestAccount(account);

    expect(await accounts.findTestAccount('playerone')).toEqual(account);
    expect(await accounts.findById(account.id)).toEqual(account);
  });

  it('refuses a second account with the same test key', async () => {
    await accounts.insertTestAccount(testAccount('PlayerOne'));

    const duplicate = accounts.insertTestAccount({
      id: randomUUID(),
      battletag: 'playerone-2#test',
      displayName: 'playerone',
      testKey: 'playerone',
    });

    await expect(duplicate).rejects.toMatchObject({ code: '23505' });
  });

  it('finds a session by the hash of its token', async () => {
    const account = testAccount('PlayerTwo');
    await accounts.insertTestAccount(account);
    const hasher = new Sha256SecretHasher();
    const expiresAt = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
    await sessions.insert({
      tokenHash: hasher.hash('session', 'd2rmm_s_token'),
      accountId: account.id,
      expiresAt,
    });

    expect(await sessions.findByHash(hasher.hash('session', 'd2rmm_s_token'))).toEqual({
      accountId: account.id,
      expiresAt,
    });
    expect(await sessions.findByHash(hasher.hash('session', 'd2rmm_s_other'))).toBeNull();
  });

  it('hashes the same value differently in the session and agent domains', () => {
    const hasher = new Sha256SecretHasher();

    expect(hasher.hash('session', 'same-value')).not.toBe(hasher.hash('agent', 'same-value'));
    expect(hasher.hash('session', 'same-value')).toMatch(/^[0-9a-f]{64}$/);
  });
});
