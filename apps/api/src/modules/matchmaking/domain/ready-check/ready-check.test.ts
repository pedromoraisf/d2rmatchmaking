import { describe, expect, it } from 'vitest';
import type { FormedGroup } from '../matcher.ts';
import type { PvpTicket, QueueTicket } from '../queue-ticket/queue-ticket.ts';
import {
  READY_CHECK_MS,
  accept,
  decline,
  expire,
  isOpenAt,
  openReadyCheck,
  rejoinQueue,
  unansweredOf,
  type ReadyCheck,
} from './ready-check.ts';

const OPENED = new Date('2026-11-10T12:10:00.000Z');
const at = (ms: number) => new Date(OPENED.getTime() + ms);
const SECOND = 1000;

function ticket(id: string, joinedAt: Date): PvpTicket {
  return {
    id,
    accountId: `acc-${id}`,
    characterId: `char-${id}`,
    characterClass: 'sorceress',
    mode: 'pvp',
    region: 'americas',
    difficulty: 'hell',
    ladder: 'sc-ladder',
    era: 'rotw',
    rating: 1500,
    level: 90,
    joinedAt,
    pvp: { format: 'duel', rules: 'gm' },
  };
}

function groupOf(members: readonly QueueTicket[]): FormedGroup {
  return {
    mode: 'pvp',
    activity: 'pvp',
    region: 'americas',
    difficulty: 'hell',
    ladder: 'sc-ladder',
    era: 'rotw',
    members,
    hostTicketId: members[0]?.id ?? '',
    teams: null,
  };
}

/** Alice and Bob, who joined at 0 and 1 seconds. */
const alice = ticket('alice', at(0));
const bob = ticket('bob', at(1 * SECOND));
const cara = ticket('cara', at(5 * SECOND));

function openedWith(members: readonly QueueTicket[]): ReadyCheck {
  return openReadyCheck('rc-1', groupOf(members), OPENED);
}

function unwrap(result: { ok: true; value: ReadyCheck } | { ok: false; error: string }): ReadyCheck {
  if (!result.ok) {
    throw new Error(`expected an answer, got ${result.error}`);
  }
  return result.value;
}

describe('openReadyCheck (RDY-01)', () => {
  it('opens with a deadline 60 seconds after it opened', () => {
    const check = openedWith([alice, bob]);
    expect(READY_CHECK_MS).toBe(60 * SECOND);
    expect(check.deadline.getTime()).toBe(OPENED.getTime() + 60 * SECOND);
    expect(check.accepted).toStrictEqual([]);
    expect(check.outcome).toBeNull();
  });

  it('is open before the deadline and not at it', () => {
    const check = openedWith([alice, bob]);
    expect(isOpenAt(check, at(59_999))).toBe(true);
    expect(isOpenAt(check, at(60_000))).toBe(false);
  });
});

describe('accept (RDY-02, RDY-03, RDY-06)', () => {
  it('records one acceptance and keeps the check open', () => {
    const check = unwrap(accept(openedWith([alice, bob]), 'acc-alice', at(10 * SECOND)));
    expect(check.accepted).toStrictEqual(['acc-alice']);
    expect(check.outcome).toBeNull();
  });

  it('accepts the check when every member has accepted (RDY-03)', () => {
    const first = unwrap(accept(openedWith([alice, bob]), 'acc-alice', at(10 * SECOND)));
    const second = unwrap(accept(first, 'acc-bob', at(20 * SECOND)));
    expect(second.outcome).toBe('accepted');
  });

  it('accepts at 59.999 seconds and refuses at 60.000 (RDY-05 boundary)', () => {
    const late = openedWith([alice, bob]);
    expect(accept(late, 'acc-alice', at(59_999)).ok).toBe(true);
    expect(accept(late, 'acc-alice', at(60_000))).toStrictEqual({ ok: false, error: 'ready-check-ended' });
  });

  it('refuses a repeated acceptance and changes nothing (RDY-06)', () => {
    const first = unwrap(accept(openedWith([alice, bob]), 'acc-alice', at(10 * SECOND)));
    expect(accept(first, 'acc-alice', at(11 * SECOND))).toStrictEqual({
      ok: false,
      error: 'already-answered',
    });
  });

  it('refuses a player who is not in the check (RDY-06)', () => {
    expect(accept(openedWith([alice, bob]), 'acc-cara', at(10 * SECOND))).toStrictEqual({
      ok: false,
      error: 'not-found',
    });
  });

  it('refuses an answer to a check that already ended as accepted (RDY-06)', () => {
    const first = unwrap(accept(openedWith([alice, bob]), 'acc-alice', at(10 * SECOND)));
    const done = unwrap(accept(first, 'acc-bob', at(20 * SECOND)));
    expect(accept(done, 'acc-bob', at(21 * SECOND))).toStrictEqual({ ok: false, error: 'ready-check-ended' });
  });
});

