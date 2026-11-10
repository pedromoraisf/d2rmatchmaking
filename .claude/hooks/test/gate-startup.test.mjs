// GPR-20, GPR-21: the gate answers every input, loads a rule module only for the calls that need it, answers before the
// hook timeout and logs no command. These tests spawn the gate in temporary repositories; they are not mutation proofs
// (ADR 026).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.resolve(here, '../gate.mjs');
const REGISTER = path.resolve(here, 'module-trace-register.mjs');
const made = [];

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'gate-startup-'));
  made.push(dir);
  return dir;
}

// git sets GIT_DIR and GIT_INDEX_FILE for the hooks of a commit; the temporary repositories must not inherit them.
const withoutGitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
);

/** A temporary git repository: the gate's checkout. */
function repo() {
  const dir = tempDir();
  execFileSync('git', ['init', '-q'], { cwd: dir, env: withoutGitEnv });
  return dir;
}

const env = (root, trace) => ({
  ...withoutGitEnv,
  CLAUDE_PROJECT_DIR: root,
  D2RMM_TRACE_FILE: trace,
});

/** The gate run with `stdin` as its input, the rule modules it imports traced into `trace`. */
function runGate(stdin, root, trace = path.join(tempDir(), 'trace.txt')) {
  const r = spawnSync(process.execPath, ['--import', REGISTER, GATE], {
    input: stdin,
    cwd: root,
    env: env(root, trace),
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, trace, decision: decisionOf(r.stdout) };
}

function decisionOf(stdout) {
  if (!stdout) return null;
  return JSON.parse(stdout).hookSpecificOutput.permissionDecision;
}

/** The rule modules a run imported, in the order they were traced. */
function tracedModules(trace) {
  return existsSync(trace) ? readFileSync(trace, 'utf8').split('\n').filter(Boolean) : [];
}

after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

test('answers every input', () => {
  const root = repo();
  const big = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'x'.repeat(101 * 1024 * 1024) } });
  const cases = {
    'a call over 100 MB': big,
    'a malformed call': '{"tool_name": ',
    'an empty stdin': '',
    'a JSON value that is not an object': '[1, 2]',
  };
  for (const [what, stdin] of Object.entries(cases)) {
    const r = runGate(stdin, root);
    assert.equal(r.status, 0, `${what}: the hook exits 0`);
    assert.equal(r.decision, 'ask', `${what}: the gate asks`);
    assert.match(r.stdout, /\[d2rmm gate\] /, `${what}: the reason is prefixed`);
  }
});

test('loads rule modules only when needed', () => {
  const root = repo();
  const readOnly = runGate(
    JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status --short' }, cwd: root }),
    root,
  );
  assert.equal(readOnly.decision, 'allow', 'a read-only call is allowed by the read-only rule');
  assert.deepEqual(tracedModules(readOnly.trace), [], 'a read-only call loads no rule module');

  const baseline = runGate(
    JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: path.join(root, '.quality-baseline.json'), content: '{"metrics":{}}\n' },
      cwd: root,
    }),
    root,
  );
  assert.deepEqual(
    tracedModules(baseline.trace),
    ['ratchet'],
    'an edit of the baseline loads the ratchet only',
  );

  const feature = runGate(
    JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: path.join(root, 'x.feature'), content: 'Feature: x\n' },
      cwd: root,
    }),
    root,
  );
  assert.deepEqual(
    tracedModules(feature.trace),
    ['acceptance'],
    'an edit of a feature file loads acceptance only',
  );
});

test('answers before the hook timeout', async () => {
  const root = repo();
  const child = spawn(process.execPath, [GATE], { cwd: root, env: env(root, path.join(tempDir(), 't.txt')) });
  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  // The stdin is never closed: the call stalls, and only the watchdog can answer.
  const started = Date.now();
  const killer = setTimeout(() => child.kill('SIGKILL'), 15_000);
  const code = await new Promise((resolve) => child.on('close', resolve));
  clearTimeout(killer);
  assert.equal(code, 0, 'the watchdog exits 0');
  assert.ok(Date.now() - started < 9_000, 'the answer comes within 9 s');
  assert.equal(decisionOf(stdout), 'ask', 'a stalled call gets ask');
});

// T23: the watchdog counts from the process start. A module loaded before the gate busy-waits 2 s, as a slow load of the
// static imports would; the answer still comes within 9 s of the spawn, so the watchdog is not armed after the load.
test('the watchdog counts from the process start', async () => {
  const root = repo();
  const busy = path.join(tempDir(), 'busy-wait.mjs');
  writeFileSync(busy, 'const end = Date.now() + 2000;\nwhile (Date.now() < end) {}\n');
  const started = Date.now();
  const child = spawn(process.execPath, ['--import', busy, GATE], {
    cwd: root,
    env: env(root, path.join(tempDir(), 't.txt')),
  });
  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  // The stdin is never closed: the call stalls, and only the watchdog can answer.
  const killer = setTimeout(() => child.kill('SIGKILL'), 15_000);
  const code = await new Promise((resolve) => child.on('close', resolve));
  clearTimeout(killer);
  assert.equal(code, 0, 'the watchdog exits 0');
  assert.equal(decisionOf(stdout), 'ask', 'a stalled call gets ask');
  assert.ok(Date.now() - started < 9_000, 'the answer comes within 9 s of the spawn');
});

test('logs no command', () => {
  const root = repo();
  const marker = 'SECRETMARKER';
  const malformed = runGate(`{"tool_name":"Bash","tool_input":{"command":"echo ${marker}"`, root);
  assert.equal(malformed.decision, 'ask');
  assert.ok(!malformed.stderr.includes(marker), 'a malformed call is not logged');
  const notObject = runGate(`["${marker}"]`, root);
  assert.equal(notObject.decision, 'ask');
  assert.ok(!notObject.stderr.includes(marker), 'a call that is not an object is not logged');
  assert.ok(!notObject.stdout.includes(marker), 'the answer does not repeat the raw input');
});

test('a read-only call spawns no rev-parse', () => {
  // GPR-22: a `git` shim on PATH logs every call the gate makes; the shim must be the one the gate runs.
  const root = repo();
  const shimDir = tempDir();
  const calls = path.join(tempDir(), 'git-calls.txt');
  const realGit = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  writeFileSync(
    path.join(shimDir, 'git'),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(calls)}\nexec ${JSON.stringify(realGit)} "$@"\n`,
    { mode: 0o755 },
  );
  const shimEnv = {
    ...withoutGitEnv,
    CLAUDE_PROJECT_DIR: root,
    D2RMM_TRACE_FILE: path.join(tempDir(), 'trace.txt'),
    PATH: `${shimDir}${path.delimiter}${process.env.PATH}`,
  };
  execFileSync('git', ['--version'], { cwd: root, env: shimEnv });
  assert.match(readFileSync(calls, 'utf8'), /--version/, 'the shim is the git the gate would run');

  const r = spawnSync(process.execPath, ['--import', REGISTER, GATE], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status --short' }, cwd: root }),
    cwd: root,
    env: shimEnv,
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(decisionOf(r.stdout), 'allow', 'a read-only call is allowed');
  const spawned = readFileSync(calls, 'utf8').split('\n').filter(Boolean);
  assert.deepEqual(
    spawned.filter((line) => line.includes('rev-parse') && line.includes('--git-common-dir')),
    [],
    'no git rev-parse --git-common-dir is spawned',
  );
});
