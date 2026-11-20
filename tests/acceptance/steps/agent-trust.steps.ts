// Steps of agent-trust (AGT-01, AGT-02, AGT-04, AGT-05, AGT-06): what an agent token opens, what a revoked one opens, what
// the agent accepts from the stream, what it sends, and when it looks at the game. Black box: the API answers the simulated
// agents, and the headless agent (the real core) reads the fixture screens and talks to the API through a recording proxy.
import { ClaimRequest, Heartbeat, Observation, RecordCharactersRequest } from '@d2rmm/contracts';
import { expect } from '@playwright/test';
import { After, Before, Given, Then, When } from '../fixtures.ts';
import { awaitRequest } from '../support/agent-proxy.ts';
import { closeWires, enableWire, wireOf } from '../support/agent-wire.ts';
import { SESSION_COOKIE, type World } from '../support/world.ts';
import { agentOf, reportedScreen, showFixture, startHeadless } from './characters-reading.steps.ts';
import { headlessOf } from './lobby-rooms.steps.ts';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const NIL_ID = '00000000-0000-4000-8000-000000000000';

// --- AGT-01: the agent token opens only the agent's routes ----------------------------------------------------------

/** What a player does on the site, as the scenarios name it, and the request of it (the API refuses the token first). */
const SITE_ACTIONS: Readonly<Record<string, { method: Method; path: string; body?: unknown }>> = {
  'read the account': { method: 'GET', path: '/v1/me' },
  'sign out': { method: 'POST', path: '/v1/auth/logout', body: {} },
  'revoke the agent': { method: 'DELETE', path: `/v1/agents/${NIL_ID}`, body: {} },
  'close a room': { method: 'POST', path: `/v1/lobby-rooms/${NIL_ID}/close`, body: {} },
  'queue for a match': {
    method: 'POST',
    path: '/v1/queue/tickets',
    body: {
      mode: 'pvp',
      characterId: NIL_ID,
      difficulty: 'hell',
      region: 'americas',
      format: 'duel',
      rules: 'gm',
    },
  },
  "set the account's characters": {
    method: 'PATCH',
    path: `/v1/me/characters/${NIL_ID}`,
    body: { ladder: 'non-ladder', era: 'rotw' },
  },
};

When(/^the agent asks to (.+) with its token$/, async ({ world }, action: string) => {
  const request = SITE_ACTIONS[action];
  if (request === undefined) throw new Error(`no site action is named "${action}"`);
  const answer = await world.lastAgent.send(request.path, {
    method: request.method,
    ...(request.body === undefined ? {} : { body: request.body }),
    headers: { Origin: world.site.site },
  });
  world.last = { status: answer.status, body: answer.body };
});

/** The agent's own routes that answer a request without a stream: the stream stays open when accepted, so it is left out. */
const AGENT_ONLY_ROUTES: readonly { method: Method; path: string; body?: unknown }[] = [
  { method: 'POST', path: '/v1/agents/heartbeat', body: heartbeatBody() },
  { method: 'GET', path: '/v1/agents/me/assignment' },
  { method: 'POST', path: `/v1/lobby-rooms/${NIL_ID}/observations`, body: observationBody() },
  { method: 'POST', path: '/v1/me/characters', body: charactersBody() },
];

function heartbeatBody() {
  return Heartbeat.parse({
    agentVersion: '1.0.0',
    pcState: 'IN_QUEUE',
    game: { running: true, window: 'Diablo II', screen: 'UNKNOWN' },
    capture: { method: 'pixels', readRate: 0.9 },
  });
}

function observationBody() {
  return Observation.parse({
    idempotencyKey: 'agt-probe',
    type: 'GAME_NAME_SEEN',
    run: 1,
    value: 'probe',
    confidence: 0.9,
    capturedAt: '2026-10-31T12:00:00.000Z',
  });
}

function charactersBody() {
  return RecordCharactersRequest.parse({
    characters: [
      {
        name: 'Sorc',
        class: 'sorceress',
        level: 85,
        hardcore: false,
        unlockedDifficulties: ['normal', 'nightmare', 'hell'],
      },
    ],
  });
}

/** The statuses of the agent routes, one line each, for a request carrying `credential`. */
async function agentRouteStatuses(
  world: World,
  send: (route: (typeof AGENT_ONLY_ROUTES)[number]) => Promise<{ status: number }>,
): Promise<string[]> {
  const lines: string[] = [];
  for (const route of AGENT_ONLY_ROUTES) {
    const answer = await send(route);
    lines.push(`${route.method} ${route.path} ${answer.status}`);
  }
  world.last = { status: lines.every((line) => line.endsWith(' 401')) ? 401 : 0, body: lines };
  return lines;
}

