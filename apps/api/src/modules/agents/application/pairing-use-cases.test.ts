import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { trace } from '@opentelemetry/api';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../../shared-kernel/clock.ts';
import { SequentialIdGenerator } from '../../../shared-kernel/id-generator.ts';
import { SeededRandomSource, type RandomSource } from '../../../shared-kernel/random-source.ts';
import { createPairingUseCases } from './agents-use-cases.ts';
import { FakeSecretHasher } from './testing/fake-secret-hasher.ts';
import { InMemoryAgentRepository } from './testing/in-memory-agent-repository.ts';
import { InMemoryPairingCodeRepository } from './testing/in-memory-pairing-code-repository.ts';
import { InMemoryRateLimitStore } from './testing/in-memory-rate-limit-store.ts';
import { InMemoryUnitOfWork } from './testing/in-memory-unit-of-work.ts';
import { RecordingEventBus } from './testing/recording-event-bus.ts';

const START = new Date('2026-10-30T12:00:00.000Z');
const MINUTE = 60 * 1000;
const TOKEN_SHAPE = /^d2rmm_a_[A-Za-z0-9_-]{43}$/;

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
  );
});

beforeEach(() => {
  exporter.reset();
});

/** Returns the scripted integers first, then draws from a seeded source. */
class ScriptedRandom implements RandomSource {
  readonly #scripted: number[];
  readonly #seeded = new SeededRandomSource(2026);

  constructor(scripted: number[]) {
    this.#scripted = [...scripted];
  }

  int(maxExclusive: number): number {
    return this.#scripted.shift() ?? this.#seeded.int(maxExclusive);
  }

  bytes(n: number): Uint8Array {
    return this.#seeded.bytes(n);
  }
}

function setup(scripted: number[] = []) {
  const clock = new FakeClock(START);
  const agents = new InMemoryAgentRepository();
  const codes = new InMemoryPairingCodeRepository();
  const rateLimits = new InMemoryRateLimitStore();
  const bus = new RecordingEventBus();
  const hasher = new FakeSecretHasher();
  const useCases = createPairingUseCases({
    agents,
    codes,
    rateLimits,
    hasher,
    clock,
    random: new ScriptedRandom(scripted),
    ids: new SequentialIdGenerator('agent'),
    uow: new InMemoryUnitOfWork(),
    bus,
  });
  return { clock, agents, codes, bus, hasher, useCases };
}

async function requestCode(
  useCases: ReturnType<typeof setup>['useCases'],
  ip = '203.0.113.7',
): Promise<{ code: string; claimSecret: string }> {
  const issued = await useCases.requestPairingCode({ ip });
  if (!issued.ok) {
    throw new Error('the pairing code request should succeed');
  }
  return { code: issued.value.code, claimSecret: issued.value.claimSecret };
}

describe('requestPairingCode', () => {
  it('returns a six-digit code, its expiry and a claim secret, and stores no account', async () => {
    const { useCases, agents, clock } = setup([7]);

    const issued = await useCases.requestPairingCode({ ip: '203.0.113.7' });

    if (!issued.ok) {
      throw new Error('the pairing code request should succeed');
    }
    expect(issued.value.code).toBe('000007');
    expect(issued.value.expiresAt).toEqual(new Date(clock.now().getTime() + 5 * MINUTE));
    expect(issued.value.claimSecret).toMatch(/^d2rmm_c_[A-Za-z0-9_-]{43}$/);
    expect((await agents.findById('agent-1'))?.accountId).toBeUndefined();
  });

  it('refuses the 11th pairing-code request per IP within an hour', async () => {
    const { useCases } = setup();
    for (let i = 0; i < 10; i += 1) {
      await requestCode(useCases);
    }

    expect(await useCases.requestPairingCode({ ip: '203.0.113.7' })).toEqual({
      ok: false,
      error: 'rate-limited',
    });
  });
});

