// The read-only shapes the gate allows (gate-precision, GPR-01 to GPR-03, GPR-30 to GPR-32).
// Part 1 is pure: a parsed line in, the table rows it matches out. Part 2 reads the checkout (realpath, stat, one
// `git` spawn per question) through `ctx`, and never touches the disk or git itself: gate.mjs builds `ctx` (io.mjs).
//
// A line is an allowed shape only when every segment is a row of READ_ONLY_TABLE, every word is a safe word, and
// the line holds nothing else (no unsafe shape, no redirection but the four whole tokens, no operator but `|`/`&&`).
// Each row lists the options it takes exactly; any other option, a glued form the row does not list, or a missing
// value makes the line not an allowed shape (GPR-02).
import path from 'node:path';
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

/** The table row a segment matches, with its options, operands, words and segment index; null when no row allows it. */
function matchSegment(seg, index) {
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
    return { row: row.command.join(' '), options, operands, words: seg.words, index };
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
  const rows = [];
  let first = 0;
  if (parsed.segments[0].words[0]?.text === 'cd') {
    const { words } = parsed.segments[0];
    const [, dir] = words;
    if (parsed.operators[0] !== '&&' || words.length !== 2 || !isSafeWord(dir)) return null;
    rows.push({ row: 'cd', options: [], operands: [dir], words, index: 0 });
    first = 1;
  }
  for (let k = first; k < parsed.segments.length; k++) {
    const m = matchSegment(parsed.segments[k], k);
    if (!m) return null;
    rows.push(m);
  }
  return rows;
}

// ---------------------------------------------------------------- part 2: the checkout, paths and secrets

const CAP_WORDS = 200;
const CAP_PATHS = 64;
const CAP_SPAWNS = 8;
const WORKTREE_ROOT = /^\.claude\/worktrees\/[^/]+$/;
const WORKTREE_PREFIX = /^(\.claude\/worktrees\/[^/]+)(\/|$)/;
// GPR-30 and the spec's "Secret name", on the last segment, letters ignored. `.env.example` is not a secret.
const SECRET_NAME = [
  /^\.env$/,
  /^\.env\.(?!example$)/,
  /^\.env~$/,
  /^\.(npmrc|netrc|git-credentials|dev\.vars|envrc|pypirc)$/,
  /^(credentials|hosts\.yml|terraform\.tfstate)$/,
  /^id_(rsa|ed25519)/,
  /\.(pem|key|tfvars|env|pfx|p12|jks)$/,
];

const deny = (reason) => ({ decision: 'deny', reason });
const ask = (reason) => ({ decision: 'ask', reason });
const under = (p, root) => p === root || p.startsWith(`${root}${path.sep}`);
const isTimedOut = (r) => r !== null && typeof r === 'object' && r.timedOut === true;

/**
 * Stops the walk through the checks. `prompt` is true when a deny check ran out of I/O time: that is an `ask`
 * (the deny check could not be made); otherwise the line gets no allow and the permission mode decides.
 */
class Stop extends Error {
  constructor(prompt) {
    super('the gate stopped a read-only check');
    this.prompt = prompt;
  }
}

/**
 * The I/O of the walk, bounded (GPR-20, the caps of GPR-01): every call counts, a timed-out call stops the walk, and
 * the eighth `git` spawn of a line is the last one it may make.
 */
function guardOf(ctx, budget) {
  return {
    realpath(p) {
      const r = ctx.realpath(p);
      if (isTimedOut(r)) throw new Stop(true); // a secret check needs the real path
      return r;
    },
    stat(p) {
      const r = ctx.stat(p);
      if (isTimedOut(r)) throw new Stop(false);
      return r;
    },
    git(args, opts) {
      budget.spawns += 1;
      if (budget.spawns > CAP_SPAWNS) throw new Stop(false);
      const r = ctx.git(args, opts);
      if (isTimedOut(r)) throw new Stop(false);
      return r;
    },
  };
}

/** The last segment of a path, lower-cased, with trailing `/` and `/.` removed before matching (GPR-30). */
function lastSegment(p) {
  let s = p;
  for (;;) {
    const t = s.replace(/\/\.?$/, '');
    if (t === s) break;
    s = t;
  }
  return s.split('/').pop().toLowerCase();
}

/** A secret name: the list above, or the git common directory and anything under it (its `d2rmm/` included). */
export function isSecretName(p, ctx, common = path.join(ctx.mainRoot ?? ctx.root, '.git')) {
  if (!p) return false;
  if (under(path.resolve(ctx.root, p), common)) return true;
  return SECRET_NAME.some((re) => re.test(lastSegment(p)));
}

