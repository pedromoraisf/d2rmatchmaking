import { describe, expect, it } from 'vitest';
import type { BattleNetAccount } from '../domain/account.ts';
import { FakeClock } from '../../../shared-kernel/clock.ts';
import { SequentialIdGenerator } from '../../../shared-kernel/id-generator.ts';
import { SeededRandomSource } from '../../../shared-kernel/random-source.ts';
import { createSignInWithBattleNet } from './sign-in-with-battle-net.ts';
import { FakeSecretHasher } from './testing/fake-secret-hasher.ts';
import { FakeBattleNetOAuth } from './testing/fake-battle-net-oauth.ts';
import { InMemoryAccountRepository } from './testing/in-memory-account-repository.ts';
import { InMemorySessionRepository } from './testing/in-memory-session-repository.ts';

const START = new Date('2026-11-01T12:00:00.000Z');
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_TOKEN_SHAPE = /^d2rmm_s_[A-Za-z0-9_-]{43}$/;
/** An in-memory repository whose first Battle.net insert loses a race: the winner's account is already stored. */
class RacingAccountRepository extends InMemoryAccountRepository {
  override async insertBattleNetAccount(account: BattleNetAccount): Promise<void> {
    this.seed({ ...account, id: 'account-winner' });
    throw new Error('duplicate key value violates unique constraint "accounts_bnet_sub"');
  }
}

const CALLBACK = {
  code: 'auth-code',
  verifier: 'pkce-verifier',
  redirectUri: 'https://site.example/api/v1/auth/bnet/callback',
};

function setup() {
  const clock = new FakeClock(START);
  const accounts = new InMemoryAccountRepository();
  const sessions = new InMemorySessionRepository();
  const hasher = new FakeSecretHasher();
  const battleNet = new FakeBattleNetOAuth();
  const signIn = createSignInWithBattleNet({
    accounts,
    sessions,
    hasher,
    clock,
    random: new SeededRandomSource(7),
    ids: new SequentialIdGenerator('account'),
    battleNet,
  });
  return { clock, accounts, sessions, hasher, battleNet, signIn };
}

