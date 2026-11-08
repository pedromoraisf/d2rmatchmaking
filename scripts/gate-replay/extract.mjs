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
// A run of 20 or more hex or base64 characters that holds a digit (a hash, a token, an id).
const LONG_RUN = /[0-9A-Za-z+/=_-]{20,}/g;
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

// A word that names a checkout path or a command: the path rule (relative, no `..`, no link, no URL).
function pathWord(text) {
  if (text.includes('://') || text.includes('<') || text.startsWith('~') || text.startsWith('/'))
    return VALUE;
  if (text.split('/').includes('..')) return VALUE;
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
]);

/** One word of a re-emitted command. `isCommand` is true for the command word of a segment. */
function emitWord(word, isCommand, env) {
  if (word.quoted !== 'none' || word.expands) return VALUE;
  const text = word.text;
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

/**
 * A Bash command re-emitted word by word from parseLine (GPR-23, GPR-24). Command words, options, checkout paths,
 * revisions and file names survive; every other word, quoted string, option value, URL and here-document body becomes
 * `<v>`. Numbers survive. The four whole redirection tokens are re-added at the end. Returns null for a line that
 * cannot be read or that spans lines without a here-document.
 * `env.exists(name)` tells whether a plain word names an entry of the checkout.
 */
export function reemitBash(command, env = {}) {
  const lines = String(command ?? '').split('\n');
  const head = lines[0];
  const parsed = parseLine(head);
  if (parsed.unsafe.includes('unparsed')) return null;
  const heredoc = parsed.segments.some((seg) =>
    seg.redirections.some((r) => r.op === '<<' || r.op === '<<<'),
  );
  if (lines.length > 1 && !heredoc) return null;
  const parts = [];
  parsed.segments.forEach((seg, i) => {
    seg.words.forEach((w, k) => parts.push(emitWord(w, k === 0, env)));
    for (const r of seg.redirections) {
      parts.push(`${r.fd ?? ''}${r.op}`);
      parts.push(
        r.target.includes('/')
          ? pathWord(r.target)
          : emitWord(
              { text: r.target, quoted: 'none', expands: false, safe: SAFE_CHARS.test(r.target) },
              false,
              env,
            ),
      );
    }
    if (i < parsed.operators.length) parts.push(parsed.operators[i]);
  });
  for (const m of head.matchAll(WHOLE_TOKEN)) parts.push(m[2]);
  if (heredoc) parts.push(VALUE);
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

/** A gate reason as a list of safe words (edge punctuation dropped), or undefined when a word stays outside the grammar. */
export function cleanReason(text, env = {}) {
  if (!text) return undefined;
  const words = normalise(text, env)
    .split(/\s+/)
    .map((w) => w.replace(SENTENCE_EDGE, ''))
    .filter((w) => w.length > 0);
  if (words.length === 0) return undefined;
  if (!words.every((w) => /^[A-Za-z0-9_./:@%+=,-]+$/.test(w) || w === VALUE)) return undefined;
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
  const f0 = { decision: verdict.decision };
  if (reason) f0.reason = reason;
  const input = call.input ?? {};
  const pattern = reason ? reason.split(' ').slice(0, 8).join(' ') : undefined;
  switch (call.name) {
    case 'Bash': {
      const command = reemitBash(normalise(input.command ?? '', env), env);
      if (command === null) return { drop: 'unparsed' };
      return { entry: { tool: 'Bash', input: { command }, f0 } };
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
      return { entry: { tool: call.name, input: toolInput, f0 } };
    }
    case 'Agent': {
      const toolInput = { size: sizeBucket(String(input.prompt ?? '').length) };
      if (input.subagent_type) {
        if (!/^[A-Za-z0-9_.:-]+$/.test(input.subagent_type)) return { drop: 'unsafe-type' };
        toolInput.subagent_type = input.subagent_type;
      }
      if (pattern) toolInput.pattern = pattern;
      return { entry: { tool: 'Agent', input: toolInput, f0 } };
    }
    default:
      return { drop: 'tool' };
  }
}

// ----------------------------------------------------------------- categories

const SECRET_WORD =
  /(^|\/)\.env($|\.(?!example$)[^/\s]*$)|\.npmrc\b|\.netrc\b|\.git-credentials\b|id_(rsa|ed25519)|\.pem\b|\.key\b|credentials|hosts\.yml|\.dev\.vars|\.envrc|\.pypirc|\.tfvars|\.p12\b|\.pfx\b|\.jks\b|terraform\.tfstate/i;
const WRITE_OPERATOR = /(^|\s)(\d*>>?\|?|&>)\s*\S|(^|\s)tee(\s|$)|(^|\s)sed\s[^|;&]*\s-i/;
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

/** The command segments of a re-emitted line, split on the operators. */
const segmentsOf = (command) => command.split(/\s(?:\|\||\||&&|;|&)\s/).map((s) => s.trim());

/** Every checkout-level read: each segment starts with a read command (or a read git subcommand). */
function isReadOnlyLine(command) {
  const stripped = command.replace(WHOLE_TOKEN, ' ');
  return segmentsOf(stripped).every((seg) => {
    const words = seg.split(/\s+/).filter(Boolean);
    const [cmd, sub] = words;
    if (!cmd) return false;
    if (cmd === 'git')
      return READ_GIT.has(sub) && !words.some((w) => w === '-c' || /^-[dDmMfF]$|^--(delete|force)/.test(w));
    return READ_COMMANDS.has(cmd) && !(cmd === 'sed' && words.some((w) => w === '-i'));
  });
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
    if (/\.only\(\)/.test(reason)) return 'edit-content';
    if (/ledger|verdict/i.test(reason)) return 'edit-ledger';
    if (/quality-baseline/.test(file) || /quality-baseline/.test(reason)) return 'edit-baseline';
    return null;
  }
  if (tool !== 'Bash') return null;
  const command = input.command;
  if (/Quote the whole gate command|only through the wrapper|During a phase run/.test(reason))
    return 'wrapper';
  if (/Retry budget|BLOCKED|is blocked|Unknown dispatch|Commit refused|dispatch|retry ledger/i.test(reason))
    return null;
  if (/would bring in or rewrite/.test(reason)) return 'guard';
  if (/\bledger\b|verdicts?\.json|\.git\/d2rmm/i.test(command) || /ledger/i.test(reason)) return 'ledger';
  if (/git push\b[^|;&]*(--force|\s-f\b)/.test(command)) return 'force-push';
  if (/^(gh|git) (secret|variable)\b|^gh repo edit|^gh api .*(rulesets|environments|settings)/.test(command))
    return 'maintainer';
  if (/^git push\b|^gh (pr|release|workflow|run)\b/.test(command)) return 'delivery';
  const stripped = command.replace(WHOLE_TOKEN, ' ');
  if (WRITE_OPERATOR.test(stripped)) {
    const target = (stripped.match(/(?:^|\s)\d*>>?\|?\s*(\S+)/) ?? [])[1] ?? '';
    const rel = target.replace(/^<repo>\//, '');
    if (isSelfProtected(rel)) return 'shell-write-ask';
    if (isHarnessFile(rel) || /\.test\.|\.spec\.|^tests\//.test(rel)) return 'shell-write-deny';
    return null;
  }
  if (/(^|\s)sleep\s/.test(command) || /\b(while|until|watch)\b/.test(command)) {
    const sleeps = [...command.matchAll(/\bsleep\s+(\S+)/g)].map((m) => m[1]);
    const loop = /\b(while|until)\b/.test(command) || /(^|\s)watch(\s|$)/.test(command);
    const total = sleeps.reduce((sum, v) => (/^\d+$/.test(v) ? sum + Number(v) : Infinity), 0);
    return loop || total > 30 ? 'polling' : null;
  }
  if (SECRET_WORD.test(command.replace(/^<repo>\//, ''))) return 'secret-read';
  const words = command.split(/\s+/);
  if (/^(python3?|node|perl)$/.test(words[0]) && words.some((w) => w === '-c' || w === '-e'))
    return 'inline-code';
  const scriptWord = /^(node|bash|sh|python3?|perl)$/.test(words[0])
    ? words.slice(1).find((w) => SCRIPT_TOKEN.test(w))
    : SCRIPT_TOKEN.test(words[0]) || words[0].startsWith('./')
      ? words[0]
      : undefined;
  if (scriptWord) return /attempt\.mjs/.test(command) ? null : 'script';
  if (isReadOnlyLine(command)) {
    if (/Shell write/i.test(reason)) return 'read-not-write';
    return 'read-only';
  }
  if (/Invalid string length|cannot judge|not a text|unreadable/i.test(reason)) return 'script';
  return null;
}

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
        pairs.push({ call, result: { text: textOf(c.content), permission: rec.permissionDecision ?? null } });
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
    for (const { call, result } of pairCalls(records)) {
      const out = entryOf(call, result, env);
      if (out.drop) {
        if (out.drop !== 'no-verdict') count(out.drop);
        continue;
      }
      const category = categoryOf(out.entry);
      if (!category) {
        count(`category: ${out.entry.tool} ${out.entry.f0.decision}`);
        continue;
      }
      const entry = { id: '', category, ...out.entry };
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
