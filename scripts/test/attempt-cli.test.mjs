// End-to-end: the wrapper really runs commands, counts failures, blocks the 4th attempt and survives worktrees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { classify } from '../lib/env-signatures.mjs';
import { runGate, exitStatus } from '../lib/gate-run.mjs';
import { diagnose } from '../lib/machine-diagnosis.mjs';

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

function committedRepo() {
  const dir = repo();
  git('-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  git('-C', dir, 'add', '.specs');
  git('-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'specs');
  return dir;
}
const lastAttempt = (dir) => {
  const ledger = JSON.parse(readFileSync(path.join(dir, '.git/d2rmm/ledger.json'), 'utf8'));
  return ledger.units['gate:demo/T1'].attempts.at(-1);
};

test('records the command, head and clean tree of a passing attempt', () => {
  const dir = committedRepo();
  const head = git('-C', dir, 'rev-parse', 'HEAD').toString().trim();
  assert.equal(run(dir, 'run', '--feature', 'demo', '--step', 'T1', '--', 'true').status, 0);
  const a = lastAttempt(dir);
  assert.equal(a.ok, true);
  assert.equal(a.command, 'true');
  assert.equal(a.head, head);
  assert.equal(a.clean, true);
});

test('records them for a failing attempt too', () => {
  const dir = committedRepo();
  const head = git('-C', dir, 'rev-parse', 'HEAD').toString().trim();
  assert.equal(run(dir, 'run', '--feature', 'demo', '--step', 'T1', '--', 'exit 1').status, 1);
  const a = lastAttempt(dir);
  assert.equal(a.ok, false);
  assert.equal(a.command, 'exit 1');
  assert.equal(a.head, head);
  assert.equal(a.clean, true);
});

test('records a dirty tree as not clean', () => {
  const dir = committedRepo();
  writeFileSync(path.join(dir, 'uncommitted.txt'), 'x\n');
  assert.equal(run(dir, 'run', '--feature', 'demo', '--step', 'T1', '--', 'true').status, 0);
  assert.equal(lastAttempt(dir).clean, false);
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

// Budget v2: the machine's failures, the timeout and the diagnosis.
const unitOf = (dir) =>
  JSON.parse(readFileSync(path.join(dir, '.git/d2rmm/ledger.json'), 'utf8')).units['gate:demo/T1'];
const countedFailures = (dir) => unitOf(dir).attempts.filter((a) => !a.ok && a.kind !== 'env').length;
const DIAGNOSIS = [
  /free memory/,
  /swap used/,
  /load average/,
  /running containers/,
  /leftover acceptance processes/,
];

test('does not count a Docker failure', () => {
  const dir = repo();
  const r = run(
    dir,
    'run',
    '--feature',
    'demo',
    '--step',
    'T1',
    '--',
    'echo Cannot connect to the Docker daemon; exit 1',
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not counted/);
  assert.match(r.stderr, /signature "docker"/);
  assert.equal(unitOf(dir).attempts.at(-1).signature, 'docker');
  assert.equal(countedFailures(dir), 0);
  assert.equal(unitOf(dir).status, 'open');
});

test('does not count a killed command', () => {
  const dir = repo();
  const r = run(dir, 'run', '--feature', 'demo', '--step', 'T1', '--', 'kill -9 $$');
  assert.equal(r.status, 137);
  assert.match(r.stderr, /signature "killed"/);
  assert.equal(countedFailures(dir), 0);
});

test('stops a command at its timeout', async () => {
  // The clock and the child are fakes: the timer fires when the test says so, and a killed child closes at once.
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const killed = [];
  child.kill = (sig) => {
    killed.push(sig);
    child.emit('close', null, sig);
    return true;
  };
  const timers = [];
  const setTimer = (fn, ms) => {
    timers.push({ fn, ms });
    return timers.length;
  };
  const pending = runGate('never ends', {
    cwd: process.cwd(),
    timeoutMs: 60_000,
    spawn: () => child,
    setTimer,
    clearTimer: () => {},
  });
  assert.equal(timers[0].ms, 60_000, 'the timer is --timeout in milliseconds');
  timers[0].fn();
  const r = await pending;
  assert.deepEqual(killed, ['SIGKILL']);
  assert.equal(r.timedOut, true);
  assert.equal(exitStatus(r), 124);
  assert.equal(
    classify({ status: r.status, signal: r.signal, output: '', timedOut: r.timedOut }).signature,
    'timeout',
  );
});

test('refuses a bad timeout', () => {
  const dir = repo();
  const marker = path.join(dir, 'ran.txt');
  for (const value of ['0', '0.5', 'soon']) {
    const r = run(
      dir,
      'run',
      '--feature',
      'demo',
      '--step',
      'T1',
      '--timeout',
      value,
      '--',
      `echo x >> ${marker}`,
    );
    assert.equal(r.status, 2, `--timeout ${value}`);
  }
  assert.equal(existsSync(marker), false, 'no command ran');
});

test('diagnoses the machine when it blocks a unit', () => {
  const dir = repo();
  const marker = path.join(dir, 'ran.txt');
  const args = [
    'run',
    '--feature',
    'demo',
    '--step',
    'T1',
    '--',
    `echo x >> ${marker}; echo Cannot connect to the Docker daemon; exit 1`,
  ];
  assert.equal(run(dir, ...args).status, 1);
  assert.equal(run(dir, ...args).status, 1);
  const third = run(dir, ...args);
  assert.equal(third.status, 1, 'the run that blocks exits with the command status');
  assert.match(third.stderr, /ENV-BLOCKED/);
  for (const line of DIAGNOSIS) assert.match(third.stderr, line);
  assert.equal(unitOf(dir).status, 'env-blocked');
  assert.equal(run(dir, 'status', '--feature', 'demo').status, 1);

  const fourth = run(dir, ...args);
  assert.equal(fourth.status, 3);
  assert.match(fourth.stderr, /ENV-BLOCKED/);
  for (const line of DIAGNOSIS) assert.match(fourth.stderr, line);
  assert.equal(
    readFileSync(marker, 'utf8').trim().split('\n').length,
    3,
    'the fourth run never ran the command',
  );
});

test('bounds each diagnosis probe to ten seconds and reads unavailable when one fails', () => {
  const calls = [];
  const probeRun = (file, args, opts) => {
    calls.push({ file, opts });
    if (file === 'docker') return { status: 1, stdout: '', signal: null };
    if (file === 'sysctl') return { status: 0, stdout: 'total = 2048.00M  used = 512.00M\n', signal: null };
    return { status: 0, stdout: 'node /usr/bin/node\n', signal: null };
  };
  const lines = diagnose({
    run: probeRun,
    freemem: () => 2 ** 30,
    loadavg: () => [1, 0.5, 0.25],
    platform: 'darwin',
  });
  assert.equal(calls.length, 3, 'swap, running containers and acceptance processes');
  assert.ok(
    calls.every((c) => c.opts.timeout === 10_000),
    'each probe is bounded to ten seconds',
  );
  assert.ok(lines.some((l) => l.includes('swap used: total = 2048.00M  used = 512.00M')));
  assert.ok(lines.some((l) => l.includes('running containers: unavailable')));
  assert.ok(lines.some((l) => l.includes('load average (1, 5, 15 min): 1.00 0.50 0.25')));
  assert.ok(lines.some((l) => l.includes('leftover acceptance processes: none')));
});
