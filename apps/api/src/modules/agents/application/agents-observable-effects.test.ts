// Observable effects of the Agents use cases that the flow tests do not pin: span names and journey attributes
// (docs/engineering/telemetry.md), rate-limit keys, rejected-state guards and the pairing-code draw loop.
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { D2R_ACCOUNT_ID, D2R_AGENT_ID } from '@d2rmm/telemetry';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../../shared-kernel/clock.ts';
import { SequentialIdGenerator } from '../../../shared-kernel/id-generator.ts';
import { SeededRandomSource, type RandomSource } from '../../../shared-kernel/random-source.ts';
import type { Transaction } from '../../../shared-kernel/index.ts';
import { Agent } from '../domain/agent.ts';
import { PairingCode } from '../domain/pairing-code.ts';
import { rateLimitKey } from '../domain/sliding-window.ts';
import { createAgentsUseCases } from './agents-use-cases.ts';
import { FakeSecretHasher } from './testing/fake-secret-hasher.ts';
import { InMemoryAgentRepository } from './testing/in-memory-agent-repository.ts';
import { InMemoryAgentTokenCache } from './testing/in-memory-agent-token-cache.ts';
import { InMemoryPairingCodeRepository } from './testing/in-memory-pairing-code-repository.ts';
import { InMemoryPresenceStore } from './testing/in-memory-presence-store.ts';
import { InMemoryRateLimitStore } from './testing/in-memory-rate-limit-store.ts';
import { InMemoryUnitOfWork } from './testing/in-memory-unit-of-work.ts';
import { RecordingEventBus } from './testing/recording-event-bus.ts';

const START = new Date('2026-11-02T12:00:00.000Z');
const MINUTE = 60 * 1000;
const TX = {} as Transaction;
const TOKEN = 'd2rmm_a_' + 'Q'.repeat(43);

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
  );
});

beforeEach(() => {
  exporter.reset();
});

class ClaimLosingAgentRepository extends InMemoryAgentRepository {
  override async claimTokenAtomically(): Promise<null> {
    return null;
  }
}

/** Finds an agent by token hash although the agent holds no token hash (a row the repository should never return). */
class TokenlessLookupAgentRepository extends InMemoryAgentRepository {
  readonly #agent: Agent;

  constructor(agent: Agent) {
    super();
    this.#agent = agent;
  }

  override async findByTokenHash(): Promise<Agent | null> {
    return this.#agent;
  }
}

class CountingCodeRepository extends InMemoryPairingCodeRepository {
  lookups = 0;

  override async findUnusedByCode(code: string) {
    this.lookups += 1;
    return super.findUnusedByCode(code);
  }
}

function constantRandom(value: number): RandomSource {
  const seeded = new SeededRandomSource(9);
  return { int: () => value, bytes: (n: number) => seeded.bytes(n) };
}

function setup(
  options: {
    agents?: InMemoryAgentRepository;
    codes?: InMemoryPairingCodeRepository;
    random?: RandomSource;
  } = {},
) {
  const clock = new FakeClock(START);
  const hasher = new FakeSecretHasher();
  const agents = options.agents ?? new InMemoryAgentRepository();
  const codes = options.codes ?? new InMemoryPairingCodeRepository();
  const bus = new RecordingEventBus();
  const cache = new InMemoryAgentTokenCache();
  const presence = new InMemoryPresenceStore();
  const rateLimits = new InMemoryRateLimitStore();
  const useCases = createAgentsUseCases({
    agents,
    codes,
    rateLimits,
    hasher,
    clock,
    random: options.random ?? new SeededRandomSource(5),
    ids: new SequentialIdGenerator('agent'),
    uow: new InMemoryUnitOfWork(),
    bus,
    cache,
    presence,
    configSource: { current: () => undefined },
  });
  return { clock, hasher, agents, codes, bus, cache, presence, rateLimits, useCases };
}

function pairedAgent(id: string, accountId: string, hasher: FakeSecretHasher): Agent {
  return new Agent({
    id,
    claimSecretHash: `claim-${id}`,
    accountId,
    tokenHash: hasher.hash('agent', TOKEN),
    tokenClaimedAt: START,
    pairedAt: START,
  });
}

function spanNamed(name: string) {
  const span = exporter.getFinishedSpans().find((candidate) => candidate.name === name);
  if (span === undefined) {
    throw new Error(`no span named ${name}`);
  }
  return span;
}

describe('agent online lookups', () => {
  it('open spans named after their lookups', async () => {
    const { useCases } = setup();

    await useCases.agentOnlineOf('account-1');
    await useCases.agentOfflineSinceOf('account-1');

    expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual([
      'agents.agent-online-of',
      'agents.agent-offline-since-of',
    ]);
  });
});

