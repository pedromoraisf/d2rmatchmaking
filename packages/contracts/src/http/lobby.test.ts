import { describe, expect, it } from 'vitest';
import { Assignment, Observation, RoomView } from './lobby.ts';

const observation = {
  idempotencyKey: 'obs-1',
  type: 'GAME_NAME_SEEN',
  run: 7,
  value: 'mmbaalh-07',
  confidence: 0.94,
  signals: { ocr: 0.91, sameServerAsHost: true },
  capturedAt: '2026-10-29T23:41:07.512Z',
};

const members = [
  { accountId: 'acc-host', characterId: null, joinOrder: 1, role: 'host' },
  { accountId: 'acc-guest', characterId: null, joinOrder: 2, role: 'member' },
];

describe('Observation', () => {
  it('accepts the observation example', () => {
    expect(Observation.parse(observation)).toStrictEqual(observation);
  });

  it('catches an unknown observation type', () => {
    const parsed = Observation.parse({ ...observation, type: 'SOMETHING_NEW' });
    expect(parsed.type).toBe('UNKNOWN');
  });

  it('rejects a value of 65 characters', () => {
    expect(Observation.safeParse({ ...observation, value: 'x'.repeat(65) }).success).toBe(false);
  });

  it('rejects a confidence above 1', () => {
    expect(Observation.safeParse({ ...observation, confidence: 1.1 }).success).toBe(false);
  });

  it('rejects an idempotency key of 65 characters', () => {
    expect(Observation.safeParse({ ...observation, idempotencyKey: 'k'.repeat(65) }).success).toBe(false);
  });
});

describe('Assignment', () => {
  const assignment = { roomId: '4821', run: 7, expectedGameName: 'mmbaalh-07', members };

  it('accepts the assignment example', () => {
    expect(Assignment.parse(assignment)).toStrictEqual(assignment);
  });

  it('rejects a game name outside the mm{activity}{difficulty}-{n} form', () => {
    expect(Assignment.safeParse({ ...assignment, expectedGameName: 'Baal Hell 7' }).success).toBe(false);
  });
});

describe('RoomView', () => {
  const room = {
    roomId: '4821',
    mode: 'leveling',
    activity: 'baal',
    difficulty: 'hell',
    stage: 'awaiting_host',
    run: 1,
    expectedGameName: 'mmbaalh-12',
    password: '',
    members,
  };

  it('accepts the room view of a freshly formed match', () => {
    expect(RoomView.parse(room)).toStrictEqual(room);
  });

  it('rejects an unknown stage', () => {
    expect(RoomView.safeParse({ ...room, stage: 'started' }).success).toBe(false);
  });
});
