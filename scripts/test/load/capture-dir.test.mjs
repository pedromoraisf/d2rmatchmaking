import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { captureDirProblem } from '../../load/lib/capture-dir.mjs';

const base = mkdtempSync(join(tmpdir(), 'capture-dir-'));
const repo = join(base, 'repo');
const outside = join(base, 'outside');
mkdirSync(join(repo, 'reports'), { recursive: true });
mkdirSync(outside);

test('a directory inside the repository is refused, existing or not', () => {
  assert.match(captureDirProblem(join(repo, 'reports'), repo), /inside the repository/);
  assert.match(captureDirProblem(join(repo, 'new', 'deeper'), repo), /inside the repository/);
  assert.match(captureDirProblem(repo, repo), /inside the repository/);
});

test('a directory outside the repository is accepted, existing or not', () => {
  assert.equal(captureDirProblem(outside, repo), null);
  assert.equal(captureDirProblem(join(outside, 'not-yet'), repo), null);
  assert.equal(captureDirProblem(join(base, 'repo-sibling'), repo), null);
});

test('a relative path that resolves inside is refused', () => {
  assert.match(captureDirProblem(join(outside, '..', 'repo', 'reports'), repo), /inside the repository/);
});

test('a symlink outside that points inside is refused, and the reverse is accepted', () => {
  const link = join(outside, 'link');
  symlinkSync(join(repo, 'reports'), link);
  assert.match(captureDirProblem(join(link, 'x'), repo), /inside the repository/);
  const back = join(repo, 'back');
  symlinkSync(outside, back);
  assert.equal(captureDirProblem(back, repo), null);
});