describe('signInWithBattleNet', () => {
  it('sends the code, the verifier and the redirect URI to the Battle.net edge', async () => {
    const { signIn, battleNet } = setup();

    await signIn(CALLBACK);

    expect(battleNet.exchanges).toEqual([CALLBACK]);
  });

  it('creates the account on the first sign-in, named by the BattleTag name part, and opens a 7-day session', async () => {
    const { signIn, accounts, clock, battleNet } = setup();
    battleNet.willSignIn('sub-alice', 'Alice#1234');

    const result = await signIn(CALLBACK);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.accountId).toBe('account-1');
    expect(result.value.displayName).toBe('Alice');
    expect(result.value.sessionToken).toMatch(SESSION_TOKEN_SHAPE);
    expect(result.value.expiresAt.getTime()).toBe(clock.now().getTime() + SEVEN_DAYS_MS);
    expect(await accounts.findByBnetSub('sub-alice')).toEqual({
      id: 'account-1',
      battletag: 'Alice#1234',
      displayName: 'Alice',
      bnetSub: 'sub-alice',
    });
  });

  it('stores only the hash of the session token', async () => {
    const { signIn, sessions, hasher, battleNet } = setup();
    battleNet.willSignIn('sub-alice', 'Alice#1234');

    const result = await signIn(CALLBACK);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(sessions.storedHashes()).toEqual([hasher.hash('session', result.value.sessionToken)]);
    expect(sessions.storedHashes()).not.toContain(result.value.sessionToken);
  });

  it('signs a returning player in to the same account without creating another', async () => {
    const { signIn, accounts, battleNet } = setup();
    battleNet.willSignIn('sub-alice', 'Alice#1234');
    const first = await signIn(CALLBACK);
    const second = await signIn(CALLBACK);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(second.value.accountId).toBe(first.value.accountId);
    expect(second.value.sessionToken).not.toBe(first.value.sessionToken);
    expect(await accounts.findByBnetSub('sub-alice')).toMatchObject({ battletag: 'Alice#1234' });
  });

  it('keeps the account id and stores a changed BattleTag and display name for the same sub', async () => {
    const { signIn, accounts, battleNet } = setup();
    battleNet.willSignIn('sub-alice', 'Alice#1234');
    const first = await signIn(CALLBACK);
    battleNet.willSignIn('sub-alice', 'Alicia#5678');

    const second = await signIn(CALLBACK);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(second.value.accountId).toBe(first.value.accountId);
    expect(second.value.displayName).toBe('Alicia');
    expect(await accounts.findByBnetSub('sub-alice')).toEqual({
      id: first.value.accountId,
      battletag: 'Alicia#5678',
      displayName: 'Alicia',
      bnetSub: 'sub-alice',
    });
  });

  it('gives two different subs two different accounts', async () => {
    const { signIn, battleNet } = setup();
    battleNet.willSignIn('sub-alice', 'Alice#1234');
    const alice = await signIn(CALLBACK);
    battleNet.willSignIn('sub-bob', 'Bob#4321');
    const bob = await signIn(CALLBACK);

    expect(alice.ok && bob.ok).toBe(true);
    if (!alice.ok || !bob.ok) {
      return;
    }
    expect(bob.value.accountId).not.toBe(alice.value.accountId);
  });

  it('opens no session and creates no account when the code exchange fails', async () => {
    const { signIn, accounts, sessions, battleNet } = setup();
    battleNet.willFail('exchange-failed');

    const result = await signIn(CALLBACK);

    expect(result).toEqual({ ok: false, error: 'exchange-failed' });
    expect(sessions.storedHashes()).toEqual([]);
    expect(await accounts.findByBnetSub('sub-default')).toBeNull();
  });

  it('opens no session and creates no account when the userinfo call fails', async () => {
    const { signIn, accounts, sessions, battleNet } = setup();
    battleNet.willFail('userinfo-failed');

    const result = await signIn(CALLBACK);

    expect(result).toEqual({ ok: false, error: 'userinfo-failed' });
    expect(sessions.storedHashes()).toEqual([]);
    expect(await accounts.findByBnetSub('sub-default')).toBeNull();
  });

  it('reads the account that won when two first sign-ins of one sub race (no 500)', async () => {
    const clock = new FakeClock(START);
    const sessions = new InMemorySessionRepository();
    const battleNet = new FakeBattleNetOAuth();
    battleNet.willSignIn('sub-alice', 'Alice#1234');
    // The other request's insert lands first: the account exists when this insert hits the unique `bnet_sub`.
    const accounts = new RacingAccountRepository();
    const signIn = createSignInWithBattleNet({
      accounts,
      sessions,
      hasher: new FakeSecretHasher(),
      clock,
      random: new SeededRandomSource(7),
      ids: new SequentialIdGenerator('account'),
      battleNet,
    });

    const result = await signIn(CALLBACK);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.accountId).toBe('account-winner');
    expect(sessions.storedHashes()).toHaveLength(1);
  });

  it('rethrows an insert failure when no account with the sub exists (a bug, not a race)', async () => {
    const clock = new FakeClock(START);
    const battleNet = new FakeBattleNetOAuth();
    battleNet.willSignIn('sub-alice', 'Alice#1234');
    const broken = {
      findByBnetSub: async () => null,
      findById: async () => null,
      findTestAccount: async () => null,
      insertTestAccount: async () => undefined,
      updateBattletag: async () => undefined,
      insertBattleNetAccount: async () => {
        throw new Error('connection lost');
      },
    };
    const signIn = createSignInWithBattleNet({
      accounts: broken,
      sessions: new InMemorySessionRepository(),
      hasher: new FakeSecretHasher(),
      clock,
      random: new SeededRandomSource(7),
      ids: new SequentialIdGenerator('account'),
      battleNet,
    });

    await expect(signIn(CALLBACK)).rejects.toThrow('connection lost');
  });
});
