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

// Budget v2 (T4): an unchanged rerun is refused before it runs; the tree is fingerprinted before the command.
// Markers live outside the repository so that what a command writes does not change the tree under test.
const gateArgs = (command) => ['run', '--feature', 'demo', '--step', 'T1', '--', command];
const linesIn = (file) => readFileSync(file, 'utf8').trim().split('\n').length;
const refusalsOf = (dir) =>
  JSON.parse(readFileSync(path.join(dir, '.git/d2rmm/ledger.json'), 'utf8')).refusals ?? [];
const outsideMarker = () => path.join(mkdtempSync(path.join(tmpdir(), 'd2rmm-mark-')), 'ran.txt');
const treeOf = (dir) => {
  const index = path.join(mkdtempSync(path.join(tmpdir(), 'd2rmm-idx-')), 'index');
  const e = { ...env, GIT_INDEX_FILE: index };
  execFileSync('git', ['-C', dir, 'add', '-A', '--', '.', ':(exclude)reports/attempts'], { env: e });
  return execFileSync('git', ['-C', dir, 'write-tree'], { env: e, encoding: 'utf8' }).trim();
};

test('refuses a rerun with nothing changed', () => {
  const dir = committedRepo();
  const marker = outsideMarker();
  const args = gateArgs(`echo x >> ${marker}; exit 1`);
  assert.equal(run(dir, ...args).status, 1);
  const again = run(dir, ...args);
  assert.equal(again.status, 4);
  assert.match(again.stderr, /nothing changed since the last failure/);
  assert.equal(linesIn(marker), 1, 'the command did not run again');
  assert.equal(countedFailures(dir), 1, 'the refusal spent nothing');
  assert.equal(unitOf(dir).attempts.length, 1, 'the refusal is not an attempt');
  assert.equal(refusalsOf(dir).length, 1);
  assert.equal(refusalsOf(dir)[0].key, 'gate:demo/T1');
});

test('refuses a rerun of a state already proven failing', () => {
  const dir = committedRepo();
  const marker = outsideMarker();
  const failing = gateArgs(`echo x >> ${marker}; exit 1`);
  assert.equal(run(dir, ...failing).status, 1);
  assert.equal(run(dir, ...gateArgs('echo Cannot connect to the Docker daemon; exit 1')).status, 1);
  assert.equal(unitOf(dir).attempts.at(-1).signature, 'docker');
  const again = run(dir, ...failing);
  assert.equal(again.status, 4);
  assert.equal(linesIn(marker), 1, 'the command did not run again');
  assert.equal(countedFailures(dir), 1);
});

