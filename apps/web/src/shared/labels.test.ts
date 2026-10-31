import { describe, expect, it } from 'vitest';
import { createI18n } from '../app/i18n.ts';
import { gameKey, onlineKey, screenKey, stageKey } from './labels.ts';

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
  ])('maps %s to its English text', (key, text) => {
    expect(i18n.t(key)).toBe(text);
  });
});
