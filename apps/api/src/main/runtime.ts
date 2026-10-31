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

/** How often the `at` timers compare their instant with the clock. */
const AT_POLL_MS = 100;

/**
 * The production scheduler (design.md § Composition roots): `every` runs on a timer, and `at` fires once the injected
 * clock reaches its instant. Reading the clock, not the timer, makes `at` follow the controllable clock of the
 * acceptance stack too (AD-045).
 */
export class ClockScheduler implements Scheduler {
  readonly #clock: Clock;
  readonly #pending = new Set<{ readonly due: number; readonly fn: () => void }>();
  #poll: ReturnType<typeof setInterval> | undefined;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  every(ms: number, fn: () => void): Cancel {
    if (!(ms > 0)) {
      throw new RangeError('every needs a positive interval');
    }
    const handle = setInterval(fn, ms);
    return () => {
      clearInterval(handle);
    };
  }

  at(time: Date, fn: () => void): Cancel {
    const timer = { due: time.getTime(), fn };
    this.#pending.add(timer);
    this.#poll ??= setInterval(() => {
      this.#tick();
    }, AT_POLL_MS);
    return () => {
      this.#pending.delete(timer);
    };
  }

  #tick(): void {
    const now = this.#clock.now().getTime();
    for (const timer of [...this.#pending]) {
      if (timer.due <= now) {
        this.#pending.delete(timer);
        timer.fn();
      }
    }
    if (this.#pending.size === 0 && this.#poll !== undefined) {
      clearInterval(this.#poll);
      this.#poll = undefined;
    }
  }
}
