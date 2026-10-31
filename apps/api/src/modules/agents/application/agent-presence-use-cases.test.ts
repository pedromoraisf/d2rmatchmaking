import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../../shared-kernel/clock.ts';
import { SequentialIdGenerator } from '../../../shared-kernel/id-generator.ts';
import { SeededRandomSource } from '../../../shared-kernel/random-source.ts';
import type { Transaction } from '../../../shared-kernel/index.ts';
import { Agent } from '../domain/agent.ts';
import { createAgentsUseCases } from './agents-use-cases.ts';
import { FakeSecretHasher } from './testing/fake-secret-hasher.ts';
import { InMemoryAgentRepository } from './testing/in-memory-agent-repository.ts';
import { InMemoryAgentTokenCache } from './testing/in-memory-agent-token-cache.ts';
import { InMemoryPairingCodeRepository } from './testing/in-memory-pairing-code-repository.ts';
import { InMemoryPresenceStore } from './testing/in-memory-presence-store.ts';
import { InMemoryRateLimitStore } from './testing/in-memory-rate-limit-store.ts';
import { InMemoryUnitOfWork } from './testing/in-memory-unit-of-work.ts';
import { RecordingEventBus } from './testing/recording-event-bus.ts';

const START = new Date('2026-10-30T12:00:00.000Z');
const TX = {} as Transaction;
const TOKEN = 'd2rmm_a_' + 'Q'.repeat(43);
const MINUTE = 60 * 1000;

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
  const hasher = new FakeSecretHasher();
  const agents = new InMemoryAgentRepository();
  const bus = new RecordingEventBus();
  const cache = new InMemoryAgentTokenCache();
  const presence = new InMemoryPresenceStore();
  const rateLimits = new InMemoryRateLimitStore();
  const useCases = createAgentsUseCases({
    agents,
    codes: new InMemoryPairingCodeRepository(),
    rateLimits,
    hasher,
    clock,
    random: new SeededRandomSource(5),
    ids: new SequentialIdGenerator('agent'),
    uow: new InMemoryUnitOfWork(),
    bus,
    cache,
    presence,
  });
  bus.subscribe('AgentRevoked', useCases.evictRevokedAgent);
  return { clock, hasher, agents, bus, cache, presence, rateLimits, useCases };
}

/** A paired agent whose token is already claimed, as the claim use case leaves it. */
async function pairedAgent(
  agents: InMemoryAgentRepository,
  hasher: FakeSecretHasher,
  id = 'agent-1',
  accountId = 'account-1',
): Promise<void> {
  await agents.insert(
    TX,
    new Agent({
      id,
      claimSecretHash: `claim-${id}`,
      accountId,
      tokenHash: hasher.hash('agent', TOKEN),
      tokenClaimedAt: START,
      pairedAt: START,
    }),
  );
}

describe('authenticateAgent', () => {
  it('authenticates a cached token without a repository call', async () => {
    const { agents, hasher, useCases } = setup();
    await pairedAgent(agents, hasher);
    await useCases.authenticateAgent({ token: TOKEN });
    const lookupsAfterFirst = agents.tokenLookups;

    const again = await useCases.authenticateAgent({ token: TOKEN });

    expect(again).toEqual({ ok: true, value: { agentId: 'agent-1', accountId: 'account-1' } });
    expect(agents.tokenLookups).toBe(lookupsAfterFirst);
  });

  it('reads a token that is not cached once and then caches it', async () => {
    const { agents, hasher, cache, useCases } = setup();
    await pairedAgent(agents, hasher);

    const first = await useCases.authenticateAgent({ token: TOKEN });

    expect(first.ok).toBe(true);
    expect(agents.tokenLookups).toBe(1);
    expect(cache.get(hasher.hash('agent', TOKEN))).toEqual({ agentId: 'agent-1', accountId: 'account-1' });
  });

  it('refuses an empty token before any lookup', async () => {
    const { agents, useCases } = setup();

    expect(await useCases.authenticateAgent({ token: '' })).toEqual({ ok: false, error: 'unauthenticated' });
    expect(agents.tokenLookups).toBe(0);
  });

  it('refuses an unknown token as unauthenticated', async () => {
    const { useCases } = setup();

    expect(await useCases.authenticateAgent({ token: TOKEN })).toEqual({
      ok: false,
      error: 'unauthenticated',
    });
  });

  it("refuses a revoked agent's token and evicts it from the cache", async () => {
    const { agents, hasher, cache, bus, useCases, clock } = setup();
    await pairedAgent(agents, hasher);
    await useCases.authenticateAgent({ token: TOKEN });
    const revoked = (await agents.findById('agent-1'))?.revoke(clock.now());
    if (revoked === undefined) {
      throw new Error('fixture agent should exist');
    }
    await agents.save(TX, revoked);

    await bus.publish({
      kind: 'transient',
      event: { type: 'AgentRevoked', payload: { agentId: 'agent-1', accountId: 'account-1' } },
    });

    expect(await useCases.authenticateAgent({ token: TOKEN })).toEqual({
      ok: false,
      error: 'unauthenticated',
    });
    expect(cache.get(hasher.hash('agent', TOKEN))).toBeUndefined();
  });
});

