// The relay's egress budgets (OBS-14, design § Relay route and § Egress allowance). Per account: 60 requests a minute,
// 2 MiB a minute and 2 MiB a UTC day. Relay-wide: 4 MiB a minute and 16 MiB a UTC day. An agent counts as its account
// (the caller resolves it). Bytes are charged as they stream, refunded when a forward is dropped, and a refusal carries
// the Retry-After of the window it hit. The counters are in memory and reset on a restart (ADR 006).
import type { Clock } from '../../shared-kernel/index.ts';

const MIB = 1024 * 1024;
const MINUTE_MS = 60 * 1000;

export const ACCOUNT_REQUESTS_PER_MINUTE = 60;
export const ACCOUNT_BYTES_PER_MINUTE = 2 * MIB;
export const ACCOUNT_BYTES_PER_DAY = 2 * MIB;
export const RELAY_BYTES_PER_MINUTE = 4 * MIB;
export const RELAY_BYTES_PER_DAY = 16 * MIB;

export type BudgetVerdict =
  { readonly outcome: 'allowed' } | { readonly outcome: 'refused'; readonly retryAfterSeconds: number };

type Scope = 'minute' | 'day';

interface Entry {
  readonly at: number;
  amount: number;
}

/** A sliding minute or a UTC day of amounts (requests or bytes). */
class Tally {
  readonly #scope: Scope;
  #entries: Entry[] = [];

  constructor(scope: Scope) {
    this.#scope = scope;
  }

  total(now: number): number {
    this.#prune(now);
    return this.#entries.reduce((sum, entry) => sum + entry.amount, 0);
  }

  add(now: number, amount: number): void {
    this.#prune(now);
    this.#entries.push({ at: now, amount });
  }

  /** Takes `amount` back from the newest entries first. */
  drain(now: number, amount: number): void {
    this.#prune(now);
    let left = amount;
    for (let i = this.#entries.length - 1; i >= 0 && left > 0; i -= 1) {
      const entry = this.#entries[i];
      if (entry === undefined) {
        continue;
      }
      const taken = Math.min(entry.amount, left);
      entry.amount -= taken;
      left -= taken;
    }
  }

  /** Seconds until this window frees amount: a minute ends when its oldest entry leaves, a day at UTC midnight. */
  retryAfterSeconds(now: number): number {
    this.#prune(now);
    if (this.#scope === 'day') {
      return Math.max(1, Math.ceil((nextUtcMidnight(now) - now) / 1000));
    }
    const oldest = this.#entries[0];
    if (oldest === undefined) {
      return 1;
    }
    return Math.max(1, Math.ceil((oldest.at + MINUTE_MS - now) / 1000));
  }

  #prune(now: number): void {
    this.#entries = this.#entries.filter((entry) =>
      this.#scope === 'minute' ? now - entry.at < MINUTE_MS : utcDay(entry.at) === utcDay(now),
    );
  }
}

interface AccountBudget {
  readonly requests: Tally;
  readonly minuteBytes: Tally;
  readonly dayBytes: Tally;
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function nextUtcMidnight(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

export class RelayBudget {
  readonly #clock: Clock;
  readonly #accounts = new Map<string, AccountBudget>();
  readonly #relayMinuteBytes = new Tally('minute');
  readonly #relayDayBytes = new Tally('day');

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  /** Counts one request of the account. Refused when the account is out of requests or any byte budget is spent. */
  admit(accountId: string): BudgetVerdict {
    const now = this.#clock.now().getTime();
    const account = this.#account(accountId);
    const checks: Array<[Tally, number]> = [
      [account.requests, ACCOUNT_REQUESTS_PER_MINUTE],
      [account.minuteBytes, ACCOUNT_BYTES_PER_MINUTE],
      [account.dayBytes, ACCOUNT_BYTES_PER_DAY],
      [this.#relayMinuteBytes, RELAY_BYTES_PER_MINUTE],
      [this.#relayDayBytes, RELAY_BYTES_PER_DAY],
    ];
    for (const [tally, limit] of checks) {
      if (tally.total(now) >= limit) {
        return { outcome: 'refused', retryAfterSeconds: tally.retryAfterSeconds(now) };
      }
    }
    account.requests.add(now, 1);
    return { outcome: 'allowed' };
  }

  /** Charges streamed bytes to the account and the relay. Refused, with nothing charged, when one would exceed a budget. */
  charge(accountId: string, bytes: number): BudgetVerdict {
    const now = this.#clock.now().getTime();
    const account = this.#account(accountId);
    const checks: Array<[Tally, number]> = [
      [account.minuteBytes, ACCOUNT_BYTES_PER_MINUTE],
      [account.dayBytes, ACCOUNT_BYTES_PER_DAY],
      [this.#relayMinuteBytes, RELAY_BYTES_PER_MINUTE],
      [this.#relayDayBytes, RELAY_BYTES_PER_DAY],
    ];
    for (const [tally, limit] of checks) {
      if (tally.total(now) + bytes > limit) {
        return { outcome: 'refused', retryAfterSeconds: tally.retryAfterSeconds(now) };
      }
    }
    account.minuteBytes.add(now, bytes);
    account.dayBytes.add(now, bytes);
    this.#relayMinuteBytes.add(now, bytes);
    this.#relayDayBytes.add(now, bytes);
    return { outcome: 'allowed' };
  }

  /** Returns bytes charged for a request that was refused later or a forward that was dropped. */
  refund(accountId: string, bytes: number): void {
    const now = this.#clock.now().getTime();
    const account = this.#account(accountId);
    account.minuteBytes.drain(now, bytes);
    account.dayBytes.drain(now, bytes);
    this.#relayMinuteBytes.drain(now, bytes);
    this.#relayDayBytes.drain(now, bytes);
  }

  #account(accountId: string): AccountBudget {
    let account = this.#accounts.get(accountId);
    if (account === undefined) {
      account = {
        requests: new Tally('minute'),
        minuteBytes: new Tally('minute'),
        dayBytes: new Tally('day'),
      };
      this.#accounts.set(accountId, account);
    }
    return account;
  }
}
