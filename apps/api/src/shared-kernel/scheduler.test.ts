import { describe, expect, it } from 'vitest';
import { FakeClock } from './clock.ts';
import { FakeScheduler } from './scheduler.ts';

const START = new Date('2026-10-30T12:00:00.000Z');

describe('FakeScheduler', () => {
  it('every(25_000) fires at 25 s and 50 s and not at 24.999 s', () => {
    const clock = new FakeClock(START);
    const scheduler = new FakeScheduler(clock);
    let fired = 0;
    scheduler.every(25_000, () => {
      fired += 1;
    });

    clock.advance(24_999);
    expect(fired).toBe(0);
    clock.advance(1);
    expect(fired).toBe(1);
    clock.advance(24_999);
    expect(fired).toBe(1);
    clock.advance(1);
    expect(fired).toBe(2);
  });

  it('a 50 s advance in one step fires the 25 s interval twice', () => {
    const clock = new FakeClock(START);
    const scheduler = new FakeScheduler(clock);
    let fired = 0;
    scheduler.every(25_000, () => {
      fired += 1;
    });

    clock.advance(50_000);

    expect(fired).toBe(2);
  });

  it('cancel stops an every callback', () => {
    const clock = new FakeClock(START);
    const scheduler = new FakeScheduler(clock);
    let fired = 0;
    const cancel = scheduler.every(1_000, () => {
      fired += 1;
    });

    clock.advance(1_000);
    cancel();
    clock.advance(5_000);

    expect(fired).toBe(1);
  });

  it('at fires once, when the clock reaches the instant', () => {
    const clock = new FakeClock(START);
    const scheduler = new FakeScheduler(clock);
    let fired = 0;
    scheduler.at(new Date(START.getTime() + 2_000), () => {
      fired += 1;
    });

    clock.advance(1_999);
    expect(fired).toBe(0);
    clock.advance(1);
    clock.advance(10_000);

    expect(fired).toBe(1);
  });

  it('cancel stops an at callback before it runs', () => {
    const clock = new FakeClock(START);
    const scheduler = new FakeScheduler(clock);
    let fired = 0;
    const cancel = scheduler.at(new Date(START.getTime() + 2_000), () => {
      fired += 1;
    });

    cancel();
    clock.advance(5_000);

    expect(fired).toBe(0);
  });

  it('runs due callbacks in due order and shows the clock at the new instant', () => {
    const clock = new FakeClock(START);
    const scheduler = new FakeScheduler(clock);
    const order: string[] = [];
    scheduler.at(new Date(START.getTime() + 3_000), () =>
      order.push(`late@${clock.now().getTime() - START.getTime()}`),
    );
    scheduler.at(new Date(START.getTime() + 1_000), () => order.push('early'));

    clock.advance(4_000);

    expect(order).toEqual(['early', 'late@4000']);
  });

  it('rejects a non-positive every interval', () => {
    const scheduler = new FakeScheduler(new FakeClock(START));

    expect(() => scheduler.every(0, () => undefined)).toThrow(RangeError);
    expect(() => scheduler.every(-5, () => undefined)).toThrow(RangeError);
  });
});