describe('recordHeartbeat', () => {
  it('publishes one AgentPresenceChanged when gameRunning changes and none for an identical heartbeat', async () => {
    const { bus, useCases } = setup();
    const running = {
      agentId: 'agent-1',
      accountId: 'account-1',
      gameRunning: true,
      screen: 'UNKNOWN' as const,
    };

    await useCases.recordHeartbeat(running);
    await useCases.recordHeartbeat(running);
    expect(bus.published).toHaveLength(1);

    await useCases.recordHeartbeat({ ...running, gameRunning: false });
    expect(bus.published).toHaveLength(2);
    expect(bus.published[1]).toEqual({
      kind: 'transient',
      event: {
        type: 'AgentPresenceChanged',
        payload: {
          agentId: 'agent-1',
          accountId: 'account-1',
          online: true,
          gameRunning: false,
          screen: 'UNKNOWN',
        },
      },
    });
  });
});

describe('sweep', () => {
  it('marks the agent offline once, 45 s after its last heartbeat', async () => {
    const { bus, clock, useCases } = setup();
    await useCases.recordHeartbeat({
      agentId: 'agent-1',
      accountId: 'account-1',
      gameRunning: true,
      screen: 'UNKNOWN',
    });
    clock.advance(44_999);
    await useCases.sweep();
    expect(bus.published).toHaveLength(1);

    clock.advance(1);
    await useCases.sweep();
    await useCases.sweep();

    expect(bus.published).toHaveLength(2);
    expect(bus.published[1]).toEqual({
      kind: 'transient',
      event: {
        type: 'AgentPresenceChanged',
        payload: {
          agentId: 'agent-1',
          accountId: 'account-1',
          online: false,
          gameRunning: true,
          screen: 'UNKNOWN',
        },
      },
    });
  });

  it('prunes rate-limit timestamps older than the widest window', async () => {
    const { rateLimits, clock, useCases } = setup();
    await rateLimits.record('ip:203.0.113.7', clock.now());
    clock.advance(61 * MINUTE);

    await useCases.sweep();

    expect(await rateLimits.timestamps('ip:203.0.113.7')).toEqual([]);
  });
});

describe('getMyAgent', () => {
  it('returns none when the account has no agent', async () => {
    const { useCases } = setup();

    expect(await useCases.getMyAgent({ accountId: 'account-1' })).toEqual({ status: 'none' });
  });

  it('returns the presence of the account agent, and reads offline from the clock', async () => {
    const { agents, hasher, clock, useCases } = setup();
    await pairedAgent(agents, hasher);
    await useCases.recordHeartbeat({
      agentId: 'agent-1',
      accountId: 'account-1',
      gameRunning: true,
      screen: 'AUTOMAP_OPEN',
    });

    expect(await useCases.getMyAgent({ accountId: 'account-1' })).toEqual({
      status: 'paired',
      agentId: 'agent-1',
      online: true,
      gameRunning: true,
      screen: 'AUTOMAP_OPEN',
      lastSeenAt: START,
    });
    clock.advance(45_000);
    expect(await useCases.getMyAgent({ accountId: 'account-1' })).toMatchObject({
      status: 'paired',
      online: false,
    });
  });
});

describe('spans', () => {
  it('opens spans named by their use case', async () => {
    const { useCases } = setup();

    await useCases.authenticateAgent({ token: '' });
    await useCases.recordHeartbeat({
      agentId: 'agent-1',
      accountId: 'account-1',
      gameRunning: false,
      screen: 'UNKNOWN',
    });
    await useCases.sweep();
    await useCases.getMyAgent({ accountId: 'account-1' });

    expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual([
      'agents.authenticate-agent',
      'agents.record-heartbeat',
      'agents.sweep',
      'agents.get-my-agent',
    ]);
  });
});
