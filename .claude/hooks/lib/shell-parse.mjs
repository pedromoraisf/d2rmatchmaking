// Command-line tokenizer for the PreToolUse gate (gate-precision, GPR-01 to GPR-03). Pure: a string in, a shape out.
//
// Quote-aware: a single-quoted string is one literal word; operators (`|`, `&&`), redirections and expansions are
// recognised only outside single quotes. A `$` or a backtick inside double quotes still expands. Every GPR-03 shape
// that the read-only rule must refuse is listed in `unsafe`. Anything the tokenizer cannot read (an unbalanced quote,
// a line over 2 MB) gives `unsafe: ['unparsed']` and no segments, so no rule may allow it.

/** Lines over this many bytes are not tokenized (fail closed, GPR-20). */
export const MAX_LINE_BYTES = 2 * 1024 * 1024;

// Characters a safe word may hold without quotes (the spec's "Safe word" definition).
const SAFE_CHAR = /[A-Za-z0-9_./:@%+=,-]/;
// The four whole redirection tokens the read-only shape allows; they are taken out of the line.
const WHOLE_TOKENS = new Set(['2>&1', '>/dev/null', '2>/dev/null', '&>/dev/null']);
const BLANK = new Set([' ', '\t']);
const OPERATOR_CHARS = new Set(['|', '&', ';', '<', '>', '(', ')', '\n', '\r']);

class Unparsed extends Error {}

const unparsed = () => ({ segments: [], operators: [], unsafe: ['unparsed'] });
const newSegment = () => ({ words: [], redirections: [] });

/**
 * One word starting at `start`, stopping before an unquoted blank or operator character.
 * Adds the GPR-03 shapes it finds to `unsafe` (a Set).
 */
