import { describe, expect, it } from 'vitest';
import { FakeClock } from './clock.ts';

const START = '2026-10-30T12:00:00.000Z';

describe('FakeClock', () => {
  it('now() returns the start instant', () => {
    const clock = new FakeClock(new Date(START));

    expect(clock.now().toISOString()).toBe(START);
  });

  it('advance(1500) moves the clock by exactly 1500 ms', () => {
    const clock = new FakeClock(new Date(START));

    clock.advance(1500);

    expect(clock.now().getTime()).toBe(new Date(START).getTime() + 1500);
  });

  it('set replaces the current instant', () => {
    const clock = new FakeClock(new Date(START));

    clock.set(new Date('2027-01-15T08:30:00.000Z'));

    expect(clock.now().toISOString()).toBe('2027-01-15T08:30:00.000Z');
  });

  it('mutating a returned Date does not change the clock', () => {
    const clock = new FakeClock(new Date(START));

    const leaked = clock.now();
    leaked.setTime(0);

    expect(clock.now().toISOString()).toBe(START);
  });

  it('the constructor copies the start date: mutating it afterwards does not move the clock', () => {
    const start = new Date(START);
    const clock = new FakeClock(start);

    start.setTime(0);

    expect(clock.now().toISOString()).toBe(START);
  });

  it('set copies its argument: mutating the date afterwards does not move the clock', () => {
    const clock = new FakeClock(new Date(START));
    const next = new Date('2027-01-15T08:30:00.000Z');

    clock.set(next);
    next.setTime(0);

    expect(clock.now().toISOString()).toBe('2027-01-15T08:30:00.000Z');
  });
});

describe('FakeClock.onMove', () => {
  it('calls the listener with the new instant on advance and on set', () => {
    const clock = new FakeClock(new Date(START));
    const seen: string[] = [];
    clock.onMove((now) => seen.push(now.toISOString()));

    clock.advance(1000);
    clock.set(new Date('2027-01-15T08:30:00.000Z'));

    expect(seen).toEqual(['2026-10-30T12:00:01.000Z', '2027-01-15T08:30:00.000Z']);
  });

  it('stops calling a listener after it unsubscribes', () => {
    const clock = new FakeClock(new Date(START));
    let calls = 0;
    const unsubscribe = clock.onMove(() => {
      calls += 1;
    });

    clock.advance(1);
    unsubscribe();
    clock.advance(1);

    expect(calls).toBe(1);
  });
});
