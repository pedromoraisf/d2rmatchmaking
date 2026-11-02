// Agent token authentication with the optional `beforeLookup` gate (AD-097): a cache hit never takes a lookup token, a
// miss asks the gate once and a refused miss reads nothing from the repository.
import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../../shared-kernel/index.ts';
import { FakeClock } from '../../../shared-kernel/index.ts';
import { Agent } from '../domain/agent.ts';
import { createAuthenticateAgent } from './authenticate-agent.ts';
import { FakeSecretHasher } from './testing/fake-secret-hasher.ts';
import { InMemoryAgentRepository } from './testing/in-memory-agent-repository.ts';
import { InMemoryAgentTokenCache } from './testing/in-memory-agent-token-cache.ts';

const START = new Date('2026-11-02T12:00:00.000Z');
const TX = {} as Transaction;
const TOKEN = 'd2rmm_a_' + 'Q'.repeat(43);

async function setup() {
  const clock = new FakeClock(START);
  const hasher = new FakeSecretHasher();
  const agents = new InMemoryAgentRepository();
  const cache = new InMemoryAgentTokenCache();
  await agents.insert(
    TX,
    new Agent({
      id: 'agent-1',
      claimSecretHash: 'claim-agent-1',
      accountId: 'account-1',
      tokenHash: hasher.hash('agent', TOKEN),
      tokenClaimedAt: START,
      pairedAt: START,
    }),
  );
  const authenticateAgent = createAuthenticateAgent({ agents, cache, hasher });
  return { clock, agents, cache, authenticateAgent };
}

describe('authenticateAgent with beforeLookup', () => {
  it('a cache hit does not call beforeLookup', async () => {
    const { authenticateAgent, agents } = await setup();
    await authenticateAgent({ token: TOKEN });
    const lookupsAfterFirst = agents.tokenLookups;
    let asked = 0;

    const again = await authenticateAgent(
      { token: TOKEN },
      {
        beforeLookup: () => {
          asked += 1;
          return false;
        },
      },
    );

    expect(again).toEqual({ ok: true, value: { agentId: 'agent-1', accountId: 'account-1' } });
    expect(asked).toBe(0);
    expect(agents.tokenLookups).toBe(lookupsAfterFirst);
  });

  it('a miss with beforeLookup false returns throttled without a repository call', async () => {
    const { authenticateAgent, agents } = await setup();
    let asked = 0;

    const refused = await authenticateAgent(
      { token: TOKEN },
      {
        beforeLookup: () => {
          asked += 1;
          return false;
        },
      },
    );

    expect(refused).toEqual({ ok: false, error: 'throttled' });
    expect(asked).toBe(1);
    expect(agents.tokenLookups).toBe(0);
  });

  it('a miss with beforeLookup true authenticates', async () => {
    const { authenticateAgent, agents } = await setup();
    let asked = 0;

    const authenticated = await authenticateAgent(
      { token: TOKEN },
      {
        beforeLookup: () => {
          asked += 1;
          return true;
        },
      },
    );

    expect(authenticated).toEqual({ ok: true, value: { agentId: 'agent-1', accountId: 'account-1' } });
    expect(asked).toBe(1);
    expect(agents.tokenLookups).toBe(1);
  });
});
