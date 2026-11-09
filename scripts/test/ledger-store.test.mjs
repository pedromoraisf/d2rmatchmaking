// GPR-22 (gate-precision): the git directory, the common directory and the branch are read from the git files, and git
// answers when the files do not say. The temporary repositories are built with every GIT_* variable cleared, and the
// git overrides of the gate's own environment are removed for the run, so nothing here touches the real repository.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { gitLocations, makeRepoContext } from '../../.claude/hooks/lib/io.mjs';
import { ledgerPath } from '../lib/ledger-store.mjs';

const saved = {
  GIT_DIR: process.env.GIT_DIR,
  GIT_COMMON_DIR: process.env.GIT_COMMON_DIR,
  D2RMM_LEDGER: process.env.D2RMM_LEDGER,
};
const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const made = [];

/** Puts one variable back as it was: unset when it was unset. */
function restore(env, key, value) {
  if (value === undefined) Reflect.deleteProperty(env, key);
  else env[key] = value;
}

before(() => {
  for (const key of Object.keys(saved)) Reflect.deleteProperty(process.env, key);
});

after(() => {
  for (const [key, value] of Object.entries(saved)) restore(process.env, key, value);
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const root = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ledger-store-'));
  made.push(dir);
  return dir;
};

/** One git command in `cwd`, with a fixed identity and no GIT_* variable of the caller. */
function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    env: {
      ...clean,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/** A repository on `main` with one commit: the main checkout. */
function repo() {
  const dir = path.join(root(), 'main');
  mkdirSync(dir);
  git(dir, ['init', '-q', '-b', 'main']);
  writeFileSync(path.join(dir, 'README.md'), 'x\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}

/** A linked worktree of `main` on a new branch, or detached when `branch` is null. */
function worktree(main, branch) {
  const dir = path.join(root(), 'wt');
  const args =
    branch === null
      ? ['worktree', 'add', '-q', '--detach', dir]
      : ['worktree', 'add', '-q', '-b', branch, dir];
  git(main, args);
  return dir;
}

/** The real path of a git answer, given relative to the directory it was printed in. */
const real = (cwd, answer) => realpathSync(path.resolve(cwd, answer));

test('reads the git directory from files', () => {
  const main = repo();
  const onBranch = worktree(main, 'feat/F0-example');
  const detached = worktree(main, null);
  for (const dir of [main, onBranch, detached]) {
    const common = real(dir, git(dir, ['rev-parse', '--git-common-dir']));
    const found = gitLocations(dir);
    assert.ok(found, `${dir}: the files say where the git directory is`);
    assert.equal(realpathSync(found.common), common, `${dir}: the common directory equals git's`);
    assert.equal(
      found.branch,
      git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']),
      `${dir}: the branch equals git's`,
    );
    assert.equal(
      realpathSync(path.dirname(path.dirname(ledgerPath(dir)))),
      common,
      `${dir}: the ledger lives in the common directory`,
    );
  }
  assert.equal(gitLocations(detached).branch, 'HEAD', 'a detached HEAD reads as HEAD');
});

test('falls back to git when the files do not say', () => {
  const main = repo();
  const broken = worktree(main, 'feat/F0-broken');
  // A `.git` file that is not a `gitdir:` link: the files say nothing, and git refuses the checkout too.
  writeFileSync(path.join(broken, '.git'), 'not a link\n');
  assert.equal(gitLocations(broken), null, 'a malformed .git file gives no answer');
  assert.throws(() => git(broken, ['rev-parse', '--git-common-dir']), 'git refuses the same checkout');
  assert.equal(ledgerPath(broken), null, 'so the fallback answers null');

  const missingCommondir = worktree(main, 'feat/F0-no-commondir');
  const gitDirOf = path.resolve(missingCommondir, readGitLink(missingCommondir));
  rmSync(path.join(gitDirOf, 'commondir'));
  assert.equal(gitLocations(missingCommondir), null, 'a missing commondir gives no answer');
  assert.throws(() => git(missingCommondir, ['rev-parse', '--git-common-dir']), 'git refuses it too');
  assert.equal(ledgerPath(missingCommondir), null, 'so the fallback answers null');

  const badHead = worktree(main, 'feat/F0-bad-head');
  writeFileSync(path.join(readGitLink(badHead, true), 'HEAD'), 'garbage\n');
  assert.equal(gitLocations(badHead), null, 'a HEAD that names no branch gives no answer');
  assert.throws(() => git(badHead, ['rev-parse', '--abbrev-ref', 'HEAD']), 'git names no branch either');
  assert.equal(makeRepoContext(badHead).currentBranch(), null, 'so the fallback answers null');
});

/** The `gitdir:` path of a linked worktree's `.git` file, as written or resolved against the worktree. */
function readGitLink(dir, resolved = false) {
  const target = readFileSync(path.join(dir, '.git'), 'utf8')
    .trim()
    .replace(/^gitdir:\s*/, '');
  return resolved ? path.resolve(dir, target) : target;
}
