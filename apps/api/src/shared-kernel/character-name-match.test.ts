import { describe, expect, it } from 'vitest';
import { matchCharacterName } from './character-name-match.ts';

const one = (index: number) => ({ kind: 'one', index });
const none = { kind: 'none' };

describe('matchCharacterName (SNM-02)', () => {
  it('matches without regard to case, as the game draws names in small caps', () => {
    expect(matchCharacterName('SORC', ['Sorc'])).toEqual(one(0));
    expect(matchCharacterName('sorc', ['SoRc'])).toEqual(one(0));
  });

  it('folds I, i, l and 1 into one glyph, both ways', () => {
    for (const read of ['Illusion', 'IIIusion', 'I1lusion', 'illusion', 'l1lusion']) {
      expect(matchCharacterName(read, ['Illusion']), read).toEqual(one(0));
    }
    expect(matchCharacterName('Illusion', ['I1lusion'])).toEqual(one(0));
  });

  it('folds 0 and o into one glyph, both ways', () => {
    expect(matchCharacterName('S0rc', ['Sorc'])).toEqual(one(0));
    expect(matchCharacterName('Sorc', ['S0rc'])).toEqual(one(0));
    expect(matchCharacterName('SORC', ['S0rc'])).toEqual(one(0));
  });

  it.each(['g', 'e', 'b', 'G', 'E', 'B'])('a known o read as %s still matches (item g)', (letter) => {
    expect(matchCharacterName(`S${letter}rc`, ['Sorc'])).toEqual(one(0));
    expect(matchCharacterName(`S${letter}rc`, ['S0rc'])).toEqual(one(0));
  });

  it('matches two misread o at once', () => {
    expect(matchCharacterName('Bgbby', ['Bobby'])).toEqual(one(0));
    expect(matchCharacterName('Reogeo', ['Roooeo'])).toEqual(one(0));
  });

  it('is directional: a known g, e or b is never matched by a read o', () => {
    for (const known of ['Sgrc', 'Serc', 'Sbrc']) {
      expect(matchCharacterName('Sorc', [known]), known).toEqual(none);
    }
  });

  it('does not take g, e or b for any other letter than o', () => {
    expect(matchCharacterName('Sgrc', ['Sarc'])).toEqual(none);
    expect(matchCharacterName('Hbmmer', ['Hammer'])).toEqual(none);
    expect(matchCharacterName('Sorg', ['Sorc'])).toEqual(none);
  });

  it('needs the same length', () => {
    expect(matchCharacterName('Sorcc', ['Sorc'])).toEqual(none);
    expect(matchCharacterName('Sor', ['Sorc'])).toEqual(none);
    expect(matchCharacterName('', ['Sorc'])).toEqual(none);
  });

  it('answers none when nothing is known', () => {
    expect(matchCharacterName('Sorc', [])).toEqual(none);
  });

  it('returns the index of the name it stands for', () => {
    expect(matchCharacterName('Hammer', ['Sorc', 'Hammer', 'Zeal'])).toEqual(one(1));
  });

  it('answers ambiguous when it stands for more than one name', () => {
    expect(matchCharacterName('Sgrc', ['Sorc', 'S0rc'])).toEqual({ kind: 'ambiguous' });
    expect(matchCharacterName('Illusion', ['Illusion', 'I1lusion'])).toEqual({ kind: 'ambiguous' });
  });

  it('prefers a name equal by the folds over a looser one', () => {
    // A known "Sgrc" is read as "Sgrc": it is not taken for a misread "Sorc" that the same account also holds.
    expect(matchCharacterName('Sgrc', ['Sorc', 'Sgrc'])).toEqual(one(1));
    expect(matchCharacterName('Sgrc', ['Sgrc', 'Sorc'])).toEqual(one(0));
  });

  it('keeps names that differ by a letter outside the folds apart', () => {
    expect(matchCharacterName('Hammer', ['Hammen'])).toEqual(none);
    expect(matchCharacterName('Zeal', ['Zeak'])).toEqual(none);
  });
});
