import { describe, expect, it } from 'vitest';
import type { ReadyCheckView, SiteStreamEvent } from '@d2rmm/contracts';
import type { RoomShown } from '../features/lobby-room/RoomPanel.tsx';
import { applyStreamEvent } from './site-state.ts';

const check: ReadyCheckView = {
  id: 'rc-1',
  mode: 'pvp',
  difficulty: 'hell',
  deadline: '2026-11-10T12:01:00.000Z',
  now: '2026-11-10T12:00:00.000Z',
  members: [
    { position: 1, class: 'sorceress', level: 91, accepted: false, you: true },
    { position: 2, class: 'barbarian', level: 84, accepted: false, you: false },
  ],
};

const started: SiteStreamEvent = { type: 'ready_check.started', data: check };

describe('applyStreamEvent: ready checks (RDY-01 … RDY-03)', () => {
  it('shows the check the stream opens', () => {
    const next = applyStreamEvent({ agent: null, room: null, readyCheck: null }, started);
    expect(next.readyCheck).toStrictEqual(check);
  });

  it('replaces the view with an acceptance of the same check', () => {
    const accepted: ReadyCheckView = {
      ...check,
      members: [
        { position: 1, class: 'sorceress', level: 91, accepted: true, you: true },
        { position: 2, class: 'barbarian', level: 84, accepted: false, you: false },
      ],
    };
    const next = applyStreamEvent(
      { agent: null, room: null, readyCheck: check },
      { type: 'ready_check.updated', data: accepted },
    );
    expect(next.readyCheck?.members[0]?.accepted).toBe(true);
  });

  it('ignores an update for a check the player is not showing', () => {
    const state = { agent: null, room: null, readyCheck: check };
    const next = applyStreamEvent(state, { type: 'ready_check.updated', data: { ...check, id: 'rc-other' } });
    expect(next).toBe(state);
  });

  it('clears the check when it resolves', () => {
    const next = applyStreamEvent(
      { agent: null, room: null, readyCheck: check },
      { type: 'ready_check.resolved', data: { id: 'rc-1', outcome: 'declined' } },
    );
    expect(next.readyCheck).toBeNull();
  });

  it('keeps the check when a different one resolves', () => {
    const state = { agent: null, room: null, readyCheck: check };
    const next = applyStreamEvent(state, {
      type: 'ready_check.resolved',
      data: { id: 'rc-other', outcome: 'accepted' },
    });
    expect(next).toBe(state);
  });
});

describe('applyStreamEvent: rooms (LBR-01, LBR-04, LBR-06, LBR-07)', () => {
  const host = { accountId: 'acc-1', characterId: null, joinOrder: 1, role: 'host' as const };
  const guest = { accountId: 'acc-2', characterId: null, joinOrder: 2, role: 'member' as const };
  const shown = {
    roomId: 'room-1',
    gameName: 'mmbaalh-12',
    stage: 'created' as const,
    run: 1,
    members: [
      {
        accountId: 'acc-1',
        joinOrder: 1,
        role: 'host' as const,
        confirmed: true,
        class: 'sorceress' as const,
        level: 91,
      },
      {
        accountId: 'acc-2',
        joinOrder: 2,
        role: 'member' as const,
        confirmed: false,
        class: 'barbarian' as const,
        level: 84,
      },
    ],
    runs: [{ run: 1, gameName: 'mmbaalh-12' }],
  };
  const state = { agent: null, room: shown, session: { accountId: 'acc-2' } };

  it('opens an assigned room Formed with its first run', () => {
    const empty: { agent: null; room: RoomShown | null } = { agent: null, room: null };
    const next = applyStreamEvent(empty, {
      type: 'room.assigned',
      data: { roomId: 'room-2', run: 1, expectedGameName: 'mmbaalh-13', members: [host] },
    });

    expect(next.room).toMatchObject({ roomId: 'room-2', stage: 'formed', run: 1, gameName: 'mmbaalh-13' });
    expect(next.room?.runs).toEqual([{ run: 1, gameName: 'mmbaalh-13' }]);
  });

  it('keeps the class and level already read when an event lists the members', () => {
    const next = applyStreamEvent(state, {
      type: 'room.member_changed',
      data: {
        roomId: 'room-1',
        change: 'confirmed',
        accountId: 'acc-2',
        members: [host, { ...guest, confirmed: true }],
      },
    });

    expect(next.room?.members.map((member) => [member.class, member.level, member.confirmed])).toEqual([
      ['sorceress', 91, false],
      ['barbarian', 84, true],
    ]);
  });

  it('adds the next run once, with nobody confirmed', () => {
    const opened: SiteStreamEvent = {
      type: 'room.run_opened',
      data: { roomId: 'room-1', run: 2, expectedGameName: 'mmbaalh-13', members: [host, guest] },
    };

    const once = applyStreamEvent(state, opened);
    const twice = applyStreamEvent(once, opened);

    expect(twice.room?.runs.map((run) => run.run)).toEqual([1, 2]);
    expect(twice.room).toMatchObject({ run: 2, gameName: 'mmbaalh-13' });
    expect(twice.room?.members.every((member) => !member.confirmed)).toBe(true);
  });

  it('ignores room events of another room', () => {
    const other = applyStreamEvent(state, {
      type: 'room.stage_changed',
      data: { roomId: 'room-9', stage: 'active', members: [host] },
    });

    expect(other).toBe(state);
  });

  it('clears the room only when the departure is the signed-in player', () => {
    const someoneElse = applyStreamEvent(state, {
      type: 'room.member_changed',
      data: { roomId: 'room-1', change: 'left', accountId: 'acc-1', members: [{ ...guest, role: 'host' }] },
    });
    const me = applyStreamEvent(state, {
      type: 'room.member_changed',
      data: { roomId: 'room-1', change: 'left', accountId: 'acc-2', members: [host] },
    });

    expect(someoneElse.room?.members.map((member) => member.role)).toEqual(['host']);
    expect(me.room).toBeNull();
  });
});
