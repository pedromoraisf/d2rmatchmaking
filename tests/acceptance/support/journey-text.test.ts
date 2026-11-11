import { describe, expect, it } from 'vitest';
import { flatten, shownEnglish, shownKeys, siteCatalogues, type Catalogue } from './journey-text.ts';

const en: Catalogue = {
  queue: { findMatch: 'Find match', mode: 'PvP', waited: 'Waited {{time}}' },
  room: { heading: 'Your room', hint: 'Press <kbd>{{hotkey}}</kbd>' },
};
const ptBR: Catalogue = {
  queue: { findMatch: 'Procurar partida', mode: 'PvP', waited: 'Esperou {{time}}' },
  room: { heading: 'Sua sala', hint: 'Pressione <kbd>{{hotkey}}</kbd>' },
};

describe('flatten', () => {
  it('lists the leaves by dotted path', () => {
    expect([...flatten(en).keys()]).toEqual([
      'queue.findMatch',
      'queue.mode',
      'queue.waited',
      'room.heading',
      'room.hint',
    ]);
  });
});

describe('shownKeys', () => {
  it('finds a key shown as it is, and nothing else', () => {
    expect(shownKeys(['queue.findMatch', 'Procurar partida', 'queue'], en)).toEqual(['queue.findMatch']);
  });
});

describe('shownEnglish', () => {
  it('finds an English source string', () => {
    expect(shownEnglish(['Find match', 'Procurar partida'], en, ptBR)).toEqual(['Find match']);
  });

  it('finds an English string with a placeholder filled in', () => {
    expect(shownEnglish(['Waited 0:05'], en, ptBR)).toEqual(['Waited 0:05']);
    expect(shownEnglish(['Esperou 0:05'], en, ptBR)).toEqual([]);
  });

  it('ignores a string that is the same in both languages and a string with markup', () => {
    expect(shownEnglish(['PvP', 'Press Ctrl+A'], en, ptBR)).toEqual([]);
  });

  it('ignores a string the Portuguese value matches too', () => {
    const same: Catalogue = { a: { x: 'Level {{n}}' } };
    const near: Catalogue = { a: { x: 'Level {{n}} (nível)' } };
    expect(shownEnglish(['Level 90 (nível)'], same, near)).toEqual([]);
  });
});

describe('the site catalogues', () => {
  it('are read from the files the site ships and hold the same keys', () => {
    const catalogues = siteCatalogues();
    expect([...flatten(catalogues.ptBR).keys()].sort()).toEqual([...flatten(catalogues.en).keys()].sort());
  });
});
