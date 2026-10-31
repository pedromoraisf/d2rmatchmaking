import { describe, expect, it } from 'vitest';
import type { AnyDomainEvent, MatchMember } from '../shared-kernel/index.ts';
import { compareStreamIds, projectStreamEvent, type CurrentAgentLookup } from './stream-projection.ts';

const agentOf: Record<string, string> = { 'account-1': 'agent-1', 'account-2': 'agent-2' };

/** Inline lookup: platform tests cannot import a module's fakes (platform-uses-public-ports). */
const agents: CurrentAgentLookup = {
  currentAgentOf: async (accountId) => agentOf[accountId] ?? null,
};

const members: readonly MatchMember[] = [
  { accountId: 'account-1', characterId: null, joinOrder: 1, role: 'host' },
  { accountId: 'account-2', characterId: null, joinOrder: 2, role: 'member' },
];

const assignment: AnyDomainEvent = {
  type: 'RoomAssignmentChanged',
  payload: { roomId: 'room-1', run: 1, expectedGameName: 'mmbaalh-1', members },
};

const stage: AnyDomainEvent = {
  type: 'RoomStageChanged',
  payload: { roomId: 'room-1', stage: 'created', members },
};

describe('projectStreamEvent', () => {
  it('a two-member assignment yields two site and two agent recipients', async () => {
    const deliveries = await projectStreamEvent(assignment, agents);

    expect(deliveries.filter((delivery) => delivery.stream === 'site')).toHaveLength(2);
    expect(deliveries.filter((delivery) => delivery.stream === 'agent')).toHaveLength(2);
    expect(deliveries.filter((delivery) => delivery.stream === 'agent')).toEqual([
      expect.objectContaining({ agentId: 'agent-1' }),
      expect.objectContaining({ agentId: 'agent-2' }),
    ]);
  });

  it('an assignment to a member without an agent gives only the site recipient', async () => {
    const withoutAgent: CurrentAgentLookup = { currentAgentOf: async () => null };

    const deliveries = await projectStreamEvent(assignment, withoutAgent);

    expect(deliveries.map((delivery) => delivery.stream)).toEqual(['site', 'site']);
  });

  it('a stage change yields no agent recipient', async () => {
    const deliveries = await projectStreamEvent(stage, agents);

    expect(deliveries.map((delivery) => delivery.stream)).toEqual(['site', 'site']);
    expect(deliveries.map((delivery) => delivery.event.type)).toEqual([
      'room.stage_changed',
      'room.stage_changed',
    ]);
  });

  it('presence goes to its owner only', async () => {
    const presence: AnyDomainEvent = {
      type: 'AgentPresenceChanged',
      payload: {
        agentId: 'agent-1',
        accountId: 'account-1',
        online: true,
        gameRunning: true,
        screen: 'UNKNOWN',
      },
    };

    const deliveries = await projectStreamEvent(presence, agents);

    expect(deliveries).toEqual([
      {
        stream: 'site',
        accountId: 'account-1',
        event: {
          type: 'agent.presence_changed',
          data: { agentId: 'agent-1', online: true, gameRunning: true, screen: 'UNKNOWN' },
        },
      },
    ]);
  });

  it('AgentRevoked and MatchFormed project to nothing', async () => {
    const revoked: AnyDomainEvent = {
      type: 'AgentRevoked',
      payload: { agentId: 'agent-1', accountId: 'account-1' },
    };
    const formed: AnyDomainEvent = {
      type: 'MatchFormed',
      payload: {
        matchId: 'match-1',
        mode: 'leveling',
        activity: 'baal',
        difficulty: 'hell',
        region: 'americas',
        ladder: 'sc-ladder',
        era: 'rotw',
        members,
      },
    };

    expect(await projectStreamEvent(revoked, agents)).toEqual([]);
    expect(await projectStreamEvent(formed, agents)).toEqual([]);
  });
});

describe('compareStreamIds', () => {
  it('ids increase with outbox order', () => {
    const ordered = ['12', '12.1', '12.2', '13'];

    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1] ?? '';
      const current = ordered[index] ?? '';
      expect(compareStreamIds(previous, current)).toBeLessThan(0);
      expect(compareStreamIds(current, previous)).toBeGreaterThan(0);
    }
  });

  it('compares equal ids as equal', () => {
    expect(compareStreamIds('12.3', '12.3')).toBe(0);
  });

  it('compares outbox ids numerically, not as text', () => {
    expect(compareStreamIds('9', '10')).toBeLessThan(0);
  });

  it('throws on a malformed id', () => {
    expect(() => compareStreamIds('12.x', '13')).toThrow(RangeError);
  });
});
