// Whose name is this? One pure rule for a name read off the screen against the names the API knows (SNM-02). Identity uses
// it on a batch of character cards, Lobby Room on a chat sighting. No I/O, no clock: a name goes in and an index comes out,
// and nothing here keeps, logs or returns the read name.

/** What a read name stands for among the known names. `one` carries the index of that name in the list given. */
export type NameMatch =
  | { readonly kind: 'one'; readonly index: number }
  | { readonly kind: 'none' }
  | { readonly kind: 'ambiguous' };

/**
 * The glyph a letter is compared by when the screen's glyphs are ambiguous: case is not observable (the game draws names
 * in small caps), `I`, `i`, `l` and `1` are one glyph, and `0` and `o` are one (the agent's `glyph_key`, CHR-10).
 */
function glyphOf(character: string): string {
  const lower = character.toLowerCase();
  if (lower === 'i' || lower === '1') return 'l';
  if (lower === '0') return 'o';
  return lower;
}

/** The letters the engine returned for an `o` on the real prints (F1 post-close item g, 43 wrong reads). */
const READ_FOR_O: ReadonlySet<string> = new Set(['g', 'e', 'b']);

function sameGlyphs(read: string, known: string): boolean {
  return (
    read.length === known.length &&
    read.split('').every((letter, at) => glyphOf(letter) === glyphOf(known.charAt(at)))
  );
}

/** Directional: a known `o` may be read as `g`, `e` or `b`; a known `g`, `e` or `b` is never matched by a read `o`. */
function sameGlyphsOrMisreadO(read: string, known: string): boolean {
  return (
    read.length === known.length &&
    read.split('').every((letter, at) => {
      const readGlyph = glyphOf(letter);
      const knownGlyph = glyphOf(known.charAt(at));
      return readGlyph === knownGlyph || (knownGlyph === 'o' && READ_FOR_O.has(readGlyph));
    })
  );
}

function resolve(indexes: readonly number[]): NameMatch {
  const [first] = indexes;
  if (first === undefined) return { kind: 'none' };
  return indexes.length === 1 ? { kind: 'one', index: first } : { kind: 'ambiguous' };
}

/**
 * Which of `known` the read name stands for. A name that equals one by the glyph folds wins over a looser one, so a known
 * `Sgrc` is read as `Sgrc` and not taken for a misread `Sorc`; only when no known name equals it by the folds does the
 * `o` read as `g`, `e` or `b` count. A read that stands for more than one name stands for none (`ambiguous`).
 */
export function matchCharacterName(read: string, known: readonly string[]): NameMatch {
  const strict = known.flatMap((name, index) => (sameGlyphs(read, name) ? [index] : []));
  if (strict.length > 0) return resolve(strict);
  return resolve(known.flatMap((name, index) => (sameGlyphsOrMisreadO(read, name) ? [index] : [])));
}
