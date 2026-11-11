import { describe, expect, it } from 'vitest';
import { ReadyCheckAnswerRefusal, ReadyCheckResolved, ReadyCheckView } from './ready-checks.ts';

const view = {
  id: 'rc-1',
  mode: 'pvp',
  difficulty: 'hell',
  deadline: '2026-11-10T12:01:00.000Z',
  now: '2026-11-10T12:00:00.000Z',
  members: [
    { position: 1, class: 'sorceress', level: 91, accepted: true, you: true },
    { position: 2, class: 'barbarian', level: 84, accepted: false, you: false },
  ],
};

describe('ReadyCheckView', () => {
  it('accepts an open check with its members by position', () => {
    expect(ReadyCheckView.parse(view)).toStrictEqual(view);
  });

  it('rejects a check with a single member', () => {
    expect(ReadyCheckView.safeParse({ ...view, members: [view.members[0]] }).success).toBe(false);
  });

  it('rejects a member whose class is not a character class', () => {
    const members = [{ ...view.members[0], class: 'paladinn' }, view.members[1]];
    expect(ReadyCheckView.safeParse({ ...view, members }).success).toBe(false);
  });

  it('rejects a member level outside 1 to 99', () => {
    const members = [{ ...view.members[0], level: 100 }, view.members[1]];
    expect(ReadyCheckView.safeParse({ ...view, members }).success).toBe(false);
  });

  it('requires the server time the countdown starts from', () => {
    const withoutNow = Object.fromEntries(Object.entries(view).filter(([key]) => key !== 'now'));
    expect(ReadyCheckView.safeParse(withoutNow).success).toBe(false);
  });

  it('rejects a deadline that is not an ISO instant', () => {
    expect(ReadyCheckView.safeParse({ ...view, deadline: 'soon' }).success).toBe(false);
  });
});

describe('ReadyCheckResolved', () => {
  it.each(['accepted', 'declined', 'timed-out'])('accepts the outcome %s', (outcome) => {
    expect(ReadyCheckResolved.parse({ id: 'rc-1', outcome })).toStrictEqual({ id: 'rc-1', outcome });
  });

  it('rejects an unknown outcome', () => {
    expect(ReadyCheckResolved.safeParse({ id: 'rc-1', outcome: 'expired' }).success).toBe(false);
  });
});

describe('ReadyCheckAnswerRefusal', () => {
  it.each(['ready-check-ended', 'already-answered', 'not-found'])('accepts the refusal %s', (error) => {
    expect(ReadyCheckAnswerRefusal.parse({ error })).toStrictEqual({ error });
  });

  it('rejects an unknown refusal', () => {
    expect(ReadyCheckAnswerRefusal.safeParse({ error: 'bored' }).success).toBe(false);
  });
});
