import { describe, expect, it } from 'vitest';
import {
  fitsAccountLimit,
  isAllowedDifficultyList,
  isCharacterLevel,
  isCharacterName,
  parseCharacter,
  parseCharacterBatch,
  type CharacterInput,
} from './character.ts';

const sorc: CharacterInput = {
  name: 'Sorc',
  class: 'sorceress',
  level: 85,
  ladder: 'sc-ladder',
  era: 'lod',
  unlockedDifficulties: ['normal', 'nightmare', 'hell'],
};

function cardNamed(index: number): CharacterInput {
  return { ...sorc, name: `Char${String.fromCharCode(97 + index)}` };
}

describe('character name rule (CHR-10)', () => {
  it.each(['Sorc', 'Zo', 'Mad-Man', 'Mad_Man', 'A'.repeat(15)])('accepts %s', (name) => {
    expect(isCharacterName(name)).toBe(true);
  });

  it.each([
    ['one letter', 'A'],
    ['sixteen letters', 'A'.repeat(16)],
    ['a space', 'a name with spaces'],
    ['a digit', 'Sorc2'],
    ['a leading separator', '-Sorc'],
    ['a trailing separator', 'Sorc_'],
    ['two separators', 'So-r_c'],
    ['empty', ''],
  ])('rejects %s', (_label, name) => {
    expect(isCharacterName(name)).toBe(false);
  });
});

describe('character level rule (CHR-10)', () => {
  it.each([1, 99])('accepts %i', (level) => {
    expect(isCharacterLevel(level)).toBe(true);
  });

  it.each([0, 100, -1, 1.5, Number.NaN])('rejects %s', (level) => {
    expect(isCharacterLevel(level)).toBe(false);
  });
});

describe('unlocked difficulty lists (CHR-07, CHR-10)', () => {
  it.each([[['normal']], [['normal', 'nightmare']], [['normal', 'nightmare', 'hell']]])(
    'accepts %j',
    (list) => {
      expect(isAllowedDifficultyList(list)).toBe(true);
    },
  );

  it.each([
    [[]],
    [['nightmare']],
    [['hell']],
    [['normal', 'hell']],
    [['nightmare', 'normal']],
    [['normal', 'normal']],
    [['normal', 'nightmare', 'hell', 'normal']],
  ])('rejects %j', (list) => {
    expect(isAllowedDifficultyList(list)).toBe(false);
  });
});

describe('parseCharacter (CHR-10)', () => {
  it('accepts a complete card and copies its difficulties', () => {
    const parsed = parseCharacter(sorc);
    expect(parsed).toEqual({ ok: true, value: sorc });
  });

  it.each([
    ['class', { class: 'necromancer2' }],
    ['era', { era: 'diablo4' }],
    ['ladder', { ladder: 'ladder' }],
    ['level', { level: 0 }],
    ['level', { level: 100 }],
    ['name', { name: 'a name with spaces' }],
    ['difficulties', { unlockedDifficulties: ['normal', 'hell'] }],
  ])('refuses a card whose %s is not allowed', (_field, change) => {
    expect(parseCharacter({ ...sorc, ...change })).toEqual({ ok: false, error: 'invalid-character' });
  });
});

describe('parseCharacterBatch (CHR-09, CHR-10)', () => {
  it('accepts one card', () => {
    expect(parseCharacterBatch([sorc])).toEqual({ ok: true, value: [sorc] });
  });

  it('accepts 24 cards with unique names', () => {
    const batch = Array.from({ length: 24 }, (_, index) => cardNamed(index));
    expect(parseCharacterBatch(batch).ok).toBe(true);
  });

  it('refuses an empty batch', () => {
    expect(parseCharacterBatch([])).toEqual({ ok: false, error: 'invalid-batch' });
  });

  it('refuses 25 cards', () => {
    const batch = Array.from({ length: 25 }, (_, index) => cardNamed(index));
    expect(parseCharacterBatch(batch)).toEqual({ ok: false, error: 'invalid-batch' });
  });

  it('refuses two cards with the same name', () => {
    expect(parseCharacterBatch([sorc, { ...sorc, level: 90 }])).toEqual({
      ok: false,
      error: 'invalid-batch',
    });
  });

  it('refuses the whole batch when one card is invalid', () => {
    expect(parseCharacterBatch([sorc, { ...sorc, name: 'Pally', level: 0 }])).toEqual({
      ok: false,
      error: 'invalid-batch',
    });
  });
});

describe('account limit (security finding 2)', () => {
  /** Distinct letters-only names: `Heroaa`, `Heroab`, … */
  const nameOf = (index: number) =>
    `Hero${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`;
  const stored = (count: number) => Array.from({ length: count }, (_, index) => nameOf(index));
  const batchOf = (indexes: readonly number[]) => {
    const parsed = parseCharacterBatch(indexes.map((index) => ({ ...sorc, name: nameOf(index) })));
    if (!parsed.ok) {
      throw new Error('the fixture batch must be valid');
    }
    return parsed.value;
  };

  it('a batch that ends at exactly 60 names fits', () => {
    expect(fitsAccountLimit(stored(59), batchOf([100]))).toBe(true);
  });

  it('a batch that would pass 60 names does not fit', () => {
    expect(fitsAccountLimit(stored(60), batchOf([100]))).toBe(false);
  });

  it('names the account already holds are replaced, so they do not count', () => {
    expect(fitsAccountLimit(stored(60), batchOf([0, 1, 2]))).toBe(true);
  });

  it('a mixed batch counts only its new names', () => {
    expect(fitsAccountLimit(stored(58), batchOf([0, 100, 101]))).toBe(true);
    expect(fitsAccountLimit(stored(58), batchOf([100, 101, 102]))).toBe(false);
  });
});
