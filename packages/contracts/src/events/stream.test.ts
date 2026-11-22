import { describe, expect, it } from 'vitest';
import {
  AgentPresenceChangedEvent,
  AgentStreamEvent,
  RoomAssignedEvent,
  RoomMemberChangedEvent,
  RoomRunOpenedEvent,
  AgentReadyCheckStartedEvent,
  AgentRoomAssignedEvent,
  AgentRoomRunOpenedEvent,
  AgentRoomStageChangedEvent,
  RoomStageChangedEvent,
  SiteStreamEvent,
} from './stream.ts';

const members = [
  { accountId: 'acc-host', characterId: null, joinOrder: 1, role: 'host' },
  { accountId: 'acc-guest', characterId: null, joinOrder: 2, role: 'member' },
];

const assigned = {
  type: 'room.assigned',
  data: { roomId: '4821', run: 7, expectedGameName: 'mmbaalh-07', members },
};

const stageChanged = {
  type: 'room.stage_changed',
  data: { roomId: '4821', stage: 'created', members },
};

const presence = {
  type: 'agent.presence_changed',
  data: { agentId: 'agent-1', online: true, gameRunning: true, screen: 'AUTOMAP_OPEN' },
};

describe('stream events', () => {
  it('accepts the room.assigned example', () => {
    expect(RoomAssignedEvent.parse(assigned)).toStrictEqual(assigned);
  });

  it('accepts the room.stage_changed example', () => {
    expect(RoomStageChangedEvent.parse(stageChanged)).toStrictEqual(stageChanged);
  });

  it('gives the agent a stage change with the room and the stage only', () => {
    const agentCopy = { type: 'room.stage_changed', data: { roomId: '4821', stage: 'expired' } };
    expect(AgentRoomStageChangedEvent.parse(agentCopy)).toStrictEqual(agentCopy);
    expect(AgentStreamEvent.parse(agentCopy)).toStrictEqual(agentCopy);
    // A member list is not part of the agent's message: it is stripped, not carried.
    expect(AgentRoomStageChangedEvent.parse(stageChanged)).toStrictEqual({
      type: 'room.stage_changed',
      data: { roomId: '4821', stage: 'created' },
    });
    expect(AgentStreamEvent.safeParse({ type: 'room.stage_changed', data: { roomId: '4821' } }).success).toBe(
      false,
    );
  });

  it('gives the agent an assignment with an empty member list, and keeps the full list for the site (SEG-03)', () => {
    const lean = { type: 'room.assigned', data: { ...assigned.data, members: [] } };
    expect(AgentRoomAssignedEvent.parse(lean)).toStrictEqual(lean);
    expect(AgentStreamEvent.parse(lean)).toStrictEqual(lean);
    // A list that is not empty is not part of the agent's message.
    expect(AgentRoomAssignedEvent.safeParse(assigned).success).toBe(false);
    expect(SiteStreamEvent.parse(assigned)).toStrictEqual(assigned);
    expect(SiteStreamEvent.safeParse(lean).success).toBe(false);
  });

  it('gives the agent a new run with an empty member list, and keeps the full list for the site (SEG-03)', () => {
    const opened = { type: 'room.run_opened', data: { ...assigned.data, run: 8 } };
    const lean = { type: 'room.run_opened', data: { ...opened.data, members: [] } };
    expect(AgentRoomRunOpenedEvent.parse(lean)).toStrictEqual(lean);
    expect(AgentStreamEvent.parse(lean)).toStrictEqual(lean);
    expect(AgentRoomRunOpenedEvent.safeParse(opened).success).toBe(false);
    expect(RoomRunOpenedEvent.parse(opened)).toStrictEqual(opened);
    expect(SiteStreamEvent.safeParse(lean).success).toBe(false);
  });

  it('gives the agent an open ready check with an empty member list, and keeps the list for the site (SEG-03)', () => {
    const started = {
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
    };
    const lean = { type: 'ready_check.started', data: { ...started.data, members: [] } };
    expect(AgentReadyCheckStartedEvent.parse(lean)).toStrictEqual(lean);
    expect(AgentStreamEvent.parse(lean)).toStrictEqual(lean);
    expect(AgentStreamEvent.safeParse(started).success).toBe(false);
    expect(SiteStreamEvent.parse(started)).toStrictEqual(started);
    expect(SiteStreamEvent.safeParse(lean).success).toBe(false);
  });

  it('keeps the members on the site stream stage change', () => {
    expect(SiteStreamEvent.parse(stageChanged)).toStrictEqual(stageChanged);
    expect(
      SiteStreamEvent.safeParse({ type: 'room.stage_changed', data: { roomId: '4821', stage: 'created' } })
        .success,
    ).toBe(false);
  });

  it('accepts the agent.presence_changed example', () => {
    expect(AgentPresenceChangedEvent.parse(presence)).toStrictEqual(presence);
  });

  it('rejects room.assigned without a game name on the site stream', () => {
    const data = { roomId: assigned.data.roomId, run: assigned.data.run, members };
    expect(SiteStreamEvent.safeParse({ type: 'room.assigned', data }).success).toBe(false);
  });

  it('does not accept agent.presence_changed on the agent stream', () => {
    expect(AgentStreamEvent.safeParse(presence).success).toBe(false);
  });

  it('accepts agent.presence_changed on the site stream', () => {
    expect(SiteStreamEvent.parse(presence)).toStrictEqual(presence);
  });

  it('accepts characters.updated on the site stream', () => {
    const updated = { type: 'characters.updated', data: {} };
    expect(SiteStreamEvent.parse(updated)).toStrictEqual(updated);
  });

  it('accepts queue.updated with a waiting ticket on the site stream', () => {
    const queued = {
      type: 'queue.updated',
      data: {
        id: 'q-1',
        status: 'waiting',
        mode: 'pvp',
        options: {
          mode: 'pvp',
          characterId: 'c-1',
          difficulty: 'hell',
          region: 'americas',
          format: 'duel',
          rules: 'gm',
        },
        joinedAt: '2026-11-10T12:00:00.000Z',
        band: { low: 1400, high: 1600 },
        poolSize: 3,
      },
    };
    expect(SiteStreamEvent.parse(queued)).toStrictEqual(queued);
  });

  it('accepts queue.updated with the left reason on the site stream', () => {
    const left = { type: 'queue.updated', data: { status: 'left', reason: 'agent-offline' } };
    expect(SiteStreamEvent.parse(left)).toStrictEqual(left);
  });

  it('rejects queue.updated with an unknown leave reason', () => {
    const left = { type: 'queue.updated', data: { status: 'left', reason: 'bored' } };
    expect(SiteStreamEvent.safeParse(left).success).toBe(false);
  });

  it('does not accept queue.updated on the agent stream', () => {
    expect(
      AgentStreamEvent.safeParse({ type: 'queue.updated', data: { status: 'left', reason: 'matched' } })
        .success,
    ).toBe(false);
  });

  it('does not accept characters.updated on the agent stream', () => {
    expect(AgentStreamEvent.safeParse({ type: 'characters.updated', data: {} }).success).toBe(false);
  });
});

