// FPR-01 to FPR-06: the proof preflight, run in temporary git repositories. Every child process gets an environment with
// no GIT_* variable: a leaked GIT_DIR once set core.bare on the real repository. The proofs append to a log outside the
// repository, so the log never counts as a changed file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChecks, proofKey } from '../proofs-preflight.mjs';

const PREFLIGHT = fileURLToPath(new URL('../proofs-preflight.mjs', import.meta.url));
const FEATURE = 'demo';

function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) Reflect.deleteProperty(env, key);
  return env;
}

// A path as one shell word, for the proof commands.
const quote = (file) => `'${file.replace(/'/gu, `'\\''`)}'`;

function readLog(file) {
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
}

function preflight(dir) {
  const result = spawnSync(process.execPath, [PREFLIGHT, FEATURE], {
    cwd: dir,
    env: cleanEnv(),
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, output: `${result.stdout}${result.stderr}` };
}

/**
 * A temporary repository: `phase/F0` at the base, and `feat/F0-demo` with one changed file, `src.txt`. The base has the
 * active phase and a tasks.md whose two checks append to the log. C1 always passes; C2 passes only when the flag exists.
 */
function makeRepo(t) {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), 'd2rmm-proofs-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, 'repo');
  const log = path.join(home, 'runs.log');
  const flag = path.join(home, 'flag');
  mkdirSync(path.join(dir, '.specs', 'phases'), { recursive: true });
  mkdirSync(path.join(dir, '.specs', 'features', FEATURE), { recursive: true });
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: dir,
      env: cleanEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const commit = (message) => {
    git('add', '.');
    git(
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-q',
      '--no-verify',
      '-m',
      message,
    );
  };
  git('init', '-q', '-b', 'main');
  writeFileSync(path.join(dir, '.specs', 'phases', 'ACTIVE'), 'F0\n');
  writeFileSync(
    path.join(dir, '.specs', 'features', FEATURE, 'tasks.md'),
    [
      '# Demo tasks',
      '',
      '## Checks',
      '',
      '**C1** - the first claim (FPR-01)',
      `Proof: \`echo one >> ${quote(log)}\``,
      '',
      '**C2** - the second claim (FPR-04)',
      `Proof: \`echo two >> ${quote(log)} && test -f ${quote(flag)}\``,
      '',
    ].join('\n'),
  );
  writeFileSync(path.join(dir, 'README.md'), 'base\n');
  commit('base');
  git('branch', 'phase/F0');
  git('checkout', '-q', '-b', 'feat/F0-demo');
  writeFileSync(path.join(dir, 'src.txt'), 'one\n');
  commit('feature');
  return { dir, log, flag, git };
}

test('preflight runs each proof once, then caches it', (t) => {
  const repo = makeRepo(t);
  writeFileSync(repo.flag, '');

  const first = preflight(repo.dir);
  assert.equal(first.status, 0, first.output);
  assert.match(first.stdout, /^C1 ran exit=0 /mu);
  assert.match(first.stdout, /^C2 ran exit=0 /mu);
  assert.deepEqual(readLog(repo.log), ['one', 'two']);

  const second = preflight(repo.dir);
  assert.equal(second.status, 0, second.output);
  assert.match(second.stdout, /^C1 cached /mu);
  assert.match(second.stdout, /^C2 cached /mu);
  assert.doesNotMatch(second.stdout, /ran exit=/u);
  assert.deepEqual(readLog(repo.log), ['one', 'two'], 'a cached run runs no proof');

  writeFileSync(path.join(repo.dir, 'src.txt'), 'two\n');
  const third = preflight(repo.dir);
  assert.equal(third.status, 0, third.output);
  assert.match(third.stdout, /^C1 ran exit=0 /mu);
  assert.match(third.stdout, /^C2 ran exit=0 /mu);
  assert.deepEqual(readLog(repo.log), ['one', 'two', 'one', 'two'], 'an edit reruns both proofs');
});

