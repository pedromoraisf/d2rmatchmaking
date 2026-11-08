// The read-only shapes the gate allows (gate-precision, GPR-01 to GPR-03, GPR-32), part 1: the table and the shape.
// Pure, no I/O: a parsed line in, the table rows it matches out. Part 2 (path operands, secrets, the working
// directory) reads files and runs git, so it is written against `ctx` and lives in the same module below.
//
// A line is an allowed shape only when every segment is a row of READ_ONLY_TABLE, every word is a safe word, and
// the line holds nothing else (no unsafe shape, no redirection but the four whole tokens, no operator but `|`/`&&`).
// Each row lists the options it takes exactly; any other option, a glued form the row does not list, or a missing
// value makes the line not an allowed shape (GPR-02).
import { expandOptions } from './shell-parse.mjs';

const NUMBER = /^\d+$/;
const SIGNED_NUMBER = /^\+?\d+$/;
const SED_SCRIPT = /^(\d+(,\d+)?|\$)p$/;
const GH_POSITIONAL = /^(\d+|[\w./+-]+)$/;
// GPR-32 / the jq row: these words, matched whole, can read the environment or other files.
const JQ_BANNED = /(^|[^\w$])(env|\$ENV|input|inputs|input_filename|include|import|\$__loc__)(?!\w)/;
const FIND_VALUED = [
  '-name',
  '-iname',
  '-path',
  '-type',
  '-maxdepth',
  '-mindepth',
  '-newer',
  '-size',
  '-mtime',
];
const FIND_FLAGS = ['-empty', '-prune', '-print', '-print0', '-not', '-o', '-a', '!', '(', ')'];

const none = (operands) => operands.length === 0;
const firstIsPattern = (operands) => operands.length >= 1;
const ghPositionals = (operands) =>
  operands.every((o) => GH_POSITIONAL.test(o.text) && !o.text.includes('//'));
const GH_LISTING = [
  '--json',
  '-L',
  '--limit',
  '--state',
  '--head',
  '--base',
  '--log',
  '--log-failed',
  '--name-only',
  '--required',
];

/** `find`: its own walk, because its predicates are not getopt options (`!`, `(`, `)`, `-o`, `-a`). */
function parseFind(args) {
  const options = [];
  const operands = [];
  for (let i = 0; i < args.length; i++) {
    const t = args[i].text;
    if (FIND_VALUED.includes(t)) {
      const value = args[i + 1];
      options.push({ name: t, values: value ? [value] : [], missing: !value });
      if (value) i++;
    } else if (t.startsWith('-') || t === '!' || t === '(' || t === ')') {
      options.push({ name: t, values: [] });
    } else {
      operands.push(args[i]);
    }
  }
  return { options, operands };
}

