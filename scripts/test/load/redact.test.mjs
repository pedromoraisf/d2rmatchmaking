import assert from 'node:assert/strict';
import { test } from 'node:test';
import { containsSecret, redact } from '../../load/lib/redact.mjs';

test('redact masks cookies, bearer and agent tokens, passwords and URL user-info', () => {
  assert.equal(redact('Cookie: __Host-d2rmm_session=abc123; other=1'), 'Cookie: [redacted]');
  assert.equal(redact('Set-Cookie: __Host-d2rmm_session=abc123; Path=/'), 'Set-Cookie: [redacted]');
  assert.equal(redact('authorization Bearer d2rmm_a_xyz failed'), 'authorization Bearer [redacted] failed');
  assert.equal(redact('agent d2rmm_a_xyz'), 'agent [redacted]');
  assert.equal(redact('password=hunter2 next'), 'password=[redacted] next');
  assert.equal(redact('{"password":"hunter2"}'), '{"password":"[redacted]"}');
  assert.equal(redact('postgres://user:s3cret@db:5432/app'), 'postgres://[redacted]@db:5432/app');
});

test('redact leaves plain text alone', () => {
  const plain = 'k6 exited with code 137 at http://127.0.0.1:8787/health';
  assert.equal(redact(plain), plain);
  assert.equal(containsSecret(plain), false);
});

test('containsSecret is true only where redact would change the text', () => {
  assert.equal(containsSecret('Bearer d2rmm_a_xyz'), true);
  assert.equal(containsSecret('just a message'), false);
});
