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

  it('a new run goes to every member site and current agent with the new name (LBR-06)', async () => {
    const runOpened: AnyDomainEvent = {
      type: 'RoomRunOpened',
      payload: { roomId: 'room-1', run: 2, expectedGameName: 'mmbaalh-2', members },
    };

    const deliveries = await projectStreamEvent(runOpened, agents);

    expect(deliveries.map((delivery) => [delivery.stream, delivery.event.type])).toEqual([
      ['site', 'room.run_opened'],
      ['agent', 'room.run_opened'],
      ['site', 'room.run_opened'],
      ['agent', 'room.run_opened'],
    ]);
    expect(deliveries[1]).toMatchObject({
      agentId: 'agent-1',
      event: { data: { run: 2, expectedGameName: 'mmbaalh-2' } },
    });
  });

  it('a member change goes to the sites of the members, and to the member who left (LBR-04, LBR-07)', async () => {
    const confirmed: AnyDomainEvent = {
      type: 'RoomMemberChanged',
      payload: { roomId: 'room-1', change: 'confirmed', accountId: 'account-2', members },
    };
    const left: AnyDomainEvent = {
      type: 'RoomMemberChanged',
      payload: {
        roomId: 'room-1',
        change: 'left',
        accountId: 'account-3',
        members,
      },
    };

    const confirmedTo = await projectStreamEvent(confirmed, agents);
    const leftTo = await projectStreamEvent(left, agents);

    expect(confirmedTo.map((delivery) => delivery.stream)).toEqual(['site', 'site']);
    expect(confirmedTo.map((delivery) => ('accountId' in delivery ? delivery.accountId : ''))).toEqual([
      'account-1',
      'account-2',
    ]);
    expect(leftTo.map((delivery) => ('accountId' in delivery ? delivery.accountId : ''))).toEqual([
      'account-1',
      'account-2',
      'account-3',
    ]);
    expect(leftTo[2]).toMatchObject({
      event: { type: 'room.member_changed', data: { change: 'left', accountId: 'account-3' } },
    });
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

  it('CharactersRecorded goes to the owner site only, as characters.updated with no body', async () => {
    const recorded: AnyDomainEvent = { type: 'CharactersRecorded', payload: { accountId: 'account-1' } };

    expect(await projectStreamEvent(recorded, agents)).toEqual([
      { stream: 'site', accountId: 'account-1', event: { type: 'characters.updated', data: {} } },
    ]);
  });

  it('QueueUpdated goes to the owner site only, as queue.updated with the view or the left reason', async () => {
    const waiting: AnyDomainEvent = {
      type: 'QueueUpdated',
      payload: {
        accountId: 'account-1',
        update: {
          id: 'ticket-1',
          status: 'waiting',
          mode: 'pvp',
          options: {
            mode: 'pvp',
            characterId: 'char-1',
            difficulty: 'hell',
            region: 'americas',
            format: 'duel',
            rules: 'gm',
          },
          joinedAt: '2026-11-10T12:00:00.000Z',
          band: { low: 1400, high: 1600 },
          poolSize: 2,
        },
      },
    };
    const left: AnyDomainEvent = {
      type: 'QueueUpdated',
      payload: { accountId: 'account-1', update: { status: 'left', reason: 'agent-offline' } },
    };

    expect(await projectStreamEvent(waiting, agents)).toEqual([
      {
        stream: 'site',
        accountId: 'account-1',
        event: {
          type: 'queue.updated',
          data: (waiting as Extract<AnyDomainEvent, { type: 'QueueUpdated' }>).payload.update,
        },
      },
    ]);
    expect(await projectStreamEvent(left, agents)).toEqual([
      {
        stream: 'site',
        accountId: 'account-1',
        event: { type: 'queue.updated', data: { status: 'left', reason: 'agent-offline' } },
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

describe('projectStreamEvent: ready checks (RDY-01, RDY-02, RDY-03)', () => {
  const started: AnyDomainEvent = {
    type: 'ReadyCheckStarted',
    payload: {
      readyCheckId: 'rc-1',
      mode: 'pvp',
      difficulty: 'hell',
      deadline: '2026-11-10T12:01:00.000Z',
      serverNow: '2026-11-10T12:00:00.000Z',
      members: [
        { accountId: 'account-1', position: 1, characterClass: 'sorceress', level: 90, accepted: false },
        { accountId: 'account-2', position: 2, characterClass: 'barbarian', level: 84, accepted: false },
      ],
    },
  };

  it('opens the check on each member’s site and agent, with the member’s own mark as you', async () => {
    const deliveries = await projectStreamEvent(started, agents);

    expect(deliveries.map((delivery) => delivery.stream)).toEqual(['site', 'agent', 'site', 'agent']);
    const first = deliveries[0];
    expect(first?.stream === 'site' && first.event).toStrictEqual({
      type: 'ready_check.started',
      data: {
        id: 'rc-1',
        mode: 'pvp',
        difficulty: 'hell',
        deadline: '2026-11-10T12:01:00.000Z',
        now: '2026-11-10T12:00:00.000Z',
        members: [
          { position: 1, class: 'sorceress', level: 90, accepted: false, you: true },
          { position: 2, class: 'barbarian', level: 84, accepted: false, you: false },
        ],
      },
    });
  });

  it('never carries an account id in the check body the recipient reads', async () => {
    const deliveries = await projectStreamEvent(started, agents);
    // The routing fields (`accountId`, `agentId`) stay in the envelope; the event body names nobody.
    expect(JSON.stringify(deliveries.map((delivery) => delivery.event))).not.toMatch(/account-\d/u);
  });

  it('sends an acceptance to the sites only, not to the agents', async () => {
    const updated: AnyDomainEvent = { ...started, type: 'ReadyCheckUpdated' };
    const deliveries = await projectStreamEvent(updated, agents);
    expect(deliveries.map((delivery) => delivery.stream)).toEqual(['site', 'site']);
  });

  it('sends the outcome to every member’s site and agent', async () => {
    const resolved: AnyDomainEvent = {
      type: 'ReadyCheckResolved',
      payload: { readyCheckId: 'rc-1', outcome: 'timed-out', accountIds: ['account-1', 'account-2'] },
    };
    const deliveries = await projectStreamEvent(resolved, agents);
    expect(deliveries.map((delivery) => delivery.stream)).toEqual(['site', 'agent', 'site', 'agent']);
    expect(deliveries[1]).toStrictEqual({
      stream: 'agent',
      agentId: 'agent-1',
      event: { type: 'ready_check.resolved', data: { id: 'rc-1', outcome: 'timed-out' } },
    });
  });
});
