import { describe, expect, it } from 'vitest';
import { SequentialIdGenerator, type MatchFormedPayload } from '../../../shared-kernel/index.ts';
import { GameName } from './game-name.ts';
import { AWAITING_HOST_EXPIRY_MS, LobbyRoom, type RestoredRoomProps } from './lobby-room.ts';

const T0 = new Date('2026-11-01T10:00:00.000Z');
const LATER = new Date('2026-11-01T10:05:00.000Z');

type Members = MatchFormedPayload['members'];

function match(members: Members): MatchFormedPayload {
  return {
    matchId: 'match-1',
    mode: 'leveling',
    activity: 'baal',
    difficulty: 'hell',
    region: 'americas',
    ladder: 'sc-ladder',
    era: 'rotw',
    members,
  };
}

const namedHost: Members = [
  { accountId: 'account-1', characterId: null, joinOrder: 1, role: 'host' },
  { accountId: 'account-2', characterId: null, joinOrder: 2, role: 'member' },
];

function formed(members: Members = namedHost): LobbyRoom {
  const opened = LobbyRoom.fromMatch(match(members), 12, new SequentialIdGenerator('room'), T0);
  if (!opened.ok) {
    throw new Error('expected the room to open');
  }
  return opened.value.room;
}

function gameName(): GameName {
  const result = GameName.of('baal', 'hell', 12);
  if (!result.ok) {
    throw new Error('expected the game name to build');
  }
  return result.value;
}

function props(overrides: Partial<RestoredRoomProps> = {}): RestoredRoomProps {
  return {
    id: 'room-1',
    matchId: 'match-1',
    mode: 'leveling',
    activity: 'baal',
    difficulty: 'hell',
    hostAccountId: 'account-1',
    stage: 'formed',
    createdAt: T0,
    currentRun: 1,
    gameName: gameName(),
    members: namedHost,
    ...overrides,
  };
}

describe('LobbyRoom.fromMatch host choice (QUE-12)', () => {
  it('takes the lowest join order as host when the match names none', () => {
    const room = formed([
      { accountId: 'account-2', characterId: null, joinOrder: 2, role: 'member' },
      { accountId: 'account-1', characterId: null, joinOrder: 1, role: 'member' },
    ]);
    expect(room.hostAccountId).toBe('account-1');
    expect(room.members.map((member) => member.role)).toStrictEqual(['host', 'member']);
  });
});

describe('LobbyRoom.expiresAt (LBR-05)', () => {
  it('is 3 minutes after the room opened while it is formed', () => {
    expect(formed().expiresAt).toEqual(new Date(T0.getTime() + AWAITING_HOST_EXPIRY_MS));
  });

  it('is 3 minutes after the assignment reached the host while awaiting the host', () => {
    const change = formed().markAssignmentDelivered('account-1', LATER);
    expect(change?.room.expiresAt).toEqual(new Date(LATER.getTime() + AWAITING_HOST_EXPIRY_MS));
  });

  it('is null once the game is created and in a room that is over', () => {
    for (const stage of ['created', 'active', 'closed', 'expired'] as const) {
      const restored = LobbyRoom.restore(props({ stage }));
      expect(restored.ok && restored.value.expiresAt).toBeNull();
    }
  });
});

describe('LobbyRoom.restore refusals', () => {
  it('refuses a room with no host', () => {
    const members: Members = [
      { accountId: 'account-1', characterId: null, joinOrder: 1, role: 'member' },
      { accountId: 'account-2', characterId: null, joinOrder: 2, role: 'member' },
    ];
    expect(LobbyRoom.restore(props({ members }))).toEqual({ ok: false, error: 'invalid-room' });
  });

  it('refuses a room with two hosts', () => {
    const members: Members = [
      { accountId: 'account-1', characterId: null, joinOrder: 1, role: 'host' },
      { accountId: 'account-2', characterId: null, joinOrder: 2, role: 'host' },
    ];
    expect(LobbyRoom.restore(props({ members }))).toEqual({ ok: false, error: 'invalid-room' });
  });

  it('refuses a stored host account that is not the member with role host', () => {
    expect(LobbyRoom.restore(props({ hostAccountId: 'account-2' }))).toEqual({
      ok: false,
      error: 'invalid-room',
    });
  });

  it('refuses a member whose role is neither host nor member', () => {
    const members = [
      { accountId: 'account-1', characterId: null, joinOrder: 1, role: 'host' },
      { accountId: 'account-2', characterId: null, joinOrder: 2, role: 'spectator' },
    ] as unknown as Members;
    expect(LobbyRoom.restore(props({ members }))).toEqual({ ok: false, error: 'invalid-room' });
  });

  it('refuses a repeated account', () => {
    const members: Members = [
      { accountId: 'account-1', characterId: null, joinOrder: 1, role: 'host' },
      { accountId: 'account-1', characterId: null, joinOrder: 2, role: 'member' },
    ];
    expect(LobbyRoom.restore(props({ members }))).toEqual({ ok: false, error: 'invalid-room' });
  });
});

describe('LobbyRoom.restore awaiting start', () => {
  it('keeps the start of the wait only in stage awaiting_host', () => {
    const awaiting = LobbyRoom.restore(props({ stage: 'awaiting_host', awaitingSince: LATER }));
    expect(awaiting.ok && awaiting.value.awaitingSince).toEqual(LATER);
    const created = LobbyRoom.restore(props({ stage: 'created', awaitingSince: LATER }));
    expect(created.ok && created.value.awaitingSince).toBeNull();
  });
});

describe('a room that is over', () => {
  it('refuses leave and close in an expired room, as in a closed one', () => {
    for (const stage of ['closed', 'expired'] as const) {
      const restored = LobbyRoom.restore(props({ stage }));
      if (!restored.ok) {
        throw new Error('expected the room to restore');
      }
      expect(restored.value.leave('account-2')).toEqual({ ok: false, error: 'wrong-stage' });
      expect(restored.value.close('account-1')).toEqual({ ok: false, error: 'wrong-stage' });
    }
  });
});
