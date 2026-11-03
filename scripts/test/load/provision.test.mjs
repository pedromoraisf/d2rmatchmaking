// The provisioner (design.md § Provisioner; LB-03, LB-04). A fake `fetch` answers the four routes with the real `Response`
// class, so the cookie and the claim are read as the provisioner reads them in production. No network is used.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROVISION_CONCURRENCY, ProvisionError, provision } from '../../load/provision.mjs';
import { playerFor } from '../../load/lib/players.mjs';

const RUN_ID = 'abcdefgh';
const BASE = 'http://127.0.0.1:8080';
const VERSION = '0.1.0';
const SLOW_TEST_MS = 20_000;

/** The secrets of one player, distinct per index, so a leaked value is recognisable in the output. */
function secretsOf(index) {
  return {
    session: `S3ssion${index}Value`,
    token: `d2rmm_a_T0ken${index}Value`,
    claimSecret: `Cla1mSecret${index}`,
  };
}

function jsonAnswer(status, body, headers = {}) {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/**
 * A fake `fetch` for the four provisioning routes. The claim answers 202 once per player, then 200 with the token.
 * `failure` replaces the answer of one route for one player: `{ index, route, status }`.
 */
function fakeFetch({ players, failure = null, claimAlwaysPending = false }) {
  const indexOf = new Map(players.map((player, index) => [player.address, index]));
  const claimPolls = new Map();
  const calls = [];
  let inFlight = 0;
  let peak = 0;

  async function fetchFake(url, init) {
    const parsed = new URL(url);
    const address = init.headers['X-Forwarded-For'];
    const index = indexOf.get(address);
    calls.push({ hostname: parsed.hostname, pathname: parsed.pathname, headers: init.headers });
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    try {
      await new Promise((resolve) => setImmediate(resolve));
      const route = parsed.pathname;
      if (failure !== null && failure.index === index && failure.route === route) {
        return jsonAnswer(failure.status, { error: 'refused' });
      }
      if (route === '/v1/auth/test-login') {
        return jsonAnswer(
          200,
          {},
          { 'set-cookie': `__Host-d2rmm_session=${secretsOf(index).session}; Path=/; HttpOnly; Secure` },
        );
      }
      if (route === '/v1/agents/pairing-codes') {
        return jsonAnswer(201, { code: '123456', claimSecret: secretsOf(index).claimSecret });
      }
      if (route === '/v1/agents/pair') {
        return jsonAnswer(200, {});
      }
      if (route === '/v1/agents/pairing-codes/claim') {
        const polls = (claimPolls.get(index) ?? 0) + 1;
        claimPolls.set(index, polls);
        if (claimAlwaysPending || polls === 1) return jsonAnswer(202, { status: 'pending' });
        return jsonAnswer(200, { token: secretsOf(index).token });
      }
      return jsonAnswer(404, { error: 'not-found' });
    } finally {
      inFlight -= 1;
    }
  }
  return { fetchFake, calls, peak: () => peak };
}

/** Captures what the process prints while `run` executes, so the test can assert that no secret was logged. */
async function capturingLogs(run) {
  const lines = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'];
  const original = Object.fromEntries(methods.map((name) => [name, console[name]]));
  for (const name of methods) {
    console[name] = (...parts) => lines.push(parts.map(String).join(' '));
  }
  try {
    return { result: await run(), lines };
  } finally {
    Object.assign(console, original);
  }
}

test('provisions players without logging secrets', { timeout: SLOW_TEST_MS }, async () => {
  const players = [0, 1, 2].map((index) => playerFor(RUN_ID, index));
  const fake = fakeFetch({ players });

  const { result, lines } = await capturingLogs(() =>
    provision({ players, base: BASE, origin: BASE, version: VERSION, fetch: fake.fetchFake, pollMs: 0 }),
  );

  assert.equal(result.length, players.length, 'every player is provisioned');
  result.forEach((provisioned, index) => {
    assert.equal(provisioned.name, players[index].name);
    assert.equal(provisioned.cookie, `__Host-d2rmm_session=${secretsOf(index).session}`);
    assert.equal(provisioned.token, secretsOf(index).token);
  });
  assert.ok(
    fake.calls.every((call) => call.hostname === '127.0.0.1'),
    'every provisioning request targets 127.0.0.1',
  );
  const polls = fake.calls.filter((call) => call.pathname === '/v1/agents/pairing-codes/claim').length;
  assert.equal(polls, players.length * 2, 'each claim is polled until 200 (one 202 first)');

  const printed = lines.join('\n');
  for (let index = 0; index < players.length; index += 1) {
    const secrets = secretsOf(index);
    for (const value of [secrets.session, secrets.token, secrets.claimSecret]) {
      assert.equal(printed.includes(value), false, 'no cookie, token or claim secret reaches the log');
    }
  }
});

test('provisions at most 20 players at a time', { timeout: SLOW_TEST_MS }, async () => {
  const players = Array.from({ length: PROVISION_CONCURRENCY + 5 }, (_, index) => playerFor(RUN_ID, index));
  const fake = fakeFetch({ players });

  const result = await provision({
    players,
    base: BASE,
    origin: BASE,
    version: VERSION,
    fetch: fake.fetchFake,
    pollMs: 0,
  });

  assert.equal(result.length, players.length);
  assert.ok(fake.peak() <= PROVISION_CONCURRENCY, `at most ${PROVISION_CONCURRENCY} requests in flight`);
  assert.ok(fake.peak() > 1, 'players are provisioned concurrently');
});

test('a non-success answer throws without the secret text', { timeout: SLOW_TEST_MS }, async () => {
  const players = [0, 1].map((index) => playerFor(RUN_ID, index));
  const fake = fakeFetch({ players, failure: { index: 0, route: '/v1/agents/pair', status: 400 } });

  await assert.rejects(
    provision({ players, base: BASE, origin: BASE, version: VERSION, fetch: fake.fetchFake, pollMs: 0 }),
    (error) => {
      assert.ok(error instanceof ProvisionError, 'the failure is a ProvisionError');
      assert.match(error.message, /pair of player 0 answered 400/u);
      for (const value of Object.values(secretsOf(0))) {
        assert.equal(error.message.includes(value), false, 'the message carries no secret');
      }
      return true;
    },
  );
});

test('a claim that stays pending gives up', { timeout: SLOW_TEST_MS }, async () => {
  const players = [playerFor(RUN_ID, 0)];
  const fake = fakeFetch({ players, claimAlwaysPending: true });

  await assert.rejects(
    provision({
      players,
      base: BASE,
      origin: BASE,
      version: VERSION,
      fetch: fake.fetchFake,
      pollMs: 0,
      maxPolls: 3,
    }),
    /stayed pending after 3 polls/u,
  );
});
