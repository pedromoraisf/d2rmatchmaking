import { SpanStatusCode, trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../../shared-kernel/clock.ts';
import { SeededRandomSource } from '../../../shared-kernel/random-source.ts';
import { SequentialIdGenerator } from '../../../shared-kernel/id-generator.ts';
import { newTestAccount } from '../domain/account.ts';
import { PlayerName } from '../domain/player-name.ts';
import { createIdentityUseCases } from './identity-use-cases.ts';
import { InMemoryAccountRepository } from './testing/in-memory-account-repository.ts';
import { InMemorySessionRepository } from './testing/in-memory-session-repository.ts';
import { FakeSecretHasher } from './testing/fake-secret-hasher.ts';

const START = new Date('2026-10-30T12:00:00.000Z');
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_TOKEN_SHAPE = /^d2rmm_s_[A-Za-z0-9_-]{43}$/;

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
  );
});

beforeEach(() => {
  exporter.reset();
});

function setup() {
  const clock = new FakeClock(START);
  const accounts = new InMemoryAccountRepository();
  const sessions = new InMemorySessionRepository();
  const hasher = new FakeSecretHasher();
  const useCases = createIdentityUseCases({
    accounts,
    sessions,
    hasher,
    clock,
    random: new SeededRandomSource(42),
    ids: new SequentialIdGenerator('account'),
  });
  return { clock, accounts, sessions, hasher, useCases };
}

describe('signInTestAccount', () => {
  it('creates PlayerOne#test with the display name as typed on the first sign-in', async () => {
    const { useCases, accounts } = setup();

    const result = await useCases.signInTestAccount({ name: 'PlayerOne' });

    expect(result.ok).toBe(true);
    const created = await accounts.findTestAccount('playerone');
    expect(created).toEqual({
      id: 'account-1',
      battletag: 'PlayerOne#test',
      displayName: 'PlayerOne',
      testKey: 'playerone',
    });
  });

  it('reuses the account ignoring case and keeps the first display name', async () => {
    const { useCases } = setup();

    const first = await useCases.signInTestAccount({ name: 'PlayerOne' });
    const second = await useCases.signInTestAccount({ name: 'playerone' });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      throw new Error('sign-in should succeed');
    }
    expect(second.value.accountId).toBe(first.value.accountId);
    expect(second.value.displayName).toBe('PlayerOne');
  });

  it('never returns a non-test account for the same name', async () => {
    const { useCases, accounts } = setup();
    accounts.seed({ id: 'real-1', battletag: 'PlayerOne#1234', displayName: 'PlayerOne' });

    const result = await useCases.signInTestAccount({ name: 'PlayerOne' });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('sign-in should succeed');
    }
    expect(result.value.accountId).not.toBe('real-1');
    expect((await accounts.findById('real-1'))?.battletag).toBe('PlayerOne#1234');
  });

  it('issues a session token of d2rmm_s_ plus 43 base64url characters and stores only its hash', async () => {
    const { useCases, sessions, hasher } = setup();

    const result = await useCases.signInTestAccount({ name: 'PlayerOne' });

    if (!result.ok) {
      throw new Error('sign-in should succeed');
    }
    const token = result.value.sessionToken;
    expect(token).toMatch(SESSION_TOKEN_SHAPE);
    expect(sessions.storedHashes()).toEqual([hasher.hash('session', token)]);
    expect(sessions.storedHashes()).not.toContain(token);
  });

  it('refuses a name outside the rules without creating an account', async () => {
    const { useCases, accounts } = setup();

    const result = await useCases.signInTestAccount({ name: ' PlayerOne' });

    expect(result).toEqual({ ok: false, error: 'invalid-name' });
    expect(await accounts.findTestAccount('playerone')).toBeNull();
  });

  it('opens its span with the use-case name', async () => {
    const { useCases } = setup();

    await useCases.signInTestAccount({ name: 'PlayerOne' });

    expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual(['identity.sign-in-test-account']);
  });
});

describe('authenticateSession', () => {
  it('resolves a fresh session token to its account', async () => {
    const { useCases } = setup();
    const signedIn = await useCases.signInTestAccount({ name: 'PlayerOne' });
    if (!signedIn.ok) {
      throw new Error('sign-in should succeed');
    }

    const result = await useCases.authenticateSession(signedIn.value.sessionToken);

    expect(result).toEqual({
      ok: true,
      value: { accountId: 'account-1', expiresAt: signedIn.value.expiresAt },
    });
  });

  it('refuses an unknown token as unauthenticated', async () => {
    const { useCases } = setup();

    expect(await useCases.authenticateSession('d2rmm_s_' + 'A'.repeat(43))).toEqual({
      ok: false,
      error: 'unauthenticated',
    });
  });

  it('refuses an empty or malformed token without a lookup', async () => {
    const { useCases } = setup();

    expect(await useCases.authenticateSession('')).toEqual({ ok: false, error: 'unauthenticated' });
    expect(await useCases.authenticateSession('d2rmm_a_' + 'A'.repeat(43))).toEqual({
      ok: false,
      error: 'unauthenticated',
    });
  });

  it('refuses an expired token as unauthenticated', async () => {
    const { useCases, clock } = setup();
    const signedIn = await useCases.signInTestAccount({ name: 'PlayerOne' });
    if (!signedIn.ok) {
      throw new Error('sign-in should succeed');
    }

    clock.advance(SEVEN_DAYS_MS);

    expect(await useCases.authenticateSession(signedIn.value.sessionToken)).toEqual({
      ok: false,
      error: 'unauthenticated',
    });
  });

  it('opens its span with the use-case name', async () => {
    const { useCases } = setup();

    await useCases.authenticateSession('');

    expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual(['identity.authenticate-session']);
    expect(exporter.getFinishedSpans()[0]?.status.code).toBe(SpanStatusCode.ERROR);
  });
});

describe('getMe', () => {
  it('returns the signed-in account', async () => {
    const { useCases } = setup();
    await useCases.signInTestAccount({ name: 'PlayerOne' });

    expect(await useCases.getMe({ accountId: 'account-1' })).toEqual({
      ok: true,
      value: { accountId: 'account-1', displayName: 'PlayerOne' },
    });
  });

  it('refuses an account that does not exist as unauthenticated', async () => {
    const { useCases } = setup();

    expect(await useCases.getMe({ accountId: 'account-404' })).toEqual({
      ok: false,
      error: 'unauthenticated',
    });
  });

  it('opens its span with the use-case name and the account id', async () => {
    const { useCases } = setup();

    await useCases.getMe({ accountId: 'account-1' });

    const [span] = exporter.getFinishedSpans();
    expect(span?.name).toBe('identity.get-me');
    expect(span?.attributes).toEqual({ accountId: 'account-1' });
  });
});

describe('newTestAccount and PlayerName wiring', () => {
  it('builds the same test account the sign-in creates', () => {
    const parsed = PlayerName.parse('PlayerOne');
    if (!parsed.ok) {
      throw new Error('PlayerOne is a valid name');
    }

    expect(newTestAccount('account-1', parsed.value).battletag).toBe('PlayerOne#test');
  });
});
