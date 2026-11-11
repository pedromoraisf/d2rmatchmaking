// The production providers of the shared-kernel ports (design.md § Shared kernel additions): the wall clock, node:crypto
// randomness and random UUIDs. Only the composition roots use them; domain and application code see the ports.
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Cancel, Clock, IdGenerator, RandomSource, Scheduler } from '../shared-kernel/index.ts';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class NodeRandomSource implements RandomSource {
  int(maxExclusive: number): number {
    return randomInt(maxExclusive);
  }

  bytes(n: number): Uint8Array {
    return randomBytes(n);
  }
}

export class RandomUuidGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}

/** How often the timers compare their instant with the clock. */
const POLL_MS = 100;

interface ClockTimer {
  due: number;
  /** Set for `every`: the timer re-arms after each run. */
  readonly interval: number | undefined;
  readonly fn: () => void;
}

/**
 * The next due instant of a repeating timer that ran at `now`: one interval after the last due instant, or one interval
 * from now when the clock jumped past more than a whole interval (one run per jump, never a burst).
 */
export function nextDue(due: number, interval: number, now: number): number {
  const next = due + interval;
  return next > now ? next : now + interval;
}

/**
 * The production scheduler (design.md § Composition roots): `every` and `at` both follow the injected clock, not a
 * timer of their own. In production the clock is the wall clock, so they fire on time. In the acceptance stack the clock
 * moves only when a step moves it (AD-045), so the matcher and the sweeps tick when a scenario passes time, never in the
 * middle of a step: a ready check's decliner is back in the queue and must be seen there, not already matched (RDY-04).
 */
export class ClockScheduler implements Scheduler {
  readonly #clock: Clock;
  readonly #pending = new Set<ClockTimer>();
  #poll: ReturnType<typeof setInterval> | undefined;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  every(ms: number, fn: () => void): Cancel {
    if (!(ms > 0)) {
      throw new RangeError('every needs a positive interval');
    }
    return this.#add({ due: this.#clock.now().getTime() + ms, interval: ms, fn });
  }

  at(time: Date, fn: () => void): Cancel {
    return this.#add({ due: time.getTime(), interval: undefined, fn });
  }

  #add(timer: ClockTimer): Cancel {
    this.#pending.add(timer);
    this.#poll ??= setInterval(() => {
      this.#tick();
    }, POLL_MS);
    return () => {
      this.#pending.delete(timer);
      this.#stopWhenIdle();
    };
  }

  #tick(): void {
    const now = this.#clock.now().getTime();
    for (const timer of [...this.#pending]) {
      if (timer.due > now || !this.#pending.has(timer)) {
        continue;
      }
      if (timer.interval === undefined) {
        this.#pending.delete(timer);
      } else {
        timer.due = nextDue(timer.due, timer.interval, now);
      }
      timer.fn();
    }
    this.#stopWhenIdle();
  }

  #stopWhenIdle(): void {
    if (this.#pending.size === 0 && this.#poll !== undefined) {
      clearInterval(this.#poll);
      this.#poll = undefined;
    }
  }
}
