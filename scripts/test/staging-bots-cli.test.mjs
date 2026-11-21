import assert from 'node:assert/strict';
import { test } from 'node:test';
import { run } from '../staging/bots.mjs';
import { createFakeApi } from './staging-fake-api.mjs';

const API = 'https://d2rmm-api.example.com';
const config = (extra = {}) => ({
  apiUrl: API,
  siteOrigin: 'https://site.example.com',
  environment: undefined,
  runId: '4242',
  inputs: { mode: 'pvp', difficulty: 'hell', ladder: 'ladder', era: 'rotw', minutes: '1', ...extra.inputs },
  ...extra.top,
});
const fastSleep = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, 1);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

async function runWith(fake, extra = {}, signal) {
  const out = [];
  let summary = '';
  const code = await run({
    config: config(extra),
    fetch: fake.fetch,
    write: (text) => out.push(text),
    sleep: fastSleep,
    random: () => 0,
    signal,
    writeSummary: (text) => {
      summary = text;
    },
  });
  return { code, out: out.join(''), summary };
}

test('SBT-05 SBT-06 SBT-07 SBT-10 one bot signs in, pairs, queues, accepts, observes, and leaves with no token valid', async () => {
  const fake = createFakeApi();
  const { code, out, summary } = await runWith(fake);
  assert.equal(code, 0);
  const paths = fake.calls.map((call) => `${call.method} ${call.path}`);
  const order = [
    'GET /healthz',
    'GET /v1/config',
    'POST /v1/auth/test-login',
    'POST /v1/agents/pairing-codes',
    'POST /v1/agents/pair',
    'POST /v1/agents/pairing-codes/claim',
    'POST /v1/me/characters',
    'POST /v1/queue/tickets',
    'POST /v1/ready-checks/rc-1/accept',
    'POST /v1/lobby-rooms/room-1/observations',
    'DELETE /v1/agents/agent-1',
    'POST /v1/auth/logout',
  ];
  let at = -1;
  for (const step of order) {
    const found = paths.indexOf(step, at + 1);
    assert.ok(found > at, `${step} comes after the step before it`);
    at = found;
  }
  // The site calls carry the origin; the agent calls carry a bearer token and no cookie.
  const login = fake.calls.find((call) => call.path === '/v1/auth/test-login');
  assert.equal(login.origin, 'https://site.example.com');
  assert.equal(login.body.name, 'bot-42-1');
  const accept = fake.calls.find((call) => call.path.endsWith('/accept'));
  assert.equal(accept.token, true);
  assert.equal(accept.cookie, false);
  const observation = fake.calls.find((call) => call.path.endsWith('/observations'));
  assert.equal(observation.body.type, 'GAME_NAME_SEEN');
  assert.equal(observation.body.value, 'mmpvph-1');
  // The agent is deleted, so its token no longer works, and nothing secret was printed.
  assert.equal(fake.state.agents.size, 0);
  assert.ok(!out.includes(fake.token));
  assert.ok(!out.includes('secretsession'));
  assert.ok(!summary.includes(fake.token));
  assert.match(summary, /bot-42-1/);
});

test('SBT-02 a production-shaped API is refused and nothing but /healthz and /v1/config is requested', async () => {
  const fake = createFakeApi({ stagingEndpoints: false });
  const { code, out } = await runWith(fake);
  assert.equal(code, 2);
  assert.match(out, /run.refused/);
  assert.deepEqual(
    fake.calls.map((call) => call.path),
    ['/healthz', '/v1/config'],
  );
});

test('SBT-02 a URL that is not an https origin is refused with no request at all', async () => {
  const fake = createFakeApi();
  const { code } = await runWith(fake, { top: { apiUrl: 'http://other.example.com' } });
  assert.equal(code, 2);
  assert.equal(fake.calls.length, 0);
});

test('SBT-01 an invalid input fails after the target check and before any write', async () => {
  const fake = createFakeApi();
  const { code } = await runWith(fake, { inputs: { bots: '5' } });
  assert.equal(code, 2);
  assert.ok(fake.calls.every((call) => call.method === 'GET'));
});

