import { describe, expect, it } from 'vitest';
import { PlayerName } from './player-name.ts';

describe('PlayerName.parse', () => {
  it('accepts names of 2 and 16 characters', () => {
    expect(PlayerName.parse('ab')).toMatchObject({ ok: true, value: { value: 'ab' } });
    expect(PlayerName.parse('a'.repeat(16))).toMatchObject({ ok: true, value: { value: 'a'.repeat(16) } });
  });

  it('accepts digits and hyphens', () => {
    expect(PlayerName.parse('Player-01')).toMatchObject({ ok: true, value: { value: 'Player-01' } });
  });

  it('rejects names outside the rules', () => {
    const rejected = ['', 'a', 'a'.repeat(17), ' PlayerOne', 'Player_One', 'Jogadoré', 'PlayerOne '];

    for (const raw of rejected) {
      expect(PlayerName.parse(raw)).toEqual({ ok: false, error: 'invalid-name' });
    }
  });

  it('computes the test key as the lower-cased name', () => {
    const parsed = PlayerName.parse('PlayerOne');

    expect(parsed).toMatchObject({ ok: true, value: { testKey: 'playerone', value: 'PlayerOne' } });
  });
});
