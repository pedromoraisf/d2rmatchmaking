import { describe, expect, it } from 'vitest';
import { PENALTY_MS, isPenalized, penaltySecondsLeft, penaltyUntil } from './penalty.ts';

const TIMED_OUT = new Date('2026-11-10T12:11:00.000Z');
const at = (ms: number) => new Date(TIMED_OUT.getTime() + ms);

describe('penalty (RDY-05)', () => {
  it('lasts five minutes from the moment the check timed out', () => {
    expect(PENALTY_MS).toBe(5 * 60 * 1000);
    expect(penaltyUntil(TIMED_OUT).getTime()).toBe(TIMED_OUT.getTime() + 300_000);
  });

  it('holds just before the five minutes end', () => {
    const until = penaltyUntil(TIMED_OUT);
    expect(isPenalized(until, at(299_999))).toBe(true);
  });

  it('is over at exactly five minutes, so the member may queue again', () => {
    const until = penaltyUntil(TIMED_OUT);
    expect(isPenalized(until, at(300_000))).toBe(false);
  });

  it('shows the whole seconds left, rounded up', () => {
    const until = penaltyUntil(TIMED_OUT);
    expect(penaltySecondsLeft(until, at(0))).toBe(300);
    expect(penaltySecondsLeft(until, at(1))).toBe(300);
    expect(penaltySecondsLeft(until, at(299_999))).toBe(1);
  });

  it('shows zero seconds left once the penalty is over', () => {
    const until = penaltyUntil(TIMED_OUT);
    expect(penaltySecondsLeft(until, at(300_000))).toBe(0);
    expect(penaltySecondsLeft(until, at(400_000))).toBe(0);
  });
});
