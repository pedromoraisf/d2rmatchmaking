/** Outcome of checking one more submission against a window. */
export type WindowOutcome =
  { readonly outcome: 'allowed' } | { readonly outcome: 'limited'; readonly retryAt: Date };

const MS_PER_MINUTE = 60 * 1000;

/**
 * At most `limit` submissions in any `windowMs` span. A submission is in the window while `now - t < windowMs`, so a
 * limited caller is allowed again at exactly `oldest in-window submission + windowMs`. The caller records the
 * timestamps of the submissions it allowed.
 */
export class SlidingWindowLimit {
  readonly limit: number;
  readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  check(timestamps: readonly Date[], now: Date): WindowOutcome {
    const nowMs = now.getTime();
    const inWindow = timestamps
      .map((t) => t.getTime())
      .filter((t) => nowMs - t < this.windowMs)
      .sort((a, b) => a - b);
    if (inWindow.length < this.limit) {
      return { outcome: 'allowed' };
    }
    // The submission that must leave the window before one more is allowed.
    const blocking = inWindow[inWindow.length - this.limit] ?? nowMs;
    return { outcome: 'limited', retryAt: new Date(blocking + this.windowMs) };
  }
}

/** Account pairing-code submissions: 10 per 5 minutes (AD-032). */
export const ACCOUNT_CODE_SUBMISSIONS = new SlidingWindowLimit(10, 5 * MS_PER_MINUTE);

/** Pairing-code requests per IP: 10 per hour (AD-041). */
export const IP_CODE_REQUESTS = new SlidingWindowLimit(10, 60 * MS_PER_MINUTE);

const HEX_GROUP = /^[0-9a-f]{1,4}$/i;

function ipv4ToGroups(address: string): string[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) {
    return null;
  }
  const octets = parts.map((p) => Number(p));
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
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
    const v4 = ipv4ToGroups(bare.slice(lastColon + 1));
    if (v4 === null) {
      return null;
    }
    tailGroups = v4;
    text = `${bare.slice(0, lastColon + 1)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) {
    return null;
  }
  const head = (halves[0] ?? '').split(':').filter((g) => g !== '');
  const tail = (halves[1] ?? '').split(':').filter((g) => g !== '');
  const groups =
    halves.length === 2
      ? [...head, ...new Array<string>(8 - head.length - tail.length - tailGroups.length).fill('0'), ...tail]
      : head;
  const all = [...groups, ...tailGroups];
  if (all.length !== 8 || !all.every((g) => HEX_GROUP.test(g))) {
    return null;
  }
  return all.map((g) => parseInt(g, 16));
}

/**
 * The key a client's submissions are counted under. An IPv6 address is keyed by its /64 prefix, so one household
 * cannot evade the limit by rotating addresses inside its prefix. Anything that does not parse is keyed as given.
 */
export function rateLimitKey(ip: string): string {
  if (!ip.includes(':')) {
    return ip;
  }
  const groups = expandIPv6(ip);
  if (groups === null) {
    return ip;
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`;
}
