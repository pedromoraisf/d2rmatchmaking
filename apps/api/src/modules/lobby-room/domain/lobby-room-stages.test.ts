import { describe, expect, it } from 'vitest';
import {
  SequentialIdGenerator,
  type AnyDomainEvent,
  type MatchFormedPayload,
} from '../../../shared-kernel/index.ts';
import { GameName } from './game-name.ts';
import { AWAITING_HOST_EXPIRY_MS, LobbyRoom, type RoomChange } from './lobby-room.ts';
import { Observation } from './observation.ts';

const T0 = new Date('2026-11-01T10:00:00.000Z');

function match(members = 3): MatchFormedPayload {
  return {
    matchId: 'match-1',
    mode: 'leveling',
    activity: 'baal',
    difficulty: 'hell',
    region: 'americas',
    ladder: 'sc-ladder',
    era: 'rotw',
    members: [1, 2, 3].slice(0, members).map((order) => ({
      accountId: `account-${order}`,
      characterId: null,
      joinOrder: order,
      role: order === 1 ? ('host' as const) : ('member' as const),
    })),
  };
}

function formed(members = 3): LobbyRoom {
  const opened = LobbyRoom.fromMatch(match(members), 12, new SequentialIdGenerator('room'));
  if (!opened.ok) {
    throw new Error('expected the room to open');
  }
  return opened.value.room;
}

function seen(accountId: string, run = 1, value = 'mmbaalh-12'): Observation {
  const made = Observation.of({
    agentId: `agent-${accountId}`,
    idempotencyKey: `${accountId}-${run}-${value}`,
    roomId: 'room-1',
    accountId,
    type: 'GAME_NAME_SEEN',
    run,
    value,
    confidence: 0.9,
    capturedAt: T0,
  });
  if (!made.ok) {
    throw new Error('expected an observation');
  }
  return made.value;
}

function changed(change: RoomChange | null): LobbyRoom {
  if (change === null) {
    throw new Error('expected a change');
  }
  return change.room;
}

function awaiting(members = 3): LobbyRoom {
  return changed(formed(members).markAssignmentDelivered('account-1', T0));
}

function created(members = 3): LobbyRoom {
  const outcome = awaiting(members).observe(seen('account-1'));
  if (outcome.outcome !== 'created') {
    throw new Error('expected created');
  }
  return outcome.room;
}

function active(): LobbyRoom {
  let room = created();
  for (const account of ['account-2', 'account-3']) {
    const outcome = room.observe(seen(account));
    if (outcome.outcome === 'ignored') {
      throw new Error('expected a confirmation');
    }
    room = outcome.room;
  }
  return room;
}

function nextName(n = 13): GameName {
  const name = GameName.of('baal', 'hell', n);
  if (!name.ok) {
    throw new Error('expected a name');
  }
  return name.value;
}

function types(events: readonly AnyDomainEvent[]): string[] {
  return events.map((event) => event.type);
}

describe('LobbyRoom.markAssignmentDelivered (LBR-02)', () => {
  it('moves formed to awaiting_host and starts the clock of the 3 minutes', () => {
    const change = formed().markAssignmentDelivered('account-1', T0);

    expect(change?.room.stage).toBe('awaiting_host');
    expect(change?.room.awaitingSince).toEqual(T0);
    expect(change?.events.map((event) => event.type)).toEqual(['RoomStageChanged']);
  });

  it('ignores another member, a repeat and a room past formed', () => {
    expect(formed().markAssignmentDelivered('account-2', T0)).toBeNull();
    expect(awaiting().markAssignmentDelivered('account-1', T0)).toBeNull();
    expect(created().markAssignmentDelivered('account-1', T0)).toBeNull();
  });
});

