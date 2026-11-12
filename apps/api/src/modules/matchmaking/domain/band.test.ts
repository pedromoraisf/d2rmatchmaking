import { describe, expect, it } from 'vitest';
import { bandAt, bandsMatch, halfBandAfter, halfBandAt } from './band.ts';

const JOINED = new Date('2026-11-10T12:00:00.000Z');
const at = (seconds: number) => new Date(JOINED.getTime() + seconds * 1000);

describe('halfBandAfter (QUE-08)', () => {
  it.each([
    [0, 50],
    [29, 50],
    [29.999, 50],
    [30, 75],
    [59, 75],
    [59.999, 75],
    [60, 100],
    [65, 100],
    [389.999, 350],
    [390, 375],
    [419.999, 375],
    [420, 400],
    [421, 400],
    [900, 400],
  ])('after %s seconds the half width is %i', (seconds, half) => {
    expect(halfBandAfter(seconds * 1000)).toBe(half);
  });

  it('never goes under the base half width when the clock runs backwards', () => {
    expect(halfBandAfter(-5_000)).toBe(50);
  });
});

describe('halfBandAt', () => {
  it('reads the wait from the join time to now', () => {
    expect(halfBandAt(JOINED, at(30))).toBe(75);
  });
});

describe('bandAt', () => {
  it('shows the rating ± the half width at 65 seconds (scenario "The PvP band widens")', () => {
    expect(bandAt(1500, JOINED, at(65))).toStrictEqual({ low: 1400, high: 1600 });
  });

  it('shows the base band before the first 30 seconds', () => {
    expect(bandAt(1500, JOINED, at(0))).toStrictEqual({ low: 1450, high: 1550 });
  });
});

describe('bandsMatch (mutual, QUE-08)', () => {
  const fresh = { rating: 1500, joinedAt: JOINED };
  const now = at(0);

  it('matches two tickets with the same rating', () => {
    expect(bandsMatch(fresh, { rating: 1500, joinedAt: JOINED }, now)).toBe(true);
  });

  it('matches when the gap equals the smaller half width', () => {
    expect(bandsMatch(fresh, { rating: 1550, joinedAt: JOINED }, now)).toBe(true);
  });

  it('refuses when the gap is one more than the smaller half width', () => {
    expect(bandsMatch(fresh, { rating: 1551, joinedAt: JOINED }, now)).toBe(false);
  });

  it('is symmetric', () => {
    const other = { rating: 1560, joinedAt: JOINED };
    expect(bandsMatch(fresh, other, now)).toBe(bandsMatch(other, fresh, now));
  });

  it('does not let a waiting ticket reach a fresh one beyond the fresh ticket band', () => {
    const waiting = { rating: 1300, joinedAt: at(-600) };
    expect(bandsMatch(waiting, fresh, now)).toBe(false);
    expect(bandsMatch(waiting, { rating: 1500, joinedAt: JOINED }, now)).toBe(false);
  });

  it('matches two waiting tickets once both bands are wide enough', () => {
    const a = { rating: 1300, joinedAt: at(-600) };
    const b = { rating: 1600, joinedAt: at(-600) };
    expect(bandsMatch(a, b, now)).toBe(true);
  });

  it('caps both bands at 400 however long the tickets wait', () => {
    const a = { rating: 1000, joinedAt: at(-3600) };
    const b = { rating: 1500, joinedAt: at(-3600) };
    expect(bandsMatch(a, b, now)).toBe(false);
    const c = { rating: 1400, joinedAt: at(-3600) };
    expect(bandsMatch(a, c, now)).toBe(true);
    const d = { rating: 1401, joinedAt: at(-3600) };
    expect(bandsMatch(a, d, now)).toBe(false);
  });
});
