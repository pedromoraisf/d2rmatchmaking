// GPR-23 to GPR-26 (gate-precision): the F0 replay. Each corpus entry is decided by the gate's own `decide` with a
// fake context whose disk, git and branch answers come from the table of this file; the decision must equal the
// expected decision of the entry's category, which is fixed here and not in the corpus.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { checkBash, decide } from '../../.claude/hooks/lib/gate-rules.mjs';
import { toRelative } from '../../.claude/hooks/lib/io.mjs';
import { RULE_MODULES } from '../../.claude/hooks/test/rule-modules.mjs';
import { emptyLedger } from '../lib/budget.mjs';

const fixture = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'gate-replay.json'),
    'utf8',
  ),
);
const { entries } = fixture;

// GPR-26: the expected decision of each category. `allow` for read-only commands and the delivery commands of the
// allowed shapes; `deny` for secret reads, the ledger, force pushes, the guard, polling, the wrapper and the harness
// writes; `ask` for scripts the replay cannot read, maintainer items and writes to self-protected files.
const EXPECTED = {
  'read-only': 'allow',
  'read-not-write': 'allow',
  delivery: 'allow',
  polling: 'deny',
  wrapper: 'deny',
  ledger: 'deny',
  'force-push': 'deny',
  guard: 'deny',
  'secret-read': 'deny',
  'read-secret': 'deny',
  'shell-write-deny': 'deny',
  'edit-ledger': 'deny',
  'shell-write-ask': 'ask',
  maintainer: 'ask',
  script: 'ask',
  'edit-baseline': 'ask',
};

// The replay's world: a checkout at ROOT on a feature branch, scratch files outside it, no ignored files.
const ROOT = '/repo';
const SCRATCH = '/scratch';
const HOME = '/home/replay';
const BRANCH = 'feat/F0-gate-precision';
const REVISIONS = new Set(['HEAD', 'main', 'origin/main']);
const DOT_FILES = new Set([
  '.env',
  '.npmrc',
  '.netrc',
  '.envrc',
  '.gitignore',
  '.gitleaksignore',
  '.nvmrc',
  '.prettierignore',
]);
// The F0 phase as the corpus was recorded: running, its four scopes delegated and approved (the brief's Delegation).
const BRIEF = [
  '# F0 brief (replay model)',
  '## Delegation',
  "- [x] specs-and-tasks: approve each feature's spec.md and tasks.md once they pass the automatic gates",
  '- [x] sub-agents: dispatch feature workers (worktrees), the Verifier and the reviewer subagents',
  '- [x] harness-edits: edit sensor/harness configuration to tighten or extend it (hooks and settings.json still ask)',
  '- [x] local-merge-phase-branch: merge green feature branches into phase/F0 locally',
  '',
  '**Approved**: 2026-10-30 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch"',
].join('\n');
const PHASE_FILES = { '.specs/phases/ACTIVE': 'F0\n', '.specs/phases/F0/brief.md': BRIEF };
const phaseFile = (rel) => PHASE_FILES[rel] ?? null;

/** A checkout-relative path is a file when its last name has an extension, a directory otherwise. */
function kindOf(rel) {
  const parts = rel.split('/').filter(Boolean);
  const base = parts.at(-1) ?? '';
  if (base === '') return 'dir';
  // A worktree's `.git` is a file that names the common directory; the main checkout's `.git` is a directory.
  if (base === '.git')
    return parts.length === 4 && parts[0] === '.claude' && parts[1] === 'worktrees' ? 'file' : 'dir';
  if (DOT_FILES.has(base) || /^[^.].*\.[A-Za-z0-9_-]+$|^\..+\.[A-Za-z0-9_-]+$/.test(base)) return 'file';
  return 'dir';
}

/** The checkout-relative path of an absolute path under ROOT, or null outside it. */
function relOf(abs) {
  if (abs === ROOT) return '';
  return abs.startsWith(`${ROOT}/`) ? abs.slice(ROOT.length + 1) : null;
}

function statOf(abs) {
  const rel = relOf(abs);
  if (rel === null) return null;
  const kind = kindOf(rel);
  return { isFile: () => kind === 'file', isDirectory: () => kind === 'dir', nlink: 1 };
}

/** `git` answers: the revisions and the branch the call was made on; tracked files; nothing ignored. */
function fakeGit(args, branch) {
  if (args[0] === 'rev-parse') {
    if (args.includes('--git-common-dir')) return '.git';
    if (args.includes('--abbrev-ref')) return branch;
    return REVISIONS.has(args.at(-1)) ? 'sha' : null;
  }
  if (args.includes('ls-files')) {
    if (args.includes('--ignored')) return '';
    const paths = args.slice(args.indexOf('--') + 1);
    return paths.filter((p) => kindOf(p) === 'file').join('\n');
  }
  return null;
}

