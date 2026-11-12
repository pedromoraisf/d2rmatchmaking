// Proves the rule that keeps game screenshots out of the repository (scripts/check-images.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { MAX_FIXTURE_BYTES, checkImages } from '../check-images.mjs';

const small = () => 14_000;

test('a drawn agent fixture and the agent icons pass', () => {
  assert.deepEqual(
    checkImages(
      ['apps/agent/fixtures/party/party-revealed.png', 'apps/agent/src-tauri/icons/icon.png'],
      small,
    ),
    [],
  );
});

test('an agent fixture larger than a drawn one is refused', () => {
  const problems = checkImages(['apps/agent/fixtures/party/x.png'], () => MAX_FIXTURE_BYTES + 1);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /capture, not a drawn fixture/);
});

test('a fixture exactly at the limit passes', () => {
  assert.deepEqual(
    checkImages(['apps/agent/fixtures/x.png'], () => MAX_FIXTURE_BYTES),
    [],
  );
});

test('a name that says it is a capture is refused even when small', () => {
  for (const name of [
    'maintainer-party-revealed.png',
    'Screenshot 2026-11-10 220259.png',
    'party-screen_shot.webp',
    'print-lobby.jpg',
    'captura.png',
  ]) {
    const problems = checkImages([`apps/agent/fixtures/party/${name}`], small);
    assert.equal(problems.length, 1, name);
    assert.match(problems[0], /game capture/);
  }
});

test('an image outside the allowed directories is refused', () => {
  for (const file of ['docs/lobby.png', 'apps/web/src/assets/bg.jpg', 'tests/acceptance/select.png']) {
    const problems = checkImages([file], small);
    assert.equal(problems.length, 1, file);
    assert.match(problems[0], /may be committed only under/);
  }
});

test('files that are not images are ignored', () => {
  assert.deepEqual(
    checkImages(['apps/agent/fixtures/party/party-revealed.png.json', 'README.md'], () => 10 ** 9),
    [],
  );
});

test('every image committed in the repository passes', () => {
  const images = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(png|jpe?g|webp|gif|bmp|tiff?|avif|heic)$/i.test(f));
  assert.deepEqual(
    checkImages(images, (f) => statSync(f).size),
    [],
  );
});
