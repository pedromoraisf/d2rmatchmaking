// The symlink check of the promotion (ADR 033): real files in a temporary directory, no mocks.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { findSymlinks } from '../delivery/no-symlinks.mjs';

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'delivery',
  'no-symlinks.mjs',
);
const base = mkdtempSync(path.join(tmpdir(), 'no-symlinks-'));
after(() => rmSync(base, { recursive: true, force: true }));

function tree(name, build) {
  const root = path.join(base, name, 'migrations');
  mkdirSync(root, { recursive: true });
  build(root);
  return root;
}

test('a tree of plain files and folders is clean', () => {
  const root = tree('clean', (r) => {
    writeFileSync(path.join(r, '0001_init.sql'), 'select 1;');
    mkdirSync(path.join(r, 'meta'));
    writeFileSync(path.join(r, 'meta', 'journal.json'), '{}');
  });
  assert.deepEqual(findSymlinks(root), []);
  assert.match(execFileSync('node', [script, root], { encoding: 'utf8' }), /holds no symlink/);
});

test('a symlink to a file, to a folder or to nothing is found, at any depth', () => {
  const root = tree('links', (r) => {
    mkdirSync(path.join(r, 'meta'));
    symlinkSync('/etc/passwd', path.join(r, '0002_leak.sql'));
    symlinkSync('/etc', path.join(r, 'meta', 'etc'));
    symlinkSync('missing', path.join(r, 'dangling'));
  });
  assert.deepEqual(
    findSymlinks(root).sort(),
    ['migrations/0002_leak.sql', 'migrations/dangling', path.join('migrations', 'meta', 'etc')].sort(),
  );
});

test('the root being a symlink is found, and the command fails naming it', () => {
  const real = path.join(base, 'real');
  mkdirSync(real);
  const root = path.join(base, 'rooted', 'migrations');
  mkdirSync(path.dirname(root));
  symlinkSync(real, root);
  assert.deepEqual(findSymlinks(root), ['migrations']);
  const run = spawnSync('node', [script, root], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /holds a symlink: migrations/);
});

test('a missing directory fails the command instead of passing', () => {
  const run = spawnSync('node', [script, path.join(base, 'nowhere')], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /cannot be read/);
});
