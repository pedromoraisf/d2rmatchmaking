#!/usr/bin/env node
// The F0 gate replay extractor (gate-precision, GPR-23 and GPR-24). Run by hand, never in CI:
//
//   node scripts/gate-replay/extract.mjs <transcript.jsonl | folder>...
//
// It reads the Claude Code session transcripts given on its command line, keeps the tool calls that a gate deny, a
// user-answered ask or a permission prompt answered, and writes scripts/test/fixtures/gate-replay.json. It keeps by
// ALLOW-LIST, never by deny-list: a Bash command is re-emitted word by word and only the words that name no value
// survive (everything else becomes `<v>`); the other tools keep only a file path or a subagent type, a size bucket and
// the gate pattern. No file content, no `old_string`/`new_string`, no prompt and no command text outside the allow-list
// reaches the fixture. The repository is public, so the fixture is reviewed line by line before it is committed.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSafeWord } from '../../.claude/hooks/lib/read-only.mjs';
import { parseLine } from '../../.claude/hooks/lib/shell-parse.mjs';
import { isHarnessFile, isSelfProtected } from '../../.claude/hooks/lib/gate-rules.mjs';

/** The placeholder for every word, path part or token that names a value. */
export const VALUE = '<v>';

// The safe-word characters of the spec's "Safe word" definition.
const SAFE_CHARS = /^[A-Za-z0-9_./:@%+=,-]+$/;
// A word of a re-emitted command that holds no value: a plain safe word.
const plainSafe = (text) => isSafeWord({ text, quoted: 'none', expands: false, safe: SAFE_CHARS.test(text) });

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"`<>)\];|&]*/gi;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const SCRATCHPAD = /(?:\/private)?\/tmp\/claude-\d+(?:\/[^\s'"/]+)*\/scratchpad(?=\/|[\s'"]|$)/g;
const HOME = /\/(?:Users|home)\/[^/\s'"]+/g;
// A run of 20 or more hex or base64 characters (the standard alphabet) that holds a digit (a hash, a token, an id).
const LONG_RUN = /[0-9A-Za-z+/]{20,}={0,2}/g;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Normalise one text: the repository → `<repo>`, the scratchpad → `<scratchpad>`, home directories → `~`, the user
 * name, e-mail addresses, URLs, session and other UUIDs, IP addresses and long hex or base64 runs → `<v>`.
 * `env` = { repo, user, scratchpad } (all optional; absent values are not replaced).
 */
export function normalise(text, env = {}) {
  let out = String(text ?? '');
  out = out.replace(URL, VALUE);
  out = out.replace(EMAIL, VALUE);
  out = out.replace(UUID, VALUE);
  out = out.replace(IPV4, VALUE);
  out = out.replace(SCRATCHPAD, '<scratchpad>');
  if (env.scratchpad) out = out.split(env.scratchpad).join('<scratchpad>');
  if (env.repo) out = out.split(env.repo).join('<repo>');
  out = out.replace(HOME, '~');
  if (env.user) out = out.replace(new RegExp(`\\b${escapeRe(env.user)}\\b`, 'g'), VALUE);
  out = out.replace(LONG_RUN, (run) => (/\d/.test(run) ? VALUE : run));
  return out;
}

// The whole redirection tokens that the parser takes out; they are re-added at the end (the gate takes them out too).
const WHOLE_TOKEN = /(^|\s)(2>&1|>\/dev\/null|2>\/dev\/null|&>\/dev\/null)(?=\s|$)/g;

// A word that names a checkout path or a command: the path rule (relative, no `..`, no link, no URL). The scratchpad
// keeps its placeholder and the file name below it, so a script there is still judged as outside the checkout.
function pathWord(text) {
  if (text.includes('://') || text.startsWith('~') || text.startsWith('/')) return VALUE;
  if (text.split('/').includes('..')) return VALUE;
  if (text.startsWith('<scratchpad>/')) {
    return plainSafe(text.slice('<scratchpad>/'.length)) ? text : VALUE;
  }
  let rel = text;
  if (rel.startsWith('<repo>/')) rel = rel.slice('<repo>/'.length);
  else if (rel === '<repo>') rel = '.';
  if (rel.includes('<')) return VALUE;
  return plainSafe(rel) ? rel : VALUE;
}

// Plain words a call names without a slash that stay: git refs, the subcommands of the tools the gate judges, and
// words with a file extension. A subcommand names a verb, not a value.
const REF_NAMES = new Set(['HEAD', 'main', 'origin']);
const SUBCOMMANDS = new Set([
  'log',
  'show',
  'status',
  'diff',
  'branch',
  'rev-parse',
  'ls-files',
  'describe',
  'blame',
  'grep',
  'add',
  'commit',
  'push',
  'fetch',
  'pull',
  'checkout',
  'switch',
  'rebase',
  'merge',
  'worktree',
  'stash',
  'tag',
  'remote',
  'config',
  'pr',
  'release',
  'workflow',
  'run',
  'view',
  'checks',
  'list',
  'api',
  'create',
  'edit',
  'secret',
  'variable',
  'exec',
  'test',
  'lint',
  'typecheck',
  'check',
  'build',
  'install',
  'help',
  'version',
  'filter',
  'nextest',
  'vitest',
  'stryker',
  'clippy',
  'fmt',
  'audit',
  'outdated',
  'phase',
  'specs',
  'contracts',
  'acceptance',
  'mutation',
  'quality',
  'harness',
  // Command names and shell keywords that a command runs (`command sleep 15`, `for …; do …; done`): names, not values.
  'sleep',
  'watch',
  'command',
  'env',
  'timeout',
  'xargs',
  'nohup',
  'exec',
  'time',
  'for',
  'do',
  'done',
  'case',
  'esac',
  'if',
  'then',
  'else',
  'fi',
  'while',
  'until',
  'break',
  'continue',
  'kill',
  'pkill',
  'ps',
  'uptime',
  'sysctl',
  'docker',
  'cargo',
  'npx',
  'pnpm',
  'npm',
  'python3',
  'python',
  'perl',
  'bash',
  'sh',
  'node',
  'gh',
  'git',
  'rm',
  'mkdir',
  'cp',
  'mv',
  'touch',
  'chmod',
  'ln',
  'tee',
  'awk',
  'curl',
  'wget',
  'test',
  'true',
  'false',
  'cut',
  'sort',
  'uniq',
  'tr',
  'head',
  'tail',
  'wc',
  'ls',
  'cat',
  'rg',
  'grep',
  'sed',
  'find',
  'diff',
  'jq',
  'echo',
  'printf',
  'which',
  'date',
  'pwd',
  'stat',
  'file',
  'tree',
  'du',
  'df',
  'cd',
  'mktemp',
  'install',
  'truncate',
]);

/** One word of a re-emitted command. `isCommand` is true for the command word of a segment. */
function emitWord(word, isCommand, env) {
  if (word.quoted !== 'none' || word.expands) return VALUE;
  const text = normalise(word.text, env);
  // A checkout or scratchpad path keeps its placeholder prefix to the path rule; any other `<` is a value.
  if (/^<(repo|scratchpad)>(\/|$)/.test(text)) return pathWord(text);
  if (text.includes('<')) return VALUE;
  if (/^\d+$/.test(text)) return text; // a number names no value; the table judges it as a number
  if (text.startsWith('-')) {
    if (text.includes('/')) return VALUE;
    return plainSafe(text) ? text : VALUE;
  }
  if (text.includes('/')) return pathWord(text);
  if (!plainSafe(text)) return VALUE;
  if (isCommand || REF_NAMES.has(text) || SUBCOMMANDS.has(text) || /\.[A-Za-z0-9]+$/.test(text)) return text;
  if (env.exists?.(text)) return text;
  return VALUE;
}

const HEREDOC_START = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/;

/**
 * Takes the body of every here-document out of a command (the lines after its start, through the delimiter line).
 * Returns the remaining text and how many bodies were taken out; the body is then one `<v>` in the re-emitted line.
 */
export function stripHeredocs(text) {
  const out = [];
  let delim = null;
  let heredocs = 0;
  for (const line of text.split('\n')) {
    if (delim !== null) {
      if (line.trim() === delim) delim = null;
      continue;
    }
    out.push(line);
    const start = HEREDOC_START.exec(line);
    if (start) {
      delim = start[2];
      heredocs++;
    }
  }
  return { text: out.join('\n'), heredocs };
}

/**
 * A Bash command re-emitted word by word from parseLine (GPR-23, GPR-24). The raw command is parsed, then each word is
 * normalised. Command words, options, checkout paths, revisions and file names survive; every other word, quoted
 * string, option value, URL and here-document body becomes `<v>`. Numbers survive. The four whole redirection tokens
 * are re-added at the end; a newline between commands becomes `;`. Returns null for a command that cannot be read.
 * `env.exists(name)` tells whether a plain word names an entry of the checkout.
 */
export function reemitBash(command, env = {}) {
  const { text, heredocs } = stripHeredocs(String(command ?? ''));
  const parsed = parseLine(text);
  if (parsed.unsafe.includes('unparsed')) return null;
  const parts = [];
  parsed.segments.forEach((seg, i) => {
    seg.words.forEach((w, k) => parts.push(emitWord(w, k === 0, env)));
    for (const r of seg.redirections) {
      parts.push(`${r.fd ?? ''}${r.op}`);
      parts.push(emitWord({ text: r.target, quoted: 'none', expands: false, safe: true }, false, env));
    }
    if (i < parsed.operators.length) parts.push(parsed.operators[i] === '\n' ? ';' : parsed.operators[i]);
  });
  for (const m of text.matchAll(WHOLE_TOKEN)) parts.push(m[2]);
  if (heredocs > 0) parts.push(VALUE);
  return parts.join(' ');
}

// The size bucket of a content length: never the content itself.
export function sizeBucket(length) {
  if (length < 1024) return '<1k';
  if (length < 100 * 1024) return '<100k';
  return '≥100k';
}

// A file path of the normalised form: safe characters, the placeholders `<repo>`, `<scratchpad>` and `~`.
const PATH_OK = /^(?:<repo>|<scratchpad>|~)?[A-Za-z0-9_./@%+=,-]*$/;
const cleanPath = (text) => {
  const out = normalise(text, {});
  return PATH_OK.test(out) && out.length > 0 ? out : null;
};

const SENTENCE_EDGE = /^[.,;:!?()"']+|[.,;:!?()"']+$/g;

// The gate's own denial counter (`[denial 1/3: …]`) is not part of the reason.
const DENIAL_SUFFIX = /\[denial[^\]]*\]/g;
// The placeholders a normalised reason may hold besides the safe words.
const REASON_PLACEHOLDERS = new Set([VALUE, '<repo>', '<scratchpad>']);

/**
 * A gate reason as a list of safe words (edge punctuation dropped, punctuation-only tokens dropped), or undefined when
 * a word stays outside the grammar (GPR-24): the reason is then left out of the entry, the call is kept.
 */
export function cleanReason(text, env = {}) {
  if (!text) return undefined;
  const words = normalise(String(text).replace(DENIAL_SUFFIX, ' '), env)
    .split(/\s+/)
    .map((w) => w.replace(SENTENCE_EDGE, ''))
    .filter((w) => /[A-Za-z0-9]/.test(w) || REASON_PLACEHOLDERS.has(w));
  if (words.length === 0) return undefined;
  if (!words.every((w) => REASON_PLACEHOLDERS.has(w) || /^[A-Za-z0-9_./:@%+=,-]+$/.test(w))) return undefined;
  return words.join(' ');
}

/** The text of a tool result: a string, or the joined text parts of a content array. */
export function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join('\n');
  return '';
}

const GATE_PREFIX = /^PreToolUse:\S+ hook error: \[d2rmm gate\]\s*/;
const USER_ANSWERED = new Set(['user_temporary', 'user_permanent', 'user_reject']);

/**
 * What one tool result says about the gate (GPR-23): `deny` for a gate hook error, `ask` for a permission prompt the
 * user answered, `prompt` for a permission prompt the classifier or the client denied. Null for every other result.
 */
export function classifyResult(result) {
  const text = result.text ?? '';
  if (GATE_PREFIX.test(text)) return { decision: 'deny', reason: text.replace(GATE_PREFIX, '').trim() };
  if (result.permission?.source === 'hook' && result.permission?.decision === 'reject') {
    return { decision: 'deny', reason: text.replace(GATE_PREFIX, '').trim() || undefined };
  }
  if (result.permission && USER_ANSWERED.has(result.permission.source)) return { decision: 'ask' };
  if (/^Permission (to use|for this action was denied)/.test(text)) return { decision: 'prompt' };
  return null;
}

/**
 * The entry of one tool call and its result (GPR-23, GPR-24). Returns `{ entry }` or `{ drop }` with the reason the
 * call was not kept. Only the allow-list reaches the entry: Bash → the re-emitted command; Edit, Write, Read → the
 * normalised file path, a size bucket; Agent → the subagent type, a size bucket; every tool → the gate pattern (the
 * first words of the reason) and the decision.
 */
export function entryOf(call, result, env = {}) {
  const verdict = classifyResult(result);
  if (!verdict) return { drop: 'no-verdict' };
  const reason = verdict.reason ? cleanReason(verdict.reason, env) : undefined;
  // The category reads the whole reason (the wrapper's text holds `<T#|…>`, which the fixture never keeps).
  const loose = verdict.reason ? normalise(verdict.reason.replace(DENIAL_SUFFIX, ' '), env) : undefined;
  const f0 = { decision: verdict.decision };
  if (reason) f0.reason = reason;
  const input = call.input ?? {};
  const pattern = reason ? reason.split(' ').slice(0, 8).join(' ') : undefined;
  switch (call.name) {
    case 'Bash': {
      const command = reemitBash(input.command ?? '', env);
      if (command === null) return { drop: 'unparsed' };
      return { entry: { tool: 'Bash', input: { command }, f0 }, loose };
    }
    case 'Edit':
    case 'Write':
    case 'Read': {
      const file = cleanPath(normalise(input.file_path ?? '', env));
      if (!file) return { drop: 'unsafe-path' };
      const content = input.new_string ?? input.content ?? '';
      const toolInput = {
        file_path: file,
        size: call.name === 'Read' ? '<1k' : sizeBucket(String(content).length),
      };
      if (pattern) toolInput.pattern = pattern;
      return { entry: { tool: call.name, input: toolInput, f0 }, loose };
    }
    case 'Agent': {
      const toolInput = { size: sizeBucket(String(input.prompt ?? '').length) };
      if (input.subagent_type) {
        if (!/^[A-Za-z0-9_.:-]+$/.test(input.subagent_type)) return { drop: 'unsafe-type' };
        toolInput.subagent_type = input.subagent_type;
      }
      if (pattern) toolInput.pattern = pattern;
      return { entry: { tool: 'Agent', input: toolInput, f0 }, loose };
    }
    default:
      return { drop: 'tool' };
  }
}

// ----------------------------------------------------------------- categories

const SECRET_WORD =
  /(^|\/)\.env($|\.(?!example$)[^/\s]*$)|\.npmrc\b|\.netrc\b|\.git-credentials\b|id_(rsa|ed25519)|\.pem\b|\.key\b|credentials|hosts\.yml|\.dev\.vars|\.envrc|\.pypirc|\.tfvars|\.p12\b|\.pfx\b|\.jks\b|terraform\.tfstate/i;
const READ_COMMANDS = new Set([
  'cat',
  'head',
  'tail',
  'wc',
  'ls',
  'rg',
  'grep',
  'sed',
  'find',
  'diff',
  'jq',
  'echo',
  'pwd',
  'stat',
  'file',
  'tree',
  'which',
  'date',
  'cd',
  'sort',
  'uniq',
  'cut',
  'tr',
  'true',
  'test',
  'command',
  'type',
  'du',
  'df',
  'env',
  'printf',
]);
const READ_GIT = new Set([
  'diff',
  'log',
  'show',
  'status',
  'ls-files',
  'rev-parse',
  'branch',
  'describe',
  'grep',
  'blame',
  'shortlog',
  'config',
  'cat-file',
  'rev-list',
  'check-ignore',
  'merge-base',
  'name-rev',
  'for-each-ref',
  'worktree',
]);
const SCRIPT_TOKEN = /(^|\/)[^\s/]+\.(sh|bash|mjs|cjs|js|py|ts)$/;

const OPERATOR_TOKENS = new Set(['|', '||', '|&', '&&', ';', '&', '(', ')']);
const REDIRECT_TOKEN = /^\d*(<<<?|<|>>?|>\||>&|&>>?)$/;
// The gate's ledger references (budget-rules.mjs LEDGER_REF): the ledger folder, its files and the environment override.
// A package scope (`@d2rmm/<package>`) is not the ledger folder (GPR-33): the `d2rmm/` here is not preceded by `@`.
const LEDGER_NAMES = /\.git\/d2rmm|(^|[^@\w])d2rmm\/|verdicts\.json|ledger\.json|D2RMM_LEDGER/;
const WHOLE_TOKENS = new Set(['2>&1', '>/dev/null', '2>/dev/null', '&>/dev/null']);
const FORCE_FLAG = /^--force|^-f$|^--force-with-lease/;
const GH_DELIVERY = new Set([
  'pr view',
  'pr merge',
  'pr create',
  'pr list',
  'pr checks',
  'release view',
  'release list',
  'release create',
  'workflow run',
  'workflow view',
  'workflow list',
  'run view',
  'run list',
]);

/** The words of each command of a re-emitted line: operators split them; redirections and their targets are left out. */
export function commandsOf(command) {
  const commands = [[]];
  const tokens = command.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (WHOLE_TOKENS.has(t)) continue;
    if (OPERATOR_TOKENS.has(t)) {
      commands.push([]);
    } else if (REDIRECT_TOKEN.test(t)) {
      i++;
    } else {
      commands.at(-1).push(t);
    }
  }
  return commands.filter((c) => c.length > 0);
}

/** The targets of the output redirections of a re-emitted line (`>`, `>>`, `>|`, `2>` …). */
function writeTargets(command) {
  const tokens = command.split(/\s+/).filter(Boolean);
  const targets = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (WHOLE_TOKENS.has(t)) continue;
    if (REDIRECT_TOKEN.test(t) && t.includes('>')) {
      targets.push((tokens[i + 1] ?? '').replace(/^<repo>\//, ''));
      i++;
    }
  }
  return targets;
}

/** A command that only reads: a read command or a read git subcommand, never a write flag. */
function isReadCommand(words) {
  const [cmd, sub] = words;
  if (cmd === 'git')
    return READ_GIT.has(sub) && !words.some((w) => w === '-c' || /^-[dDmMfF]$|^--(delete|force)/.test(w));
  return READ_COMMANDS.has(cmd) && !(cmd === 'sed' && words.includes('-i'));
}

/** A delivery command of an allowed shape (GPR-26): push without force, PR, release, workflow and run reads. */
function isDeliveryCommand(words) {
  const [cmd, sub] = words;
  if (cmd === 'git') return sub === 'push' && !words.some((w) => FORCE_FLAG.test(w));
  if (cmd === 'gh') return GH_DELIVERY.has(`${sub} ${words[2] ?? ''}`);
  return false;
}

/** A script run by a shell or interpreter, or run as the command word itself; the wrapper is not a script. */
function isScriptCommand(words) {
  const [cmd] = words;
  if (words.some((w) => /attempt\.mjs/.test(w))) return false;
  if (/^(node|bash|sh|python3?|perl)$/.test(cmd)) return words.slice(1).some((w) => SCRIPT_TOKEN.test(w));
  return SCRIPT_TOKEN.test(cmd) || cmd.startsWith('./');
}

/** A script that lives outside the checkout: the scratchpad placeholder before its name. */
function isOutsideScript(words) {
  if (!isScriptCommand(words)) return false;
  const [cmd] = words;
  const script = /^(node|bash|sh|python3?|perl)$/.test(cmd)
    ? words.slice(1).find((w) => SCRIPT_TOKEN.test(w))
    : cmd;
  return script !== undefined && script.startsWith('<scratchpad>/');
}

/** A sleep that adds up over 30 seconds, a sleep in a loop, or the `watch` command (GPR-15, GPR-16). */
function isPolling(command, commands) {
  if (commands.some((c) => c[0] === 'watch')) return true;
  const sleeps = [...command.matchAll(/(?:^|\s)sleep\s+(\S+)/g)].map((m) => m[1]);
  if (sleeps.length === 0) return false;
  if (/(^|\s)(for|while|until)\s/.test(command)) return true;
  const total = sleeps.reduce((sum, v) => (/^\d+$/.test(v) ? sum + Number(v) : Infinity), 0);
  return total > 30;
}

/** Repository settings, secrets and variables, and the production database: maintainer items of ADR 028 § 1. */
function isMaintainer(words) {
  const [cmd, sub] = words;
  if (cmd === 'gh' && (sub === 'secret' || sub === 'variable')) return true;
  if (cmd === 'gh' && sub === 'repo' && words[2] === 'edit') return true;
  return cmd === 'gh' && sub === 'api' && words.some((w) => /rulesets|environments|settings/.test(w));
}

/**
 * A line of the allowed read-only shapes (GPR-02, GPR-03): every command reads, the commands join with `|` and `&&`
 * only, nothing is written, and no word names a secret or the git common directory. No value (`<v>`) may stand in it.
 */
function readOnlyShape(command, commands) {
  if (commands.length === 0 || command.includes('<v>')) return false;
  if (command.split(/\s+/).some((t) => OPERATOR_TOKENS.has(t) && t !== '|' && t !== '&&')) return false;
  if (writeTargets(command).length > 0) return false;
  if (commands.some((c) => c.some((w) => SECRET_WORD.test(w) || /^\.git(\/|$)/.test(w)))) return false;
  return commands.every(isReadCommand);
}

/**
 * The category of a kept entry (GPR-23, GPR-26): the key of the expected-decision table of the replay test, or null
 * when the entry belongs to no category the replay can judge (the call depended on the retry ledger or on a file the
 * replay does not hold). Pure: the entry alone decides.
 */
export function categoryOf(entry) {
  const reason = entry.f0?.reason ?? '';
  const { tool, input } = entry;
  if (tool === 'Agent') return null; // dispatch depends on the retry ledger
  if (tool === 'Read')
    return SECRET_WORD.test(input.file_path ?? '') && entry.f0.decision !== 'ask' ? 'read-secret' : null;
  if (tool === 'Edit' || tool === 'Write') {
    const file = input.file_path ?? '';
    // A content rule (`.only()`) needs the new content, which the corpus does not hold: no category for it.
    if (/ledger|verdict/i.test(reason)) return 'edit-ledger';
    if (/quality-baseline/.test(file) || /quality-baseline/.test(reason)) return 'edit-baseline';
    return null;
  }
  if (tool !== 'Bash') return null;
  const command = input.command;
  // A deny that names the whole line, then the presence rules: a line holding one of these gets its decision whatever
  // the other commands on it are.
  const commands = commandsOf(command);
  // The ledger and the verdicts are named in the line itself, or the replay could not reproduce the deny.
  if (LEDGER_NAMES.test(command)) return 'ledger';
  // An allowed read-only shape is read-only whatever F0 answered (ro-0025: F0 denied it under an older wrapper rule).
  if (readOnlyShape(command, commands)) {
    return command.split(/\s+/).some((t) => WHOLE_TOKENS.has(t)) ? 'read-not-write' : 'read-only';
  }
  // The wrapper's denials name a sensor or a quoted command the line holds: a value (`<v>`) may hide it (a quoted
  // commit message, a sensor name in a runner's place), so those lines have no category.
  if (/Quote the whole gate command|only through the wrapper|During a phase run/.test(reason)) {
    if (command.includes('<v>') || ambiguousRunner(commands)) return null;
    return 'wrapper';
  }
  if (/Retry budget|BLOCKED|is blocked|Unknown dispatch|Commit refused|dispatch|retry ledger/i.test(reason))
    return null;
  // The guard (`git worktree`, `git branch`, `git merge-tree`) answers from the commits of the branches, which the
  // replay does not hold: its entries have no category.
  if (/would bring in or rewrite/.test(reason)) return null;
  if (commands.some((c) => c[0] === 'git' && c[1] === 'push' && c.some((w) => FORCE_FLAG.test(w))))
    return 'force-push';
  if (commands.some((c) => c.some((w) => SECRET_WORD.test(w.replace(/^<repo>\//, ''))))) return 'secret-read';
  // The git common directory and everything under it is a secret name too, in an operand of a table command (GPR-30).
  if (commands.some((c) => TABLE_COMMANDS.has(c[0]) && c.some((w) => /^\.git(\/|$)/.test(w))))
    return 'secret-read';
  if (isPolling(command, commands)) return 'polling';
  if (commands.some(isMaintainer)) return 'maintainer';
  const targets = writeTargets(command);
  if (targets.length > 0) {
    // Only a file of the checkout is a harness file; a scratch file (`<scratchpad>/…`) or an absolute path is not.
    if (!/^[^<~/]/.test(targets[0])) return null;
    if (isSelfProtected(targets[0])) return 'shell-write-ask';
    if (isHarnessFile(targets[0]) || /\.test\.|\.spec\.|^tests\//.test(targets[0])) return 'shell-write-deny';
    return null;
  }
  // The rest: every command of the line must be of one family for the line to have that family's decision. A line
  // with a value (`<v>`) is judged by the gate on that value (a path or a revision it cannot see), so the replay does
  // not claim its decision: those lines have no category.
  // A script outside the checkout is judged by its content; the replay holds none, so it is unreadable and asks.
  if (commands.some(isOutsideScript) && commands.every((c) => isReadCommand(c) || isScriptCommand(c)))
    return 'script';
  if (command.includes('<v>')) return null;
  // The allowed shapes join commands with `|` and `&&` only (GPR-03): any other separator is no shape at all.
  if (command.split(/\s+/).some((t) => OPERATOR_TOKENS.has(t) && t !== '|' && t !== '&&')) return null;
  const wholeTokens = command.split(/\s+/).some((t) => WHOLE_TOKENS.has(t));
  if (commands.length > 0 && commands.every(isReadCommand))
    return wholeTokens ? 'read-not-write' : 'read-only';
  // Push and PR commands are an allowed shape on a feature or phase branch only (ADR 028 § 1).
  const onFlowBranch = /^(feat|phase)\//.test(entry.branch ?? '');
  if (
    onFlowBranch &&
    commands.some(isDeliveryCommand) &&
    commands.every((c) => isReadCommand(c) || isDeliveryCommand(c))
  )
    return 'delivery';
  return null;
}

/** The read-only table's commands: a secret name in an operand of one of these denies (GPR-30). */
const TABLE_COMMANDS = new Set(['cat', 'head', 'tail', 'wc', 'rg', 'grep', 'sed', 'diff', 'jq', 'ls']);

/** The runners whose first word names a sensor or a script: a value there hides which one runs. */
const RUNNERS = new Set(['pnpm', 'npx', 'cargo', 'yarn', 'node', 'bash', 'sh']);
function ambiguousRunner(commands) {
  return commands.some((c) => {
    if (!RUNNERS.has(c[0])) return false;
    const names = c.slice(1).filter((w) => !w.startsWith('-') && w !== 'exec' && w !== 'run');
    return names[0] === '<v>';
  });
}

// A git branch name in the safe-word grammar (a name, never a value).
const BRANCH_NAME = /^[A-Za-z0-9_./-]{1,100}$/;

const dropKey = (entry) =>
  JSON.stringify([entry.tool, entry.input, entry.f0.decision, entry.f0.reason ?? null]);

/** Transcript records → tool calls paired with their results, in order. Pure. */
export function pairCalls(records) {
  const calls = new Map();
  const pairs = [];
  for (const rec of records) {
    const content = rec?.message?.content;
    if (!Array.isArray(content)) continue;
    if (rec.type === 'assistant') {
      for (const c of content)
        if (c?.type === 'tool_use') calls.set(c.id, { name: c.name, input: c.input ?? {} });
    } else if (rec.type === 'user') {
      for (const c of content) {
        if (c?.type !== 'tool_result') continue;
        const call = calls.get(c.tool_use_id);
        if (!call) continue;
        pairs.push({
          call,
          result: { text: textOf(c.content), permission: rec.permissionDecision ?? null },
          branch: typeof rec.gitBranch === 'string' ? rec.gitBranch : null,
        });
      }
    }
  }
  return pairs;
}

function walkJsonl(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walkJsonl(p);
    return e.name.endsWith('.jsonl') ? [p] : [];
  });
}

/** The checkout's main directory and the environment of the normalisation. */
export function environmentOf(cwd = process.cwd()) {
  let repo;
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    repo = path.dirname(path.resolve(cwd, common));
  } catch {
    repo = cwd;
  }
  return {
    repo,
    user: os.userInfo().username,
    exists: (name) => existsSync(path.join(repo, name)),
  };
}

/** Run the extractor over the given files and folders, returning the fixture and the drop counts. */
export function extract(paths, env) {
  const files = paths.flatMap((p) => (statSync(p).isDirectory() ? walkJsonl(p) : [p])).sort();
  const seen = new Set();
  const entries = [];
  const dropped = {};
  const count = (label) => {
    dropped[label] = (dropped[label] ?? 0) + 1;
  };
  for (const file of files) {
    const records = readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    for (const { call, result, branch } of pairCalls(records)) {
      const out = entryOf(call, result, env);
      if (out.drop) {
        if (out.drop !== 'no-verdict') count(out.drop);
        continue;
      }
      const category = categoryOf({
        ...out.entry,
        branch: branch && BRANCH_NAME.test(branch) ? branch : undefined,
        f0: { ...out.entry.f0, reason: out.loose ?? out.entry.f0.reason },
      });
      if (!category) {
        count(`category: ${out.entry.tool} ${out.entry.f0.decision}`);
        continue;
      }
      // The branch the session was on: a replayed push or merge is judged on it. A name outside the grammar is left out.
      const entry = { id: '', category, ...out.entry };
      if (branch && BRANCH_NAME.test(branch) && !branch.includes('..')) entry.branch = branch;
      const key = dropKey(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }
  }
  entries.forEach((e, i) => {
    e.id = `ro-${String(i + 1).padStart(4, '0')}`;
  });
  return { version: 1, entries, dropped };
}

function main(argv) {
  if (argv.length === 0) {
    console.error('usage: node scripts/gate-replay/extract.mjs <transcript.jsonl | folder>...');
    process.exit(2);
  }
  const env = environmentOf();
  const { version, entries, dropped } = extract(argv, env);
  const target = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'test',
    'fixtures',
    'gate-replay.json',
  );
  writeFileSync(target, `${JSON.stringify({ version, entries }, null, 2)}\n`);
  console.log(`kept ${entries.length} entries`);
  for (const [label, n] of Object.entries(dropped).sort()) console.log(`dropped ${n}: ${label}`);
  const byCategory = {};
  for (const e of entries) byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
  for (const [label, n] of Object.entries(byCategory).sort()) console.log(`kept ${n}: category ${label}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2));
