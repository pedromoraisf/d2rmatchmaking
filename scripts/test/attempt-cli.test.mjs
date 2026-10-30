// End-to-end: the wrapper really runs commands, counts failures, blocks the 4th attempt and survives worktrees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const script = new URL('../attempt.mjs', import.meta.url).pathname;

// Inside git hooks (Lefthook), git exports GIT_DIR, GIT_INDEX_FILE, … — child gits would then act on the real
// repository instead of the temporary one. Every subprocess here runs with those variables removed.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && k !== 'D2RMM_LEDGER'),
);
const git = (...args) => execFileSync('git', args, { env });

function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'd2rmm-attempt-'));
  git('init', '-q', dir);
  mkdirSync(path.join(dir, '.specs/features/demo'), { recursive: true });
  writeFileSync(path.join(dir, '.specs/features/demo/tasks.md'), '# Tasks\n\n### T1: do it\n');
  return dir;
}
const run = (cwd, ...args) => spawnSync('node', [script, ...args], { cwd, encoding: 'utf8', env });

test('attempt run: 1 + 2 retries, then exit 3 without running the command', () => {
  const dir = repo();
  const marker = path.join(dir, 'ran.txt');
  const args = ['run', '--feature', 'demo', '--step', 'T1', '--', `echo x >> ${marker}; exit 1`];
  assert.equal(run(dir, ...args).status, 1);
  assert.equal(run(dir, ...args).status, 1);
  const third = run(dir, ...args);
  assert.equal(third.status, 3);
  assert.match(third.stderr, /BLOCKED/);
  const fourth = run(dir, ...args);
  assert.equal(fourth.status, 3);
  assert.equal(
    readFileSync(marker, 'utf8').trim().split('\n').length,
    3,
    'the 4th attempt never ran the command',
  );
  assert.equal(run(dir, 'status', '--feature', 'demo').status, 1);
  const ledger = JSON.parse(readFileSync(path.join(dir, '.git/d2rmm/ledger.json'), 'utf8'));
  assert.equal(ledger.units['gate:demo/T1'].status, 'blocked');
});

test('attempt run: invented steps and unknown features are refused', () => {
  const dir = repo();
  assert.equal(run(dir, 'run', '--feature', 'demo', '--step', 'T1b', '--', 'true').status, 2);
  assert.equal(run(dir, 'run', '--feature', 'nope', '--step', 'T1', '--', 'true').status, 2);
  assert.equal(run(dir, 'run', '--feature', 'demo', '--step', 'spec', '--', 'true').status, 0);
});

test('worktrees share one ledger (parallel workers cannot reset each other)', () => {
  const dir = repo();
  git('-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  git('-C', dir, 'add', '.specs');
  git('-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'specs');
  const wt = path.join(dir, 'wt');
  git('-C', dir, 'worktree', 'add', '-q', wt, '-b', 'feat/F0-demo');
  run(wt, 'run', '--feature', 'demo', '--step', 'T1', '--', 'exit 1');
  run(dir, 'run', '--feature', 'demo', '--step', 'T1', '--', 'exit 1');
  assert.equal(run(wt, 'run', '--feature', 'demo', '--step', 'T1', '--', 'exit 1').status, 3);
});
