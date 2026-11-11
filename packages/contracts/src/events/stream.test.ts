import { describe, expect, it } from 'vitest';
import {
  AgentPresenceChangedEvent,
  AgentStreamEvent,
  RoomAssignedEvent,
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