/** One row per command of the spec's read-only table. `command` is the words that name it, bare. */
export const READ_ONLY_TABLE = [
  { command: ['cat'], allowed: ['-n'] },
  {
    command: ['sed'],
    allowed: ['-n'],
    operands: (ops, options) =>
      options.some((o) => o.name === '-n') && ops.length >= 1 && SED_SCRIPT.test(ops[0].text),
  },
  {
    command: ['grep'],
    allowed: ['-n', '-i', '-E', '-F', '-v', '-c', '-l', '-w', '-o', '-A', '-B', '-C', '-m'],
    valued: ['-A', '-B', '-C', '-m'],
    numeric: ['-A', '-B', '-C', '-m'],
    operands: firstIsPattern,
  },
  {
    command: ['rg'],
    allowed: ['-n', '-i', '-S', '-F', '-w', '-l', '-c', '-A', '-B', '-C', '-t', '--files'],
    valued: ['-A', '-B', '-C', '-t'],
    numeric: ['-A', '-B', '-C'],
    operands: (ops, options) => options.some((o) => o.name === '--files') || firstIsPattern(ops),
  },
  {
    command: ['head'],
    allowed: ['-n', '-c'],
    valued: ['-n', '-c'],
    numeric: ['-n', '-c'],
    digitsAsN: true,
  },
  {
    command: ['tail'],
    allowed: ['-n', '-c'],
    valued: ['-n', '-c'],
    numeric: ['-n', '-c'],
    numericPattern: SIGNED_NUMBER,
    digitsAsN: true,
  },
  { command: ['wc'], allowed: ['-l', '-w', '-c', '-m'] },
  {
    command: ['ls'],
    allowed: ['-l', '-a', '-A', '-h', '-R', '-1', '-t', '-r', '-S', '-d'],
  },
  {
    command: ['find'],
    allowed: [...FIND_VALUED, ...FIND_FLAGS],
    valued: FIND_VALUED,
    numeric: ['-maxdepth', '-mindepth'],
    parse: parseFind,
  },
  {
    command: ['jq'],
    allowed: ['-r', '-c', '-e', '-s', '-S', '-n', '--arg'],
    valued: ['--arg'],
    arity: { '--arg': 2 },
    operands: (ops) => ops.length >= 1 && !JQ_BANNED.test(ops[0].text),
  },
  { command: ['diff'], allowed: ['-u', '-U', '-q', '-b', '-w'], valued: ['-U'], numeric: ['-U'] },
  { command: ['git', 'status'], allowed: ['--short', '-s', '--branch', '-b', '--porcelain'] },
  {
    command: ['git', 'rev-parse'],
    allowed: ['--short', '--abbrev-ref', '--show-toplevel', '--git-common-dir', '--verify', '--quiet'],
  },
  {
    command: ['git', 'ls-files'],
    allowed: ['--others', '-o', '--exclude-standard', '--error-unmatch', '--cached', '-c'],
  },
  // git diff, git log and git show take the same options. `--format`, `--pretty` and `--color` take only the `=` form
  // the table lists (`--format=F`, `--color=never`).
  ...['diff', 'log', 'show'].map((sub) => ({
    command: ['git', sub],
    allowed: [
      '--stat',
      '--shortstat',
      '--name-only',
      '--name-status',
      '--oneline',
      '-n',
      '-p',
      '--patch',
      '--graph',
      '--decorate',
      '--cached',
      '--staged',
      '--no-color',
      '--format',
      '--pretty',
      '--color',
    ],
    valued: ['-n'],
    numeric: ['-n'],
    digitsAsN: true,
    equalsOnly: ['--format', '--pretty', '--color'],
    values: { '--color': /^never$/ },
  })),
  {
    command: ['git', 'branch'],
    allowed: ['--list', '-a', '-r', '-v', '--show-current', '--contains', '--merged'],
    valued: ['--contains'],
    operands: none,
  },
  {
    command: ['git', 'fetch'],
    allowed: ['--prune', '--tags', '-q'],
    // The remote is origin only, and a refspec has no `:`.
    operands: (ops) => ops.every((o, i) => (i === 0 ? o.text === 'origin' : !o.text.includes(':'))),
  },
  {
    command: ['gh', 'run', 'view'],
    allowed: GH_LISTING,
    valued: GH_LISTING.slice(0, 6),
    numeric: ['-L', '--limit'],
    operands: ghPositionals,
  },
  {
    command: ['gh', 'run', 'list'],
    allowed: GH_LISTING,
    valued: GH_LISTING.slice(0, 6),
    numeric: ['-L', '--limit'],
    operands: ghPositionals,
  },
  {
    command: ['gh', 'pr', 'view'],
    allowed: GH_LISTING,
    valued: GH_LISTING.slice(0, 6),
    numeric: ['-L', '--limit'],
    operands: ghPositionals,
  },
  {
    command: ['gh', 'pr', 'list'],
    allowed: GH_LISTING,
    valued: GH_LISTING.slice(0, 6),
    numeric: ['-L', '--limit'],
    operands: ghPositionals,
  },
  {
    command: ['gh', 'pr', 'checks'],
    allowed: GH_LISTING,
    valued: GH_LISTING.slice(0, 6),
    numeric: ['-L', '--limit'],
    operands: ghPositionals,
  },
  {
    command: ['gh', 'pr', 'diff'],
    allowed: GH_LISTING,
    valued: GH_LISTING.slice(0, 6),
    numeric: ['-L', '--limit'],
    operands: ghPositionals,
  },
  {
    command: ['gh', 'api'],
    allowed: ['-H', '--paginate', '-X', '--method'],
    valued: ['-H', '-X', '--method'],
    glue: ['-H'],
    values: { '-H': /^(Accept|X-GitHub-Api-Version):/, '-X': /^GET$/, '--method': /^GET$/ },
    // A repository endpoint only: no scheme, no host.
    operands: (ops) => ops.length === 1 && /^\/?repos\//.test(ops[0].text),
  },
  {
    command: ['node', 'scripts/phase-status.mjs'],
    allowed: ['--json'],
    operands: (ops) => ops.length === 1 && /^F\d+$/.test(ops[0].text),
  },
  {
    command: ['node', 'scripts/attempt.mjs', 'status'],
    allowed: ['--feature'],
    valued: ['--feature'],
    operands: none,
  },
  {
    command: ['node', 'scripts/attempt.mjs', 'report'],
    allowed: ['--feature'],
    valued: ['--feature'],
    operands: none,
  },
  { command: ['echo'], allowed: [] },
];