const tableRowOf = (words) =>
  READ_ONLY_TABLE.find((r) => r.command.length <= words.length && r.command.every((c, i) => words[i] === c));

/**
 * GPR-30: a secret name in any operand, option value or `<rev>:<path>` of a table command, whatever its other options
 * and whether or not the line is an allowed shape. Returns the name found, or null.
 */
function secretOperand(parsed, ctx) {
  const common = path.join(ctx.mainRoot ?? ctx.root, '.git');
  for (const seg of parsed.segments) {
    const row = tableRowOf(seg.words.map((w) => w.text));
    if (!row) continue;
    for (const w of seg.words.slice(row.command.length)) {
      const hit = [w.text, ...w.text.split(/[=:]/)].find((c) => isSecretName(c, ctx, common));
      if (hit !== undefined) return hit;
    }
  }
  return null;
}

/** The real path of `p`, or of its nearest existing ancestor with the rest added (a path not written yet). */
function realOf(p, io) {
  const tail = [];
  let probe = path.resolve(p);
  for (;;) {
    const real = io.realpath(probe);
    if (real) return path.join(real, ...tail);
    const parent = path.dirname(probe);
    if (parent === probe) return path.resolve(p);
    tail.unshift(path.basename(probe));
    probe = parent;
  }
}

/** A directory inside the checkout, with no nested repository between it and the checkout root (GPR-31). */
function insideDir(real, top, io) {
  if (!under(real, top)) return false;
  const st = io.stat(real);
  if (!st || !st.isDirectory()) return false;
  for (let dir = real; ; dir = path.dirname(dir)) {
    if (dir === top) return true;
    if (WORKTREE_ROOT.test(path.relative(top, dir).split(path.sep).join('/'))) return true;
    if (io.stat(path.join(dir, '.git'))) return false;
  }
}

/** The directory the line runs in: the input's cwd, which must be a directory inside the checkout (GPR-31). */
function workingDir(input, top, io) {
  if (typeof input?.cwd !== 'string' || input.cwd === '') return null;
  const real = io.realpath(input.cwd);
  return real && insideDir(real, top, io) ? real : null;
}

/** The checkout a directory belongs to: its feature worktree, or the main checkout. */
function checkoutRootOf(base, top) {
  const m = WORKTREE_PREFIX.exec(path.relative(top, base).split(path.sep).join('/'));
  return m ? path.join(top, m[1]) : top;
}

/** Whether `rev` (or both ends of `A..B` / `A...B`) names a revision. Each question is one `git` spawn. */
function isRevisionText(text, base, io) {
  const isRev = (t) =>
    io.git(['rev-parse', '--verify', '--quiet', '--end-of-options', t], { cwd: base }) !== null;
  const range = /^(.+?)\.{2,3}(.+)$/.exec(text);
  return range ? isRev(range[1]) && isRev(range[2]) : isRev(text);
}

/**
 * The path operands of one matched segment, by how its command reads them (the spec's "Path operand"). `reads` are
 * read paths (file contents), `lists` are names a command lists, `revPaths` are the path halves of `<rev>:<path>`.
 * @returns {{ reads: string[], lists: string[], revPaths: string[] }}
 */
export function pathOperands(match, base, io) {
  const { row, operands, options, words } = match;
  const texts = (ws) => ws.map((w) => w.text);
  const reads = [];
  const lists = [];
  const revPaths = [];
  switch (row) {
    case 'cat':
    case 'head':
    case 'tail':
    case 'wc':
    case 'diff':
      reads.push(...texts(operands));
      break;
    case 'sed':
    case 'grep':
    case 'jq':
      reads.push(...texts(operands.slice(1)));
      break;
    case 'rg':
      if (options.some((o) => o.name === '--files')) lists.push(...texts(operands));
      else reads.push(...texts(operands.slice(1)));
      break;
    case 'ls':
    case 'find':
      lists.push(...(operands.length ? texts(operands) : ['.']));
      break;
    case 'git ls-files':
      lists.push(...texts(operands));
      break;
    case 'git diff':
    case 'git log':
    case 'git show': {
      const dash = words.findIndex((w) => w.text === '--' && w.quoted === 'none');
      for (const o of operands) {
        const beforeDash = dash < 0 || words.indexOf(o) < dash;
        if (o.text.includes(':')) revPaths.push(o.text.slice(o.text.indexOf(':') + 1));
        else if (!(beforeDash && isRevisionText(o.text, base, io))) reads.push(o.text);
      }
      break;
    }
    default:
      break;
  }
  for (const o of options) if (o.name === '-newer' && o.values[0]) reads.push(o.values[0].text);
  return { reads, lists, revPaths };
}

