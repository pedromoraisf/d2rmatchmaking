import { describe, expect, it } from 'vitest';
import { SequentialIdGenerator, type MatchFormedPayload } from '../../../shared-kernel/index.ts';
import { LobbyRoom } from './lobby-room.ts';
import { Observation, type ObservationType } from './observation.ts';

const T0 = new Date('2026-11-01T10:00:00.000Z');

const match: MatchFormedPayload = {
  matchId: 'match-1',
  mode: 'leveling',
  activity: 'baal',
  difficulty: 'hell',
  region: 'americas',
  ladder: 'sc-ladder',
  era: 'rotw',
  members: [1, 2].map((order) => ({
    accountId: `account-${order}`,
    characterId: null,
    joinOrder: order,
    role: order === 1 ? ('host' as const) : ('member' as const),
  })),
};

let sequence = 0;

function observation(
  accountId: string,
  type: ObservationType,
  options: { run?: number; value?: string; roomId?: string } = {},
): Observation {
  const made = Observation.of({
    agentId: `agent-${accountId}`,
    idempotencyKey: `${accountId}-${type}-${String(options.run ?? 1)}-${String(++sequence)}`,
    roomId: options.roomId ?? 'room-1',
    accountId,
    type,
    run: options.run ?? 1,
    value: options.value ?? (type === 'OTHER_GAME_SEEN' ? '' : 'mmbaalh-12'),
    confidence: 0.9,
    capturedAt: T0,
  });
  if (!made.ok) {
    throw new Error('expected an observation');
  }
  return made.value;
}

/** A `created` room: the host confirmed, the guest not yet. */
function created(): LobbyRoom {
  const opened = LobbyRoom.fromMatch(match, 12, new SequentialIdGenerator('room'), T0);
  if (!opened.ok) {
    throw new Error('expected the room to open');
  }
  const outcome = opened.value.room.observe(observation('account-1', 'GAME_NAME_SEEN'));
  if (outcome.outcome !== 'created') {
    throw new Error('expected created');
  }
  return outcome.room;
}

function active(): LobbyRoom {
  const outcome = created().observe(observation('account-2', 'GAME_NAME_SEEN'));
  if (outcome.outcome !== 'active') {
    throw new Error('expected active');
  }
  return outcome.room;
}

function elsewhereOf(room: LobbyRoom, accountId: string): boolean | undefined {
  return room.members.find((member) => member.accountId === accountId)?.elsewhere;
}

describe('LobbyRoom.observe OTHER_GAME_SEEN (ARL-10)', () => {
  it('marks a confirmed member elsewhere, tells the site and keeps the stage', () => {
    const room = created();
    const outcome = room.observe(observation('account-1', 'OTHER_GAME_SEEN'));
    if (outcome.outcome !== 'elsewhere') {
      throw new Error('expected elsewhere');
    }
    expect(outcome.room.stage).toBe('created');
    expect(elsewhereOf(outcome.room, 'account-1')).toBe(true);
    expect(elsewhereOf(outcome.room, 'account-2')).toBe(false);
    expect(outcome.events.map((event) => event.type)).toEqual(['RoomMemberChanged']);
    expect(outcome.events[0]?.payload).toMatchObject({ change: 'elsewhere', accountId: 'account-1' });
  });

  it('keeps an active room active', () => {
    const outcome = active().observe(observation('account-1', 'OTHER_GAME_SEEN'));
    expect(outcome.outcome).toBe('elsewhere');
    expect(outcome.outcome === 'elsewhere' ? outcome.room.stage : null).toBe('active');
  });

  it('never carries a value into the event', () => {
    const outcome = created().observe(observation('account-1', 'OTHER_GAME_SEEN'));
    expect(JSON.stringify(outcome)).not.toContain('duels');
  });

  it('ignores a repeat, a member who is not confirmed, a stale run, another room and a room not yet created', () => {
    const room = created();
    const first = room.observe(observation('account-1', 'OTHER_GAME_SEEN'));
    if (first.outcome !== 'elsewhere') {
      throw new Error('expected elsewhere');
    }
    expect(first.room.observe(observation('account-1', 'OTHER_GAME_SEEN')).outcome).toBe('ignored');
    expect(room.observe(observation('account-2', 'OTHER_GAME_SEEN')).outcome).toBe('ignored');
    expect(room.observe(observation('account-1', 'OTHER_GAME_SEEN', { run: 2 })).outcome).toBe('ignored');
    expect(room.observe(observation('account-1', 'OTHER_GAME_SEEN', { roomId: 'room-9' })).outcome).toBe(
      'ignored',
    );
    expect(room.observe(observation('account-9', 'OTHER_GAME_SEEN')).outcome).toBe('ignored');
    const opened = LobbyRoom.fromMatch(match, 12, new SequentialIdGenerator('room'), T0);
    if (!opened.ok) {
      throw new Error('expected the room to open');
    }
    expect(opened.value.room.observe(observation('account-1', 'OTHER_GAME_SEEN')).outcome).toBe('ignored');
  });

  it('ignores a room that is over', () => {
    const closed = created().close('account-1');
    if (!closed.ok) {
      throw new Error('expected closed');
    }
    expect(closed.value.room.observe(observation('account-1', 'OTHER_GAME_SEEN')).outcome).toBe('ignored');
  });
});

describe('LobbyRoom.observe GAME_NAME_SEEN after OTHER_GAME_SEEN (ARL-10)', () => {
  function elsewhere(room: LobbyRoom, accountId: string): LobbyRoom {
    const outcome = room.observe(observation(accountId, 'OTHER_GAME_SEEN'));
    if (outcome.outcome !== 'elsewhere') {
      throw new Error('expected elsewhere');
    }
    return outcome.room;
  }

  it('confirms the host again with a member event and no stage event', () => {
    const away = elsewhere(created(), 'account-1');
    const outcome = away.observe(observation('account-1', 'GAME_NAME_SEEN'));
    if (outcome.outcome !== 'returned') {
      throw new Error('expected returned');
    }
    expect(elsewhereOf(outcome.room, 'account-1')).toBe(false);
    expect(outcome.room.stage).toBe('created');
    expect(outcome.events.map((event) => event.type)).toEqual(['RoomMemberChanged']);
    expect(outcome.events[0]?.payload).toMatchObject({ change: 'returned', accountId: 'account-1' });
  });

  it('confirms a guest again in an active room', () => {
    const away = elsewhere(active(), 'account-2');
    const outcome = away.observe(observation('account-2', 'GAME_NAME_SEEN'));
    expect(outcome.outcome).toBe('returned');
    expect(outcome.outcome === 'returned' ? outcome.room.stage : null).toBe('active');
  });

  it('does not clear it for a wrong name or a stale run', () => {
    const away = elsewhere(created(), 'account-1');
    expect(away.observe(observation('account-1', 'GAME_NAME_SEEN', { value: 'mmbaaxh-12' })).outcome).toBe(
      'ignored',
    );
    expect(away.observe(observation('account-1', 'GAME_NAME_SEEN', { run: 2 })).outcome).toBe('ignored');
  });

  it('clears it when the next run opens', () => {
    const away = elsewhere(active(), 'account-1');
    const next = away.openNextRun(
      'account-1',
      (() => {
        const name = LobbyRoom.fromMatch(match, 13, new SequentialIdGenerator('x'), T0);
        if (!name.ok) {
          throw new Error('name');
        }
        return name.value.room.gameName;
      })(),
      T0,
    );
    if (!next.ok) {
      throw new Error('expected the next run');
    }
    expect(next.value.room.members.every((member) => !member.elsewhere)).toBe(true);
  });
});
