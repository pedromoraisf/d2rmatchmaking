// Observable effects of the Identity use cases that the flow tests do not pin: span names and attributes
// (docs/engineering/telemetry.md), the full-tier span detail, the session-token shape and the sign-in guards.
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { D2R_ACCOUNT_ID } from '@d2rmm/telemetry';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../../shared-kernel/clock.ts';
import { SequentialIdGenerator } from '../../../shared-kernel/id-generator.ts';
import { SeededRandomSource } from '../../../shared-kernel/random-source.ts';
import type { SpanAttributes, SpanDetail } from '../../../shared-kernel/index.ts';
import { createCharacterUseCases } from './character-use-cases.ts';
import { createIdentityUseCases } from './identity-use-cases.ts';
import { checkCallback, encodeOAuthAttempt, startOAuthAttempt } from './oauth-state.ts';
import { hasSessionTokenShape } from './session-token.ts';
import { FakeBattleNetOAuth } from './testing/fake-battle-net-oauth.ts';
import { FakeSecretHasher } from './testing/fake-secret-hasher.ts';
import { InMemoryAccountRepository } from './testing/in-memory-account-repository.ts';
import { InMemoryCharacterRepository } from './testing/in-memory-character-repository.ts';
import { InMemorySessionRepository } from './testing/in-memory-session-repository.ts';
import { InMemoryUnitOfWork } from './testing/in-memory-unit-of-work.ts';
import { RecordingOutbox } from './testing/recording-outbox.ts';

const START = new Date('2026-11-10T12:00:00.000Z');

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  // Without a context manager no span is active, and a use case cannot annotate it.
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
  );
});

beforeEach(() => {
  exporter.reset();
});

function spanNamed(name: string) {
  const span = exporter.getFinishedSpans().find((candidate) => candidate.name === name);
  if (span === undefined) {
    throw new Error(`no span named ${name}`);
  }
  return span;
}

/** A SpanDetail that keeps what it was asked to annotate. */
class RecordingSpanDetail implements SpanDetail {
  readonly annotations: SpanAttributes[] = [];

  annotate(attributes: SpanAttributes): void {
    this.annotations.push(attributes);
  }
}

class CountingAccountRepository extends InMemoryAccountRepository {
  battletagUpdates = 0;

  override async updateBattletag(accountId: string, battletag: string, displayName: string): Promise<void> {
    this.battletagUpdates += 1;
    return super.updateBattletag(accountId, battletag, displayName);
  }
}

function identitySetup(
  options: { stagingEndpoints?: boolean; spanDetail?: SpanDetail; accounts?: InMemoryAccountRepository } = {},
) {
  const clock = new FakeClock(START);
  const accounts = options.accounts ?? new InMemoryAccountRepository();
  const sessions = new InMemorySessionRepository();
  const hasher = new FakeSecretHasher();
  const battleNet = new FakeBattleNetOAuth();
  const useCases = createIdentityUseCases({
    accounts,
    sessions,
    hasher,
    clock,
    random: new SeededRandomSource(42),
    ids: new SequentialIdGenerator('account'),
    battleNet,
    ...(options.stagingEndpoints === undefined ? {} : { stagingEndpoints: options.stagingEndpoints }),
    ...(options.spanDetail === undefined ? {} : { spanDetail: options.spanDetail }),
  });
  return { clock, accounts, sessions, hasher, battleNet, useCases };
}

const signInInput = { code: 'code-1', verifier: 'verifier-1', redirectUri: 'https://site.test/callback' };

function characterSetup(spanDetail?: SpanDetail) {
  const characters = new InMemoryCharacterRepository();
  const useCases = createCharacterUseCases({
    characters,
    uow: new InMemoryUnitOfWork(),
    outbox: new RecordingOutbox(),
    clock: new FakeClock(START),
    ...(spanDetail === undefined ? {} : { spanDetail }),
  });
  return { characters, useCases };
}

const sorc = {
  name: 'Sorc',
  class: 'sorceress',
  level: 85,
  hardcore: false,
  unlockedDifficulties: ['normal', 'nightmare', 'hell'],
} as const;

describe('isLinked', () => {
  it('opens a span named is-linked', async () => {
    const { useCases } = identitySetup();

    await useCases.isLinked('nobody');

    expect(spanNamed('identity.is-linked')).toBeDefined();
  });

  it('does not count a test account as linked unless staging endpoints are set', async () => {
    const { useCases } = identitySetup();
    const signedIn = await useCases.signInTestAccount({ name: 'PlayerOne' });
    if (!signedIn.ok) {
      throw new Error('sign-in should succeed');
    }

    expect(await useCases.isLinked(signedIn.value.accountId)).toBe(false);
    expect(await identitySetupLinked(true)).toBe(true);
  });
});

async function identitySetupLinked(stagingEndpoints: boolean): Promise<boolean> {
  const { useCases } = identitySetup({ stagingEndpoints });
  const signedIn = await useCases.signInTestAccount({ name: 'PlayerOne' });
  if (!signedIn.ok) {
    throw new Error('sign-in should succeed');
  }
  return useCases.isLinked(signedIn.value.accountId);
}

