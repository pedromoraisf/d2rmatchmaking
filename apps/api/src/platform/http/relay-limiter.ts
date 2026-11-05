// The relay's in-memory limiter (OBS-14, design § Relay route). Platform-local: `SlidingWindowLimit` is internal to the agents
// module (platform-uses-public-ports). Two separate maps, so one can never starve the other:
//   - principals (`agent:<id>`, `account:<id>`), keyed only after a successful authentication, capped at 50 000;
//   - addresses (credential-less and failed-authentication requests), capped at 10 000, with one overflow bucket.
// Both maps are swept every 30 s. A restart resets them (ADR 006).
import type { Cancel, Clock, Scheduler } from '../../shared-kernel/index.ts';

export type Admission =
  { readonly outcome: 'allowed' } | { readonly outcome: 'limited'; readonly retryAt: Date };

/** Credential-less arrivals an address may make in a minute before the relay answers `429` (AC 4). */
export const ADDRESS_LIMIT = 120;
export const ADDRESS_WINDOW_MS = 60 * 1000;
export const PRINCIPAL_CAP = 50_000;
export const ADDRESS_CAP = 10_000;
export const SWEEP_INTERVAL_MS = 30 * 1000;

const OVERFLOW_KEY = 'address-overflow';
const UNPARSEABLE_KEY = 'address-unparseable';

interface WindowEntry {
  times: number[];
  readonly windowMs: number;
}

export class RelayLimiter {
  readonly #clock: Clock;
  readonly #principals = new Map<string, WindowEntry>();
  readonly #addresses = new Map<string, WindowEntry>();

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  /**
   * Counts one arrival from an address. A new address beyond the cap falls into the shared overflow bucket, so one
   * address flood cannot grow the map without bound; the 121st arrival in a minute is refused.
   */
  arriveFromAddress(ip: string): Admission {
    let key = addressKeyOf(ip);
    if (!this.#addresses.has(key) && this.#addresses.size >= ADDRESS_CAP) {
      key = OVERFLOW_KEY;
    }
    return arrive(this.#addresses, key, this.#clock.now().getTime(), ADDRESS_LIMIT, ADDRESS_WINDOW_MS);
  }

  /** Counts one arrival of an authenticated principal. A new principal at the cap is refused; an existing one is not. */
  arriveAsPrincipal(key: string, limit: number, windowMs: number): Admission {
    const now = this.#clock.now().getTime();
    if (!this.#principals.has(key) && this.#principals.size >= PRINCIPAL_CAP) {
      return { outcome: 'limited', retryAt: new Date(now + windowMs) };
    }
    return arrive(this.#principals, key, now, limit, windowMs);
  }

  /** Drops every timestamp outside its window and every key left with none. */
  sweep(): void {
    const now = this.#clock.now().getTime();
    sweepMap(this.#principals, now);
    sweepMap(this.#addresses, now);
  }

  /** Sweeps every 30 s until the returned function is called. */
  watch(scheduler: Scheduler): Cancel {
    return scheduler.every(SWEEP_INTERVAL_MS, () => {
      this.sweep();
    });
  }

  keyCounts(): { readonly principals: number; readonly addresses: number } {
    return { principals: this.#principals.size, addresses: this.#addresses.size };
  }
}

/**
 * Records one arrival and answers. Refused arrivals are recorded too (a flood keeps its own window full). Limited when
 * the window holds more than `limit` arrivals, the new one included; the caller may retry at the instant the oldest
 * arrival that must leave the window does.
 */
function arrive(
  map: Map<string, WindowEntry>,
  key: string,
  nowMs: number,
  limit: number,
  windowMs: number,
): Admission {
  const entry: WindowEntry = map.get(key) ?? { times: [], windowMs };
  entry.times = entry.times.filter((time) => nowMs - time < windowMs);
  entry.times.push(nowMs);
  map.set(key, entry);
  if (entry.times.length <= limit) {
    return { outcome: 'allowed' };
  }
  const blocking = entry.times[entry.times.length - limit - 1] ?? nowMs;
  return { outcome: 'limited', retryAt: new Date(blocking + windowMs) };
}

function sweepMap(map: Map<string, WindowEntry>, nowMs: number): void {
  for (const [key, entry] of map) {
    entry.times = entry.times.filter((time) => nowMs - time < entry.windowMs);
    if (entry.times.length === 0) {
      map.delete(key);
    }
  }
}

// --- Address keys (copied from the agents module's `rateLimitKey`, not imported: that one is module-internal). The copy
// unwraps IPv4-mapped IPv6 (`::ffff:a.b.c.d`), which the original would key as one shared /64, and tightens the IPv4
// parse; an address that does not parse maps to one fixed bucket.

const IPV4_PART = /^\d{1,3}$/;
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
const HEX_GROUP = /^[0-9a-f]{1,4}$/i;

function ipv4Groups(address: string): string[] | null {
  const parts = address.split('.');
  if (parts.length !== 4 || !parts.every((part) => IPV4_PART.test(part))) {
    return null;
  }
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => octet > 255)) {
    return null;
  }
  const [a = 0, b = 0, c = 0, d = 0] = octets;
  return [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
}

function expandIPv6(address: string): number[] | null {
  const bare = address.split('%')[0] ?? address;
  let text = bare;
  let tailGroups: string[] = [];
  if (bare.includes('.')) {
    const lastColon = bare.lastIndexOf(':');
    const v4 = ipv4Groups(bare.slice(lastColon + 1));
    if (v4 === null) {
      return null;
    }
    tailGroups = v4;
    text = bare.slice(0, lastColon + 1);
  }
  const halves = text.split('::');
  if (halves.length > 2) {
    return null;
  }
  const head = (halves[0] ?? '').split(':').filter((group) => group !== '');
  const tail = (halves[1] ?? '').split(':').filter((group) => group !== '');
  const groups =
    halves.length === 2
      ? [...head, ...new Array<string>(8 - head.length - tail.length - tailGroups.length).fill('0'), ...tail]
      : head;
  const all = [...groups, ...tailGroups];
  if (all.length !== 8 || !all.every((group) => HEX_GROUP.test(group))) {
    return null;
  }
  return all.map((group) => parseInt(group, 16));
}

/**
 * The key an address's arrivals are counted under: an IPv4 address as given, an IPv4-mapped IPv6 address as its IPv4
 * string, any other IPv6 address by its /64 prefix, and every address that does not parse under one fixed key.
 */
export function addressKeyOf(ip: string): string {
  const mapped = IPV4_MAPPED.exec(ip);
  const text = mapped?.[1] ?? ip;
  if (!text.includes(':')) {
    return ipv4Groups(text) === null ? UNPARSEABLE_KEY : text;
  }
  const groups = expandIPv6(text);
  if (groups === null) {
    return UNPARSEABLE_KEY;
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':')}::/64`;
}
