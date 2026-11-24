import { describe, expect, it } from 'vitest';
import type { Character } from './character.ts';
import { reconcileCards, type StoredFacts } from './reconcile.ts';

const card = (name: string, overrides: Partial<Character> = {}): Character => ({
  name,
  class: 'sorceress',
  level: 85,
  hardcore: false,
  unlockedDifficulties: ['normal', 'nightmare', 'hell'],
  ...overrides,
});
const held = (name: string, overrides: Partial<StoredFacts> = {}): StoredFacts => ({
  name,
  class: 'sorceress',
  level: 85,
  hardcore: false,
  ...overrides,
});

describe('reconcileCards (SNM-07)', () => {
  it('gives a misread card the stored spelling', () => {
    const result = reconcileCards([card('Sgrc', { level: 86 })], [held('Sorc')]);
    expect(result.characters.map((character) => character.name)).toEqual(['Sorc']);
    expect(result.characters[0]?.level).toBe(86);
    expect(result.reconciled).toBe(1);
  });

  it('leaves a name the account holds, however it is spelled, untouched', () => {
    const result = reconcileCards([card('SORC')], [held('Sorc')]);
    expect(result.characters.map((character) => character.name)).toEqual(['SORC']);
    expect(result.reconciled).toBe(0);
  });

  it('takes a card at the same level for the stored character', () => {
    expect(reconcileCards([card('Sbrc', { level: 85 })], [held('Sorc')]).reconciled).toBe(1);
  });

  it.each([
    ['another class', { class: 'paladin' as const }],
    ['another mode', { hardcore: true }],
    ['a lower level', { level: 84 }],
  ])('keeps the card as a new character for %s', (_label, overrides) => {
    const result = reconcileCards([card('Sgrc', overrides)], [held('Sorc')]);
    expect(result.characters.map((character) => character.name)).toEqual(['Sgrc']);
    expect(result.reconciled).toBe(0);
  });

  it('keeps the card when the batch also holds the stored character', () => {
    const result = reconcileCards([card('Sorc'), card('Sgrc')], [held('Sorc')]);
    expect(result.characters.map((character) => character.name)).toEqual(['Sorc', 'Sgrc']);
    expect(result.reconciled).toBe(0);
  });

  it('keeps the card when two stored names are possible', () => {
    const result = reconcileCards([card('Sgrc')], [held('Sorc'), held('S0rc')]);
    expect(result.characters.map((character) => character.name)).toEqual(['Sgrc']);
  });

  it('does not take two misread cards for one stored character', () => {
    const result = reconcileCards([card('Sgrc'), card('Sbrc')], [held('Sorc')]);
    expect(result.characters.map((character) => character.name)).toEqual(['Sorc', 'Sbrc']);
    expect(result.reconciled).toBe(1);
  });

  it('is directional: a stored g is not swallowed by a read o', () => {
    const result = reconcileCards([card('Sorc')], [held('Sgrc')]);
    expect(result.characters.map((character) => character.name)).toEqual(['Sorc']);
  });

  it('does nothing for an account with no characters', () => {
    const result = reconcileCards([card('Sgrc')], []);
    expect(result).toEqual({ characters: [card('Sgrc')], reconciled: 0 });
  });
});
