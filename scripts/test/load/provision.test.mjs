// The provisioner (design.md § Provisioner; LB-03, LB-04). A fake `fetch` answers the four routes with the real `Response`
// class, so the cookie and the claim are read as the provisioner reads them in production. No network is used.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROVISION_CONCURRENCY, ProvisionError, emptyTimings, provision } from '../../load/provision.mjs';
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

const ROUTE_OF_PATH = new Map([
  ['/v1/auth/test-login', 'test-login'],
  ['/v1/agents/pairing-codes', 'pairing-codes'],
  ['/v1/agents/pair', 'pair'],
  ['/v1/agents/pairing-codes/claim', 'claim'],
]);

/**
 * A fake `fetch` with its own clock. Each request advances the clock by its cost, read from `costs` under `<index>:<route>`
 * (one number, or a list with one number per call of that request), so the elapsed time of a request is its cost. Only
 * the requests with a cost move the clock, so a test with one costly request has exact elapsed times even when the players
 * run concurrently. `failure` replaces the answer of one request: a `status`, a `timeout` (the DOMException that
 * AbortSignal.timeout gives) or a `network` error.
 */
function timedFetch({ players, costs = {}, failure = null }) {
  const indexOf = new Map(players.map((player, index) => [player.address, index]));
  const pending = new Map(Object.entries(costs).map(([key, value]) => [key, [value].flat()]));
  const clock = { ms: 0 };
  const claimPolls = new Map();

  async function fetchTimed(url, init) {
    const route = ROUTE_OF_PATH.get(new URL(url).pathname);
    const index = indexOf.get(init.headers['X-Forwarded-For']);
    const queue = pending.get(`${index}:${route}`) ?? [];
    clock.ms += queue.length > 0 ? queue.shift() : 0;
    if (failure !== null && failure.index === index && failure.route === route) {
      if (failure.error === 'timeout') {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      }
      if (failure.error === 'network') throw new TypeError('fetch failed');
      return jsonAnswer(failure.status, { error: 'refused' });
    }
    if (route === 'test-login') {
      return jsonAnswer(
        200,
        {},
        { 'set-cookie': `__Host-d2rmm_session=${secretsOf(index).session}; Path=/; HttpOnly; Secure` },
      );
    }
    if (route === 'pairing-codes') {
      return jsonAnswer(201, { code: '123456', claimSecret: secretsOf(index).claimSecret });
    }
    if (route === 'pair') return jsonAnswer(200, {});
    const polls = (claimPolls.get(index) ?? 0) + 1;
    claimPolls.set(index, polls);
    if (polls === 1) return jsonAnswer(202, { status: 'pending' });
    return jsonAnswer(200, { token: secretsOf(index).token });
  }
  return { fetchTimed, now: () => clock.ms };
}

/** The message names no player name, no client address and no secret of the player. */
function assertNamesNothingOf(text, player, index) {
  assert.equal(text.includes(player.name), false, 'the message carries no player name');
  assert.equal(text.includes(player.address), false, 'the message carries no client address');
  for (const value of Object.values(secretsOf(index))) {
    assert.equal(text.includes(value), false, 'the message carries no secret');
  }
}

test('provisioning failures name the route and the player', { timeout: SLOW_TEST_MS }, async () => {
  const players = [0, 1, 2].map((index) => playerFor(RUN_ID, index));
  const common = { players, base: BASE, origin: BASE, version: VERSION, pollMs: 0 };

  const status = timedFetch({
    players,
    costs: { '1:pair': 40 },
    failure: { index: 1, route: 'pair', status: 400 },
  });
  const statusTimings = emptyTimings();
  await assert.rejects(
    provision({ ...common, fetch: status.fetchTimed, now: status.now, timings: statusTimings }),
    (error) => {
      assert.ok(error instanceof ProvisionError, 'the failure is a ProvisionError');
      assert.match(error.message, /pair of player 1 answered 400 \(kind status:400, 40 ms\)/u);
      assertNamesNothingOf(error.message, players[1], 1);
      return true;
    },
  );
  assert.equal(statusTimings.pair, 40, 'the failing request counts toward its route');

  const timeout = timedFetch({
    players,
    costs: { '2:pairing-codes': 10000 },
    failure: { index: 2, route: 'pairing-codes', error: 'timeout' },
  });
  const timeoutTimings = emptyTimings();
  await assert.rejects(
    provision({ ...common, fetch: timeout.fetchTimed, now: timeout.now, timings: timeoutTimings }),
    (error) => {
      assert.match(error.message, /pairing-codes of player 2 did not answer \(kind timeout, 10000 ms\)/u);
      assertNamesNothingOf(error.message, players[2], 2);
      return true;
    },
  );
  assert.equal(timeoutTimings['pairing-codes'], 10000, 'the timed-out request is the slowest of its route');

  const network = timedFetch({
    players,
    costs: { '0:claim': 5 },
    failure: { index: 0, route: 'claim', error: 'network' },
  });
  await assert.rejects(provision({ ...common, fetch: network.fetchTimed, now: network.now }), (error) => {
    assert.match(error.message, /claim of player 0 did not answer \(kind network, 5 ms\)/u);
    assertNamesNothingOf(error.message, players[0], 0);
    return true;
  });

  const single = [players[0]];
  const slowest = timedFetch({
    players: single,
    costs: { '0:test-login': 3, '0:pairing-codes': 7, '0:pair': 11, '0:claim': [5, 2] },
  });
  const timings = emptyTimings();
  const provisioned = await provision({
    players: single,
    base: BASE,
    origin: BASE,
    version: VERSION,
    fetch: slowest.fetchTimed,
    now: slowest.now,
    pollMs: 0,
    timings,
  });
  assert.equal(provisioned.length, 1);
  assert.deepEqual(
    timings,
    { 'test-login': 3, 'pairing-codes': 7, pair: 11, claim: 5 },
    'the slowest request of each route is kept, here the first claim poll',
  );
});
