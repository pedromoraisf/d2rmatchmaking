// The static test of the load run (design.md § Test Strategy; LB-01, LB-02, LB-20). It reads files and runs no Docker: the image
// pins, the Dockerfiles and the root .dockerignore. The package scripts, the journey and the workflows are checked here too
// once their tasks land (T28).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import * as images from '../load/lib/images.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIGEST = /@sha256:[0-9a-f]{64}$/u;
const TAG_AND_DIGEST = /^[a-z0-9./-]+:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$/u;

function read(...parts) {
  return readFileSync(path.join(root, ...parts), 'utf8');
}

/** The meaningful lines of a Dockerfile or a .dockerignore: trimmed, without blanks and comments. */
function linesOf(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

test('images, shell and journey rules', () => {
  const pulled = [
    images.POSTGRES_IMAGE,
    images.NODE_ALPINE_IMAGE,
    images.NODE_SLIM_IMAGE,
    images.GOLANG_BUILDER_IMAGE,
    images.K6_BASE_IMAGE,
  ];
  for (const reference of pulled) {
    assert.match(reference, TAG_AND_DIGEST, `${reference} carries a tag and a sha256 digest`);
  }
  for (const tag of [images.API_IMAGE_TAG, images.K6_IMAGE_TAG]) {
    assert.match(tag, /^d2rmm-load-(api|k6):[a-z0-9.-]+$/u, `${tag} is a local build tag, never latest`);
  }

  const pins = new Set([images.NODE_SLIM_IMAGE, images.GOLANG_BUILDER_IMAGE, images.K6_BASE_IMAGE]);
  for (const file of ['api.Dockerfile', 'k6.Dockerfile']) {
    const froms = [
      ...read('scripts', 'load', 'docker', file).matchAll(/^FROM\s+(?:--platform=\S+\s+)?(\S+)/gmu),
    ].map((match) => match[1]);
    assert.ok(froms.length > 0, `${file} has a FROM line`);
    for (const from of froms) {
      assert.match(from, DIGEST, `${file}: ${from} is pinned by digest`);
      assert.ok(pins.has(from), `${file}: ${from} is one of the pins of lib/images.mjs`);
    }
  }

  const api = linesOf(read('scripts', 'load', 'docker', 'api.Dockerfile'));
  const render = parse(read('render.yaml')).services[0];
  assert.deepEqual(
    api.filter((line) => line.startsWith('FROM ')),
    [`FROM ${images.NODE_SLIM_IMAGE}`],
    'the API image is built on the pinned slim base',
  );
  assert.ok(
    api.includes(`RUN ${render.buildCommand}`),
    'the API image installs with render.yaml buildCommand',
  );
  const cmd = api.find((line) => line.startsWith('CMD '));
  assert.ok(cmd, 'the API image has a CMD');
  assert.equal(
    JSON.parse(cmd.slice('CMD '.length)).join(' '),
    render.startCommand,
    'the start is render.yaml startCommand',
  );
  assert.ok(api.includes('USER node'), 'the API image runs as the node user');
  assert.equal(
    api.some((line) => /^ARG\b/u.test(line)),
    false,
    'the API image takes no build argument',
  );
  assert.equal(
    api.some((line) => /^ENV\b/u.test(line)),
    false,
    'the API image sets no environment at build time',
  );
  assert.equal(
    api.some((line) => /^COPY\b/u.test(line) && /\.(pem|key|crt|env)\b|\.env/u.test(line)),
    false,
    'no certificate, key or environment file is copied by name',
  );

  const ignore = linesOf(read('.dockerignore'));
  assert.equal(ignore[0], '*', 'the build context starts deny-by-default');
  const lastReinclusion = Math.max(-1, ...ignore.map((line, index) => (line.startsWith('!') ? index : -1)));
  for (const entry of [
    '!apps/api',
    '!packages',
    '!package.json',
    '!pnpm-lock.yaml',
    '!pnpm-workspace.yaml',
  ]) {
    assert.ok(ignore.includes(entry), `.dockerignore re-includes ${entry}`);
  }
  for (const entry of ['**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/node_modules']) {
    assert.ok(
      ignore.indexOf(entry) > lastReinclusion,
      `.dockerignore excludes ${entry} after every re-inclusion`,
    );
  }

  const journey = read('scripts', 'load', 'k6', 'journey.mjs');
  assert.match(
    journey,
    /import\s*\{[^}]*\}\s*from\s*'\.\/journey-state\.mjs'/u,
    'journey.mjs imports the state machine it is tested with',
  );
  assert.doesNotMatch(journey, /console\.log/u, 'journey.mjs prints nothing with console.log');
  assert.doesNotMatch(journey, /traceparent/iu, 'journey.mjs sends no traceparent');
});
