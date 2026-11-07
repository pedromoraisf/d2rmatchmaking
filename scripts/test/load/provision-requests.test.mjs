import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  claimRequest,
  cookieFrom,
  pairRequest,
  pairingCodeRequest,
  testLoginRequest,
  tokenFrom,
} from '../../load/lib/provision-requests.mjs';

const BASE = 'http://127.0.0.1:8080';
const ORIGIN = 'http://localhost:8788';
const ADDRESS = '10.0.0.7';
const VERSION = '0.1.0';
const COOKIE = '__Host-d2rmm_session=sess-value-42';

test('provisioning requests', () => {
  const login = testLoginRequest({ base: BASE, origin: ORIGIN, address: ADDRESS, name: 'lbk7q2mz9a0' });
  assert.equal(login.url, 'http://127.0.0.1:8080/v1/auth/test-login');
  assert.equal(login.init.method, 'POST');
  assert.deepEqual(login.init.headers, {
    Origin: ORIGIN,
    'Content-Type': 'application/json',
    'X-Forwarded-For': ADDRESS,
  });
  assert.deepEqual(JSON.parse(login.init.body), { name: 'lbk7q2mz9a0' });
  assert.equal('Authorization' in login.init.headers, false, 'a site call sends no bearer');

  const code = pairingCodeRequest({ base: BASE, version: VERSION, address: ADDRESS });
  assert.equal(code.url, 'http://127.0.0.1:8080/v1/agents/pairing-codes');
  assert.deepEqual(code.init.headers, { 'X-Agent-Version': VERSION, 'X-Forwarded-For': ADDRESS });
  assert.equal(code.init.body, undefined, 'the pairing-code call has no body');
  assert.equal('Origin' in code.init.headers, false, 'the agent route is not a same-origin route');

  const pair = pairRequest({ base: BASE, origin: ORIGIN, address: ADDRESS, cookie: COOKIE, code: '123456' });
  assert.equal(pair.url, 'http://127.0.0.1:8080/v1/agents/pair');
  assert.deepEqual(pair.init.headers, {
    Origin: ORIGIN,
    'Content-Type': 'application/json',
    Cookie: COOKIE,
    'X-Forwarded-For': ADDRESS,
  });
  assert.deepEqual(JSON.parse(pair.init.body), { code: '123456' });
  assert.equal('Authorization' in pair.init.headers, false, 'a site call sends no bearer');

  const claim = claimRequest({ base: BASE, version: VERSION, address: ADDRESS, claimSecret: 'claim-secret' });
  assert.equal(claim.url, 'http://127.0.0.1:8080/v1/agents/pairing-codes/claim');
  assert.deepEqual(claim.init.headers, {
    'X-Agent-Version': VERSION,
    'Content-Type': 'application/json',
    'X-Forwarded-For': ADDRESS,
  });
  assert.deepEqual(JSON.parse(claim.init.body), { claimSecret: 'claim-secret' });
  assert.equal('Authorization' in claim.init.headers, false, 'the claim is made without a bearer');

  for (const built of [login, code, pair, claim]) {
    assert.equal(new URL(built.url).hostname, '127.0.0.1', 'every URL has the loopback host');
  }
});

test('a base with another host is refused', () => {
  const others = [
    'http://localhost:8080',
    'http://10.0.0.5:8080',
    'https://127.0.0.1:8080',
    'http://127.0.0.1',
  ];
  for (const base of others) {
    assert.throws(() => pairingCodeRequest({ base, version: VERSION, address: ADDRESS }), TypeError, base);
  }
  assert.throws(
    () => pairingCodeRequest({ base: 'http://127.0.0.1:8080/path', version: VERSION, address: ADDRESS }),
    TypeError,
    'a base with a path is refused',
  );
  assert.throws(
    () => pairingCodeRequest({ base: 'not a url', version: VERSION, address: ADDRESS }),
    TypeError,
  );
});

test('malformed inputs are refused', () => {
  assert.throws(() => pairingCodeRequest({ base: BASE, version: 'latest', address: ADDRESS }), TypeError);
  assert.throws(() => pairingCodeRequest({ base: BASE, version: VERSION, address: '10.0.0.300' }), TypeError);
  assert.throws(
    () => testLoginRequest({ base: BASE, origin: ORIGIN, address: ADDRESS, name: 'a' }),
    TypeError,
  );
  assert.throws(
    () => testLoginRequest({ base: BASE, origin: ORIGIN, address: ADDRESS, name: 'bad name' }),
    TypeError,
    'a name with a space is refused',
  );
  assert.throws(
    () => pairRequest({ base: BASE, origin: ORIGIN, address: ADDRESS, cookie: 'other=1', code: '123456' }),
    TypeError,
    'pair needs the session cookie',
  );
});

test('cookieFrom returns the session pair and tokenFrom the agent token', () => {
  const header = '__Host-d2rmm_session=sess-value-42; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800';
  assert.equal(cookieFrom(header), COOKIE, 'the name and value only');
  assert.equal(cookieFrom([header]), COOKIE, 'a list of header values');
  assert.equal(
    cookieFrom(['theme=dark; Path=/', header]),
    COOKIE,
    'the session cookie is found among other cookies',
  );
  assert.throws(() => cookieFrom('theme=dark; Path=/'), TypeError, 'no session cookie is refused');
  assert.throws(() => cookieFrom(undefined), TypeError);

  assert.equal(tokenFrom({ token: 'd2rmm_a_aaa-AAA_000' }), 'd2rmm_a_aaa-AAA_000');
  assert.throws(() => tokenFrom({ token: 'session-like' }), TypeError, 'a token needs the d2rmm_a_ prefix');
  assert.throws(() => tokenFrom({}), TypeError);
  assert.throws(() => tokenFrom(null), TypeError);
});
