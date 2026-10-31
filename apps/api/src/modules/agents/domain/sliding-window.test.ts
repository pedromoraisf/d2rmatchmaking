import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_CODE_SUBMISSIONS,
  IP_CODE_REQUESTS,
  rateLimitKey,
  SlidingWindowLimit,
} from './sliding-window.ts';

const T0 = new Date('2026-10-30T12:00:00.000Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;

function submissions(count: number, startMs: number, stepMs: number): Date[] {
  return Array.from({ length: count }, (_, i) => new Date(startMs + i * stepMs));
}

describe('SlidingWindowLimit', () => {
  it('allows the 10th submission in 5 minutes', () => {
    const timestamps = submissions(9, T0.getTime(), SECOND);

    const outcome = ACCOUNT_CODE_SUBMISSIONS.check(timestamps, new Date(T0.getTime() + 9 * SECOND));

    expect(outcome).toEqual({ outcome: 'allowed' });
  });

  it('limits the 11th submission until the oldest is 5 minutes old', () => {
    const timestamps = submissions(10, T0.getTime(), SECOND);
    const now = new Date(T0.getTime() + 10 * SECOND);

    const beforeRetry = ACCOUNT_CODE_SUBMISSIONS.check(timestamps, new Date(T0.getTime() + 5 * MINUTE - 1));
    const atRetry = ACCOUNT_CODE_SUBMISSIONS.check(timestamps, new Date(T0.getTime() + 5 * MINUTE));

    expect(ACCOUNT_CODE_SUBMISSIONS.check(timestamps, now)).toEqual({
      outcome: 'limited',
      retryAt: new Date(T0.getTime() + 5 * MINUTE),
    });
    expect(beforeRetry.outcome).toBe('limited');
    expect(atRetry).toEqual({ outcome: 'allowed' });
  });

  it('ignores submissions that left the window', () => {
    const timestamps = submissions(10, T0.getTime(), 0);

    expect(ACCOUNT_CODE_SUBMISSIONS.check(timestamps, new Date(T0.getTime() + 5 * MINUTE))).toEqual({
      outcome: 'allowed',
    });
  });

  it('uses 10 submissions per hour for the IP window', () => {
    expect(IP_CODE_REQUESTS.limit).toBe(10);
    expect(IP_CODE_REQUESTS.windowMs).toBe(60 * MINUTE);
    expect(new SlidingWindowLimit(1, SECOND).check([], T0)).toEqual({ outcome: 'allowed' });
  });
});

describe('rateLimitKey', () => {
  it('keys two IPv6 addresses in the same /64 to one key', () => {
    expect(rateLimitKey('2001:db8:1:2::1')).toBe(rateLimitKey('2001:db8:1:2:ffff:ffff:ffff:ffff'));
    expect(rateLimitKey('2001:0db8:0001:0002::1')).toBe(rateLimitKey('2001:db8:1:2::9'));
  });

  it('keys IPv6 addresses in different /64 prefixes to different keys', () => {
    expect(rateLimitKey('2001:db8:1:2::1')).not.toBe(rateLimitKey('2001:db8:1:3::1'));
  });

  it('keys an IPv4 address as itself', () => {
    expect(rateLimitKey('203.0.113.7')).toBe('203.0.113.7');
  });
});
