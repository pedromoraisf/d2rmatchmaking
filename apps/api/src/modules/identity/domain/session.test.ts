import { describe, expect, it } from 'vitest';
import { Session } from './session.ts';

const NOW = new Date('2026-10-30T12:00:00.000Z');
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

describe('Session', () => {
  it('opens a session that expires 7 days after now', () => {
    const session = Session.open('account-1', NOW);

    expect(session.accountId).toBe('account-1');
    expect(session.expiresAt.getTime()).toBe(NOW.getTime() + SEVEN_DAYS_MS);
  });

  it('expires at exactly 7 days', () => {
    const session = Session.open('account-1', NOW);

    expect(session.isValidAt(new Date(NOW.getTime() + SEVEN_DAYS_MS - 1))).toBe(true);
    expect(session.isValidAt(new Date(NOW.getTime() + SEVEN_DAYS_MS))).toBe(false);
  });

  it('does not change when the opening date is mutated afterwards', () => {
    const now = new Date(NOW.getTime());
    const session = Session.open('account-1', now);

    now.setTime(0);

    expect(session.expiresAt.getTime()).toBe(NOW.getTime() + SEVEN_DAYS_MS);
  });
});