describe('decline (RDY-04)', () => {
  it('ends the check at once as declined', () => {
    const check = unwrap(decline(openedWith([alice, bob]), 'acc-bob', at(3 * SECOND)));
    expect(check.outcome).toBe('declined');
  });

  it('refuses a decline from a member who already accepted (RDY-06)', () => {
    const accepted = unwrap(accept(openedWith([alice, bob]), 'acc-bob', at(3 * SECOND)));
    expect(decline(accepted, 'acc-bob', at(4 * SECOND))).toStrictEqual({
      ok: false,
      error: 'already-answered',
    });
  });

  it('refuses a decline after the check ended', () => {
    const check = unwrap(decline(openedWith([alice, bob]), 'acc-bob', at(3 * SECOND)));
    expect(decline(check, 'acc-alice', at(4 * SECOND))).toStrictEqual({
      ok: false,
      error: 'ready-check-ended',
    });
  });

  it('refuses a decline from a player who is not in the check', () => {
    expect(decline(openedWith([alice, bob]), 'acc-cara', at(3 * SECOND))).toStrictEqual({
      ok: false,
      error: 'not-found',
    });
  });
});

describe('expire (RDY-05)', () => {
  it('leaves a check that is not due unchanged', () => {
    const check = openedWith([alice, bob]);
    expect(expire(check, at(59_999))).toBe(check);
  });

  it('ends a due check as timed out at the deadline', () => {
    const check = expire(openedWith([alice, bob]), at(60_000));
    expect(check.outcome).toBe('timed-out');
  });

  it('leaves an accepted check alone when the deadline passes', () => {
    const accepted = unwrap(accept(openedWith([alice, bob]), 'acc-alice', at(SECOND)));
    const done = unwrap(accept(accepted, 'acc-bob', at(2 * SECOND)));
    expect(expire(done, at(60_000))).toBe(done);
  });

  it('counts a member who neither accepted nor answered as not answering', () => {
    const accepted = unwrap(accept(openedWith([alice, bob, cara]), 'acc-alice', at(SECOND)));
    const timedOut = expire(accepted, at(60_000));
    expect(unansweredOf(timedOut).map((member) => member.accountId)).toStrictEqual(['acc-bob', 'acc-cara']);
  });
});

describe('rejoinQueue (RDY-04, RDY-05, INV-05)', () => {
  it('returns the accepted members ahead of a ticket that joined after them', () => {
    const accepted = unwrap(accept(openedWith([alice, bob]), 'acc-alice', at(5 * SECOND)));
    const declined = unwrap(decline(accepted, 'acc-bob', at(6 * SECOND)));
    const back = rejoinQueue([cara], declined);
    expect(back.map((member) => member.id)).toStrictEqual(['alice', 'cara']);
  });

  it('keeps the original join instant of the returning member', () => {
    const accepted = unwrap(accept(openedWith([alice, bob]), 'acc-alice', at(5 * SECOND)));
    const timedOut = expire(accepted, at(60_000));
    const back = rejoinQueue([cara], timedOut);
    expect(back[0]?.joinedAt).toStrictEqual(alice.joinedAt);
  });

  it('returns nobody when no member accepted', () => {
    const declined = unwrap(decline(openedWith([alice, bob]), 'acc-bob', at(3 * SECOND)));
    expect(rejoinQueue([cara], declined)).toStrictEqual([cara]);
  });
});