/** A read path (GPR-01): inside the checkout, not a secret, and a regular file with one link (its target too). */
function readOk(p, base, root, top, common, commonReal, io, ctx, rels) {
  const abs = path.resolve(base, p);
  const real = realOf(abs, io);
  if (!under(real, top) || under(real, commonReal)) return false;
  if (isSecretName(abs, ctx, common) || isSecretName(real, ctx, commonReal)) return false;
  const st = io.stat(real);
  if (!st || !st.isFile() || st.nlink !== 1) return false;
  rels.push(path.relative(root, abs), path.relative(root, real));
  return true;
}

/** A listed name or a `<rev>:<path>` path (GPR-01): inside the checkout, outside the git directory, not a secret. */
function insideOk(p, base, top, common, commonReal, io, ctx) {
  const abs = path.resolve(base, p);
  const real = realOf(abs, io);
  if (!under(real, top) || under(real, commonReal)) return false;
  return !isSecretName(abs, ctx, common) && !isSecretName(real, ctx, commonReal);
}

/** Every allowed-shape check of a line that passed matchShape. True when the line may be allowed. */
function shapeAllowed(rows, parsed, input, io, ctx) {
  const common = path.join(ctx.mainRoot ?? ctx.root, '.git');
  const top = io.realpath(ctx.mainRoot ?? ctx.root);
  if (!top) return false;
  const commonReal = realOf(common, io);
  let base = workingDir(input, top, io);
  if (!base) return false;
  let first = 0;
  if (rows[0].row === 'cd') {
    const real = io.realpath(path.resolve(base, rows[0].operands[0].text));
    if (!real || !insideDir(real, top, io)) return false;
    base = real;
    first = 1;
  }
  const root = checkoutRootOf(base, top);
  const rels = [];
  let count = 0;
  for (const match of rows.slice(first)) {
    const { reads, lists, revPaths } = pathOperands(match, base, io);
    count += reads.length + lists.length + revPaths.length;
    if (count > CAP_PATHS) return false;
    const needsRead =
      match.row === 'grep' || (match.row === 'rg' && !match.options.some((o) => o.name === '--files'));
    const afterPipe = match.index > 0 && parsed.operators[match.index - 1] === '|';
    if (needsRead && reads.length === 0 && !afterPipe) return false;
    for (const p of reads) if (!readOk(p, base, root, top, common, commonReal, io, ctx, rels)) return false;
    for (const p of [...lists, ...revPaths])
      if (!insideOk(p, base, top, common, commonReal, io, ctx)) return false;
    const recursive =
      match.row === 'find' || (match.row === 'ls' && match.options.some((o) => o.name === '-R'));
    if (recursive) {
      // A listing that starts at a directory holding the git directory would list it (GPR-31).
      for (const p of lists) if (under(commonReal, realOf(path.resolve(base, p), io))) return false;
    }
    if (match.row.startsWith('node scripts/') && base !== root) return false;
  }
  if (rels.length > 0) {
    // One batched check per line: untracked, ignored files among the read paths (`git check-ignore` would need stdin).
    const out = io.git(
      ['--literal-pathspecs', 'ls-files', '--others', '--ignored', '--exclude-standard', '--', ...rels],
      { cwd: root },
    );
    if (out === null) return false;
    const ignored = new Set(out.split('\n').filter(Boolean));
    if (rels.some((r) => ignored.has(r))) return false;
  }
  return true;
}

/**
 * GPR-01, GPR-30 and GPR-31 for one Bash line: `allow` for a read-only line inside the checkout, `deny` for a secret
 * name in a table command, `ask` when a deny check ran out of time, otherwise null (no opinion, no allow).
 */
export function readOnlyDecision(parsed, input, ctx) {
  const secret = secretOperand(parsed, ctx);
  if (secret !== null) {
    return deny(
      `${secret} is a secret name: the gate never reads it (GPR-30). Use .env.example for placeholders.`,
    );
  }
  const rows = matchShape(parsed);
  if (!rows) return null;
  if (parsed.segments.reduce((n, s) => n + s.words.length, 0) > CAP_WORDS) return null;
  try {
    const allowed = shapeAllowed(rows, parsed, input, guardOf(ctx, { spawns: 0 }), ctx);
    return allowed ? { decision: 'allow', reason: 'GPR-01: a read-only command inside the checkout.' } : null;
  } catch (err) {
    if (err instanceof Stop) {
      return err.prompt
        ? ask('The gate ran out of time checking a read (GPR-20). Asking instead of allowing.')
        : null;
    }
    throw err;
  }
}
