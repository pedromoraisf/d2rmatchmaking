import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimerScheduler } from './timer-scheduler.ts';

const START = new Date('2026-10-31T12:00:00.000Z');

describe('TimerScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: START });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('every fires on each interval and cancel stops it', () => {
    const scheduler = new TimerScheduler();
    const calls: number[] = [];
    const cancel = scheduler.every(1_000, () => calls.push(Date.now()));

    vi.advanceTimersByTime(2_500);
    expect(calls).toEqual([START.getTime() + 1_000, START.getTime() + 2_000]);

    cancel();
    vi.advanceTimersByTime(5_000);
    expect(calls).toHaveLength(2);
  });

  it('at fires once at its time and cancel stops it', () => {
    const scheduler = new TimerScheduler();
    const fired: number[] = [];
    scheduler.at(new Date(START.getTime() + 3_000), () => fired.push(Date.now()));
    const cancelled = scheduler.at(new Date(START.getTime() + 4_000), () => fired.push(-1));

    vi.advanceTimersByTime(2_999);
    expect(fired).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(fired).toEqual([START.getTime() + 3_000]);

    cancelled();
    vi.advanceTimersByTime(10_000);
    expect(fired).toEqual([START.getTime() + 3_000]);
  });

  it('at fires at once for a time already past', () => {
    const scheduler = new TimerScheduler();
    const fired = vi.fn();

    scheduler.at(new Date(START.getTime() - 1_000), fired);
    vi.advanceTimersByTime(0);

    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('every refuses a non-positive interval', () => {
    const scheduler = new TimerScheduler();

    expect(() => scheduler.every(0, () => undefined)).toThrow(RangeError);
  });
});
