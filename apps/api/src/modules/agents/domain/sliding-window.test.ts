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

describe('SlidingWindowLimit reads the window in time order', () => {
  it('blocks from the oldest in-window submission whatever the order the timestamps come in', () => {
    const limit = new SlidingWindowLimit(2, 5 * MINUTE);
    const ordered = [T0, new Date(T0.getTime() + 2 * MINUTE)];
    const reversed = [ordered[1] as Date, ordered[0] as Date];
    const now = new Date(T0.getTime() + 3 * MINUTE);

    expect(limit.check(reversed, now)).toEqual(limit.check(ordered, now));
    expect(limit.check(reversed, now)).toEqual({
      outcome: 'limited',
      retryAt: new Date(T0.getTime() + 5 * MINUTE),
    });
  });
});

describe('rateLimitKey for IPv6, zones and malformed addresses', () => {
  it('keys the expanded and the compressed form of one address the same', () => {
    expect(rateLimitKey('2001:0db8:0000:0001:0000:0000:0000:0001')).toBe('2001:db8:0:1::/64');
    expect(rateLimitKey('2001:0db8:0000:0001:0000:0000:0000:0001')).toBe(rateLimitKey('2001:db8:0:1::1'));
  });

  it('keys the loopback address under the zero /64 prefix', () => {
    expect(rateLimitKey('::1')).toBe('0:0:0:0::/64');
    expect(rateLimitKey('::')).toBe('0:0:0:0::/64');
  });

  it('ignores the zone identifier of a link-local address', () => {
    expect(rateLimitKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(rateLimitKey('fe80::1%eth0')).toBe(rateLimitKey('fe80::1'));
  });

  it('keys the first four groups of a trailing-:: address', () => {
    expect(rateLimitKey('1:2:3:4:5:6:7::')).toBe('1:2:3:4::/64');
  });

  it('keys every IPv4-mapped address under one prefix, since the /64 rule applies to them too', () => {
    expect(rateLimitKey('::ffff:203.0.113.7')).toBe(rateLimitKey('::ffff:198.51.100.9'));
  });

  it('keys an address that does not parse exactly as given', () => {
    for (const raw of [
      '2001:db8::zz',
      '1:2:3::4::5',
      '1:2:3:4:5:6:7:8:9',
      '::ffff:300.1.1.1',
      '::ffff:1.2.3',
    ]) {
      expect(rateLimitKey(raw)).toBe(raw);
    }
  });
});

describe('rateLimitKey requires every hex group to be exactly hex', () => {
  it('keys an address with a non-hex letter before a hex run as given', () => {
    expect(rateLimitKey('2001:db8:zz1:2::1')).toBe('2001:db8:zz1:2::1');
  });

  it('keys an address with a non-hex letter after a hex run as given', () => {
    expect(rateLimitKey('2001:db8:1zz:2::1')).toBe('2001:db8:1zz:2::1');
  });
});

describe('rateLimitKey checks each IPv4 octet of a mapped address', () => {
  it('keys an address whose octet is above 255 as given', () => {
    expect(rateLimitKey('::ffff:1.256.2.3')).toBe('::ffff:1.256.2.3');
  });

  it('keys an address whose octet is not a number as given', () => {
    expect(rateLimitKey('::ffff:x.1.2.3')).toBe('::ffff:x.1.2.3');
  });

  it('keys an address whose octet is negative as given', () => {
    expect(rateLimitKey('::ffff:-16777215.1.0.0')).toBe('::ffff:-16777215.1.0.0');
  });

  it('accepts 255 as an octet', () => {
    expect(rateLimitKey('::ffff:255.255.0.1')).toBe('0:0:0:0::/64');
  });
});

describe('rateLimitKey reads the dotted tail of an IPv6 address', () => {
  it('keys an IPv4-mapped address by the /64 of its leading groups', () => {
    expect(rateLimitKey('::ffff:203.0.113.7')).toBe('0:0:0:0::/64');
  });

  it('keeps the groups in front of a dotted tail and keys the address by them', () => {
    expect(rateLimitKey('1:2:3:4:5:6:1.2.3.4')).toBe('1:2:3:4::/64');
  });
});

describe('rateLimitKey refuses an address with two ::', () => {
  it('keys an address with eight groups and a second :: as given', () => {
    expect(rateLimitKey('1:2:3:4:5:6:7:8::9::')).toBe('1:2:3:4:5:6:7:8::9::');
  });
});
