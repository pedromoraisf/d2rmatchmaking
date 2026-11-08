// Polling rules for the PreToolUse gate (gate-precision, GPR-15 to GPR-18). Pure: a parsed command line and a
// history snapshot in, a decision and a history effect out; no I/O (gate.mjs applies the effect).
//
// A `sleep` whose durations add up past 30 s, a loop that sleeps or a `watch`, and the fifth identical command within
// ten minutes of one session are denied with one reason: run the long work in the background and wait for its task
// notification. A fail-open store (history-store.mjs) only means no repetition deny for that call.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseLine } from './shell-parse.mjs';

/** GPR-18: the one reason every polling deny carries. */
export const POLLING_REASON =
  'Do not poll. Run the long work in the background and wait for its task notification instead of sleeping, looping or watching.';

const SLEEP_LIMIT_SECONDS = 30;
const WINDOW_MS = 10 * 60 * 1000;
// The fourth identical call before this one passes; with four earlier calls in the window the fifth denies.
const MAX_EARLIER_REPEATS = 4;
const MAX_NESTING = 5;
const MAX_PREFIXES = 8;
const UNIT = { s: 1, m: 60, h: 3600, d: 86400 };
// A decimal number with an optional s, m, h or d suffix (`1e2`, `infinity` and `$N` do not match).
const DURATION = /^(\d+\.?\d*|\.\d+)([smhd])?$/;
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SHELL = /^(ba|z|da|k|fi)?sh$/;
const SHELL_COMMAND_FLAG = /^-[A-Za-z]*c[A-Za-z]*$/;
const LOOP_WORDS = new Set(['for', 'until', 'while']);
// Reserved words that open a loop or block body, so the command after them is the one read.
const RESERVED = new Set(['do', 'then', 'else', '{', '!']);
// Prefixes that run the command word after them (GPR-15); `xargs` appends input the gate cannot read.
const PREFIXES = new Set(['command', 'env', 'timeout', 'xargs', 'nohup', 'nice', 'time', 'exec']);
const VALUED_OPTIONS = {
  env: ['-u', '--unset', '-C', '--chdir', '-S', '--split-string'],
  timeout: ['-s', '--signal', '-k', '--kill-after'],
  nice: ['-n', '--adjustment'],
  xargs: [
    '-I',
    '-n',
    '-P',
    '-L',
    '-l',
    '-d',
    '-s',
    '-E',
    '-e',
    '-a',
    '--max-args',
    '--max-procs',
    '--delimiter',
    '--arg-file',
    '--replace',
  ],
};

const base = (text) => path.posix.basename(text);

/** Skip one prefix word and its options (and `timeout`'s duration); `xargs` marks what follows as unknown input. */
function skipPrefix(words) {
  const name = base(words[0].text);
  const valued = VALUED_OPTIONS[name] ?? [];
  let j = 1;
  while (j < words.length && words[j].text.startsWith('-')) j += valued.includes(words[j].text) ? 2 : 1;
  if (name === 'env') while (j < words.length && ASSIGN.test(words[j].text)) j++;
  if (name === 'timeout') j++; // the duration
  return { rest: words.slice(j), dynamic: name === 'xargs' };
}

/** Leading words that are not the command: `NAME=value` assignments and the reserved words opening a loop body. */
const isLeadingNoise = (word) => ASSIGN.test(word.text) || RESERVED.has(word.text);

/** The command word of a segment, read through the prefixes of GPR-15 and the leading assignments and keywords. */
function commandOf(words) {
  let rest = words;
  let dynamic = false;
  while (rest.length && isLeadingNoise(rest[0])) rest = rest.slice(1);
  for (let k = 0; k < MAX_PREFIXES && rest.length && PREFIXES.has(base(rest[0].text)); k++) {
    const step = skipPrefix(rest);
    rest = step.rest;
    dynamic = dynamic || step.dynamic;
    while (rest.length && isLeadingNoise(rest[0])) rest = rest.slice(1);
  }
  return {
    name: rest.length ? base(rest[0].text) : '',
    args: rest.slice(1),
    dynamic,
  };
}