/**
 * A word the read-only shapes may hold: a safe word (no expansion, no double quotes, unquoted characters from the
 * safe set or single-quoted text), and no word starting with `=` (GPR-02, the spec's "Safe word").
 */
export function isSafeWord(word) {
  if (!word || word.expands || word.quoted === 'double') return false;
  if (word.text.startsWith('=')) return false;
  return word.safe === true;
}

/** Whether a segment's option list is the row's: listed names, whole values, numbers as numbers, no bare `=` form. */
function optionsAllowed(row, options) {
  for (const o of options) {
    if (!row.allowed.includes(o.name) || o.missing) return false;
    const long = o.name.startsWith('--');
    if (row.equalsOnly?.includes(o.name) && !o.glued) return false;
    // A glued single-dash value (`-A3`, `-H'Accept: x'`) only where the row allows it; `--name=value` is matched whole.
    if (o.glued && !long && !row.numeric?.includes(o.name) && !row.glue?.includes(o.name)) return false;
    for (const v of o.values) if (!isSafeWord(v)) return false;
    const [value] = o.values;
    if (value && row.values?.[o.name] && !row.values[o.name].test(value.text)) return false;
    if (value && row.numeric?.includes(o.name) && !(row.numericPattern ?? NUMBER).test(value.text))
      return false;
    if (!value && (row.numeric?.includes(o.name) || row.values?.[o.name])) return false;
  }
  return true;
}

/** The table row a segment matches, with its options and operands; null when no row allows it. */
function matchSegment(seg) {
  if (seg.words.length === 0 || seg.redirections.length > 0) return null;
  if (!seg.words.every(isSafeWord)) return null;
  for (const row of READ_ONLY_TABLE) {
    if (row.command.length > seg.words.length) continue;
    if (!row.command.every((c, i) => seg.words[i].text === c)) continue;
    const args = seg.words.slice(row.command.length);
    const spec = { valued: row.valued ?? [], arity: row.arity, digitsAsN: row.digitsAsN };
    const { options, operands } = row.parse ? row.parse(args) : expandOptions(args, spec);
    if (!optionsAllowed(row, options)) return null;
    if (row.operands && !row.operands(operands, options)) return null;
    return { row: row.command.join(' '), options, operands };
  }
  return null;
}

/**
 * The table rows of a parsed line (see shell-parse.mjs), one per segment, or null when the line is not an allowed
 * shape. A leading `cd <dir> &&` is allowed and comes back as the row `cd` with its one operand; part 2 resolves it.
 */
export function matchShape(parsed) {
  if (!parsed || parsed.unsafe.length > 0 || parsed.segments.length === 0) return null;
  if (parsed.operators.some((op) => op !== '|' && op !== '&&')) return null;
  let segments = parsed.segments;
  const rows = [];
  if (segments[0].words[0]?.text === 'cd') {
    const [, dir] = segments[0].words;
    if (parsed.operators[0] !== '&&' || segments[0].words.length !== 2 || !isSafeWord(dir)) return null;
    rows.push({ row: 'cd', options: [], operands: [dir] });
    segments = segments.slice(1);
  }
  for (const seg of segments) {
    const m = matchSegment(seg);
    if (!m) return null;
    rows.push(m);
  }
  return rows;
}