When('the site calls each agent route with the session cookie', async ({ world }) => {
  const owner = world.lastOwner;
  if (owner === undefined) throw new Error('no agent is paired in this scenario');
  const cookie = `${SESSION_COOKIE}=${await world.sessionOf(owner)}`;
  await agentRouteStatuses(world, (route) =>
    world.lastAgent.send(route.path, {
      method: route.method,
      ...(route.body === undefined ? {} : { body: route.body }),
      bearer: null,
      headers: { Cookie: cookie },
    }),
  );
});

Then('the API answers {string} on every one', ({ world }, code: string) => {
  const lines = world.last?.body;
  expect(Array.isArray(lines), 'the statuses of the agent routes').toBe(true);
  expect(
    (lines as string[]).filter((line) => !line.endsWith(` ${code}`)),
    'agent routes that did not answer the status',
  ).toEqual([]);
});

// --- AGT-02: a revoked or replaced token opens nothing --------------------------------------------------------------

When(/^"(.+)" revokes the agent$/, async ({ world }, name: string) => {
  // The agent's stream is open before the revoke, so the scenario can see it end.
  await world.agentStreamOf(world.currentAgentOf(name));
  const cookie = `${SESSION_COOKIE}=${await world.sessionOf(name)}`;
  const mine = await fetch(`${world.site.api}/v1/agents/me`, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(10_000),
  });
  const agentId = ((await mine.json()) as { agentId?: string }).agentId;
  expect(agentId, 'the id of the paired agent').toBeDefined();
  const revoked = await fetch(`${world.site.api}/v1/agents/${agentId}`, {
    method: 'DELETE',
    headers: { Cookie: cookie, Origin: world.site.site, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(10_000),
  });
  expect(revoked.status, 'the revoke').toBe(204);
});

async function everyAgentRouteRefuses(world: World, agentIndex: number): Promise<void> {
  const agent = world.paired[agentIndex];
  if (agent === undefined) throw new Error(`agent ${agentIndex + 1} was not paired in this scenario`);
  const lines = await agentRouteStatuses(world, (route) =>
    agent.send(route.path, {
      method: route.method,
      ...(route.body === undefined ? {} : { body: route.body }),
    }),
  );
  expect(
    lines.filter((line) => !line.endsWith(' 401')),
    'routes that still answered the token',
  ).toEqual([]);
}

Then('the revoked agent is answered {string} on every agent route', async ({ world }, code: string) => {
  expect(code, 'the status the scenario expects').toBe('401');
  await everyAgentRouteRefuses(world, 0);
});

Then('the first agent is answered {string} on every agent route', async ({ world }, code: string) => {
  expect(code, 'the status the scenario expects').toBe('401');
  await everyAgentRouteRefuses(world, 0);
});

// --- AGT-04, AGT-05: the wire of the headless agents ----------------------------------------------------------------

Before({ tags: '@AGT-04 or @AGT-05' }, ({ world }) => {
  enableWire(world);
});

After({ tags: '@AGT-04 or @AGT-05' }, async ({ world }) => {
  await closeWires(world);
});

/** The paths a data-only agent may ask for while it holds a room and waits (its own routes, none of them an action). */
const WAITING_PATHS = new Set([
  '/v1/agents/heartbeat',
  '/v1/agents/me/assignment',
  '/v1/stream',
  '/v1/ready-checks/me',
  '/v1/telemetry/traces',
]);

interface Injection {
  readonly before: number;
  readonly requestsBefore: number;
}
const injections = new WeakMap<World, Injection>();

