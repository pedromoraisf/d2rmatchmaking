import { describe, expect, it } from 'vitest';
import { SequentialIdGenerator, type MatchFormedPayload } from '../../../shared-kernel/index.ts';
import { LobbyRoom } from './lobby-room.ts';
import { Observation, type ObservationProps, type ObservationType } from './observation.ts';

const CAPTURED_AT = new Date('2026-10-31T10:00:00.000Z');

function match(overrides: Partial<MatchFormedPayload> = {}): MatchFormedPayload {
  return {
    matchId: 'match-1',
    mode: 'leveling',
    activity: 'baal',
    difficulty: 'hell',
    region: 'americas',
    ladder: 'sc-ladder',
    era: 'rotw',
    members: [
      { accountId: 'account-2', characterId: null, joinOrder: 2, role: 'member' },
      { accountId: 'account-1', characterId: null, joinOrder: 1, role: 'host' },
    ],
    ...overrides,
  };
}

function open(payload: MatchFormedPayload = match()): LobbyRoom {
  const result = LobbyRoom.fromMatch(payload, 12, new SequentialIdGenerator('room'));
  if (!result.ok) {
    throw new Error('expected the room to open');
  }
  return result.value.room;
}

function observation(overrides: Partial<ObservationProps> = {}): Observation {
  const props: ObservationProps = {
    agentId: 'agent-1',
    idempotencyKey: 'key-1',
    roomId: 'room-1',
    accountId: 'account-1',
    type: 'GAME_NAME_SEEN',
    run: 1,
    value: 'mmbaalh-12',
    confidence: 0.9,
    capturedAt: CAPTURED_AT,
    ...overrides,
  };
  const result = Observation.of(props);
  if (!result.ok) {
    throw new Error('expected a valid observation');
  }
  return result.value;
}

function observed(type: ObservationType, overrides: Partial<ObservationProps> = {}): Observation {
  return observation({ type, ...overrides });
}

describe('LobbyRoom.fromMatch', () => {
  it('fromMatch creates awaiting_host with run 1', () => {
    const room = open();

    expect(room.stage).toBe('awaiting_host');
    expect(room.currentRun).toBe(1);
    expect(room.gameName.value).toBe('mmbaalh-12');
  });

  it('makes the member with the lowest join order the host', () => {
    expect(open().hostAccountId).toBe('account-1');
  });

  it('keeps the password empty', () => {
    expect(open().password).toBe('');
  });

  it('emits the assignment and the stage with the members in join order', () => {
    const change = LobbyRoom.fromMatch(match(), 12, new SequentialIdGenerator('room'));
    if (!change.ok) {
      throw new Error('expected the room to open');
    }
    const [assignment, stage] = change.value.events;
    expect(assignment).toEqual({
      type: 'RoomAssignmentChanged',
      payload: {
        roomId: 'room-1',
        run: 1,
        expectedGameName: 'mmbaalh-12',
        members: [
          { accountId: 'account-1', characterId: null, joinOrder: 1, role: 'host' },
          { accountId: 'account-2', characterId: null, joinOrder: 2, role: 'member' },
        ],
      },
    });
    expect(stage).toEqual({
      type: 'RoomStageChanged',
      payload: { roomId: 'room-1', stage: 'awaiting_host', members: change.value.room.members },
    });
    expect(change.value.events).toHaveLength(2);
  });

  it('answers unsupported-difficulty for a difficulty F0 does not play', () => {
    expect(
      LobbyRoom.fromMatch(match({ difficulty: 'normal' }), 12, new SequentialIdGenerator('room')),
    ).toEqual({
      ok: false,
      error: 'unsupported-difficulty',
    });
  });
});

describe('LobbyRoom.observe', () => {
  it('ignores a GAME_NAME_SEEN from a member who is not the host', () => {
    const outcome = open().observe(observation({ accountId: 'account-2' }));

    expect(outcome).toEqual({ outcome: 'ignored' });
  });

  it('ignores a GAME_NAME_SEEN for another run', () => {
    expect(open().observe(observation({ run: 2 }))).toEqual({ outcome: 'ignored' });
  });

  it('ignores a GAME_NAME_SEEN with another game name', () => {
    expect(open().observe(observation({ value: 'mmbaalh-13' }))).toEqual({ outcome: 'ignored' });
  });

  it('ignores an observation of another type', () => {
    expect(open().observe(observed('ROUND_REPORTED'))).toEqual({ outcome: 'ignored' });
  });

  it('moves to created on a matching host observation with one RoomStageChanged', () => {
    const outcome = open().observe(observation({ value: 'MMBAALH-12' }));

    expect(outcome.outcome).toBe('created');
    if (outcome.outcome !== 'created') {
      throw new Error('expected the room to be created');
    }
    expect(outcome.room.stage).toBe('created');
    expect(outcome.events).toEqual([
      {
        type: 'RoomStageChanged',
        payload: { roomId: 'room-1', stage: 'created', members: outcome.room.members },
      },
    ]);
  });

  it('ignores every observation once the room is created, with no event', () => {
    const created = open().observe(observation());
    if (created.outcome !== 'created') {
      throw new Error('expected the room to be created');
    }

    expect(created.room.observe(observation({ idempotencyKey: 'key-2' }))).toEqual({ outcome: 'ignored' });
  });
});