describe('authenticateAgent spans', () => {
  it('tags the span with the agent and account ids on a miss and on a cache hit', async () => {
    const { agents, hasher, useCases } = setup();
    await agents.insert(TX, pairedAgent('agent-1', 'account-1', hasher));

    await useCases.authenticateAgent({ token: TOKEN });
    expect(spanNamed('agents.authenticate-agent').attributes).toEqual({
      [D2R_AGENT_ID]: 'agent-1',
      [D2R_ACCOUNT_ID]: 'account-1',
    });

    exporter.reset();
    await useCases.authenticateAgent({ token: TOKEN });
    expect(spanNamed('agents.authenticate-agent').attributes).toEqual({
      [D2R_AGENT_ID]: 'agent-1',
      [D2R_ACCOUNT_ID]: 'account-1',
    });
  });

  it('refuses an agent the repository returns without a token hash', async () => {
    const tokenless = new Agent({
      id: 'agent-1',
      claimSecretHash: 'claim-agent-1',
      accountId: 'account-1',
      pairedAt: START,
    });
    const { cache, useCases } = setup({ agents: new TokenlessLookupAgentRepository(tokenless) });

    expect(await useCases.authenticateAgent({ token: TOKEN })).toEqual({
      ok: false,
      error: 'unauthenticated',
    });
    expect(cache.get(new FakeSecretHasher().hash('agent', TOKEN))).toBeUndefined();
  });
});

describe('claimToken when the atomic claim finds nothing', () => {
  async function pendingCodeFor(codes: InMemoryPairingCodeRepository, agentId: string) {
    await codes.insert(
      TX,
      new PairingCode({ agentId, code: '000007', expiresAt: new Date(START.getTime() + 5 * MINUTE) }),
    );
  }

  it('answers gone for an agent whose token was already claimed, even with a pending code', async () => {
    const { agents, codes, useCases } = setup();
    await agents.insert(
      TX,
      new Agent({
        id: 'agent-1',
        claimSecretHash: new FakeSecretHasher().hash('claim', 'secret-1'),
        tokenClaimedAt: START,
      }),
    );
    await pendingCodeFor(codes, 'agent-1');

    expect(await useCases.claimToken({ claimSecret: 'secret-1' })).toEqual({ state: 'gone' });
  });

  it('answers gone for a revoked agent, even with a pending code', async () => {
    const { agents, codes, useCases } = setup();
    await agents.insert(
      TX,
      new Agent({
        id: 'agent-1',
        claimSecretHash: new FakeSecretHasher().hash('claim', 'secret-1'),
        revokedAt: START,
      }),
    );
    await pendingCodeFor(codes, 'agent-1');

    expect(await useCases.claimToken({ claimSecret: 'secret-1' })).toEqual({ state: 'gone' });
  });

  it('answers gone for an agent already paired to an account, even with a pending code', async () => {
    const { agents, codes, useCases } = setup({ agents: new ClaimLosingAgentRepository() });
    await agents.insert(
      TX,
      new Agent({
        id: 'agent-1',
        claimSecretHash: new FakeSecretHasher().hash('claim', 'secret-1'),
        accountId: 'account-1',
        pairedAt: START,
      }),
    );
    await pendingCodeFor(codes, 'agent-1');

    expect(await useCases.claimToken({ claimSecret: 'secret-1' })).toEqual({ state: 'gone' });
  });
});

describe('getMyAgent', () => {
  it('shows a paired agent that never reported as offline, with no game and an unknown screen', async () => {
    const { agents, hasher, useCases } = setup();
    await agents.insert(TX, pairedAgent('agent-1', 'account-1', hasher));

    expect(await useCases.getMyAgent({ accountId: 'account-1' })).toEqual({
      status: 'paired',
      agentId: 'agent-1',
      online: false,
      gameRunning: false,
      screen: 'UNKNOWN',
      lastSeenAt: null,
    });
  });
});

describe('pairAgent', () => {
  it('counts the submission under the account key', async () => {
    const { codes, agents, rateLimits, useCases } = setup();
    await agents.insert(
      TX,
      new Agent({ id: 'agent-1', claimSecretHash: new FakeSecretHasher().hash('claim', 'secret-1') }),
    );
    await codes.insert(
      TX,
      new PairingCode({
        agentId: 'agent-1',
        code: '000007',
        expiresAt: new Date(START.getTime() + 5 * MINUTE),
      }),
    );

    await useCases.pairAgent({ accountId: 'account-1', code: '000007' });

    expect(await rateLimits.timestamps('account:account-1')).toEqual([START]);
  });

  it('refuses a code whose agent was revoked', async () => {
    const { codes, agents, useCases } = setup();
    await agents.insert(
      TX,
      new Agent({
        id: 'agent-1',
        claimSecretHash: new FakeSecretHasher().hash('claim', 'secret-1'),
        revokedAt: START,
      }),
    );
    await codes.insert(
      TX,
      new PairingCode({
        agentId: 'agent-1',
        code: '000007',
        expiresAt: new Date(START.getTime() + 5 * MINUTE),
      }),
    );

    expect(await useCases.pairAgent({ accountId: 'account-1', code: '000007' })).toEqual({
      ok: false,
      error: 'invalid-code',
    });
  });

  it('refuses a code whose agent does not exist', async () => {
    const { codes, useCases } = setup();
    await codes.insert(
      TX,
      new PairingCode({
        agentId: 'ghost',
        code: '000007',
        expiresAt: new Date(START.getTime() + 5 * MINUTE),
      }),
    );

    expect(await useCases.pairAgent({ accountId: 'account-1', code: '000007' })).toEqual({
      ok: false,
      error: 'invalid-code',
    });
  });

  it('does not revoke the agent it pairs when the account already owns it', async () => {
    const { codes, agents, bus, hasher, useCases } = setup();
    await agents.insert(TX, pairedAgent('agent-1', 'account-1', hasher));
    await codes.insert(
      TX,
      new PairingCode({
        agentId: 'agent-1',
        code: '000007',
        expiresAt: new Date(START.getTime() + 5 * MINUTE),
      }),
    );

    const paired = await useCases.pairAgent({ accountId: 'account-1', code: '000007' });

    expect(paired).toEqual({ ok: true, value: { agentId: 'agent-1' } });
    expect(bus.published).toEqual([]);
    expect((await agents.findById('agent-1'))?.revokedAt).toBeUndefined();
  });
});

