import { describe, expect, it } from 'vitest';
import { createI18n } from '../app/i18n.ts';
import {
  classKey,
  classMark,
  difficultyKey,
  difficultyTone,
  eraKey,
  gameKey,
  ladderKey,
  modeKey,
  onlineKey,
  screenKey,
  stageKey,
} from './labels.ts';

const i18n = createI18n(['en-US']);

describe('labels', () => {
  it.each([
    [stageKey('awaiting_host'), 'Awaiting host'],
    [stageKey('created'), 'Created'],
    [screenKey('UNKNOWN'), 'Screen: Unknown'],
    [screenKey('AUTOMAP_OPEN'), 'Screen: Automap open'],
    [onlineKey(true), 'Agent online'],
    [onlineKey(false), 'Agent offline'],
    [gameKey(true), 'Game open'],
    [gameKey(false), 'Game closed'],
    [screenKey('CHARACTER_SELECT'), 'Screen: Character selection'],
    [screenKey('IN_GAME'), 'Screen: In game'],
    [classKey('necromancer'), 'Necromancer'],
    [eraKey('rotw'), 'Reign of the Warlock'],
    [difficultyKey('hell'), 'Hell'],
    [modeKey(true), 'Hardcore'],
    [modeKey(false), 'Softcore'],
    [ladderKey('non-ladder'), 'Non-ladder'],
    [ladderKey('ladder'), 'Ladder'],
  ])('maps %s to its English text', (key, text) => {
    expect(i18n.t(key)).toBe(text);
  });

  it('marks every class with its two-letter card mark', () => {
    expect(classMark('amazon')).toBe('AM');
    expect(classMark('sorceress')).toBe('SO');
    expect(classMark('warlock')).toBe('WL');
  });

  it('colours each difficulty tag as the prototype does: Normal, Nightmare and Hell', () => {
    expect(difficultyTone('normal')).toBe('d-n');
    expect(difficultyTone('nightmare')).toBe('d-nm');
    expect(difficultyTone('hell')).toBe('d-h');
  });
});