describe('LobbyRoom.observe (LBR-03, LBR-04)', () => {
  it('confirms the host and creates the room from awaiting_host and from formed', () => {
    for (const room of [awaiting(), formed()]) {
      const outcome = room.observe(seen('account-1'));
      expect(outcome.outcome).toBe('created');
      if (outcome.outcome === 'ignored') {
        throw new Error('expected a change');
      }
      expect(outcome.room.members.map((member) => member.confirmed)).toEqual([true, false, false]);
      expect(outcome.room.awaitingSince).toBeNull();
    }
  });

  it('keeps a member sighting out of awaiting_host (AWS-24)', () => {
    expect(awaiting().observe(seen('account-2'))).toEqual({ outcome: 'ignored' });
  });

  it('confirms a member after created and stays created while another is missing', () => {
    const outcome = created().observe(seen('account-2'));

    expect(outcome.outcome).toBe('confirmed');
    if (outcome.outcome !== 'confirmed') {
      throw new Error('expected a confirmation');
    }
    expect(outcome.room.stage).toBe('created');
    expect(types(outcome.events)).toEqual(['RoomMemberChanged']);
    expect(outcome.events[0]).toMatchObject({ payload: { change: 'confirmed', accountId: 'account-2' } });
  });

  it('becomes active when the last member is confirmed, with both events', () => {
    const second = created().observe(seen('account-2'));
    if (second.outcome !== 'confirmed') {
      throw new Error('expected a confirmation');
    }
    const last = second.room.observe(seen('account-3'));

    expect(last.outcome).toBe('active');
    if (last.outcome !== 'active') {
      throw new Error('expected active');
    }
    expect(last.room.stage).toBe('active');
    expect(types(last.events)).toEqual(['RoomMemberChanged', 'RoomStageChanged']);
  });

  it('ignores a repeated confirmation, a stale run, a wrong name and an outsider', () => {
    const room = created();
    const second = room.observe(seen('account-2'));
    if (second.outcome !== 'confirmed') {
      throw new Error('expected a confirmation');
    }

    expect(second.room.observe(seen('account-2'))).toEqual({ outcome: 'ignored' });
    expect(room.observe(seen('account-2', 2))).toEqual({ outcome: 'ignored' });
    expect(room.observe(seen('account-2', 1, 'mmbaalh-99'))).toEqual({ outcome: 'ignored' });
    expect(room.observe(seen('account-9'))).toEqual({ outcome: 'ignored' });
  });

  it('ignores every sighting once active', () => {
    expect(active().observe(seen('account-2'))).toEqual({ outcome: 'ignored' });
  });
});

describe('LobbyRoom.expireIfDue (LBR-05)', () => {
  it('expires at 3:00.000 and not at 2:59.999', () => {
    const room = awaiting();

    expect(AWAITING_HOST_EXPIRY_MS).toBe(180_000);
    expect(room.expiresAt).toEqual(new Date(T0.getTime() + 180_000));
    expect(room.expireIfDue(new Date(T0.getTime() + 179_999))).toBeNull();
    const change = room.expireIfDue(new Date(T0.getTime() + 180_000));
    expect(change?.room.stage).toBe('expired');
    expect(change?.events).toEqual([
      { type: 'RoomStageChanged', payload: { roomId: 'room-1', stage: 'expired', members: room.members } },
    ]);
  });

  it('never expires a room that is not awaiting_host', () => {
    const late = new Date(T0.getTime() + 3_600_000);

    expect(formed().expireIfDue(late)).toBeNull();
    expect(created().expireIfDue(late)).toBeNull();
    expect(active().expireIfDue(late)).toBeNull();
    expect(created().expiresAt).toBeNull();
  });
});

describe('LobbyRoom.openNextRun (LBR-06)', () => {
  it('opens run 2 with the new name, clears the confirmations and restarts the 3 minutes', () => {
    const later = new Date(T0.getTime() + 600_000);
    const result = active().openNextRun('account-1', nextName(), later);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('expected a new run');
    }
    const { room, events } = result.value;
    expect(room.stage).toBe('awaiting_host');
    expect(room.currentRun).toBe(2);
    expect(room.gameName.value).toBe('mmbaalh-13');
    expect(room.members.every((member) => !member.confirmed)).toBe(true);
    expect(room.awaitingSince).toEqual(later);
    expect(types(events)).toEqual(['RoomRunOpened', 'RoomStageChanged']);
    expect(events[0]).toMatchObject({
      payload: { roomId: 'room-1', run: 2, expectedGameName: 'mmbaalh-13' },
    });
    expect(room.observe(seen('account-1', 1, 'mmbaalh-12'))).toEqual({ outcome: 'ignored' });
    expect(room.observe(seen('account-1', 2, 'mmbaalh-13')).outcome).toBe('created');
  });

  it('refuses a member who is not the host, an outsider and a room that is not active', () => {
    expect(active().openNextRun('account-2', nextName(), T0)).toEqual({ ok: false, error: 'not-host' });
    expect(active().openNextRun('account-9', nextName(), T0)).toEqual({ ok: false, error: 'not-member' });
    expect(created().openNextRun('account-1', nextName(), T0)).toEqual({ ok: false, error: 'wrong-stage' });
  });
});

