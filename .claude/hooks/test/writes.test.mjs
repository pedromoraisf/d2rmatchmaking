import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine } from '../lib/shell-parse.mjs';
import { writeTargets, writeDecision } from '../lib/writes.mjs';

const ctx = { root: '/repo', mainRoot: '/repo' };
const targets = (line) => writeTargets(parseLine(line)).map((t) => [t.path, t.how]);
const decide = (line) => writeDecision(parseLine(line), ctx);

test('finds every shell write', () => {
  assert.deepEqual(targets('echo x > a.txt'), [['a.txt', 'redirect']]);
  assert.deepEqual(targets('echo x >> a.txt'), [['a.txt', 'redirect']]);
  assert.deepEqual(targets('echo x 2> err.log'), [['err.log', 'redirect']]);
  assert.deepEqual(targets('cmd &> all.log'), [['all.log', 'redirect']]);
  assert.deepEqual(targets('echo x >| f.txt'), [['f.txt', 'redirect']]);
  assert.deepEqual(targets('echo x >&f.txt'), [['f.txt', 'redirect']]);
  assert.deepEqual(targets('echo x | tee out.txt'), [['out.txt', 'tee']]);
  assert.deepEqual(targets('tee -a out.txt other.txt'), [
    ['out.txt', 'tee'],
    ['other.txt', 'tee'],
  ]);
  assert.deepEqual(targets('sed -i s/a/b/ f.txt'), [['f.txt', 'sed -i']]);
  assert.deepEqual(targets('sed --in-place=.bak -e s/a/b/ f.txt'), [['f.txt', 'sed -i']]);
  assert.deepEqual(targets('perl -pi -e s/a/b/ f.txt'), [['f.txt', 'perl -i']]);
  assert.deepEqual(targets('perl -i s/a/b/ f.txt'), [['f.txt', 'perl -i']]);
  assert.deepEqual(targets('truncate -s 0 f.txt'), [['f.txt', 'truncate']]);
  assert.deepEqual(targets('install -m 644 src.txt dst.txt'), [
    ['src.txt', 'install'],
    ['dst.txt', 'install'],
  ]);
  assert.deepEqual(targets('cp src.txt dst.txt'), [
    ['src.txt', 'cp'],
    ['dst.txt', 'cp'],
  ]);
  assert.deepEqual(targets('mv a.txt b.txt'), [
    ['a.txt', 'mv'],
    ['b.txt', 'mv'],
  ]);
  assert.deepEqual(targets('ln -s a.txt b.txt'), [
    ['a.txt', 'ln'],
    ['b.txt', 'ln'],
  ]);
});

test('a read is never a write', () => {
  const read = 'cat .claude/hooks/gate.mjs 2>&1 | head -n 5';
  assert.deepEqual(targets(read), []);
  assert.equal(decide(read), null);
  assert.deepEqual(targets('echo "a > b"'), []);
  assert.equal(decide('echo "a > b"'), null);
  assert.deepEqual(targets("grep '>' file"), []);
  assert.equal(decide("grep '>' file"), null);
});

test('never takes a device or a descriptor as a target', () => {
  assert.deepEqual(targets('echo x > /dev/null'), []);
  assert.deepEqual(targets('echo x >&2'), []);
  assert.deepEqual(targets('echo x 2>/dev/stderr'), []);
  assert.deepEqual(targets('echo x &>/dev/null'), []);
  assert.deepEqual(targets('echo x > /dev/stdout'), []);
});

test('leaves dd, curl, wget, patch and git apply to the current rules', () => {
  for (const line of [
    'dd if=x of=eslint.config.mjs',
    'curl -o eslint.config.mjs https://example.com/x',
    'wget -O eslint.config.mjs https://example.com/x',
    'patch eslint.config.mjs',
    'git apply eslint.config.mjs',
  ]) {
    assert.deepEqual(targets(line), [], line);
    assert.equal(decide(line), null, line);
  }
});

test('denies harness writes and asks for self-protected ones', () => {
  const harness = decide('echo x > eslint.config.mjs');
  assert.equal(harness.decision, 'deny');
  assert.match(harness.reason, /Edit tool/);

  const baseline = decide('echo x > .quality-baseline.json');
  assert.equal(baseline.decision, 'deny');
  assert.match(baseline.reason, /Edit tool/);

  const testFile = decide('echo x > apps/api/src/room.test.ts');
  assert.equal(testFile.decision, 'deny');
  assert.match(testFile.reason, /Edit tool/);

  assert.equal(decide('echo x > .claude/hooks/gate.mjs').decision, 'ask');
  // HBS-23: a self-protected file in a covered worktree keeps its ask.
  const worktree = decide('sed -i s/a/b/ .claude/worktrees/gate-precision/.claude/hooks/gate.mjs');
  assert.equal(worktree.decision, 'ask');

  assert.equal(decide('echo x > docs/readme.md'), null);
});

test('refuses a secret as a copy source', () => {
  for (const line of ['ln apps/api/.env x.txt', 'cp apps/api/.env x', 'install apps/api/.env x']) {
    const d = decide(line);
    assert.equal(d?.decision, 'deny', line);
  }
  assert.equal(decide('cp apps/api/.env.example x'), null);
});
