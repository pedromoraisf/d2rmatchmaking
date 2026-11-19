import { describe, expect, it } from 'vitest';
import { GameName, type GameDifficulty } from './game-name.ts';

function baal12(): GameName {
  const result = GameName.of('baal', 'hell', 12);
  if (!result.ok) {
    throw new Error('expected a game name');
  }
  return result.value;
}

describe('GameName', () => {
  it('builds mmbaalh-<n> for baal on hell', () => {
    const result = GameName.of('baal', 'hell', 12);

    expect(result.ok && result.value.value).toBe('mmbaalh-12');
  });

  it('answers unsupported-difficulty for a value outside the three difficulties', () => {
    expect(GameName.of('baal', 'toString' as GameDifficulty, 12)).toEqual({
      ok: false,
      error: 'unsupported-difficulty',
    });
  });

  it('matches the expected name ignoring case', () => {
    expect(baal12().matches('MMBAALH-12')).toBe(true);
  });

  it('does not match a value with a leading space', () => {
    expect(baal12().matches(' mmbaalh-12')).toBe(false);
  });

  it('does not match another number', () => {
    expect(baal12().matches('mmbaalh-13')).toBe(false);
  });
});