describe('LobbyRoom.leave (LBR-07)', () => {
  it('passes the host role to the lowest join order among those left', () => {
    const result = active().leave('account-1');
    if (!result.ok) {
      throw new Error('expected a leave');
    }

    expect(result.value.room.hostAccountId).toBe('account-2');
    expect(result.value.room.members.map((member) => member.accountId)).toEqual(['account-2', 'account-3']);
    expect(types(result.value.events)).toEqual(['RoomMemberChanged', 'RoomMemberChanged']);
    expect(result.value.events.map((event) => ('payload' in event ? event.payload : null))).toMatchObject([
      { change: 'left', accountId: 'account-1' },
      { change: 'host_changed', accountId: 'account-2' },
    ]);
  });

  it('hands over to the lowest join order even when the match named a later member as host', () => {
    const named = match();
    const opened = LobbyRoom.fromMatch(
      {
        ...named,
        members: named.members.map((member) => ({
          ...member,
          role: member.joinOrder === 3 ? ('host' as const) : ('member' as const),
        })),
      },
      12,
      new SequentialIdGenerator('room'),
    );
    if (!opened.ok) {
      throw new Error('expected the room to open');
    }
    const result = opened.value.room.leave('account-3');
    if (!result.ok) {
      throw new Error('expected a leave');
    }

    expect(result.value.room.hostAccountId).toBe('account-1');
  });

  it('keeps the host when another member leaves', () => {
    const result = active().leave('account-3');
    if (!result.ok) {
      throw new Error('expected a leave');
    }

    expect(result.value.room.hostAccountId).toBe('account-1');
    expect(types(result.value.events)).toEqual(['RoomMemberChanged']);
  });

  it('becomes active when the member who had not confirmed leaves a created room', () => {
    const result = created(2).leave('account-2');
    if (!result.ok) {
      throw new Error('expected a leave');
    }

    expect(result.value.room.stage).toBe('active');
    expect(types(result.value.events)).toEqual(['RoomMemberChanged', 'RoomStageChanged']);
  });

  it('stays created when a confirmed member leaves and another is still missing', () => {
    const second = created().observe(seen('account-2'));
    if (second.outcome !== 'confirmed') {
      throw new Error('expected a confirmation');
    }
    const result = second.room.leave('account-2');
    if (!result.ok) {
      throw new Error('expected a leave');
    }

    expect(result.value.room.stage).toBe('created');
  });

  it('closes the room when the last member leaves and keeps that member listed', () => {
    const solo = formed(1);
    const result = solo.leave('account-1');
    if (!result.ok) {
      throw new Error('expected a leave');
    }

    expect(result.value.room.stage).toBe('closed');
    expect(result.value.room.members.map((member) => member.accountId)).toEqual(['account-1']);
    expect(types(result.value.events)).toEqual(['RoomMemberChanged', 'RoomStageChanged']);
  });

  it('keeps the 3 minutes running when the host leaves an awaiting_host room', () => {
    const result = awaiting().leave('account-1');
    if (!result.ok) {
      throw new Error('expected a leave');
    }

    expect(result.value.room.stage).toBe('awaiting_host');
    expect(result.value.room.awaitingSince).toEqual(T0);
    expect(result.value.room.observe(seen('account-2')).outcome).toBe('created');
  });

  it('refuses an outsider and a room that is over', () => {
    expect(active().leave('account-9')).toEqual({ ok: false, error: 'not-member' });
    const closed = active().close('account-1');
    if (!closed.ok) {
      throw new Error('expected a close');
    }
    expect(closed.value.room.leave('account-2')).toEqual({ ok: false, error: 'wrong-stage' });
  });
});

describe('LobbyRoom.close (LBR-09)', () => {
  it('lets the host close the room from any open stage', () => {
    for (const room of [formed(), awaiting(), created(), active()]) {
      const result = room.close('account-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.room.stage).toBe('closed');
        expect(result.value.room.members).toHaveLength(3);
        expect(types(result.value.events)).toEqual(['RoomStageChanged']);
      }
    }
  });

  it('refuses a member who is not the host, an outsider and a room that is over', () => {
    expect(active().close('account-2')).toEqual({ ok: false, error: 'not-host' });
    expect(active().close('account-9')).toEqual({ ok: false, error: 'not-member' });
    const closed = active().close('account-1');
    if (!closed.ok) {
      throw new Error('expected a close');
    }
    expect(closed.value.room.close('account-1')).toEqual({ ok: false, error: 'wrong-stage' });
  });
});

describe('LobbyRoom.restore of every stage', () => {
  it('restores a room in each stage with its confirmations', () => {
    const base = created();
    for (const stage of ['formed', 'created', 'active', 'closed', 'expired'] as const) {
      const restored = LobbyRoom.restore({
        id: 'room-1',
        matchId: 'match-1',
        mode: 'leveling',
        activity: 'baal',
        difficulty: 'hell',
        hostAccountId: 'account-1',
        stage,
        currentRun: 2,
        gameName: nextName(),
        members: base.members,
      });
      expect(restored.ok).toBe(true);
      if (restored.ok) {
        expect(restored.value.stage).toBe(stage);
        expect(restored.value.members.map((member) => member.confirmed)).toEqual([true, false, false]);
        expect(restored.value.awaitingSince).toBeNull();
      }
    }
  });
});
