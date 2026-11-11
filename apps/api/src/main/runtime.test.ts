import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../shared-kernel/index.ts';
import { ClockScheduler, nextDue } from './runtime.ts';

const START = new Date('2026-11-11T12:00:00Z');

describe('nextDue', () => {
  it('re-arms one interval after the last due instant', () => {
    expect(nextDue(1_000, 1_000, 1_000)).toBe(2_000);
    expect(nextDue(1_000, 1_000, 1_999)).toBe(2_000);
  });

  it('counts from now when the clock jumped over a whole interval', () => {
    expect(nextDue(1_000, 1_000, 2_000)).toBe(3_000);
    expect(nextDue(1_000, 1_000, 60_000)).toBe(61_000);
  });
});

describe('ClockScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs an every callback only when the clock reaches its instant, not when real time passes (RDY-04)', () => {
    const clock = new FakeClock(START);
    const scheduler = new ClockScheduler(clock);
    const ticks = vi.fn();
    scheduler.every(1_000, ticks);

    vi.advanceTimersByTime(10_000);
    expect(ticks).not.toHaveBeenCalled();

    clock.advance(1_000);
    vi.advanceTimersByTime(100);
    expect(ticks).toHaveBeenCalledTimes(1);
  });

  it('runs an every callback once for a jump of many intervals, then again one interval later', () => {
    const clock = new FakeClock(START);
    const scheduler = new ClockScheduler(clock);
    const ticks = vi.fn();
    scheduler.every(1_000, ticks);

    clock.advance(60_000);
    vi.advanceTimersByTime(100);
    expect(ticks).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_000);
    expect(ticks).toHaveBeenCalledTimes(1);
    clock.advance(1_000);
    vi.advanceTimersByTime(100);
    expect(ticks).toHaveBeenCalledTimes(2);
  });

  it('stops an every callback when cancelled, and stops polling when nothing is pending', () => {
    const clock = new FakeClock(START);
    const scheduler = new ClockScheduler(clock);
    const ticks = vi.fn();
    const cancel = scheduler.every(1_000, ticks);
    cancel();

    clock.advance(5_000);
    vi.advanceTimersByTime(200);
    expect(ticks).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('runs an at callback once, when the clock reaches its instant', () => {
    const clock = new FakeClock(START);
    const scheduler = new ClockScheduler(clock);
    const fired = vi.fn();
    scheduler.at(new Date('2026-11-11T12:00:05Z'), fired);

    clock.advance(4_999);
    vi.advanceTimersByTime(200);
    expect(fired).not.toHaveBeenCalled();

    clock.advance(1);
    vi.advanceTimersByTime(200);
    clock.advance(10_000);
    vi.advanceTimersByTime(200);
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('refuses an interval that is not positive', () => {
    const scheduler = new ClockScheduler(new FakeClock(START));
    expect(() => scheduler.every(0, () => undefined)).toThrow(RangeError);
  });
});
