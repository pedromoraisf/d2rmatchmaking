import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strykerScore, cargoMutantsScore, harnessField, pointer, eslintWarnings } from '../lib/collect.mjs';

test('stryker score counts killed+timeout over valid mutants', () => {
  const report = { files: { 'a.ts': { mutants: [{ status: 'Killed' }, { status: 'Survived' }, { status: 'Timeout' }, { status: 'NoCoverage' }, { status: 'CompileError' }] } } };
  assert.equal(strykerScore(report), 50);
  assert.equal(strykerScore({ files: {} }), null);
});

test('cargo-mutants score ignores unviable mutants', () => {
  const o = { outcomes: [{ summary: 'CaughtMutant' }, { summary: 'MissedMutant' }, { summary: 'Unviable' }, { summary: 'Timeout' }] };
  assert.equal(cargoMutantsScore(o), 66.67);
});

test('harness-score report fields', () => {
  const r = { level: { index: 4 }, score: { percent: 91 }, checks: [{ passed: false }, { passed: true }, { passed: false, applicable: false }] };
  assert.equal(harnessField(r, 'level'), 4);
  assert.equal(harnessField(r, 'percent'), 91);
  assert.equal(harnessField(r, 'failed'), 1);
});

test('json pointer and eslint counts', () => {
  assert.equal(pointer({ a: { b: 3 } }, '/a/b'), 3);
  assert.equal(pointer(null, '/a'), undefined);
  assert.equal(eslintWarnings([{ warningCount: 1, errorCount: 2 }, { warningCount: 0, errorCount: 0 }]), 3);
});
