import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../shared-kernel/clock.ts';
import { SeededRandomSource } from '../../../shared-kernel/random-source.ts';
import { SequentialIdGenerator } from '../../../shared-kernel/id-generator.ts';
import { createSignInWithBattleNet } from './sign-in-with-battle-net.ts';
import { createSignOut } from './sign-out.ts';
import { createAuthenticateSession } from './authenticate-session.ts';
import { FakeSecretHasher } from './testing/fake-secret-hasher.ts';
import { FakeBattleNetOAuth } from './testing/fake-battle-net-oauth.ts';
import { InMemoryAccountRepository } from './testing/in-memory-account-repository.ts';
import { InMemorySessionRepository } from './testing/in-memory-session-repository.ts';

const START = new Date('2026-11-01T12:00:00.000Z');

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
    random: new SeededRandomSource(11),
    ids: new SequentialIdGenerator('account'),
    battleNet,
  });
  const signOut = createSignOut({ sessions, hasher });
  const authenticate = createAuthenticateSession({ sessions, hasher, clock });
  return { sessions, hasher, battleNet, signIn, signOut, authenticate };
}

describe('signOut', () => {
  it('deletes the session of the token, so the old token is unauthenticated afterwards', async () => {
    const { signIn, signOut, authenticate, battleNet, sessions } = setup();
    battleNet.willSignIn('sub-alice', 'Alice#1234');
    const signedIn = await signIn({ code: 'c', verifier: 'v', redirectUri: 'https://site.example/cb' });
    expect(signedIn.ok).toBe(true);
    if (!signedIn.ok) {
      return;
    }
    expect(await authenticate(signedIn.value.sessionToken)).toMatchObject({ ok: true });

    await signOut({ sessionToken: signedIn.value.sessionToken });

    expect(await authenticate(signedIn.value.sessionToken)).toEqual({ ok: false, error: 'unauthenticated' });
    expect(sessions.storedHashes()).toEqual([]);
  });

  it('leaves the other sessions of the account in place', async () => {
    const { signIn, signOut, authenticate, battleNet } = setup();
    battleNet.willSignIn('sub-alice', 'Alice#1234');
    const first = await signIn({ code: 'c', verifier: 'v', redirectUri: 'https://site.example/cb' });
    const second = await signIn({ code: 'c', verifier: 'v', redirectUri: 'https://site.example/cb' });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }

    await signOut({ sessionToken: first.value.sessionToken });

    expect(await authenticate(second.value.sessionToken)).toMatchObject({ ok: true });
  });

  it('deletes nothing and does not fail for a token with no session', async () => {
    const { signOut, sessions } = setup();

    await expect(signOut({ sessionToken: 'd2rmm_s_' + 'x'.repeat(43) })).resolves.toBeUndefined();
    expect(sessions.storedHashes()).toEqual([]);
  });
});
