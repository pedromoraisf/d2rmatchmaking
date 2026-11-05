import { describe, expect, it } from 'vitest';
import type { AgentRevokedEvent, BusEvent, MatchFormedEvent } from '../shared-kernel/index.ts';
import { InMemoryEventBus } from './event-bus.ts';

const revoked: AgentRevokedEvent = {
  type: 'AgentRevoked',
  payload: { agentId: 'agent-1', accountId: 'account-1' },
};

const matchFormed: MatchFormedEvent = {
  type: 'MatchFormed',
  payload: {
    matchId: 'match-1',
    mode: 'leveling',
    activity: 'baal',
    difficulty: 'hell',
    region: 'americas',
    ladder: 'sc-ladder',
    era: 'rotw',
    members: [{ accountId: 'account-1', characterId: null, joinOrder: 1, role: 'host' }],
  },
};

const transient: BusEvent = { kind: 'transient', event: revoked };
const durable: BusEvent = { kind: 'durable', id: 7n, event: matchFormed };

describe('InMemoryEventBus', () => {
  it('calls two subscribers of the same type in subscription order', async () => {
    const bus = new InMemoryEventBus();
    const calls: string[] = [];
    bus.subscribe('AgentRevoked', () => {
      calls.push('first');
    });
    bus.subscribe('AgentRevoked', async () => {
      calls.push('second');
    });

    await bus.publish(transient);

    expect(calls).toEqual(['first', 'second']);
  });

  it('does not call subscribers of other event types', async () => {
    const bus = new InMemoryEventBus();
    const calls: string[] = [];
    bus.subscribe('MatchFormed', () => {
      calls.push('match');
    });

    await bus.publish(transient);

    expect(calls).toEqual([]);
  });

  it('rejects publish when a subscriber throws', async () => {
    const bus = new InMemoryEventBus();
    bus.subscribe('AgentRevoked', () => {
      throw new Error('projection failed');
    });

    await expect(bus.publish(transient)).rejects.toThrow('projection failed');
  });

  it('delivers transient and durable events to their subscribers, with the bus envelope unchanged', async () => {
    const bus = new InMemoryEventBus();
    const seen: BusEvent[] = [];
    bus.subscribe('AgentRevoked', (event) => {
      seen.push(event);
    });
    bus.subscribe('MatchFormed', (event) => {
      seen.push(event);
    });

    await bus.publish(transient);
    await bus.publish(durable);

    expect(seen).toEqual([transient, durable]);
    expect(seen[1]).toMatchObject({ kind: 'durable', id: 7n });
  });

  it('does nothing when nobody subscribed to the event type', async () => {
    const bus = new InMemoryEventBus();

    await expect(bus.publish(durable)).resolves.toBeUndefined();
  });
});
