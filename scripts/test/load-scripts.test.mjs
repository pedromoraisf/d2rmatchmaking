// The static test of the load run (design.md § Test Strategy; LB-01, LB-02, LB-20). It reads files and runs no Docker: the image
// pins, the Dockerfiles and the root .dockerignore. The package scripts, the journey and the workflows are checked here too
// once their tasks land (T28).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
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

/** Every `.mjs` file under scripts/load, with its repository-relative name. */
function loadModules() {
  return readdirSync(path.join(root, 'scripts', 'load'), { recursive: true })
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => path.join('scripts', 'load', name));
}

/** The meaningful lines of a Dockerfile or a .dockerignore: trimmed, without blanks and comments. */
function linesOf(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

test('images, shell and journey rules', () => {
  // Every constant lib/images.mjs exports: a `_IMAGE` is pulled and must be pinned, a `_TAG` is a local build tag.
  const exported = Object.entries(images);
  const pulled = exported.filter(([name]) => name.endsWith('_IMAGE'));
  assert.ok(pulled.length > 0, 'lib/images.mjs exports the pulled images');
  for (const [name, reference] of pulled) {
    assert.match(reference, TAG_AND_DIGEST, `${name} carries a tag and a sha256 digest`);
  }
  const localTags = exported.filter(([name]) => name.endsWith('_TAG'));
  assert.ok(localTags.length > 0, 'lib/images.mjs exports the local build tags');
  for (const [name, tag] of localTags) {
    assert.match(tag, /^d2rmm-load-(api|k6):[a-z0-9.-]+$/u, `${name} is a local build tag, never latest`);
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

  // Nothing under scripts/load pushes an image, logs in to a registry or runs a command through a shell. An image
  // literal is a name with a version tag (`node:26`) or a digest; `node:path` is a module specifier, not an image.
  const IMAGE_LITERAL =
    /(['"`])((?:docker\.io\/|ghcr\.io\/)?(?:library\/)?(?:postgres|node|golang|alpine(?:\/openssl)?|grafana\/k6)(?::\d[^'"`\s]*|@[^'"`\s]*))\1/gu;
  const SHELL_INTERPOLATION = /(?:'sh',\s*'-c',\s*|sh -c\s+)(['"`])[^'"`]*\$\{/u;
  for (const file of loadModules()) {
    const text = read(file);
    assert.doesNotMatch(text, /\bdocker\s+(?:push|login)\b|--push\b/u, `${file} pushes or logs in nowhere`);
    assert.doesNotMatch(text, /shell:\s*true/u, `${file} spawns without a shell`);
    assert.doesNotMatch(text, /(?<![\w.])exec(?:Sync)?\(/u, `${file} runs no child_process exec`);
    assert.doesNotMatch(text, SHELL_INTERPOLATION, `${file} interpolates nothing into sh -c`);
    for (const [, , reference] of text.matchAll(IMAGE_LITERAL)) {
      assert.match(reference, DIGEST, `${file}: ${reference} is pinned by digest`);
    }
  }
});

test('pairing limiter constants', () => {
  // The pairing limiter the run must not change (LB-04): read from the API's own source, never copied.
  const source = read('apps', 'api', 'src', 'modules', 'agents', 'domain', 'sliding-window.ts');
  const minute = /^const MS_PER_MINUTE = (\d+) \* (\d+);$/mu.exec(source);
  assert.ok(minute, 'MS_PER_MINUTE is defined as a product of two numbers');
  const msPerMinute = Number(minute[1]) * Number(minute[2]);
  const limiterOf = (name) => {
    const match = new RegExp(
      `^export const ${name} = new SlidingWindowLimit\\((\\d+), (\\d+) \\* MS_PER_MINUTE\\);$`,
      'mu',
    ).exec(source);
    assert.ok(match, `${name} is a SlidingWindowLimit over whole minutes`);
    return { limit: Number(match[1]), windowMs: Number(match[2]) * msPerMinute };
  };
  assert.deepEqual(
    limiterOf('IP_CODE_REQUESTS'),
    { limit: 10, windowMs: 60 * 60 * 1000 },
    'pairing-code requests: 10 an hour per address',
  );
  assert.deepEqual(
    limiterOf('ACCOUNT_CODE_SUBMISSIONS'),
    { limit: 10, windowMs: 5 * 60 * 1000 },
    'pairing-code submissions: 10 per 5 minutes per account',
  );
});

test('load scripts are on demand only', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['test:load'], 'LOAD_PROFILE=full node scripts/load/run.mjs', 'the full run');
  assert.equal(
    pkg.scripts['test:load:smoke'],
    'LOAD_PROFILE=smoke node scripts/load/run.mjs',
    'the smoke run',
  );
  assert.equal(pkg.scripts['load:publish'], 'node scripts/load/publish.mjs', 'the publish command');

  const LOAD_COMMAND = /test:load|load:publish|scripts\/load\//u;
  for (const name of ['check', 'test', 'test:harness', 'test:integration']) {
    assert.ok(name in pkg.scripts, `${name} is a root script`);
    assert.doesNotMatch(pkg.scripts[name], LOAD_COMMAND, `${name} never runs the load`);
  }
  for (const file of readdirSync(path.join(root, '.github', 'workflows'))) {
    assert.doesNotMatch(read('.github', 'workflows', file), LOAD_COMMAND, `${file} never runs the load`);
  }
});