test('an empty commit is not a change', () => {
  const dir = committedRepo();
  const marker = outsideMarker();
  const args = gateArgs(`echo x >> ${marker}; exit 1`);
  assert.equal(run(dir, ...args).status, 1);
  git('-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'empty');
  assert.equal(run(dir, ...args).status, 4);
  assert.equal(linesIn(marker), 1);
});

test('runs after a change or with another command', () => {
  const edits = [
    [
      'edits a tracked file',
      (dir) => writeFileSync(path.join(dir, '.specs/features/demo/tasks.md'), '# Tasks\n\n### T1: changed\n'),
    ],
    ['adds an untracked file', (dir) => writeFileSync(path.join(dir, 'new.txt'), 'x\n')],
  ];
  for (const [label, change] of edits) {
    const dir = committedRepo();
    const marker = outsideMarker();
    const args = gateArgs(`echo x >> ${marker}; exit 1`);
    assert.equal(run(dir, ...args).status, 1);
    change(dir);
    assert.equal(run(dir, ...args).status, 1, label);
    assert.equal(linesIn(marker), 2, label);
  }
  const dir = committedRepo();
  const marker = outsideMarker();
  assert.equal(run(dir, ...gateArgs(`echo x >> ${marker}; exit 1`)).status, 1);
  assert.equal(run(dir, ...gateArgs(`echo y >> ${marker}; exit 1`)).status, 1, 'another command');
  assert.equal(linesIn(marker), 2);
});

test('runs again after a machine failure', () => {
  const dir = committedRepo();
  const marker = outsideMarker();
  const args = gateArgs(`echo x >> ${marker}; echo Cannot connect to the Docker daemon; exit 1`);
  assert.equal(run(dir, ...args).status, 1);
  assert.equal(run(dir, ...args).status, 1, 'the same tree runs again after a machine failure');
  assert.equal(linesIn(marker), 2);
  assert.equal(countedFailures(dir), 0);
});

test('never refuses without a fingerprint', () => {
  const plain = mkdtempSync(path.join(tmpdir(), 'd2rmm-plain-'));
  mkdirSync(path.join(plain, '.specs/features/demo'), { recursive: true });
  writeFileSync(path.join(plain, '.specs/features/demo/tasks.md'), '# Tasks\n\n### T1: do it\n');
  const marker = outsideMarker();
  const ledgerFile = path.join(mkdtempSync(path.join(tmpdir(), 'd2rmm-ledger-')), 'ledger.json');
  const plainRun = () =>
    spawnSync('node', [script, ...gateArgs(`echo x >> ${marker}; exit 1`)], {
      cwd: plain,
      encoding: 'utf8',
      env: { ...env, D2RMM_LEDGER: ledgerFile },
    });
  assert.equal(plainRun().status, 1);
  assert.equal(plainRun().status, 1, 'no git, no fingerprint, no refusal');
  assert.equal(linesIn(marker), 2);
});

test('takes the fingerprint before the command', () => {
  const dir = committedRepo();
  const before = treeOf(dir);
  const args = gateArgs(`echo changed > ${dir}/new.txt; exit 1`);
  assert.equal(run(dir, ...args).status, 1);
  assert.equal(unitOf(dir).attempts[0].fingerprint, before, 'recorded before the command wrote new.txt');
  assert.notEqual(treeOf(dir), before, 'the command did change the tree');
  assert.equal(run(dir, ...args).status, 1, 'the tree after the run differs, so the rerun runs');
  assert.equal(countedFailures(dir), 2);
});

// Budget v2 (T5): the full output on disk, the end on the terminal.
test('keeps the full output and prints the last 60 lines', () => {
  for (const [lines, first] of [
    [60, 1],
    [61, 2],
    [200, 141],
  ]) {
    const dir = repo();
    const r = run(dir, 'run', '--feature', 'demo', '--step', 'T1', '--', `seq 1 ${lines}`);
    assert.equal(r.status, 0, `${lines} lines`);
    const log = readFileSync(path.join(dir, 'reports/attempts/gate-demo-T1/1.log'), 'utf8');
    assert.equal(log.trim().split('\n').length, lines, 'the log holds every line');
    const shown = r.stdout.trim().split('\n').map(Number);
    assert.deepEqual(
      shown,
      Array.from({ length: lines - first + 1 }, (_, i) => first + i),
      `the terminal shows lines ${first} to ${lines}`,
    );
  }
});

test('prints the result and the duration', () => {
  const dir = repo();
  const r = run(dir, 'run', '--feature', 'demo', '--step', 'T1', '--', 'true');
  assert.equal(r.status, 0);
  assert.match(r.stderr, /gate:demo\/T1: exit 0 in \d+\.\d+s\./);
  assert.match(r.stderr, /passed on attempt 1/);
});

// Budget v2 (T6): the orchestrator resets a unit once, with a reason; every reset is kept.
const ledgerOf = (dir) => JSON.parse(readFileSync(path.join(dir, '.git/d2rmm/ledger.json'), 'utf8'));
let failureNo = 0;
/** Three counted failures. Each command is new, so no rerun is refused; the third blocks the unit (exit 3). */
const blockCounted = (dir) => {
  for (const status of [1, 1, 3]) {
    failureNo += 1;
    assert.equal(run(dir, ...gateArgs(`exit 1 #${failureNo}`)).status, status);
  }
  assert.equal(unitOf(dir).status, 'blocked');
};
/** Three environment failures in a row: the unit is env-blocked. */
const blockMachine = (dir) => {
  const args = gateArgs('echo Cannot connect to the Docker daemon; exit 1');
  for (let i = 0; i < 3; i += 1) assert.equal(run(dir, ...args).status, 1);
  assert.equal(unitOf(dir).status, 'env-blocked');
};

test('resets a unit once for the orchestrator', () => {
  const dir = repo();
  blockCounted(dir);
  const r = run(
    dir,
    'reset',
    '--unit',
    'gate:demo/T1',
    '--by',
    'orchestrator',
    '--reason',
    'Docker was stopped; started again',
  );
  assert.equal(r.status, 0);
  const ledger = ledgerOf(dir);
  assert.equal(ledger.units['gate:demo/T1'], undefined, 'the unit has no attempts');
  assert.equal(ledger.resets.length, 1);
  assert.equal(ledger.resets[0].key, 'gate:demo/T1');
  assert.equal(ledger.resets[0].by, 'orchestrator');
  assert.equal(ledger.resets[0].reason, 'Docker was stopped; started again');
  assert.equal(ledger.resets[0].previous.attempts.length, 3, 'the reset keeps what it cleared');
});

test('needs a reason from the orchestrator', () => {
  const dir = repo();
  blockCounted(dir);
  const r = run(dir, 'reset', '--unit', 'gate:demo/T1', '--by', 'orchestrator');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /non-empty --reason/);
  assert.equal(ledgerOf(dir).resets, undefined, 'nothing was reset');
  assert.equal(unitOf(dir).status, 'blocked');
});

