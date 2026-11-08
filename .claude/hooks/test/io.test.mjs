import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import { mkdtempSync, writeFileSync, linkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeIo, READ_MAX_BYTES } from '../lib/io.mjs';

/** A clock the test moves by hand. */
function clock(t = 0) {
  const c = { t, now: () => c.t };
  return c;
}

test('checks the deadline before each call', () => {
  const c = clock(0);
  let touched = 0;
  const countingFs = {
    constants: nodeFs.constants,
    openSync: () => ((touched += 1), 9),
    fstatSync: () => ((touched += 1), { isFile: () => true, nlink: 1, size: 0 }),
    readSync: () => ((touched += 1), 0),
    closeSync: () => (touched += 1),
    realpathSync: () => ((touched += 1), '/x'),
    statSync: () => ((touched += 1), {}),
  };
  const spawned = [];
  const io = makeIo({
    now: c.now,
    deadlineMs: 5000,
    fs: countingFs,
    spawn: (...args) => (spawned.push(args), 'ok'),
  });

  assert.equal(io.git(['status']), 'ok', 'before the deadline a git call runs');
  c.t = 5001;
  assert.deepEqual(io.git(['status']), { timedOut: true });
  assert.deepEqual(io.readFile('/x/a'), { timedOut: true });
  assert.deepEqual(io.realpath('/x'), { timedOut: true });
  assert.deepEqual(io.stat('/x'), { timedOut: true });
  assert.equal(spawned.length, 1, 'no spawn starts past the deadline');
  assert.equal(touched, 0, 'no fs call starts past the deadline');
  assert.equal(io.spawnCount(), 1);
});

test('bounds each git spawn', () => {
  const c = clock(0);
  const seen = [];
  const io = makeIo({
    now: c.now,
    deadlineMs: 5000,
    spawn: (file, args, opts) => (seen.push({ file, args, opts }), 'out\n'),
  });

  assert.equal(io.git(['status'], { cwd: '/repo' }), 'out');
  c.t = 4000;
  assert.equal(io.git(['log']), 'out');

  assert.equal(seen[0].file, 'git');
  assert.deepEqual(seen[0].args.slice(0, 3), ['-c', 'core.fsmonitor=false', 'status']);
  assert.equal(seen[0].opts.timeout, 2000, 'a spawn is capped at 2 s');
  assert.equal(seen[1].opts.timeout, 1000, 'a spawn gets the time left when that is less');
  assert.equal(seen[0].opts.killSignal, 'SIGKILL');
  assert.equal(seen[0].opts.cwd, '/repo');
  assert.equal(seen[0].opts.env.GIT_OPTIONAL_LOCKS, '0');
  assert.equal(io.spawnCount(), 2);

  const timedOut = makeIo({
    now: () => 0,
    spawn: () => {
      throw Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
    },
  });
  assert.deepEqual(timedOut.git(['status']), { timedOut: true }, 'a spawn timeout is not a throw');

  const failed = makeIo({
    now: () => 0,
    spawn: () => {
      throw new Error('exit 1');
    },
  });
  assert.equal(failed.git(['status']), null, 'a failing git gives null');
});

test('reads only a small regular file with one link', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gate-io-'));
  try {
    const io = makeIo({ now: () => 0 });
    const small = path.join(dir, 'small.txt');
    writeFileSync(small, 'hello');
    assert.equal(io.readFile(small), 'hello');
    assert.equal(io.readFile(path.join(dir, 'missing.txt')), null, 'a missing file gives null');

    const twin = path.join(dir, 'twin.txt');
    linkSync(small, twin);
    assert.equal(io.readFile(small), null, 'a hard-linked file is refused');
    assert.equal(io.readFile(twin), null, 'the other name of a hard link is refused too');

    assert.equal(io.readFile(dir), null, 'a directory is refused');

    const exact = path.join(dir, 'exact.txt');
    writeFileSync(exact, 'a'.repeat(READ_MAX_BYTES));
    assert.equal(io.readFile(exact).length, READ_MAX_BYTES, 'exactly 1 MB is read');

    const big = path.join(dir, 'big.txt');
    writeFileSync(big, 'a'.repeat(READ_MAX_BYTES + 1));
    assert.equal(io.readFile(big), null, 'a file over 1 MB is refused');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // A FIFO: the open is non-blocking and its type is refused, so nothing reads from it.
  const opened = [];
  const fifoFs = {
    constants: nodeFs.constants,
    openSync: (p, flags) => (opened.push(flags), 7),
    fstatSync: () => ({ isFile: () => false, nlink: 1, size: 0 }),
    readSync: () => {
      throw new Error('a FIFO must never be read');
    },
    closeSync: () => {},
  };
  const io = makeIo({ now: () => 0, fs: fifoFs });
  assert.equal(io.readFile('/x/pipe'), null);
  assert.ok((opened[0] & nodeFs.constants.O_NONBLOCK) !== 0, 'the open is O_NONBLOCK');
});
