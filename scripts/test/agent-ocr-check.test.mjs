// The maintainer's Windows OCR check (scripts/agent/ocr-check.mjs): the folder's problems and the nextest arguments are pure;
// nothing here runs the OCR engine or reads a screenshot.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { SCREENSHOTS, folderProblems, nextestArgs } from '../agent/ocr-check.mjs';

const folder = path.join('/shots', 'party');
const everyFileExists = () => true;
const isFolder = () => true;

test('the check names the three screenshots it reads', () => {
  assert.deepEqual(SCREENSHOTS, [
    'maintainer-party-revealed.png',
    'maintainer-party-revealed-tooltip.png',
    'maintainer-party-masked.png',
  ]);
});

test('a folder with the three screenshots has no problem', () => {
  assert.deepEqual(folderProblems(folder, everyFileExists, isFolder), []);
});

test('no folder argument is a problem, and asks for one', () => {
  assert.deepEqual(folderProblems(undefined, everyFileExists, isFolder), [
    'give the folder of the three screenshots as the argument',
  ]);
  assert.deepEqual(folderProblems('', everyFileExists, isFolder), [
    'give the folder of the three screenshots as the argument',
  ]);
});

test('a path that is missing or is not a folder is a problem', () => {
  assert.deepEqual(
    folderProblems(folder, () => false, isFolder),
    [`${folder} is not a folder`],
  );
  assert.deepEqual(
    folderProblems(folder, everyFileExists, () => false),
    [`${folder} is not a folder`],
  );
});

test('each missing screenshot is named, so the maintainer knows which file to copy', () => {
  const onlyRevealed = (file) =>
    file === folder || file === path.join(folder, 'maintainer-party-revealed.png');
  assert.deepEqual(folderProblems(folder, onlyRevealed, isFolder), [
    `maintainer-party-revealed-tooltip.png is missing from ${folder}`,
    `maintainer-party-masked.png is missing from ${folder}`,
  ]);
});

test('the nextest run executes only the ignored ocr_check test of the app package', () => {
  const args = nextestArgs();
  assert.equal(args[0], 'nextest');
  assert.equal(args[1], 'run');
  assert.deepEqual(args.slice(args.indexOf('-p'), args.indexOf('-p') + 2), ['-p', 'd2rmm-agent']);
  assert.deepEqual(args.slice(args.indexOf('--run-ignored'), args.indexOf('--run-ignored') + 2), [
    '--run-ignored',
    'only',
  ]);
  assert.equal(args[args.indexOf('-E') + 1], 'test(ocr_check)', 'the filter names the check test');
  assert.ok(args.includes('--no-capture'), 'the per-file PASS and FAIL lines are printed');
});

test('the nextest run points at the agent workspace manifest', () => {
  const manifest = nextestArgs()[nextestArgs().indexOf('--manifest-path') + 1];
  assert.ok(
    manifest.endsWith(path.join('apps', 'agent', 'src-tauri', 'Cargo.toml')),
    `the manifest is the agent's: ${manifest}`,
  );
});