function readWord(src, start, unsafe) {
  let text = '';
  let quoted = 'none';
  let expands = false;
  let safe = true;
  let i = start;
  while (i < src.length) {
    const ch = src[i];
    if (BLANK.has(ch) || OPERATOR_CHARS.has(ch)) break;
    if (ch === "'") {
      const close = src.indexOf("'", i + 1);
      if (close < 0) throw new Unparsed('unbalanced single quote');
      const inner = src.slice(i + 1, close);
      if (inner.includes('`')) unsafe.add('backtick');
      text += inner;
      if (quoted === 'none') quoted = 'single';
      i = close + 1;
      continue;
    }
    if (ch === '"') {
      quoted = 'double';
      safe = false;
      i++;
      let closed = false;
      while (i < src.length) {
        const c = src[i];
        if (c === '"') {
          closed = true;
          i++;
          break;
        }
        if (c === '\\' && i + 1 < src.length && '"\\$`\n'.includes(src[i + 1])) {
          text += src[i + 1];
          i += 2;
          continue;
        }
        if (c === '$') {
          expands = true;
          unsafe.add('dollar');
        } else if (c === '`') {
          unsafe.add('backtick');
        }
        text += c;
        i++;
      }
      if (!closed) throw new Unparsed('unbalanced double quote');
      continue;
    }
    safe = safe && SAFE_CHAR.test(ch);
    if (ch === '\\') {
      unsafe.add('backslash');
      safe = false;
      text += src[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (ch === '$') {
      expands = true;
      unsafe.add('dollar');
    } else if (ch === '`') {
      unsafe.add('backtick');
    } else if (ch === '~') {
      unsafe.add('tilde');
    } else if (ch === '{' || ch === '}') {
      unsafe.add('brace');
    } else if (ch === '*' || ch === '?' || ch === '[') {
      unsafe.add('glob');
    }
    text += ch;
    i++;
  }
  return { word: { text, quoted, expands, safe }, end: i };
}

/**
 * A redirection at `pos` (`<`, `>` or the `&` of `&>`), with an optional file descriptor `fd` and the raw token's
 * start `tokenStart`. Returns the position after it. Whole tokens of the read-only shape are taken out.
 */
function readRedirect(src, pos, fd, tokenStart, state) {
  const { unsafe, segment } = state;
  const c = src[pos];
  let op;
  let j;
  if (c === '&') {
    op = src[pos + 2] === '>' ? '&>>' : '&>';
    j = pos + (op === '&>>' ? 3 : 2);
  } else if (c === '<') {
    if (src[pos + 1] === '(') {
      unsafe.add('process-sub');
      return pos + 1; // the `(` is then a subshell
    }
    if (src.startsWith('<<<', pos)) {
      op = '<<<';
      j = pos + 3;
    } else if (src.startsWith('<<', pos)) {
      op = '<<';
      j = pos + 2;
    } else {
      op = '<';
      j = pos + 1;
    }
  } else {
    if (src[pos + 1] === '(') {
      unsafe.add('process-sub');
      return pos + 1;
    }
    if (src[pos + 1] === '>') {
      op = '>>';
      j = pos + 2;
    } else if (src[pos + 1] === '|') {
      op = '>|';
      j = pos + 2;
    } else if (src[pos + 1] === '&') {
      op = '>&';
      j = pos + 2;
    } else {
      op = '>';
      j = pos + 1;
    }
  }
  while (j < src.length && BLANK.has(src[j])) j++;
  if (j >= src.length || OPERATOR_CHARS.has(src[j])) throw new Unparsed('redirection without a target');
  const { word, end } = readWord(src, j, unsafe);
  if (WHOLE_TOKENS.has(src.slice(tokenStart, end))) return end;
  unsafe.add('redirect');
  if (op === '>&') unsafe.add('>&word');
  if (op === '>|') unsafe.add('>|');
  if (op === '<' || op === '<<' || op === '<<<') unsafe.add(op);
  segment.redirections.push(fd === undefined ? { op, target: word.text } : { op, fd, target: word.text });
  return end;
}

/**
 * Tokenize a command line.
 * @returns {{ segments: { words: Word[], redirections: Redirection[] }[], operators: string[], unsafe: string[] }}
 *   Word = { text, quoted: 'none'|'single'|'double', expands, safe }; `safe` is true when the word is a safe word
 *   (unquoted safe characters and single-quoted strings only).
 */
export function parseLine(text) {
  const src = String(text ?? '');
  if (Buffer.byteLength(src, 'utf8') > MAX_LINE_BYTES) return unparsed();
  const unsafe = new Set();
  if (src.includes('\n')) unsafe.add('newline');
  if (src.includes('\r')) unsafe.add('carriage-return');
  const segments = [];
  const operators = [];
  let segment = newSegment();
  const state = { unsafe, segment };
  const endSegment = (op) => {
    operators.push(op);
    segments.push(segment);
    segment = newSegment();
    state.segment = segment;
  };
  try {
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      state.segment = segment;
      if (BLANK.has(ch)) {
        i++;
      } else if (ch === '\n' || ch === '\r') {
        endSegment('\n');
        i++;
      } else if (ch === '|') {
        if (src[i + 1] === '|') {
          unsafe.add('or');
          endSegment('||');
          i += 2;
        } else if (src[i + 1] === '&') {
          unsafe.add('pipe-stderr');
          endSegment('|&');
          i += 2;
        } else {
          endSegment('|');
          i++;
        }
      } else if (ch === '&') {
        if (src[i + 1] === '&') {
          endSegment('&&');
          i += 2;
        } else if (src[i + 1] === '>') {
          i = readRedirect(src, i, undefined, i, state);
        } else {
          unsafe.add('background');
          endSegment('&');
          i++;
        }
      } else if (ch === ';') {
        unsafe.add('semicolon');
        endSegment(';');
        i++;
      } else if (ch === '(' || ch === ')') {
        unsafe.add('subshell');
        endSegment(ch);
        i++;
      } else if (ch === '<' || ch === '>') {
        i = readRedirect(src, i, undefined, i, state);
      } else {
        const { word, end } = readWord(src, i, unsafe);
        if (
          end < src.length &&
          (src[end] === '<' || src[end] === '>') &&
          /^\d+$/.test(word.text) &&
          word.quoted === 'none'
        ) {
          i = readRedirect(src, end, Number(word.text), i, state);
        } else {
          segment.words.push(word);
          i = end;
        }
      }
    }
  } catch (err) {
    if (err instanceof Unparsed) return unparsed();
    throw err;
  }
  segments.push(segment);
  for (const seg of segments) {
    if (seg.words[0]?.text !== 'git') continue;
    // GPR-03: a glob or a leading `:` in a git path operand (quoted or not) is not an allowed shape.
    for (const w of seg.words.slice(1)) {
      if (!w.text.startsWith('-') && (/[*?[]/.test(w.text) || w.text.startsWith(':')))
        unsafe.add('git-pathspec');
    }
  }
  return { segments, operators, unsafe: [...unsafe] };
}

/** A word made from part of another word's text, keeping its quoting. */
const partWord = (w, text) => ({ text, quoted: w.quoted, expands: w.expands, safe: w.safe });

/**
 * Expand the options of one command. `words` are the words after the command word (Word objects from parseLine).
 * `spec.valued` lists the options that take a value (`-n`, `-A`, `--arg`…); `spec.arity` gives how many words a
 * valued option takes when it is not glued (default 1); `spec.digitsAsN` reads `-20` as `-n 20` (head, tail).
 * Clusters (`-la`) split into their letters; a valued letter takes the rest of the cluster (`-A3`) or the next word;
 * `--long=value` is one option; after `--`, every word is an operand.
 * Options are not checked here: the caller refuses any name its table does not allow.
 * @returns {{ options: { name: string, values: Word[], glued?: boolean, missing?: boolean }[], operands: Word[] }}
 */
export function expandOptions(words, spec = {}) {
  const valued = new Set(spec.valued ?? []);
  const arity = spec.arity ?? {};
  const options = [];
  const operands = [];
  let endOfOptions = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const t = w.text;
    if (endOfOptions) {
      operands.push(w);
    } else if (t === '--') {
      endOfOptions = true;
    } else if (t.startsWith('--')) {
      const eq = t.indexOf('=');
      if (eq >= 0) {
        options.push({ name: t.slice(0, eq), values: [partWord(w, t.slice(eq + 1))], glued: true });
      } else if (valued.has(t)) {
        const n = arity[t] ?? 1;
        const vals = words.slice(i + 1, i + 1 + n);
        options.push({ name: t, values: vals, missing: vals.length < n });
        i += vals.length;
      } else {
        options.push({ name: t, values: [] });
      }
    } else if (spec.digitsAsN && /^-\d+$/.test(t)) {
      options.push({ name: '-n', values: [partWord(w, t.slice(1))], glued: true });
    } else if (t.length > 1 && t.startsWith('-')) {
      const letters = t.slice(1);
      for (let k = 0; k < letters.length; k++) {
        const name = `-${letters[k]}`;
        if (!valued.has(name)) {
          options.push({ name, values: [] });
          continue;
        }
        const rest = letters.slice(k + 1);
        if (rest.length > 0) {
          options.push({ name, values: [partWord(w, rest)], glued: true });
        } else {
          const n = arity[name] ?? 1;
          const vals = words.slice(i + 1, i + 1 + n);
          options.push({ name, values: vals, missing: vals.length < n });
          i += vals.length;
        }
        break;
      }
    } else {
      operands.push(w);
    }
  }
  return { options, operands };
}
