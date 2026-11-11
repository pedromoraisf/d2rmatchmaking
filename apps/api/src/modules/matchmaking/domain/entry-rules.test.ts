import { describe, expect, it } from 'vitest';
import {
  checkEntry,
  combinedLadder,
  LEVEL_FLOORS,
  type EntryCharacter,
  type EntryRequest,
} from './entry-rules.ts';

const sorc: EntryCharacter = {
  level: 90,
  hardcore: false,
  ladder: 'ladder',
  era: 'rotw',
  unlockedDifficulties: ['normal', 'nightmare', 'hell'],
};

const zon: EntryCharacter = {
  level: 45,
  hardcore: false,
  ladder: 'ladder',
  era: 'rotw',
  unlockedDifficulties: ['normal', 'nightmare'],
};

const pvp = (difficulty: 'normal' | 'nightmare' | 'hell' = 'hell'): EntryRequest => ({
  mode: 'pvp',
  difficulty,
});

const leveling = (overrides: Partial<Extract<EntryRequest, { mode: 'leveling' }>> = {}): EntryRequest => ({
  mode: 'leveling',
  difficulty: 'nightmare',
  activity: 'chaos',
  minLevel: 40,
  ...overrides,
});

function refusalOf(character: EntryCharacter, request: EntryRequest): string | null {
  const result = checkEntry(character, request);
  return result.ok ? null : result.error;
}

describe('combinedLadder', () => {
  it.each([
    [false, 'ladder', 'sc-ladder'],
    [false, 'non-ladder', 'sc-nonladder'],
    [true, 'ladder', 'hc-ladder'],
    [true, 'non-ladder', 'hc-nonladder'],
  ] as const)('hardcore %s with %s is %s', (hardcore, ladder, expected) => {
    expect(combinedLadder(hardcore, ladder)).toBe(expected);
  });
});

describe('checkEntry: declarations (QUE-03)', () => {
  it('refuses a character whose ladder is not declared', () => {
    expect(refusalOf({ ...sorc, ladder: null }, pvp())).toBe('undeclared-character');
  });

  it('refuses a character whose era is not declared', () => {
    expect(refusalOf({ ...sorc, era: null }, pvp())).toBe('undeclared-character');
  });

  it('answers the declaration before the difficulty', () => {
    expect(refusalOf({ ...sorc, ladder: null, unlockedDifficulties: ['normal'] }, pvp('hell'))).toBe(
      'undeclared-character',
    );
  });

  it('returns the derived ladder and the era of an accepted join', () => {
    expect(checkEntry({ ...sorc, hardcore: true, ladder: 'non-ladder' }, pvp())).toStrictEqual({
      ok: true,
      value: { ladder: 'hc-nonladder', era: 'rotw' },
    });
  });
});

describe('checkEntry: unlocked difficulties (QUE-03, INV-02)', () => {
  it('refuses a difficulty the character has not unlocked (PvP)', () => {
    expect(refusalOf(zon, pvp('hell'))).toBe('difficulty-locked');
  });

  it('refuses a locked difficulty in leveling too', () => {
    expect(refusalOf(zon, leveling({ difficulty: 'hell', minLevel: 70 }))).toBe('difficulty-locked');
  });

  it('accepts an unlocked difficulty in PvP', () => {
    expect(refusalOf(zon, pvp('nightmare'))).toBeNull();
  });

  it('answers the lock before the level floor', () => {
    expect(refusalOf(zon, leveling({ difficulty: 'hell', minLevel: 40 }))).toBe('difficulty-locked');
  });
});

describe('checkEntry: level floors (QUE-03)', () => {
  it.each([
    ['normal', 10],
    ['nightmare', 40],
    ['hell', 70],
  ] as const)('the %s floor is %i', (difficulty, floor) => {
    expect(LEVEL_FLOORS[difficulty]).toBe(floor);
  });

  it.each([
    [9, 'normal', 10, 'below-floor'],
    [10, 'normal', 10, null],
    [39, 'nightmare', 40, 'below-floor'],
    [40, 'nightmare', 40, null],
    [69, 'hell', 70, 'below-floor'],
    [70, 'hell', 70, null],
  ] as const)('a level %i character on %s with minimum %i: %s', (level, difficulty, minLevel, expected) => {
    const character = { ...sorc, level, unlockedDifficulties: ['normal', 'nightmare', 'hell'] as const };
    expect(refusalOf(character, leveling({ difficulty, minLevel }))).toBe(expected);
  });

  it('does not apply the level floor to PvP', () => {
    expect(refusalOf({ ...sorc, level: 1 }, pvp('normal'))).toBeNull();
  });
});

describe('checkEntry: the chosen minimum (QUE-03)', () => {
  it.each([
    [9, 'normal', 10, 'minimum-below-floor'],
    [10, 'normal', 10, null],
    [39, 'nightmare', 40, 'minimum-below-floor'],
    [40, 'nightmare', 40, null],
    [69, 'hell', 70, 'minimum-below-floor'],
    [70, 'hell', 70, null],
  ] as const)('minimum %i on %s: %s', (minLevel, difficulty, _floor, expected) => {
    const character = { ...sorc, level: 99, unlockedDifficulties: ['normal', 'nightmare', 'hell'] as const };
    expect(refusalOf(character, leveling({ difficulty, minLevel }))).toBe(expected);
  });

  it('refuses a character under the chosen minimum', () => {
    expect(refusalOf(zon, leveling({ difficulty: 'nightmare', minLevel: 50 }))).toBe('below-minimum-level');
  });

  it('accepts a character exactly at the chosen minimum', () => {
    expect(refusalOf(zon, leveling({ difficulty: 'nightmare', minLevel: 45 }))).toBeNull();
  });

  it('answers the minimum under the floor before a character under the minimum', () => {
    expect(refusalOf(zon, leveling({ difficulty: 'nightmare', minLevel: 39 }))).toBe('minimum-below-floor');
  });

  it('answers a character under the floor before the minimum', () => {
    const low = { ...sorc, level: 35, unlockedDifficulties: ['normal', 'nightmare'] as const };
    expect(refusalOf(low, leveling({ difficulty: 'nightmare', minLevel: 40 }))).toBe('below-floor');
  });
});

describe('checkEntry: Heralds (QUE-04)', () => {
  it('accepts Heralds in Hell with Reign of the Warlock', () => {
    expect(refusalOf(sorc, leveling({ activity: 'heralds', difficulty: 'hell', minLevel: 70 }))).toBeNull();
  });

  it('refuses Heralds on Nightmare', () => {
    expect(refusalOf(sorc, leveling({ activity: 'heralds', difficulty: 'nightmare', minLevel: 40 }))).toBe(
      'activity-not-available',
    );
  });

  it('refuses Heralds on Normal', () => {
    expect(
      refusalOf(
        { ...sorc, unlockedDifficulties: ['normal'] },
        leveling({ activity: 'heralds', difficulty: 'normal', minLevel: 10 }),
      ),
    ).toBe('activity-not-available');
  });

  it.each(['classic', 'lod'] as const)('refuses Heralds in the %s era', (era) => {
    expect(
      refusalOf(
        { ...sorc, era, level: 99, unlockedDifficulties: ['normal', 'nightmare', 'hell'] },
        leveling({ activity: 'heralds', difficulty: 'hell', minLevel: 70 }),
      ),
    ).toBe('activity-not-available');
  });

  it('does not refuse the other activities for their era', () => {
    expect(
      refusalOf({ ...sorc, era: 'lod' }, leveling({ activity: 'baal', difficulty: 'nightmare' })),
    ).toBeNull();
  });
});