test("refuses the orchestrator's second reset", () => {
  const dir = repo();
  blockCounted(dir);
  assert.equal(
    run(dir, 'reset', '--unit', 'gate:demo/T1', '--by', 'orchestrator', '--reason', 'first').status,
    0,
  );
  blockCounted(dir);
  assert.equal(
    run(dir, 'reset', '--unit', 'gate:demo/T1', '--by', 'pedromoraisf', '--reason', 'maintainer').status,
    0,
  );
  blockCounted(dir);
  const second = run(dir, 'reset', '--unit', 'gate:demo/T1', '--by', 'orchestrator', '--reason', 'again');
  assert.equal(second.status, 2);
  assert.match(second.stderr, /maintainer's/);
  assert.equal(unitOf(dir).status, 'blocked', 'the refused reset changed nothing');
  assert.equal(ledgerOf(dir).resets.length, 2, 'the earlier resets are kept');
});

test('resets an env-blocked unit', () => {
  const dir = repo();
  blockMachine(dir);
  const r = run(
    dir,
    'reset',
    '--unit',
    'gate:demo/T1',
    '--by',
    'orchestrator',
    '--reason',
    'Docker was stopped',
  );
  assert.equal(r.status, 0);
  const ledger = ledgerOf(dir);
  assert.equal(ledger.resets[0].previous.status, 'env-blocked');
  assert.equal(ledger.units['gate:demo/T1'], undefined);
});

test('reads both forms of the unit option', () => {
  const dir = repo();
  blockCounted(dir);
  const equals = run(dir, 'reset', '--unit=gate:demo/T1', '--by', 'orchestrator', '--reason', 'equals form');
  assert.equal(equals.status, 0);
  assert.equal(ledgerOf(dir).resets[0].key, 'gate:demo/T1');
  blockCounted(dir);
  const spaced = run(
    dir,
    'reset',
    '--unit',
    ' gate:demo/T1 ',
    '--by',
    'orchestrator',
    '--reason',
    'space form',
  );
  assert.equal(spaced.status, 2, 'the spaced form, trimmed, names the unit the orchestrator already reset');
});
