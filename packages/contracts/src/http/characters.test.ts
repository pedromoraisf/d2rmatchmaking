import { describe, expect, it } from 'vitest';
import {
  CharacterName,
  CharacterReading,
  CharacterView,
  Level,
  MyCharactersResponse,
  RecordCharactersRequest,
  isAllowedDifficultyList,
} from './characters.ts';

const sorc = {
  name: 'Sorc',
  class: 'sorceress',
  level: 85,
  ladder: 'sc-ladder',
  era: 'lod',
  unlockedDifficulties: ['normal', 'nightmare', 'hell'],
};

function cardNamed(index: number) {
  return { ...sorc, name: `Char${String.fromCharCode(97 + index)}` };
}

describe('CharacterName', () => {
  it.each(['Sorc', 'Zon', 'Hammer', 'Ab', 'Mad-Man', 'Mad_Man', 'A'.repeat(15)])('accepts %s', (name) => {
    expect(CharacterName.safeParse(name).success).toBe(true);
  });

  it.each([
    ['too short', 'A'],
    ['too long', 'A'.repeat(16)],
    ['a space', 'a name with spaces'],
    ['a digit', 'Sorc2'],
    ['a leading separator', '-Sorc'],
    ['a trailing separator', 'Sorc-'],
    ['two separators', 'So-r_c'],
    ['an empty name', ''],
  ])('rejects %s', (_label, name) => {
    expect(CharacterName.safeParse(name).success).toBe(false);
  });
});

describe('Level', () => {
  it.each([1, 99])('accepts level %i', (level) => {
    expect(Level.safeParse(level).success).toBe(true);
  });

  it.each([0, 100, 1.5])('rejects level %s', (level) => {
    expect(Level.safeParse(level).success).toBe(false);
  });
});

describe('unlockedDifficulties', () => {
  it.each([[['normal']], [['normal', 'nightmare']], [['normal', 'nightmare', 'hell']]])(
    'accepts the allowed list %j',
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
  ])('rejects the list %j', (list) => {
    expect(isAllowedDifficultyList(list)).toBe(false);
  });
});

describe('CharacterReading', () => {
  it('accepts a complete card', () => {
    expect(CharacterReading.parse(sorc)).toStrictEqual(sorc);
  });

  it('rejects an unknown class', () => {
    expect(CharacterReading.safeParse({ ...sorc, class: 'necromancer2' }).success).toBe(false);
  });

  it('rejects an unknown era', () => {
    expect(CharacterReading.safeParse({ ...sorc, era: 'diablo4' }).success).toBe(false);
  });

  it('rejects an unknown ladder value', () => {
    expect(CharacterReading.safeParse({ ...sorc, ladder: 'ladder' }).success).toBe(false);
  });

  it('rejects a difficulty list that is not allowed', () => {
    expect(CharacterReading.safeParse({ ...sorc, unlockedDifficulties: ['normal', 'hell'] }).success).toBe(
      false,
    );
  });
});

describe('RecordCharactersRequest', () => {
  it('accepts one card', () => {
    expect(RecordCharactersRequest.parse({ characters: [sorc] })).toStrictEqual({ characters: [sorc] });
  });

  it('accepts 24 cards with unique names', () => {
    const characters = Array.from({ length: 24 }, (_, index) => cardNamed(index));
    expect(RecordCharactersRequest.safeParse({ characters }).success).toBe(true);
  });

  it('rejects an empty batch', () => {
    expect(RecordCharactersRequest.safeParse({ characters: [] }).success).toBe(false);
  });

  it('rejects 25 cards', () => {
    const characters = Array.from({ length: 25 }, (_, index) => cardNamed(index));
    expect(RecordCharactersRequest.safeParse({ characters }).success).toBe(false);
  });

  it('rejects two cards with the same name', () => {
    expect(RecordCharactersRequest.safeParse({ characters: [sorc, { ...sorc, level: 90 }] }).success).toBe(
      false,
    );
  });

  it('rejects a batch that holds one card with an unreadable field', () => {
    const broken = { ...sorc, name: 'Bad Name', level: 0 };
    expect(RecordCharactersRequest.safeParse({ characters: [sorc, broken] }).success).toBe(false);
  });
});

describe('site character views', () => {
  it('accepts a listed character with its read time', () => {
    const view = { ...sorc, readAt: '2026-11-10T12:00:00.000Z' };
    expect(CharacterView.parse(view)).toStrictEqual(view);
  });

  it('accepts the response with no characters', () => {
    expect(MyCharactersResponse.parse({ characters: [] })).toStrictEqual({ characters: [] });
  });
});