/** Command text run by a nested shell (`sh -c`, `bash -lc`) or by `eval`; none for other commands. */
function nestedTexts({ name, args }) {
  if (name === 'eval') return [args.map((w) => w.text).join(' ')];
  if (!SHELL.test(name)) return [];
  const at = args.findIndex((w) => SHELL_COMMAND_FLAG.test(w.text));
  return at >= 0 ? [args[at + 1]?.text ?? ''] : [];
}

/** Seconds of one sleep operand, or Infinity when it is not a literal decimal duration. */
function operandSeconds(word) {
  if (word.expands) return Infinity;
  const m = DURATION.exec(word.text);
  if (!m) return Infinity;
  return Number(m[1]) * UNIT[m[2] ?? 's'];
}

/** Seconds of one `sleep` call. With no operand it sleeps for nothing, unless `xargs` feeds it unknown input. */
function sleepCallSeconds({ args, dynamic }) {
  if (dynamic) return Infinity;
  if (args.length === 0) return 0;
  return args.reduce((sum, w) => sum + operandSeconds(w), 0);
}

/**
 * Total `sleep` seconds of a command line, nested `sh -c`/`bash -c`/`eval` text included. Infinity for an argument
 * that is not a literal decimal (`infinity`, `1e2`, `$N`), for `xargs sleep`, and for nesting deeper than MAX_NESTING.
 */
export function sleepSeconds(parsed, depth = 0) {
  let total = 0;
  for (const seg of parsed.segments) {
    const cmd = commandOf(seg.words);
    if (cmd.name === 'sleep') total += sleepCallSeconds(cmd);
    for (const text of nestedTexts(cmd)) {
      if (depth >= MAX_NESTING) return Infinity;
      total += sleepSeconds(parseLine(text), depth + 1);
    }
  }
  return total;
}

/**
 * True when a loop (`for`, `until`, `while`) is followed by a `sleep` in the line, or the line runs `watch`; nested
 * shell text is read the same way (GPR-16).
 */
export function pollingLoop(parsed, depth = 0) {
  const firstLoop = parsed.segments.findIndex((seg) => LOOP_WORDS.has(seg.words[0]?.text));
  const cmds = parsed.segments.map((seg) => commandOf(seg.words));
  if (cmds.some((c) => c.name === 'watch')) return true;
  if (firstLoop >= 0 && cmds.slice(firstLoop).some((c) => c.name === 'sleep')) return true;
  if (depth >= MAX_NESTING) return false;
  return cmds.some((c) => nestedTexts(c).some((text) => pollingLoop(parseLine(text), depth + 1)));
}

const deny = () => ({ decision: 'deny', reason: POLLING_REASON, effects: [] });

/** GPR-15 and GPR-16 on one command line: `deny` with POLLING_REASON, or null. */
export function pollingDecision(parsed) {
  if (sleepSeconds(parsed) > SLEEP_LIMIT_SECONDS || pollingLoop(parsed)) return deny();
  return null;
}

/**
 * GPR-17: the fifth identical trimmed command within ten minutes in one session denies. `history` is the store's
 * snapshot `{ sessions: { [sid]: [{ hash, at }] } }` (pruned by the store). Every call, a denied one included, returns
 * the effect `{ op: 'history', sid, hash, at }` that gate.mjs applies (AD-158).
 */
export function repeatDecision(command, sid, history, now) {
  const text = String(command ?? '').trim();
  const hash = createHash('sha256').update(text).digest('hex');
  const session = String(sid ?? 'none');
  const entries = history?.sessions?.[session] ?? [];
  const earlier = entries.filter((e) => e.hash === hash && now - e.at < WINDOW_MS).length;
  const effects = [{ op: 'history', sid: session, hash, at: now }];
  if (earlier >= MAX_EARLIER_REPEATS) return { decision: 'deny', reason: POLLING_REASON, effects };
  return { decision: null, reason: '', effects };
}
