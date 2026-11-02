// The relay limiter (OBS-14): sliding windows in two separate maps, caps with an overflow bucket, one bucket for unparseable
// addresses, IPv4-mapped IPv6 unwrapped to IPv4, and a sweep every 30 s.
import { describe, expect, it } from 'vitest';
import { FakeClock, FakeScheduler } from '../../shared-kernel/index.ts';
import { RelayLimiter, addressKeyOf } from './relay-limiter.ts';

const START = new Date('2026-11-02T12:00:00.000Z');
const MINUTE = 60 * 1000;

function setup() {
  const clock = new FakeClock(START);
  return { clock, limiter: new RelayLimiter(clock) };
}

describe('RelayLimiter', () => {
  it('counts credential-less requests per address and refuses the 121st', () => {
    const { limiter, clock } = setup();

    for (let i = 0; i < 120; i += 1) {
      expect(limiter.arriveFromAddress('203.0.113.7')).toEqual({ outcome: 'allowed' });
    }
    expect(limiter.arriveFromAddress('203.0.113.7')).toMatchObject({ outcome: 'limited' });
    expect(limiter.arriveFromAddress('203.0.113.8')).toEqual({ outcome: 'allowed' });
    clock.advance(MINUTE);
    expect(limiter.arriveFromAddress('203.0.113.7')).toEqual({ outcome: 'allowed' });
  });

  it('an address cap overflow never blocks a principal', () => {
    const { limiter } = setup();
    for (let i = 0; i < 10_000; i += 1) {
      limiter.arriveFromAddress(`10.0.${Math.floor(i / 256)}.${i % 256}`);
    }
    expect(limiter.keyCounts().addresses).toBe(10_000);

    // A new address now falls into the one shared overflow bucket: 120 a minute, the 121st is refused.
    for (let i = 0; i < 120; i += 1) {
      expect(limiter.arriveFromAddress(`192.0.2.${i}`)).toEqual({ outcome: 'allowed' });
    }
    expect(limiter.arriveFromAddress('192.0.2.200')).toMatchObject({ outcome: 'limited' });

    // The principal map has its own cap and is untouched by the address overflow.
    expect(limiter.arriveAsPrincipal('agent:agent-1', 60, MINUTE)).toEqual({ outcome: 'allowed' });
  });

  it('an unparseable address uses one bucket', () => {
    const { limiter } = setup();
    for (let i = 0; i < 60; i += 1) {
      expect(limiter.arriveFromAddress('garbage-a')).toEqual({ outcome: 'allowed' });
    }
    for (let i = 0; i < 60; i += 1) {
      expect(limiter.arriveFromAddress('garbage-b')).toEqual({ outcome: 'allowed' });
    }

    expect(limiter.arriveFromAddress('garbage-c')).toMatchObject({ outcome: 'limited' });
    expect(limiter.keyCounts().addresses).toBe(1);
  });

  it('an IPv4-mapped IPv6 address keys as IPv4', () => {
    const { limiter } = setup();
    for (let i = 0; i < 60; i += 1) {
      limiter.arriveFromAddress('::ffff:203.0.113.7');
    }
    for (let i = 0; i < 60; i += 1) {
      limiter.arriveFromAddress('203.0.113.7');
    }

    expect(limiter.arriveFromAddress('::FFFF:203.0.113.7')).toMatchObject({ outcome: 'limited' });
    expect(addressKeyOf('::ffff:198.51.100.1')).toBe('198.51.100.1');
    expect(addressKeyOf('::ffff:198.51.100.1')).not.toBe(addressKeyOf('::ffff:198.51.100.2'));
  });

  it('sweeps expired keys', () => {
    const { limiter, clock } = setup();
    const scheduler = new FakeScheduler(clock);
    limiter.watch(scheduler);
    limiter.arriveFromAddress('203.0.113.7');
    limiter.arriveAsPrincipal('agent:agent-1', 60, MINUTE);
    expect(limiter.keyCounts()).toEqual({ principals: 1, addresses: 1 });

    clock.advance(61 * 1000);

    expect(limiter.keyCounts()).toEqual({ principals: 0, addresses: 0 });
  });

  it('refuses a new principal at the cap and still counts an existing one', () => {
    const { limiter } = setup();
    for (let i = 0; i < 60; i += 1) {
      limiter.arriveAsPrincipal('account:account-1', 60, MINUTE);
    }
    expect(limiter.arriveAsPrincipal('account:account-1', 60, MINUTE)).toMatchObject({ outcome: 'limited' });

    for (let i = 0; i < 50_000 - 1; i += 1) {
      limiter.arriveAsPrincipal(`account:fill-${i}`, 60, MINUTE);
    }
    expect(limiter.keyCounts().principals).toBe(50_000);
    expect(limiter.arriveAsPrincipal('account:new', 60, MINUTE)).toMatchObject({ outcome: 'limited' });
    expect(limiter.arriveAsPrincipal('account:fill-0', 60, MINUTE)).toEqual({ outcome: 'allowed' });
  });
});

describe('addressKeyOf', () => {
  it('keys an IPv6 address by its /64 prefix and leaves IPv4 as given', () => {
    expect(addressKeyOf('2001:db8:1:2::1')).toBe(addressKeyOf('2001:db8:1:2:ffff:ffff:ffff:ffff'));
    expect(addressKeyOf('2001:db8:1:2::1')).not.toBe(addressKeyOf('2001:db8:1:3::1'));
    expect(addressKeyOf('203.0.113.7')).toBe('203.0.113.7');
  });

  it('maps every malformed address to the same fixed key', () => {
    expect(addressKeyOf('not-an-ip')).toBe(addressKeyOf('256.1.1.1'));
    expect(addressKeyOf('1..2.3')).toBe(addressKeyOf('x'));
  });
});
