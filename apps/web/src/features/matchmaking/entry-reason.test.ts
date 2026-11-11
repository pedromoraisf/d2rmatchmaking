import type { CharacterView } from '@d2rmm/contracts';
import { describe, expect, it } from 'vitest';
import { firstEntryReason, LEVEL_FLOORS } from './entry-reason.ts';

const READY: CharacterView = {
  id: 'c-1',
  name: 'Sorc',
  class: 'sorceress',
  level: 90,
  hardcore: false,
  ladder: 'ladder',
  era: 'rotw',
  unlockedDifficulties: ['normal', 'nightmare', 'hell'],
  readAt: '2026-11-10T12:00:00.000Z',
};

const pvp = (difficulty: 'normal' | 'nightmare' | 'hell' = 'hell') => ({ mode: 'pvp' as const, difficulty });

function leveling(
  overrides: {
    difficulty?: 'normal' | 'nightmare' | 'hell';
    minLevel?: number;
    activity?: 'baal' | 'heralds';
  } = {},
) {
  return {
    mode: 'leveling' as const,
    difficulty: overrides.difficulty ?? ('nightmare' as const),
    activity: overrides.activity ?? ('chaos' as const),
    minLevel: overrides.minLevel ?? 40,
  };
}

describe('firstEntryReason', () => {
  it('has the level floors of the prototype', () => {
    expect(LEVEL_FLOORS).toStrictEqual({ normal: 10, nightmare: 40, hell: 70 });
  });

  it('says no character is chosen when there is none', () => {
    expect(firstEntryReason(undefined, pvp())).toBe('noCharacter');
  });

  it('accepts a ready character for PvP', () => {
    expect(firstEntryReason(READY, pvp())).toBeNull();
  });

  it('says the declaration is missing before anything else', () => {
    expect(firstEntryReason({ ...READY, ladder: null, unlockedDifficulties: ['normal'] }, pvp('hell'))).toBe(
      'undeclared',
    );
    expect(firstEntryReason({ ...READY, era: null }, pvp())).toBe('undeclared');
  });

  it('says a difficulty is locked on this character', () => {
    const cara = {
      ...READY,
      level: 45,
      unlockedDifficulties: ['normal', 'nightmare'] as CharacterView['unlockedDifficulties'],
    };
    expect(firstEntryReason(cara, pvp('hell'))).toBe('difficultyLocked');
    expect(firstEntryReason(cara, pvp('nightmare'))).toBeNull();
  });

  it.each([
    [9, 'normal', 10, 'belowFloor'],
    [10, 'normal', 10, null],
    [39, 'nightmare', 40, 'belowFloor'],
    [40, 'nightmare', 40, null],
    [69, 'hell', 70, 'belowFloor'],
    [70, 'hell', 70, null],
  ] as const)('a level %i character on %s with minimum %i: %s', (level, difficulty, minLevel, expected) => {
    const character = {
      ...READY,
      level,
      unlockedDifficulties: ['normal', 'nightmare', 'hell'] as CharacterView['unlockedDifficulties'],
    };
    expect(firstEntryReason(character, leveling({ difficulty, minLevel }))).toBe(expected);
  });

  it.each([
    [39, 'nightmare', 'minimumBelowFloor'],
    [40, 'nightmare', null],
    [69, 'hell', 'minimumBelowFloor'],
    [70, 'hell', null],
  ] as const)('a minimum of %i on %s: %s', (minLevel, difficulty, expected) => {
    expect(firstEntryReason({ ...READY, level: 99 }, leveling({ difficulty, minLevel }))).toBe(expected);
  });

  it('says the character is under the chosen minimum', () => {
    const cara = {
      ...READY,
      level: 45,
      unlockedDifficulties: ['normal', 'nightmare'] as CharacterView['unlockedDifficulties'],
    };
    expect(firstEntryReason(cara, leveling({ minLevel: 50 }))).toBe('belowMinimum');
    expect(firstEntryReason(cara, leveling({ minLevel: 45 }))).toBeNull();
  });

  it('says Heralds needs Hell and Reign of the Warlock', () => {
    expect(
      firstEntryReason(READY, leveling({ activity: 'heralds', difficulty: 'hell', minLevel: 70 })),
    ).toBeNull();
    expect(firstEntryReason(READY, leveling({ activity: 'heralds', difficulty: 'nightmare' }))).toBe(
      'activityNotAvailable',
    );
    expect(
      firstEntryReason(
        { ...READY, era: 'lod' },
        leveling({ activity: 'heralds', difficulty: 'hell', minLevel: 70 }),
      ),
    ).toBe('activityNotAvailable');
  });
});