/** The context of one call: the branch the session was on (the corpus's `branch`, else the replay's default). */
function replayCtx(branch = BRANCH) {
  return {
    root: ROOT,
    mainRoot: ROOT,
    modules: RULE_MODULES,
    ledger: emptyLedger(),
    verdicts: {},
    now: () => '2026-11-08T00:00:00.000Z',
    nowMs: () => 0,
    // No script content is in the corpus: a script is unreadable, so it asks (GPR-12).
    readFile: (rel) => phaseFile(rel),
    readMainFile: (rel) => phaseFile(rel),
    isTracked: (rel) => kindOf(rel) === 'file',
    currentBranch: () => branch,
    headTime: () => 1,
    git: (...called) => fakeGit(Array.isArray(called[0]) ? called[0] : called, branch),
    realpath: (p) =>
      relOf(p) !== null || p.startsWith(`${SCRATCH}/`) || p.startsWith(`${HOME}/`) ? p : null,
    stat: (p) => statOf(p),
  };
}

/** A corpus entry as the gate's call: `<v>` is a neutral word, the placeholders of paths map to the replay's roots. */
function callOf(entry) {
  if (entry.tool === 'Bash') {
    return { tool_name: 'Bash', tool_input: { command: entry.input.command.replace(/<v>/g, 'v') } };
  }
  const file = entry.input.file_path ?? '';
  const abs = file
    .replace(/^<repo>/, ROOT)
    .replace(/^<scratchpad>/, SCRATCH)
    .replace(/^~/, HOME);
  return { tool_name: entry.tool, tool_input: { file_path: abs } };
}

const inputOf = (entry) => ({ session_id: 'f0-replay', cwd: ROOT, ...callOf(entry) });

/** `allow` when the gate allows, `deny` or `ask` when it stops, `none` when it has no opinion (the prompt stays). */
function decisionOf(entry) {
  const r = decide(inputOf(entry), replayCtx(entry.branch), toRelative);
  return r?.decision ?? 'none';
}

test('replays F0 with the expected decisions', () => {
  const wrong = [];
  for (const entry of entries) {
    const expected = EXPECTED[entry.category];
    assert.ok(expected, `${entry.id}: the category ${entry.category} has an expected decision`);
    const got = decisionOf(entry);
    if (got !== expected) wrong.push(`${entry.id} ${entry.category}: expected ${expected}, got ${got}`);
  }
  assert.deepEqual(wrong, [], 'every entry decides as its category says');
});

test('covers the F0 friction rows', () => {
  const has = (pred) => entries.some(pred);
  // brief revision 6 § 1: permission prompts for read-only shell commands
  assert.ok(
    has((e) => e.category === 'read-only' && e.f0.decision !== 'deny'),
    'a read-only command that F0 prompted',
  );
  // "Shell write to a harness/sensor file" on reads (`2>&1`, `2>/dev/null`)
  assert.ok(
    has((e) => e.category === 'read-not-write' && /2>&1|2>\/dev\/null/.test(e.input.command ?? '')),
    'a read with 2>&1 or 2>/dev/null that F0 stopped',
  );
  // asks for scripts outside the repo, gate errors
  assert.ok(
    has((e) => e.category === 'script' && e.f0.decision === 'ask'),
    'a script F0 asked for',
  );
  // polling and sleep
  assert.ok(
    has((e) => e.category === 'polling'),
    'a polling loop or a long sleep',
  );
});

const PATH_OK = /^(<repo>|<scratchpad>|~)?[A-Za-z0-9_./@%+=,-]*$/;
const COMMAND_OK = /^[A-Za-z0-9_./:@%+=,\-<>|&;() ]*$/;
const REASON_WORD = /^(<v>|<repo>|<scratchpad>|[A-Za-z0-9_./:@%+=,-]+)$/;

test('holds nothing private', () => {
  const text = JSON.stringify(fixture);
  assert.ok(!/\/Users\/|\/home\//.test(text), 'no home directory');
  assert.ok(
    !/\/private\/|\/tmp\/claude-|scratchpad\//.test(text.replace(/<scratchpad>/g, '')),
    'no scratchpad path',
  );
  assert.ok(!/[\w.+-]+@[\w-]+(\.[\w-]+)+/.test(text), 'no e-mail address');
  for (const m of text.matchAll(/:\/\/([^/\s"\\]+)/g)) {
    assert.ok(
      ['github.com', 'localhost'].includes(m[1]),
      `no host other than github.com and localhost: ${m[1]}`,
    );
  }
  for (const run of text.matchAll(/[0-9A-Za-z+/]{20,}/g)) {
    assert.ok(!/\d/.test(run[0]), `no run of 20 or more hex or base64 characters: ${run[0]}`);
  }
  for (const e of entries) {
    if (e.input.command !== undefined) assert.match(e.input.command, COMMAND_OK, e.id);
    if (e.input.file_path !== undefined) assert.match(e.input.file_path, PATH_OK, e.id);
    if (e.f0.reason !== undefined) {
      for (const word of e.f0.reason.split(' ')) assert.match(word, REASON_WORD, e.id);
    }
  }
});

test('never allows what an old rule stops', () => {
  // The old rules are the same rules without the read-only step: a context with no I/O skips it (GPR-04).
  const offending = [];
  for (const entry of entries) {
    if (decisionOf(entry) !== 'allow' || entry.tool !== 'Bash') continue;
    const input = inputOf(entry);
    const oldCtx = { ...replayCtx(entry.branch), realpath: undefined };
    const old = checkBash(input.tool_input.command, oldCtx, 0, input);
    if (old?.decision === 'deny' || old?.decision === 'ask') offending.push(`${entry.id}: ${old.decision}`);
  }
  assert.deepEqual(offending, [], 'no allow where an old deny or ask fires');
});
