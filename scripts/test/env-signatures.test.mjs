import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, hasTestFailure } from '../lib/env-signatures.mjs';

test('classifies the Docker daemon', () => {
  assert.deepEqual(
    classify({ status: 1, output: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock' }),
    { signature: 'docker' },
  );
  assert.deepEqual(classify({ status: 1, output: 'Could not find a working container runtime strategy' }), {
    signature: 'docker',
  });
});

test('classifies a full disk', () => {
  assert.deepEqual(classify({ status: 1, output: 'Error: ENOSPC: no space left on device' }), {
    signature: 'disk',
  });
  assert.deepEqual(classify({ status: 1, output: 'write failed: No Space Left On Device' }), {
    signature: 'disk',
  });
});

test('classifies a kill', () => {
  assert.deepEqual(classify({ status: 137, output: 'Killed' }), { signature: 'killed' });
  assert.deepEqual(classify({ status: null, signal: 'SIGKILL', output: '' }), { signature: 'killed' });
});

test('classifies a port in use', () => {
  assert.deepEqual(
    classify({ status: 1, output: 'Error: listen EADDRINUSE: address already in use :::3000' }),
    {
      signature: 'port',
    },
  );
});

test('classifies a missing command', () => {
  assert.deepEqual(classify({ status: 127, output: 'sh: cargo: command not found' }), {
    signature: 'not-found',
  });
  assert.deepEqual(classify({ status: 1, output: 'Error: spawn pnpm ENOENT' }), { signature: 'not-found' });
});

test('classifies the wrapper timeout', () => {
  assert.deepEqual(classify({ status: null, signal: 'SIGTERM', output: '', timedOut: true }), {
    signature: 'timeout',
  });
});

test('classifies a bare exit 127 as not found', () => {
  assert.deepEqual(classify({ status: 127, output: '' }), { signature: 'not-found' });
});

test('leaves ordinary failures alone', () => {
  assert.equal(classify({ status: 1, output: 'expected 2, received 3' }), null);
  assert.equal(classify({ status: 1, output: 'Error: Module not found: ./missing.js' }), null);
  assert.equal(classify({ status: 1, output: 'GET /healthz 404 not found' }), null);
  assert.equal(classify({ status: 1, output: '' }), null);
});

test('a test-failure marker wins over a signature', () => {
  assert.equal(
    classify({ status: 1, output: 'Cannot connect to the Docker daemon\nnot ok 3 - stores the room' }),
    null,
  );
  assert.equal(classify({ status: 137, output: 'Killed\n✖ stores the room' }), null);
  assert.equal(classify({ status: 127, output: 'sh: x: command not found\n1 failing' }), null);
  assert.equal(classify({ status: 1, output: 'EADDRINUSE\nTests: 2 failed' }), null);
  assert.equal(
    classify({ status: null, signal: 'SIGKILL', output: 'Error: ENOSPC\ntest result: FAILED' }),
    null,
  );
  assert.equal(hasTestFailure('Tests: 1 failed, 4 passed'), true);
  assert.equal(hasTestFailure('all green'), false);
});