test('SBT-06 with human first, the sentinel queues alone, and the others join only when a non-bot waits', async () => {
  const fake = createFakeApi({ pool: 1, roomScript: false });
  const stop = new AbortController();
  const finished = runWith(fake, { inputs: { mode: 'leveling', activity: 'baal', bots: '3' } }, stop.signal);
  const joins = () =>
    fake.calls.filter((call) => call.path === '/v1/queue/tickets' && call.method === 'POST').length;
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(joins(), 1, 'only the sentinel has joined while nobody else waits');
  assert.ok(
    fake.calls.some((call) => call.path === '/v1/queue/tickets/me'),
    'it reads the pool',
  );
  fake.setPool(2);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(joins(), 3, 'the other bots join once another player waits');
  stop.abort();
  const { code } = await finished;
  assert.equal(code, 0);
  assert.equal(fake.state.agents.size, 0, 'every bot left');
});

const observationsOf = (fake) => fake.calls.filter((call) => call.path.endsWith('/observations'));

test('SBT-07 a member posts its sighting once the game is created, even when the site stream delivered the stages before the assignment', async () => {
  const fake = createFakeApi({ host: false, agentDelayMs: 50 });
  const { code } = await runWith(fake);
  assert.equal(code, 0);
  assert.equal(observationsOf(fake).length, 1, 'the stages that came first were kept, not lost');
});

test('SBT-07 a host posts its sighting only once the room awaits it, never before', async () => {
  const fake = createFakeApi({ host: true, siteStages: ['formed'], closeRoom: false });
  const stop = new AbortController();
  const finished = runWith(fake, {}, stop.signal);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.ok(
    fake.calls.some(
      (call) => call.path === '/v1/lobby-rooms/room-1/leave' || call.path === '/v1/agents/heartbeat',
    ),
  );
  assert.equal(observationsOf(fake).length, 0, 'the room is only formed: nothing is posted yet');
  fake.pushSite('room.stage_changed', { roomId: 'room-1', stage: 'awaiting_host', members: [] });
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(observationsOf(fake).length, 1, 'the sighting follows awaiting_host');
  stop.abort();
  await finished;
});

test('SBT-06 a bot joins only once its agent is online and its site stream is open, however slow they are', async () => {
  const fake = createFakeApi({ strictJoin: true, streamDelayMs: 80 });
  const { code } = await runWith(fake, {}, AbortSignal.timeout(10_000));
  assert.equal(code, 0, 'the join was not refused as agent-offline or site-not-open');
  const order = fake.calls.map((call) => `${call.method} ${call.path}`);
  assert.ok(order.indexOf('POST /v1/agents/heartbeat') < order.indexOf('POST /v1/queue/tickets'));
  assert.equal(fake.calls.filter((call) => call.path === '/v1/stream').length >= 2, true);
});

test('SBT-07 a bot that opens its agent stream late still accepts the ready check it finds open', async () => {
  const fake = createFakeApi({ roomScript: false, readyCheckOpen: true });
  const { code } = await runWith(fake, {}, AbortSignal.timeout(400));
  assert.equal(code, 0);
  assert.ok(
    fake.calls.some((call) => call.path === '/v1/ready-checks/me'),
    'it reads its open ready check on connect',
  );
  assert.ok(
    fake.calls.some((call) => call.path === '/v1/ready-checks/rc-1/accept'),
    'and accepts it',
  );
});

test('SBT-07 a host whose assignment event listed no host still posts, because the roles are read again at awaiting_host', async () => {
  const fake = createFakeApi({
    host: true,
    staleRoles: true,
    siteStages: ['formed', 'awaiting_host'],
    agentDelayMs: 60,
  });
  const { code } = await runWith(fake);
  assert.equal(code, 0);
  assert.equal(observationsOf(fake).length, 1, 'the host posted although the event named nobody host');
});
