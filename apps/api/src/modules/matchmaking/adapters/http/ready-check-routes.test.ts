import { describe, expect, it } from 'vitest';
import { readyCheckRefusalStatus, readyCheckViewOf } from './ready-check-routes.ts';

describe('readyCheckRefusalStatus (RDY-06)', () => {
  it('answers 404 for a player who is not in the check', () => {
    expect(readyCheckRefusalStatus('not-found')).toBe(404);
  });

  it('answers 409 for a check that ended', () => {
    expect(readyCheckRefusalStatus('ready-check-ended')).toBe(409);
  });

  it('answers 409 for an answer already given', () => {
    expect(readyCheckRefusalStatus('already-answered')).toBe(409);
  });
});

describe('readyCheckViewOf (RDY-11)', () => {
  const payload = {
    readyCheckId: 'rc-1',
    mode: 'pvp' as const,
    difficulty: 'hell' as const,
    deadline: '2026-11-10T12:01:00.000Z',
    members: [
      { accountId: 'alice', position: 1, characterClass: 'sorceress' as const, level: 91, accepted: true },
      { accountId: 'bob', position: 2, characterClass: 'barbarian' as const, level: 84, accepted: false },
    ],
  };

  it('marks the caller as you and carries no account id', () => {
    const view = readyCheckViewOf(payload, 'bob');
    expect(view.members.map((member) => member.you)).toStrictEqual([false, true]);
    expect(JSON.stringify(view)).not.toMatch(/alice|bob/u);
    expect(view.members[0]).toStrictEqual({
      position: 1,
      class: 'sorceress',
      level: 91,
      accepted: true,
      you: false,
    });
  });
});
