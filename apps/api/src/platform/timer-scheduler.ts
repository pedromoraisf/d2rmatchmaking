import type { Cancel, Scheduler } from '../shared-kernel/index.ts';

/** The production Scheduler, on the Node timers. Tests use FakeScheduler (driven by FakeClock) or Vitest fake timers. */
export class TimerScheduler implements Scheduler {
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
    const handle = setTimeout(fn, Math.max(0, time.getTime() - Date.now()));
    return () => {
      clearTimeout(handle);
    };
  }
}
