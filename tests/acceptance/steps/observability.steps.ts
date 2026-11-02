// The two trace scenarios of the acceptance feature (OBS-08, OBS-12, OBS-24): the site action and the agent's observation
// each leave one trace in the local telemetry backend. Black box: the site in the browser, the API over HTTP, the headless
// agent process and the backend's query API.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect } from '@playwright/test';
import { After, Given, Then, When } from '../fixtures.ts';
import { startTracedStack, type TracedStack } from '../support/stack.ts';
import { HeadlessAgent, prepareFixture } from '../support/headless-agent.ts';
import { startTelemetryBackend, type TelemetryBackend } from '../support/telemetry-backend.ts';
import {
  assertTraceA,
  assertTraceB,
  leaksIn,
  NAMES,
  pollTraces,
  readTrace,
  type Trace,
} from '../support/trace-reader.ts';
import { submitPairingCode, type World } from '../support/world.ts';

/** What the trace steps of one scenario share. */
interface TraceState {
  traced?: TracedStack;
  siteTraceparent?: string | undefined;
  traceA?: Trace;
  agent?: HeadlessAgent;
  fixtureDir?: string;
  startedAt?: number;
}

const states = new WeakMap<World, TraceState>();

function stateOf(world: World): TraceState {
  let state = states.get(world);
  if (state === undefined) {
    state = {};
    states.set(world, state);
  }
  return state;
}

/** The backend is started once per worker, by the first trace scenario that needs it (design § Local backend). */
let backend: Promise<TelemetryBackend> | undefined;

function telemetryBackend(): Promise<TelemetryBackend> {
  backend ??= startTelemetryBackend();
  return backend;
}

function requireBackend(): Promise<TelemetryBackend> {
  if (backend === undefined) {
    throw new Error('the telemetry backend is not running: the scenario did not start it');
  }
  return backend;
}

/** True when `check` passes on the trace; the check's message is not needed by the polling caller. */
function holds(check: (trace: Trace) => void): (trace: Trace) => boolean {
  return (trace) => {
    try {
      check(trace);
      return true;
    } catch {
      return false;
    }
  };
}

/** True when a span named `parentName` has a child named `childName` in the trace. */
function childNamed(trace: Trace, parentName: string, childName: string): boolean {
  return trace.spans.some(
    (parent) =>
      parent.name === parentName &&
      trace.spans.some((child) => child.parentSpanId === parent.spanId && child.name === childName),
  );
}

After(async ({ world }) => {
  const state = states.get(world);
  await state?.agent?.stop();
  await state?.traced?.close();
  if (state?.fixtureDir !== undefined) {
    rmSync(state.fixtureDir, { recursive: true, force: true });
  }
});

// Scenario: A test match leaves one trace through the site, the API, the database, the outbox and the stream.
Given('the telemetry backend is running locally', async ({ world }) => {
  const running = await telemetryBackend();
  const state = stateOf(world);
  // The traced stack exports to the backend, and the World's site becomes its site before any visitor opens (OBS-44).
  state.traced = await startTracedStack({ otlpEndpoint: running.otlpUrl });
  world.site = state.traced.staging;
});

When(/^"(.+)" starts a test match on the site$/, async ({ world }, name: string) => {
  const page = world.player(name).visitor?.page;
  if (page === undefined) {
    throw new Error(`"${name}" has not signed in on the site in this scenario`);
  }
  // The site's own request carries the traceparent of its action span (OBS-04); the listener keeps the match request's.
  page.on('request', (request) => {
    if (request.url().endsWith('/api/v1/staging/match-formed')) {
      stateOf(world).siteTraceparent = request.headers()['traceparent'];
    }
  });
  await world.startTestMatch(name, true);
});

Then('the API request carried a traceparent sent by the site', ({ world }) => {
  expect(stateOf(world).siteTraceparent, 'the traceparent of the match request').toMatch(
    /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/u,
  );
});

Then(
  'the telemetry backend holds, within 30 seconds, one trace that contains the site action as the root, the API request as its child, a database query as a child of the request, the outbox relay as a child of the stored context, and the stream delivery as a child of the outbox relay',
  async ({ world }) => {
    const traceparent = stateOf(world).siteTraceparent;
    expect(traceparent, 'the site traceparent').toBeDefined();
    const traceId = String(traceparent).split('-')[1] ?? '';
    const running = await requireBackend();
    const trace = await readTrace(running.queryUrl, traceId, holds(assertTraceA));
    assertTraceA(trace);
    stateOf(world).traceA = trace;
    process.stdout.write(`trace A, the site action (OBS-08): ${traceId}\n`);
  },
);