describe('recordHeartbeat span', () => {
  it('carries the agent and account ids', async () => {
    const { useCases } = setup();

    await useCases.recordHeartbeat({
      agentId: 'agent-1',
      accountId: 'account-1',
      gameRunning: true,
      screen: 'IN_GAME',
    });

    expect(spanNamed('agents.record-heartbeat').attributes).toEqual({
      [D2R_AGENT_ID]: 'agent-1',
      [D2R_ACCOUNT_ID]: 'account-1',
    });
  });
});

describe('requestPairingCode', () => {
  it('counts the request under the ip key and opens its named span', async () => {
    const { rateLimits, useCases } = setup();

    await useCases.requestPairingCode({ ip: '203.0.113.7' });

    expect(await rateLimits.timestamps(`ip:${rateLimitKey('203.0.113.7')}`)).toEqual([START]);
    expect(spanNamed('agents.request-pairing-code')).toBeDefined();
  });

  it('draws again when the code clashes with a pending one', async () => {
    const scripted = [7, 7, 8];
    const seeded = new SeededRandomSource(3);
    const random: RandomSource = { int: () => scripted.shift() ?? 99, bytes: (n) => seeded.bytes(n) };
    const { useCases } = setup({ random });

    const first = await useCases.requestPairingCode({ ip: '203.0.113.7' });
    const second = await useCases.requestPairingCode({ ip: '203.0.113.7' });

    expect(first.ok && first.value.code).toBe('000007');
    expect(second.ok && second.value.code).toBe('000008');
  });

  it('reuses the value of a code that expired unused', async () => {
    const scripted = [7, 7, 8];
    const seeded = new SeededRandomSource(3);
    const random: RandomSource = { int: () => scripted.shift() ?? 99, bytes: (n) => seeded.bytes(n) };
    const { clock, useCases } = setup({ random });
    await useCases.requestPairingCode({ ip: '203.0.113.7' });
    clock.advance(6 * MINUTE);

    const again = await useCases.requestPairingCode({ ip: '203.0.113.7' });

    expect(again.ok && again.value.code).toBe('000007');
  });

  it('gives up after exactly 20 clashing draws', async () => {
    const codes = new CountingCodeRepository();
    const { useCases } = setup({ codes, random: constantRandom(7) });
    await useCases.requestPairingCode({ ip: '203.0.113.7' });
    codes.lookups = 0;

    await expect(useCases.requestPairingCode({ ip: '203.0.113.7' })).rejects.toThrow(
      'could not draw a free pairing code',
    );
    expect(codes.lookups).toBe(20);
  });
});

describe('revokeAgent span', () => {
  it('records the outcome of a revoke and of a refusal', async () => {
    const { agents, hasher, useCases } = setup();
    await agents.insert(TX, pairedAgent('agent-1', 'account-1', hasher));

    await useCases.revokeAgent({ accountId: 'account-1', agentId: 'other' });
    expect(spanNamed('agents.revoke').attributes).toEqual({ outcome: 'not-found' });

    exporter.reset();
    await useCases.revokeAgent({ accountId: 'account-1', agentId: 'agent-1' });
    expect(spanNamed('agents.revoke').attributes).toEqual({ outcome: 'ok' });
  });
});

describe('sweep pruning', () => {
  it('keeps rate-limit timestamps inside the widest window (one hour) and prunes older ones', async () => {
    const { clock, rateLimits, useCases } = setup();
    const now = clock.now();
    await rateLimits.record('ip:keep', new Date(now.getTime() - 30 * MINUTE));
    await rateLimits.record('ip:keep', new Date(now.getTime() - 1000));
    await rateLimits.record('ip:drop', new Date(now.getTime() - 61 * MINUTE));

    await useCases.sweep();

    expect(await rateLimits.timestamps('ip:keep')).toHaveLength(2);
    expect(await rateLimits.timestamps('ip:drop')).toEqual([]);
  });
});
