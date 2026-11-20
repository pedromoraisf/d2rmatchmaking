// Unit tests of the Authenticode verdict (AGR-04) on drawn PowerShell answers.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseSubject, signatureVerdict } from '../agent/signature-verdict.mjs';

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'agent',
  'signature-verdict.mjs',
);
const SUBJECT = 'CN=SignPath Foundation, O=SignPath Foundation, L=Lewes, S=Delaware, C=US';

test('a subject is split into its pairs, quotes and commas included', () => {
  assert.deepEqual(parseSubject('CN="Doe, Jane", O=Org'), [
    ['CN', 'Doe, Jane'],
    ['O', 'Org'],
  ]);
  assert.deepEqual(parseSubject(undefined), []);
});

test('a valid signature by the expected publisher passes', () => {
  assert.deepEqual(signatureVerdict({ status: 'Valid', subject: SUBJECT, expected: 'SignPath Foundation' }), {
    ok: true,
  });
});

test('an empty expected publisher is "not configured" and always fails', () => {
  for (const expected of ['', '  ', undefined]) {
    const verdict = signatureVerdict({ status: 'Valid', subject: SUBJECT, expected });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /not configured/);
  }
});

test('an unsigned, invalid or unknown-root signature fails, whatever the subject', () => {
  for (const status of ['NotSigned', 'HashMismatch', 'UnknownError', 'NotTrusted', undefined]) {
    const verdict = signatureVerdict({ status, subject: SUBJECT, expected: 'SignPath Foundation' });
    assert.equal(verdict.ok, false, String(status));
    assert.match(verdict.reason, /not Valid/);
  }
});

test('another publisher fails, and only a whole CN or O counts', () => {
  for (const subject of [
    'CN=Somebody Else, O=Somebody Else',
    'CN=SignPath Foundation Fake, O=Evil',
    'L=SignPath Foundation',
    '',
  ]) {
    const verdict = signatureVerdict({ status: 'Valid', subject, expected: 'SignPath Foundation' });
    assert.equal(verdict.ok, false, subject);
    assert.match(verdict.reason, /another publisher/);
  }
});

test('the CLI reads the JSON from standard input and exits 1 on a refusal', () => {
  const run = (input, expected) =>
    spawnSync('node', [script, '--expected', expected], { input: JSON.stringify(input), encoding: 'utf8' });
  const pass = run({ status: 'Valid', subject: SUBJECT }, 'SignPath Foundation');
  assert.equal(pass.status, 0, pass.stderr);
  const refuse = run({ status: 'NotSigned', subject: '' }, 'SignPath Foundation');
  assert.equal(refuse.status, 1);
  assert.match(refuse.stderr, /::error::the installer's signature is NotSigned/);
  assert.equal(run({ status: 'Valid', subject: SUBJECT }, '').status, 1);
});
