import { describe, expect, it } from 'vitest';
import { Agent } from '../domain/agent.ts';
import { FakeClock, type Transaction } from '../../../shared-kernel/index.ts';
import { createRevokeAgent } from './revoke-agent.ts';
import { InMemoryAgentRepository } from './testing/in-memory-agent-repository.ts';
import { InMemoryUnitOfWork } from './testing/in-memory-unit-of-work.ts';
import { RecordingEventBus } from './testing/recording-event-bus.ts';

const START = new Date('2026-11-01T12:00:00.000Z');

function setup() {
  const clock = new FakeClock(START);
  const agents = new InMemoryAgentRepository();
  const bus = new RecordingEventBus();
  const revokeAgent = createRevokeAgent({ agents, clock, uow: new InMemoryUnitOfWork(), bus });
  return { clock, agents, bus, revokeAgent };
}

/** A paired agent with a claimed token, as the pairing and the claim leave it. */
function pairedAgent(id: string, accountId: string, tokenHash = `token-of-${id}`): Agent {
  return new Agent({
    id,
    claimSecretHash: `claim-of-${id}`,
    accountId,
    tokenHash,
    tokenClaimedAt: START,
    pairedAt: START,
  });
}

describe('revokeAgent', () => {
  it('revokes the current agent of the account, stamps the time and publishes AgentRevoked', async () => {
    const { agents, bus, revokeAgent, clock } = setup();
    await agents.insert({} as Transaction, pairedAgent('agent-1', 'account-1'));

    const result = await revokeAgent({ accountId: 'account-1', agentId: 'agent-1' });

    expect(result).toEqual({ ok: true, value: { agentId: 'agent-1' } });
    expect((await agents.findById('agent-1'))?.revokedAt).toEqual(clock.now());
    expect(bus.published).toEqual([
      {
        kind: 'transient',
        event: { type: 'AgentRevoked', payload: { agentId: 'agent-1', accountId: 'account-1' } },
      },
    ]);
  });

  it('refuses an agent that another account owns, and changes nothing', async () => {
    const { agents, bus, revokeAgent } = setup();
    await agents.insert({} as Transaction, pairedAgent('agent-bob', 'account-bob'));

    const result = await revokeAgent({ accountId: 'account-alice', agentId: 'agent-bob' });

    expect(result).toEqual({ ok: false, error: 'not-found' });
    expect((await agents.findById('agent-bob'))?.revokedAt).toBeUndefined();
    expect(bus.published).toEqual([]);
  });

  it('refuses an agent id that is unknown, and changes nothing', async () => {
    const { agents, bus, revokeAgent } = setup();
    await agents.insert({} as Transaction, pairedAgent('agent-1', 'account-1'));

    const result = await revokeAgent({ accountId: 'account-1', agentId: 'agent-unknown' });

    expect(result).toEqual({ ok: false, error: 'not-found' });
    expect((await agents.findById('agent-1'))?.revokedAt).toBeUndefined();
    expect(bus.published).toEqual([]);
  });

  it('refuses an agent that is already revoked, and publishes nothing a second time', async () => {
    const { agents, bus, revokeAgent } = setup();
    await agents.insert({} as Transaction, pairedAgent('agent-1', 'account-1'));
    await revokeAgent({ accountId: 'account-1', agentId: 'agent-1' });

    const second = await revokeAgent({ accountId: 'account-1', agentId: 'agent-1' });

    expect(second).toEqual({ ok: false, error: 'not-found' });
    expect(bus.published).toHaveLength(1);
  });

  it('refuses the agent an earlier pairing already revoked, and revokes only the current one', async () => {
    const { agents, revokeAgent } = setup();
    await agents.insert({} as Transaction, pairedAgent('agent-old', 'account-1'));
    await agents.save({} as Transaction, pairedAgent('agent-old', 'account-1').revoke(START));
    await agents.insert({} as Transaction, pairedAgent('agent-new', 'account-1'));

    expect(await revokeAgent({ accountId: 'account-1', agentId: 'agent-old' })).toEqual({
      ok: false,
      error: 'not-found',
    });
    expect(await revokeAgent({ accountId: 'account-1', agentId: 'agent-new' })).toEqual({
      ok: true,
      value: { agentId: 'agent-new' },
    });
  });

  it('revokes an agent that never claimed its token, so the account reads no agent afterwards', async () => {
    const { agents, revokeAgent } = setup();
    await agents.insert(
      {} as Transaction,
      new Agent({ id: 'agent-1', claimSecretHash: 'claim-1', accountId: 'account-1', pairedAt: START }),
    );

    expect(await revokeAgent({ accountId: 'account-1', agentId: 'agent-1' })).toEqual({
      ok: true,
      value: { agentId: 'agent-1' },
    });
    expect(await agents.findCurrentByAccount('account-1')).toBeNull();
  });
});