describe('pairAgent', () => {
  it('binds the agent to the account and marks the code used', async () => {
    const { useCases, agents, codes } = setup();
    const { code } = await requestCode(useCases);

    const paired = await useCases.pairAgent({ accountId: 'account-1', code });

    expect(paired).toEqual({ ok: true, value: { agentId: 'agent-1' } });
    expect((await agents.findById('agent-1'))?.accountId).toBe('account-1');
    expect(await codes.findUnusedByCode(code)).toBeNull();
  });

  it('refuses an unknown, an expired or an already used code as invalid-code', async () => {
    const { useCases, clock } = setup();
    const first = await requestCode(useCases, '203.0.113.1');
    const second = await requestCode(useCases, '203.0.113.2');

    expect(await useCases.pairAgent({ accountId: 'account-1', code: '999999' })).toEqual({
      ok: false,
      error: 'invalid-code',
    });
    clock.advance(5 * MINUTE);
    expect(await useCases.pairAgent({ accountId: 'account-1', code: second.code })).toEqual({
      ok: false,
      error: 'invalid-code',
    });
    expect(first.code).toMatch(/^\d{6}$/);
  });

  it('refuses a code that was already used', async () => {
    const { useCases } = setup();
    const { code } = await requestCode(useCases);
    await useCases.pairAgent({ accountId: 'account-1', code });

    expect(await useCases.pairAgent({ accountId: 'account-2', code })).toEqual({
      ok: false,
      error: 'invalid-code',
    });
  });

  it('limits the 11th submission per account within 5 minutes, counting failed submissions too', async () => {
    const { useCases } = setup();
    for (let i = 0; i < 10; i += 1) {
      await useCases.pairAgent({ accountId: 'account-1', code: '111111' });
    }

    expect(await useCases.pairAgent({ accountId: 'account-1', code: '111111' })).toEqual({
      ok: false,
      error: 'rate-limited',
    });
  });

  it('revokes the previous agent of the account and publishes AgentRevoked', async () => {
    const { useCases, agents, bus } = setup();
    const first = await requestCode(useCases);
    await useCases.pairAgent({ accountId: 'account-1', code: first.code });
    const second = await requestCode(useCases, '203.0.113.9');

    const paired = await useCases.pairAgent({ accountId: 'account-1', code: second.code });

    expect(paired).toEqual({ ok: true, value: { agentId: 'agent-2' } });
    expect((await agents.findById('agent-1'))?.revokedAt).toBeDefined();
    expect(bus.published).toEqual([
      {
        kind: 'transient',
        event: { type: 'AgentRevoked', payload: { agentId: 'agent-1', accountId: 'account-1' } },
      },
    ]);
  });

  it('opens its span with the use-case name', async () => {
    const { useCases } = setup();

    await useCases.pairAgent({ accountId: 'account-1', code: '000000' });

    expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual(['agents.pair-agent']);
  });
});

describe('claimToken', () => {
  it('answers pending before the code is used', async () => {
    const { useCases } = setup();
    const { claimSecret } = await requestCode(useCases);

    expect(await useCases.claimToken({ claimSecret })).toEqual({ state: 'pending' });
  });

  it('hands the token out once after the code is used, then answers gone', async () => {
    const { useCases, agents, hasher } = setup();
    const { code, claimSecret } = await requestCode(useCases);
    await useCases.pairAgent({ accountId: 'account-1', code });

    const claimed = await useCases.claimToken({ claimSecret });

    expect(claimed.state).toBe('claimed');
    if (claimed.state !== 'claimed') {
      throw new Error('the first claim should hand out the token');
    }
    expect(claimed.token).toMatch(TOKEN_SHAPE);
    expect((await agents.findById('agent-1'))?.tokenHash).toBe(hasher.hash('agent', claimed.token));
    expect(await useCases.claimToken({ claimSecret })).toEqual({ state: 'gone' });
  });

  it('answers gone for a code that expired unused', async () => {
    const { useCases, clock } = setup();
    const { claimSecret } = await requestCode(useCases);

    clock.advance(5 * MINUTE);

    expect(await useCases.claimToken({ claimSecret })).toEqual({ state: 'gone' });
  });

  it('answers gone for a secret it never issued', async () => {
    const { useCases } = setup();

    expect(await useCases.claimToken({ claimSecret: 'd2rmm_c_unknown' })).toEqual({ state: 'gone' });
  });

  it('opens its span with the use-case name', async () => {
    const { useCases } = setup();

    await useCases.claimToken({ claimSecret: 'd2rmm_c_unknown' });

    expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual(['agents.claim-token']);
  });
});
