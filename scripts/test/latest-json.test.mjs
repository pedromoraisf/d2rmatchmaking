// Unit tests of the latest.json signature rewrite that the SignPath job runs (AGS-29, AD-053).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replaceWindowsSignature } from '../agent/latest-json.mjs';

const latest = () => ({
  version: '0.0.1',
  notes: 'first release',
  pub_date: '2026-10-31T00:00:00Z',
  platforms: {
    'windows-x86_64': { signature: 'old-windows', url: 'https://example.test/setup.exe' },
    'darwin-aarch64': { signature: 'mac-signature', url: 'https://example.test/app.tar.gz' },
  },
});

test('latest-json replaces only the Windows signature and keeps the version', () => {
  const before = latest();
  const after = replaceWindowsSignature(before, 'new-windows\n');

  assert.equal(after.version, '0.0.1');
  assert.equal(after.notes, 'first release');
  assert.equal(after.pub_date, '2026-10-31T00:00:00Z');
  assert.deepEqual(after.platforms['windows-x86_64'], {
    signature: 'new-windows',
    url: 'https://example.test/setup.exe',
  });
  assert.deepEqual(after.platforms['darwin-aarch64'], before.platforms['darwin-aarch64']);
  assert.deepEqual(before, latest(), 'the input is not mutated');
});

test('latest-json refuses a file without a Windows entry', () => {
  const without = { version: '0.0.1', platforms: { 'darwin-aarch64': { signature: 'x', url: 'y' } } };
  assert.throws(() => replaceWindowsSignature(without, 'new'), /no windows-x86_64 entry/);
});

test('latest-json refuses an empty signature', () => {
  assert.throws(() => replaceWindowsSignature(latest(), '  \n'), /signature is empty/);
  assert.throws(() => replaceWindowsSignature(latest(), undefined), /signature is empty/);
});