describe('authenticateSession', () => {
  it('refuses a token without the session shape before any lookup, even when a row exists for it', async () => {
    const { useCases, sessions, hasher } = identitySetup();
    for (const token of ['garbage-token-longer-than-the-prefix', 'd2rmm_s_']) {
      await sessions.insert({
        tokenHash: hasher.hash('session', token),
        accountId: 'account-1',
        expiresAt: new Date(START.getTime() + 60_000),
      });

      expect(await useCases.authenticateSession(token)).toEqual({ ok: false, error: 'unauthenticated' });
    }
  });

  it('tags the span with the account id of the session', async () => {
    const { useCases, battleNet } = identitySetup();
    battleNet.willSignIn('sub-1', 'Alice#1234');
    const signedIn = await useCases.signInWithBattleNet(signInInput);
    if (!signedIn.ok) {
      throw new Error('sign-in should succeed');
    }
    exporter.reset();

    await useCases.authenticateSession(signedIn.value.sessionToken);

    expect(spanNamed('identity.authenticate-session').attributes).toEqual({
      [D2R_ACCOUNT_ID]: signedIn.value.accountId,
    });
  });
});

describe('signOut', () => {
  it('opens a span named sign-out-session', async () => {
    const { useCases } = identitySetup();

    await useCases.signOut({ sessionToken: 'd2rmm_s_unknown' });

    expect(spanNamed('identity.sign-out-session')).toBeDefined();
  });
});

describe('signInWithBattleNet', () => {
  it('tags its span with the account id and gives the full tier the BattleTag', async () => {
    const spanDetail = new RecordingSpanDetail();
    const { useCases, battleNet } = identitySetup({ spanDetail });
    battleNet.willSignIn('sub-1', 'Alice#1234');

    const signedIn = await useCases.signInWithBattleNet(signInInput);

    if (!signedIn.ok) {
      throw new Error('sign-in should succeed');
    }
    expect(spanNamed('identity.sign-in-battle-net').attributes).toEqual({
      [D2R_ACCOUNT_ID]: signedIn.value.accountId,
    });
    expect(spanDetail.annotations).toEqual([{ 'd2r.account.battletag': 'Alice#1234' }]);
  });

  it('stores nothing about the BattleTag when it did not change', async () => {
    const accounts = new CountingAccountRepository();
    const { useCases, battleNet } = identitySetup({ accounts });
    battleNet.willSignIn('sub-1', 'Alice#1234');
    await useCases.signInWithBattleNet(signInInput);

    await useCases.signInWithBattleNet(signInInput);
    expect(accounts.battletagUpdates).toBe(0);

    battleNet.willSignIn('sub-1', 'Alicia#1234');
    const renamed = await useCases.signInWithBattleNet(signInInput);
    expect(accounts.battletagUpdates).toBe(1);
    expect(renamed.ok && renamed.value.displayName).toBe('Alicia');
  });
});

describe('hasSessionTokenShape', () => {
  it.each([
    ['the prefix and a body', 'd2rmm_s_x', true],
    ['the prefix alone', 'd2rmm_s_', false],
    ['an empty token', '', false],
    ['another prefix', 'd2rmm_a_' + 'Q'.repeat(43), false],
    ['no prefix and a long body', 'x'.repeat(60), false],
  ])('%s', (_label, token, expected) => {
    expect(hasSessionTokenShape(token)).toBe(expected);
  });
});

describe('checkCallback', () => {
  const NOW = START;

  it('refuses an expiry with trailing characters after its digits', () => {
    const attempt = startOAuthAttempt(new SeededRandomSource(1), NOW);
    const cookie = `${attempt.state}.${attempt.verifier}.${String(NOW.getTime() + 60_000)}x`;

    expect(checkCallback(cookie, { code: 'c', state: attempt.state }, NOW)).toEqual({
      ok: false,
      error: 'missing-state',
    });
  });

  it('refuses a provider error even when a code came with it', () => {
    const attempt = startOAuthAttempt(new SeededRandomSource(1), NOW);

    expect(
      checkCallback(
        encodeOAuthAttempt(attempt),
        { code: 'c', error: 'access_denied', state: attempt.state },
        NOW,
      ),
    ).toEqual({ ok: false, error: 'provider-error' });
  });
});

describe('character use cases spans', () => {
  it('records the names read in the full tier before they are checked', async () => {
    const spanDetail = new RecordingSpanDetail();
    const { useCases } = characterSetup(spanDetail);

    await useCases.recordCharacters({
      accountId: 'alice',
      characters: [sorc, { ...sorc, name: 'Hammer' }],
    });

    expect(spanDetail.annotations).toEqual([{ 'd2r.observation.read_names': 'Sorc, Hammer' }]);
  });

  it('counts the pairs on the names-of span', async () => {
    const { useCases } = characterSetup();

    await useCases.characterNamesOf([
      { accountId: 'alice', characterId: 'a' },
      { accountId: 'bob', characterId: 'b' },
    ]);

    expect(spanNamed('identity.character-names-of').attributes).toEqual({ 'd2r.characters.count': 2 });
  });

  it('names the character-of and list-characters spans', async () => {
    const { useCases } = characterSetup();

    await useCases.characterOf('alice', 'nope');
    await useCases.listMyCharacters({ accountId: 'alice' });

    expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual([
      'identity.character-of',
      'identity.list-characters',
    ]);
  });
});