When(
  "the API sends Bob's agent an event of an unknown type and a known event with an extra field",
  async ({ world }) => {
    const wire = wireOf(world, 'Bob');
    const agent = headlessOf(world, 'Bob').agent;
    injections.set(world, {
      before: agent.events.length,
      requestsBefore: wire.requests().length,
    });
    const otherRoom = '9b1d4e2a-0000-4000-8000-0000000000aa';
    const delivered =
      wire.injectIntoStream(
        `event: command\ndata: ${JSON.stringify({ command: 'calc.exe', url: 'https://example.invalid' })}\n\n`,
      ) +
      wire.injectIntoStream(
        `event: room.stage_changed\ndata: ${JSON.stringify({ roomId: otherRoom, stage: 'closed', command: 'calc.exe' })}\n\n`,
      );
    expect(delivered, 'the streams that got the events').toBeGreaterThan(0);
    // The agent reads a stream event as it arrives; a second is many reads.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  },
);

Then("Bob's agent holds the same room as before", ({ world }) => {
  const injected = injections.get(world);
  if (injected === undefined) throw new Error('no event was sent in this scenario');
  const all = headlessOf(world, 'Bob').agent.events;
  const held = all
    .slice(0, injected.before)
    .filter((event) => event.event === 'assignment')
    .at(-1)?.['room'];
  expect(held, 'the room Bob held before the events').toBeDefined();
  // The window prints an `assignment` line whenever its room line changes (a reveal hint, say), so the room is read by name.
  const after = all
    .slice(injected.before)
    .filter((event) => ['assignment', 'room-dropped'].includes(event.event));
  expect(
    after.filter((event) => event.event === 'room-dropped' || event['room'] !== held),
    "the room events of Bob's agent that name another room or drop it",
  ).toEqual([]);
});

Then("Bob's agent performed no action", ({ world }) => {
  const injected = injections.get(world);
  if (injected === undefined) throw new Error('no event was sent in this scenario');
  const asked = wireOf(world, 'Bob')
    .requests()
    .slice(injected.requestsBefore)
    .map((record) => record.path);
  expect(
    asked.filter((path) => !WAITING_PATHS.has(path)),
    "the requests Bob's agent made that are not its own waiting routes",
  ).toEqual([]);
});

// AGT-05: every request of the host's agent holds the keys of its contract and no image. The Given and the When are the
// room lifecycle's (the host's agent sees the name of the run); the wire is the recording proxy in front of the API.

/** The JSON keys each agent request may carry, from the contracts: nothing else leaves the PC (NFR-04). */
const KEYS_OF: Readonly<Record<string, readonly string[]>> = {
  '/v1/agents/heartbeat': Object.keys(Heartbeat.shape),
  '/v1/agents/pairing-codes/claim': Object.keys(ClaimRequest.shape),
  '/v1/me/characters': Object.keys(RecordCharactersRequest.shape),
};
const OBSERVATION_KEYS = Object.keys(Observation.shape);
const OBSERVATION_PATH = /^\/v1\/lobby-rooms\/[^/]+\/observations$/;
/** Media types an agent request may carry: JSON bodies and the span exporter's protobuf. Never an image or raw bytes. */
const ALLOWED_TYPES = new Set(['application/json', 'application/x-protobuf']);

Then("every request Alice's agent sent holds only the keys of its contract", async ({ world }) => {
  const wire = wireOf(world, 'Alice');
  await awaitRequest(wire, 'the observation of the run', (record) => OBSERVATION_PATH.test(record.path));
  // The body of the last request is read once it ends; a moment lets it finish.
  await new Promise((resolve) => setTimeout(resolve, 500));
  const stray: string[] = [];
  let checked = 0;
  for (const record of wire.requests()) {
    if (record.bodyKeys === undefined) continue;
    const allowed = OBSERVATION_PATH.test(record.path) ? OBSERVATION_KEYS : KEYS_OF[record.path];
    checked += 1;
    if (allowed === undefined) {
      stray.push(`${record.method} ${record.path} sent a JSON body but is no route with one`);
      continue;
    }
    const extra = record.bodyKeys.filter((key) => !allowed.includes(key));
    if (extra.length > 0) stray.push(`${record.method} ${record.path} sent ${extra.join(', ')}`);
  }
  expect(checked, 'the JSON bodies the agent sent').toBeGreaterThan(0);
  expect(stray, "keys outside the contracts in Alice's requests").toEqual([]);
});

Then('none of them holds image data', ({ world }) => {
  const types = wireOf(world, 'Alice')
    .requests()
    .flatMap((record) => (record.contentType === undefined ? [] : [`${record.path}: ${record.contentType}`]))
    .filter((entry) => !ALLOWED_TYPES.has(entry.split(': ')[1] ?? ''));
  expect(types, 'request bodies of a type that could carry an image or raw bytes').toEqual([]);
});

// --- AGT-06: no capture without the player's consent ----------------------------------------------------------------
// The agent that is not given a frame reports the screen "Unknown": a readable fixture is shown and the site's screen is the
// proof of what the agent captured (CHR-20).

Given(
  /^(\w+)'s agent is online with the game running and (no consent|consent) given$/,
  async ({ world }, name: string, consent: string) => {
    await startHeadless(world, name, consent === 'consent');
    showFixture(world, 'select-titles');
    if (consent === 'consent') {
      await expect
        .poll(() => reportedScreen(world, name), { timeout: 15_000, message: 'the screen with consent' })
        .toBe('CHARACTER_SELECT');
    }
  },
);

When('a second passes', async () => {
  // Two reads of the agent: a frame it was going to capture would have been captured by now.
  await new Promise((resolve) => setTimeout(resolve, 3_000));
});

When(/^Alice withdraws consent$/, ({ world }) => {
  agentOf(world).consent(false);
});

Then(/^(\w+)'s agent has not captured a frame$/, async ({ world }, name: string) => {
  expect(await reportedScreen(world, name), 'the screen of an agent with no consent').toBe('UNKNOWN');
});

Then(/^(\w+)'s agent captures no frame after the next second$/, async ({ world }, name: string) => {
  await expect
    .poll(() => reportedScreen(world, name), { timeout: 5_000, message: 'the screen after the withdrawal' })
    .toBe('UNKNOWN');
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  expect(await reportedScreen(world, name), 'the screen two seconds later').toBe('UNKNOWN');
});