describe('room.run_opened and room.member_changed', () => {
  const runOpened = {
    type: 'room.run_opened',
    data: { roomId: '4821', run: 8, expectedGameName: 'mmbaalh-08', members },
  };
  const memberChanged = {
    type: 'room.member_changed',
    data: {
      roomId: '4821',
      change: 'left',
      accountId: 'acc-host',
      members: [{ ...members[1], confirmed: true }],
    },
  };

  it('accepts the room.run_opened example on the site and the agent streams', () => {
    expect(RoomRunOpenedEvent.parse(runOpened)).toStrictEqual(runOpened);
    expect(SiteStreamEvent.parse(runOpened)).toStrictEqual(runOpened);
    // The agent's copy has no members (SEG-03): the full example is the site's message, the lean one the agent's.
    const lean = { type: 'room.run_opened', data: { ...runOpened.data, members: [] } };
    expect(AgentStreamEvent.parse(lean)).toStrictEqual(lean);
    expect(AgentStreamEvent.safeParse(runOpened).success).toBe(false);
  });

  it('accepts the elsewhere and returned changes with the member flag (ARL-10)', () => {
    for (const change of ['elsewhere', 'returned']) {
      const event = {
        type: 'room.member_changed',
        data: {
          roomId: '4821',
          change,
          accountId: 'acc-host',
          members: [{ ...members[0], confirmed: true, elsewhere: change === 'elsewhere' }],
        },
      };
      expect(SiteStreamEvent.parse(event)).toStrictEqual(event);
    }
  });

  it('accepts the room.member_changed example on the site stream only', () => {
    expect(RoomMemberChangedEvent.parse(memberChanged)).toStrictEqual(memberChanged);
    expect(SiteStreamEvent.parse(memberChanged)).toStrictEqual(memberChanged);
    expect(AgentStreamEvent.safeParse(memberChanged).success).toBe(false);
  });

  it('rejects a member change of an unknown kind', () => {
    const unknown = { ...memberChanged, data: { ...memberChanged.data, change: 'kicked' } };
    expect(RoomMemberChangedEvent.safeParse(unknown).success).toBe(false);
  });
});