Then('no span of that trace carries a query string, a cookie, a token or a player name', ({ world }) => {
  const trace = stateOf(world).traceA;
  expect(trace, 'trace A was read').toBeDefined();
  const player = world.matchOwner;
  expect(player, 'the player of the match').toBeDefined();
  expect(leaksIn(trace?.spans ?? [], String(player)), 'leaks in the exported spans').toStrictEqual([]);
});

// Scenario: The agent's observation leaves its own trace and the room becomes Created.
Given(/^a test match is formed with "(.+)" as host$/, async ({ world }, name: string) => {
  await world.startTestMatch(name, false);
});

Given('the headless agent core is running with a fixture screen', async ({ world }) => {
  const host = world.matchOwner;
  expect(host, 'the host of the match').toBeDefined();
  const room = world.player(String(host)).room;
  expect(room, 'the room of the host').toBeDefined();
  const session = await world.sessionOf(String(host));
  const state = stateOf(world);
  state.fixtureDir = mkdtempSync(path.join(tmpdir(), 'd2rmm-headless-'));
  const fixture = prepareFixture(state.fixtureDir, String(room?.gameName));
  state.startedAt = Date.now();
  // The example pairs itself as the host's agent, the way an agent pairs: it shows a code and the host types it on the site.
  state.agent = HeadlessAgent.start({ apiBase: world.site.api, fixture: fixture.png });
  const shown = await state.agent.waitFor('code');
  const paired = await submitPairingCode(world.site, session, String(shown['code']));
  expect(paired.status, 'pairing the headless agent').toBe(200);
  await state.agent.waitFor('paired');
  await state.agent.waitFor('assignment', 45_000, (item) => item['room'] === room?.gameName);
});

When('the agent reports the game name of the room', async ({ world }) => {
  const agent = stateOf(world).agent;
  expect(agent, 'the headless agent runs in this scenario').toBeDefined();
  agent?.read();
  await agent?.waitFor('observed');
});

Then('the site shows the room as "Created" within 2 seconds', async ({ world }) => {
  await expect(
    world.currentVisitor.page.getByText('Created', { exact: true }),
    'the room as Created',
  ).toBeVisible({ timeout: 2_000 });
});

Then(
  `the telemetry backend holds, within 30 seconds, one trace whose root is the agent's observation span, with the API span of that request as its child, the outbox relay and the stream delivery of the "Created" event below it`,
  async ({ world }) => {
    const host = String(world.matchOwner);
    const roomId = String(world.player(host).room?.roomId);
    const running = await requireBackend();
    const since = stateOf(world).startedAt ?? Date.now();
    const trace = await pollTraces(
      running.queryUrl,
      `{ name = "${NAMES.agentObservation}" }`,
      since,
      (candidate) =>
        candidate.spans.some(
          (span) => span.name === NAMES.agentObservation && span.attributes['d2r.room.id'] === roomId,
        ) && holds(assertTraceB)(candidate),
    );
    assertTraceB(trace);
    process.stdout.write(`trace B, the agent observation (OBS-12): ${trace.traceId}\n`);
  },
);

Then(
  `the API span of the agent's heartbeat and the API span of the agent's stream request are each a child of the agent's own span for that request, with the same trace id`,
  async ({ world }) => {
    const state = stateOf(world);
    // The stream span ends when the stream closes, so the example stops first; its shutdown flushes its spans (OBS-19).
    await state.agent?.stop();
    const running = await requireBackend();
    const since = state.startedAt ?? Date.now();
    const heartbeat = await pollTraces(running.queryUrl, `{ name = "agent.heartbeat" }`, since, (candidate) =>
      childNamed(candidate, 'agent.heartbeat', NAMES.apiRequest),
    );
    const stream = await pollTraces(
      running.queryUrl,
      `{ name = "agent.stream.connect" }`,
      since,
      (candidate) => childNamed(candidate, 'agent.stream.connect', 'GET'),
    );
    expect(heartbeat.traceId, 'the heartbeat trace').toMatch(/^[0-9a-f]{32}$/u);
    expect(stream.traceId, 'the stream trace').toMatch(/^[0-9a-f]{32}$/u);
  },
);
