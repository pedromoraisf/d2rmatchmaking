import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../shared-kernel/clock.ts';
import type { Transaction } from '../../../shared-kernel/index.ts';
import { Agent } from '../domain/agent.ts';
import { createAgentOfflineSinceOf, createAgentOnlineOf } from './agent-online.ts';
import { InMemoryAgentRepository } from './testing/in-memory-agent-repository.ts';
import { InMemoryPresenceStore } from './testing/in-memory-presence-store.ts';

const START = new Date('2026-11-10T12:00:00.000Z');
const TX = {} as Transaction;

function setup() {
  const clock = new FakeClock(START);
  const agents = new InMemoryAgentRepository();
  const presence = new InMemoryPresenceStore();
  const online = createAgentOnlineOf({ agents, presence, clock });
  return { clock, agents, presence, online };
}

async function pairedAgent(agents: InMemoryAgentRepository, accountId: string, id = 'agent-1') {
  await agents.insert(TX, new Agent({ id, claimSecretHash: 'h', accountId, pairedAt: START }));
  return id;
}

describe('agentOnlineOf (FR-31)', () => {
  it('is false for an account with no agent', async () => {
    const { online } = setup();
    expect(await online('alice')).toBe(false);
  });

  it('is false for an agent that never reported', async () => {
    const { agents, online } = setup();
    await pairedAgent(agents, 'alice');
    expect(await online('alice')).toBe(false);
  });

  it('is true for an agent that reported within 45 seconds', async () => {
    const { agents, presence, clock, online } = setup();
    const agentId = await pairedAgent(agents, 'alice');
    presence.set({
      agentId,
      accountId: 'alice',
      presence: { online: true, gameRunning: true, screen: 'IN_GAME', lastSeenAt: clock.now() },
    });
    clock.advance(44_999);
    expect(await online('alice')).toBe(true);
  });

  it('is false from exactly 45 seconds after the last report', async () => {
    const { agents, presence, clock, online } = setup();
    const agentId = await pairedAgent(agents, 'alice');
    presence.set({
      agentId,
      accountId: 'alice',
      presence: { online: true, gameRunning: true, screen: 'IN_GAME', lastSeenAt: clock.now() },
    });
    clock.advance(45_000);
    expect(await online('alice')).toBe(false);
  });

  it('is false for a presence the sweep already marked offline', async () => {
    const { agents, presence, clock, online } = setup();
    const agentId = await pairedAgent(agents, 'alice');
    presence.set({
      agentId,
      accountId: 'alice',
      presence: { online: false, gameRunning: false, screen: 'UNKNOWN', lastSeenAt: clock.now() },
    });
    expect(await online('alice')).toBe(false);
  });
});

describe('agentOfflineSinceOf (FR-32)', () => {
  function offlineSetup() {
    const base = setup();
    return {
      ...base,
      offlineSince: createAgentOfflineSinceOf({
        agents: base.agents,
        presence: base.presence,
        clock: base.clock,
      }),
    };
  }

  it('is null for an account with no agent and for an agent that never reported', async () => {
    const { agents, offlineSince } = offlineSetup();
    expect(await offlineSince('alice')).toBeNull();
    await pairedAgent(agents, 'alice');
    expect(await offlineSince('alice')).toBeNull();
  });

  it('is null while the agent reported within 45 seconds', async () => {
    const { agents, presence, clock, offlineSince } = offlineSetup();
    const agentId = await pairedAgent(agents, 'alice');
    presence.set({
      agentId,
      accountId: 'alice',
      presence: { online: true, gameRunning: true, screen: 'IN_GAME', lastSeenAt: clock.now() },
    });
    clock.advance(44_999);
    expect(await offlineSince('alice')).toBeNull();
  });

  it('is 45 seconds after the last heartbeat once the agent is offline, however long ago', async () => {
    const { agents, presence, clock, offlineSince } = offlineSetup();
    const agentId = await pairedAgent(agents, 'alice');
    presence.set({
      agentId,
      accountId: 'alice',
      presence: { online: true, gameRunning: true, screen: 'IN_GAME', lastSeenAt: clock.now() },
    });
    clock.advance(200_000);
    expect(await offlineSince('alice')).toEqual(new Date(START.getTime() + 45_000));
  });
});
