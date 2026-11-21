import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertStaging, TargetRefusal } from '../staging/lib/target.mjs';

const API = 'https://d2rmm-api.example.com';

function api({ stagingEndpoints = true, status = 200 } = {}) {
  const seen = [];
  const fetch = async (url, init = {}) => {
    seen.push(`${init.method ?? 'GET'} ${new URL(url).pathname}`);
    const path = new URL(url).pathname;
    if (path === '/healthz') return new Response('{}', { status });
    return new Response(JSON.stringify({ stagingEndpoints, minAgentVersion: '0.5.0' }), { status });
  };
  return { fetch, seen };
}

const input = (extra = {}) => ({ apiUrl: API, environment: undefined, ...extra });

test('SBT-02 a staging API passes, after only /healthz and /v1/config', async () => {
  const fake = api();
  const target = await assertStaging(input({ fetch: fake.fetch }));
  assert.equal(target.origin, API);
  assert.equal(target.minAgentVersion, '0.5.0');
  assert.deepEqual(fake.seen, ['GET /healthz', 'GET /v1/config']);
});

test('SBT-02 a production-shaped API (stagingEndpoints false) is refused', async () => {
  await assert.rejects(
    assertStaging(input({ fetch: api({ stagingEndpoints: false }).fetch })),
    TargetRefusal,
  );
});

test('SBT-02 an unset variable, a path, and a plain-http remote host are refused', async () => {
  const fake = api();
  for (const bad of [{ apiUrl: undefined }, { apiUrl: `${API}/v1` }, { apiUrl: 'http://x.example.com' }]) {
    await assert.rejects(assertStaging(input({ ...bad, fetch: fake.fetch })), TargetRefusal);
  }
  assert.deepEqual(fake.seen, []);
});

test('SBT-02 D2RMM_ENV=production is refused before any request', async () => {
  const fake = api();
  await assert.rejects(assertStaging(input({ environment: 'production', fetch: fake.fetch })), TargetRefusal);
  assert.deepEqual(fake.seen, []);
});

test('SBT-02 an API that does not answer, or answers an error, is refused', async () => {
  await assert.rejects(assertStaging(input({ fetch: api({ status: 502 }).fetch })), TargetRefusal);
  await assert.rejects(
    assertStaging(
      input({
        fetch: async () => {
          throw new Error('down');
        },
      }),
    ),
    TargetRefusal,
  );
});
