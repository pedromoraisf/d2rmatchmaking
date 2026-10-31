import type { FakeClock } from './clock.ts';

/** Stops a scheduled callback. Calling it again does nothing. */
export type Cancel = () => void;

/** Port for running callbacks later. The production implementation lives in main/ (timers); tests use FakeScheduler. */
export interface Scheduler {
  /** Calls `fn` every `ms` milliseconds until cancelled. */
  every(ms: number, fn: () => void): Cancel;
  /** Calls `fn` once, when the clock reaches `time`. */
  at(time: Date, fn: () => void): Cancel;
}

interface Timer {
  due: number;
  readonly interval: number | undefined;
  readonly fn: () => void;
}

/**
 * Test double driven by FakeClock: callbacks run only when the test moves the clock (`clock.advance`, `clock.set`).
 * Every occurrence that is due by the new instant runs, in due order; a callback sees the clock at the new instant.
 */
export class FakeScheduler implements Scheduler {
  readonly #clock: FakeClock;
  readonly #timers = new Set<Timer>();

  constructor(clock: FakeClock) {
    this.#clock = clock;
    clock.onMove(() => {
      this.#runDue();
    });
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

  #add(timer: Timer): Cancel {
    this.#timers.add(timer);
    return () => {
      this.#timers.delete(timer);
    };
  }

  #runDue(): void {
    const now = this.#clock.now().getTime();
    for (;;) {
      let next: Timer | undefined;
      for (const timer of this.#timers) {
        if (timer.due <= now && (next === undefined || timer.due < next.due)) {
          next = timer;
        }
      }
      if (next === undefined) {
        return;
      }
      if (next.interval === undefined) {
        this.#timers.delete(next);
      } else {
        next.due += next.interval;
      }
      next.fn();
    }
  }
}
