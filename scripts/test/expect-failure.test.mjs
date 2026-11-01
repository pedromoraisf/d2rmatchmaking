// The expect-failure runner of the agent's boundary fixtures (AGS-21, AGS-22): it passes only on the named failure.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'agent',
  'expect-failure.mjs',
);
const run = (id, command) =>
  spawnSync(process.execPath, [script, id, '--', process.execPath, '-e', command], {
    encoding: 'utf8',
  });

test('expect-failure passes only on the named failure', () => {
  const failing = "console.error('error: banned crate sysinfo'); process.exit(1)";
  assert.equal(run('banned', failing).status, 0);
  assert.equal(run('unsafe_code', failing).status, 1, 'a failure that does not name the id is refused');
});

test('fails when the command succeeds', () => {
  const result = run('banned', "console.log('banned'); process.exit(0)");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /the command succeeded/);
});

test('fails when it fails without the id (a build error)', () => {
  const result = run('banned', "console.error('error[E0432]: unresolved import'); process.exit(1)");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not name "banned"/);
});
