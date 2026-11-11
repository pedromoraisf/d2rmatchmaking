import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  type MigratedTestDatabase,
} from '../../../../../test/support/migrated-database.ts';
import { FakeClock, SeededRandomSource, type Transaction } from '../../../../shared-kernel/index.ts';
import type { Account } from '../../domain/account.ts';
import type { Character } from '../../domain/character/character.ts';
import { PostgresCharacterRepository } from './postgres-character-repository.ts';
import { createSignInWithBattleNet } from '../../application/sign-in-with-battle-net.ts';
import { FakeBattleNetOAuth } from '../../application/testing/fake-battle-net-oauth.ts';
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
  await database.pool.query('delete from identity.characters');
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

  it('finds a Battle.net account by its sub and never as a test account', async () => {
    const account = { id: randomUUID(), battletag: 'Alice#1234', displayName: 'Alice', bnetSub: 'sub-alice' };
    await accounts.insertBattleNetAccount(account);

    expect(await accounts.findByBnetSub('sub-alice')).toEqual(account);
    expect(await accounts.findByBnetSub('sub-unknown')).toBeNull();
    expect(await accounts.findTestAccount('alice')).toBeNull();
  });

  it('refuses a second Battle.net account with the same sub', async () => {
    await accounts.insertBattleNetAccount({
      id: randomUUID(),
      battletag: 'Alice#1234',
      displayName: 'Alice',
      bnetSub: 'sub-alice',
    });

    const duplicate = accounts.insertBattleNetAccount({
      id: randomUUID(),
      battletag: 'Other#9999',
      displayName: 'Other',
      bnetSub: 'sub-alice',
    });

    await expect(duplicate).rejects.toMatchObject({ code: '23505' });
  });

  it('keeps the account id and stores a changed BattleTag and display name', async () => {
    const id = randomUUID();
    await accounts.insertBattleNetAccount({
      id,
      battletag: 'Alice#1234',
      displayName: 'Alice',
      bnetSub: 'sub-a',
    });

    await accounts.updateBattletag(id, 'Alicia#5678', 'Alicia');

    expect(await accounts.findByBnetSub('sub-a')).toEqual({
      id,
      battletag: 'Alicia#5678',
      displayName: 'Alicia',
      bnetSub: 'sub-a',
    });
  });

  it('deletes a session by its token hash and tolerates a missing one', async () => {
    const account = testAccount('PlayerThree');
    await accounts.insertTestAccount(account);
    const hasher = new Sha256SecretHasher();
    const tokenHash = hasher.hash('session', 'd2rmm_s_signout');
    await sessions.insert({ tokenHash, accountId: account.id, expiresAt: new Date(NOW.getTime() + 60_000) });

    await sessions.delete(tokenHash);

    expect(await sessions.findByHash(tokenHash)).toBeNull();
    await expect(sessions.delete(tokenHash)).resolves.toBeUndefined();
  });

  it('lets another Battle.net account take a BattleTag that a player changed away from (IDB-02)', async () => {
    const firstId = randomUUID();
    await accounts.insertBattleNetAccount({
      id: firstId,
      battletag: 'Alice#1234',
      displayName: 'Alice',
      bnetSub: 'sub-first',
    });
    await accounts.updateBattletag(firstId, 'Alicia#5678', 'Alicia');

    const reused = accounts.insertBattleNetAccount({
      id: randomUUID(),
      battletag: 'Alice#1234',
      displayName: 'Alice',
      bnetSub: 'sub-second',
    });

    await expect(reused).resolves.toBeUndefined();
    expect(await accounts.findByBnetSub('sub-second')).toMatchObject({ battletag: 'Alice#1234' });
  });

  it('still refuses a second test account with the same key when BattleTags are not unique (IDB-07)', async () => {
    await accounts.insertTestAccount(testAccount('PlayerFour'));

    const duplicate = accounts.insertTestAccount({
      id: randomUUID(),
      battletag: 'PlayerFour#test',
      displayName: 'PlayerFour',
      testKey: 'playerfour',
    });

    await expect(duplicate).rejects.toMatchObject({ code: '23505' });
  });

  it('two first sign-ins of one sub at once both open a session on the same account (no 500)', async () => {
    const battleNet = new FakeBattleNetOAuth();
    battleNet.willSignIn('sub-race', 'Racer#0001');
    const signIn = createSignInWithBattleNet({
      accounts,
      sessions,
      hasher: new Sha256SecretHasher(),
      clock: new FakeClock(NOW),
      random: new SeededRandomSource(11),
      // Real UUIDs: the accounts table types its id as uuid.
      ids: { next: () => randomUUID() },
      battleNet,
    });
    const callback = { code: 'code', verifier: 'verifier', redirectUri: 'https://site.example/cb' };

    const [first, second] = await Promise.all([signIn(callback), signIn(callback)]);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(second.value.accountId).toBe(first.value.accountId);
    expect(await accounts.findByBnetSub('sub-race')).toMatchObject({ id: first.value.accountId });
  });
});

describe('the character repository (CHR-10, migration 0007)', () => {
  /** The adapter takes the opaque token the unit of work hands out; a Kysely transaction is that token. */
  const asToken = (trx: unknown): Transaction => trx as Transaction;

  function card(name: string, level: number): Character {
    return {
      name,
      class: 'sorceress',
      level,
      ladder: 'sc-ladder',
      era: 'lod',
      unlockedDifficulties: ['normal'],
    };
  }

  it('stores Abc then abc as one row that keeps the newest spelling', async () => {
    const account = testAccount('CharacterOwner');
    await accounts.insertTestAccount(account);
    const characters = new PostgresCharacterRepository(database.db);

    await database.db
      .transaction()
      .execute((trx) => characters.upsertMany(asToken(trx), account.id, [card('Abc', 10)], NOW));
    await database.db
      .transaction()
      .execute((trx) =>
        characters.upsertMany(asToken(trx), account.id, [card('abc', 20)], new Date(NOW.getTime() + 1000)),
      );

    const rows = await database.pool.query<{ name: string }>(
      'select name from identity.characters where account_id = $1',
      [account.id],
    );
    expect(rows.rows).toEqual([{ name: 'abc' }]);
    expect(await characters.listByAccount(account.id)).toMatchObject([{ name: 'abc', level: 20 }]);
  });

  it('refuses a second row whose name differs only in case', async () => {
    const account = testAccount('CaseOwner');
    await accounts.insertTestAccount(account);
    await database.pool.query(
      `insert into identity.characters (account_id, name, class, level, ladder, era, unlocked_difficulties, read_at)
       values ($1, 'Abc', 'sorceress', 10, 'sc-ladder', 'lod', '{normal}', $2)`,
      [account.id, NOW],
    );

    const duplicate = database.pool.query(
      `insert into identity.characters (account_id, name, class, level, ladder, era, unlocked_difficulties, read_at)
       values ($1, 'ABC', 'sorceress', 10, 'sc-ladder', 'lod', '{normal}', $2)`,
      [account.id, NOW],
    );

    await expect(duplicate).rejects.toMatchObject({ code: '23505' });
  });
});