test('a failed proof runs again and fails the preflight', (t) => {
  const repo = makeRepo(t);

  const first = preflight(repo.dir);
  assert.equal(first.status, 1, first.output);
  assert.match(first.output, /^proofs-preflight failed: C2$/mu);
  assert.doesNotMatch(first.output, /failed: .*C1/u);
  assert.deepEqual(readLog(repo.log), ['one', 'two']);

  const second = preflight(repo.dir);
  assert.equal(second.status, 1, second.output);
  assert.match(second.stdout, /^C1 cached /mu, 'C1 stays green and cached');
  assert.match(second.stdout, /^C2 ran exit=1 /mu, 'C2 runs again under the same key');
  assert.deepEqual(readLog(repo.log), ['one', 'two', 'two']);

  writeFileSync(repo.flag, '');
  const third = preflight(repo.dir);
  assert.equal(third.status, 0, third.output);
  assert.match(third.stdout, /^C2 ran exit=0 /mu);
});

test('a missing cache or a git error runs every proof', (t) => {
  const repo = makeRepo(t);
  const cacheFile = path.join(repo.dir, 'reports', 'proofs-cache', `${FEATURE}.json`);
  writeFileSync(repo.flag, '');

  assert.equal(preflight(repo.dir).status, 0);
  assert.deepEqual(readLog(repo.log), ['one', 'two']);

  rmSync(cacheFile);
  const missing = preflight(repo.dir);
  assert.equal(missing.status, 0, missing.output);
  assert.match(missing.stdout, /^C1 ran /mu);
  assert.match(missing.stdout, /^C2 ran /mu);
  assert.deepEqual(readLog(repo.log), ['one', 'two', 'one', 'two']);

  writeFileSync(cacheFile, '{not json');
  const corrupt = preflight(repo.dir);
  assert.equal(corrupt.status, 0, corrupt.output);
  assert.match(corrupt.stdout, /^C1 ran /mu);
  assert.match(corrupt.stdout, /^C2 ran /mu);
  assert.equal(readLog(repo.log).length, 6);

  repo.git('branch', '-D', 'phase/F0');
  const noBase = preflight(repo.dir);
  assert.equal(noBase.status, 0, noBase.output);
  assert.match(noBase.stdout, /^C1 ran /mu);
  assert.match(noBase.stdout, /^C2 ran /mu);
  assert.equal(readLog(repo.log).length, 8);
});

test('parseChecks reads each Proof of the Checks section in file order', () => {
  const text = [
    '## Done',
    '**C9** - a check outside the section',
    'Proof: `echo outside`',
    '',
    '## Checks',
    '',
    '**C1** - first (FPR-01)',
    'Proof: `echo one`',
    '**C2** - second (FPR-02)',
    'Proof: `echo two`',
    'Proof: `echo two again`',
    '',
    '## Handoff',
    'Proof: `echo late`',
  ].join('\n');
  assert.deepEqual(parseChecks(text), [
    { id: 'C1', command: 'echo one' },
    { id: 'C2', command: 'echo two' },
    { id: 'C2', command: 'echo two again' },
  ]);
});

test('the key changes with the command and with a changed file path or content', () => {
  const file = { path: 'src.txt', content: 'one\n' };
  const key = proofKey('echo a', [file]);
  assert.equal(proofKey('echo a', [{ ...file }]), key, 'the same inputs give the same key');
  assert.notEqual(proofKey('echo b', [file]), key, 'the command is part of the key');
  assert.notEqual(
    proofKey('echo a', [{ path: 'other.txt', content: 'one\n' }]),
    key,
    'the path is part of the key',
  );
  assert.notEqual(proofKey('echo a', [{ ...file, content: 'two\n' }]), key, 'the content is part of the key');
  assert.notEqual(proofKey('echo a', [{ path: 'src.txt', content: '' }]), key, 'a deleted file differs');
  const two = [file, { path: 'b.txt', content: 'x' }];
  assert.equal(
    proofKey('echo a', [...two].reverse()),
    proofKey('echo a', two),
    'the order of the files does not matter',
  );
});
