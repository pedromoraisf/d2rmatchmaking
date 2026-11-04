import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyDockerFailure } from '../../load/lib/preflight.mjs';

test('classifies Docker failures', () => {
  const missing = classifyDockerFailure(Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }));
  assert.equal(missing.kind, 'docker-missing');
  assert.match(missing.message, /Docker/, 'a missing Docker names Docker');

  assert.equal(classifyDockerFailure('sh: docker: command not found').kind, 'docker-missing');

  const down = classifyDockerFailure(
    'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
  );
  assert.equal(down.kind, 'docker-down');
  assert.match(down.message, /Docker/, 'a stopped daemon names Docker');

  const pull = classifyDockerFailure(
    new Error('pull access denied for grafana/k6, repository does not exist or may require docker login'),
  );
  assert.equal(pull.kind, 'image');
  assert.match(pull.message, /the image grafana\/k6/, 'an image failure names the image and its reference');

  const manifest = classifyDockerFailure({
    message: 'manifest unknown',
    image: 'golang:1.27.1-alpine',
  });
  assert.equal(manifest.kind, 'image');
  assert.match(manifest.message, /golang:1\.27\.1-alpine/, 'the image the caller set is named');

  const build = classifyDockerFailure('failed to solve: process "/bin/sh -c apk add git" did not complete');
  assert.equal(build.kind, 'image');
  assert.match(build.message, /the image/, 'a build failure names the image even without a reference');
});

test('an unknown error is classified docker-down with the original text included, redacted', () => {
  const odd = classifyDockerFailure(new Error('something odd happened Bearer d2rmm_a_leaked'));
  assert.equal(odd.kind, 'docker-down');
  assert.match(odd.message, /Docker/, 'the message names Docker');
  assert.match(odd.message, /something odd happened/, 'the original text is included');
  assert.doesNotMatch(odd.message, /d2rmm_a_leaked/, 'the secret in the original text is redacted');
});

test('an unknown long error keeps its end, where the reason is, and redacts before it cuts', () => {
  // A `docker run` prints its pull progress first and the reason last, so the end of the text is the part to keep.
  const progress = 'Pulling fs layer\n'.repeat(60);
  const long = classifyDockerFailure(`${progress}Error response from daemon: the mount is denied`);
  assert.equal(long.kind, 'docker-down');
  assert.match(long.message, /the mount is denied/, 'the reason at the end of the text is in the message');
  assert.ok(long.message.length < 700, 'the message stays short');

  const straddling = classifyDockerFailure(`${'a'.repeat(600)} Bearer d2rmm_a_leaked_secret_value`);
  assert.doesNotMatch(
    straddling.message,
    /leaked|secret_value/,
    'a secret at the cut is never partly written',
  );
});
