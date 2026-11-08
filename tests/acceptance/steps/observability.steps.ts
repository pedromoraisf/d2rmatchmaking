// The two trace scenarios of the acceptance feature (OBS-08, OBS-12, OBS-24): the site action and the agent's observation
// each leave one trace in the local telemetry backend. Black box: the site in the browser, the API over HTTP, the headless
// agent process and the backend's query API.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect } from '@playwright/test';
import { After, Given, Then, When, test } from '../fixtures.ts';
import { startTracedStack } from '../support/stack.ts';
import {
  awaitRequest,
  startRecordingProxy,
  traceIdOf,
  type AgentRequestRecord,
  type RecordingProxy,
} from '../support/agent-proxy.ts';
import { HeadlessAgent, prepareFixture } from '../support/headless-agent.ts';
import {
  existingStateOf,
  HEADLESS_START_TIMEOUT_MS,
  stateOf,
  TRACED_START_TIMEOUT_MS,
  type TelemetryState,
} from '../support/scenario-state.ts';
import { startTelemetryBackend, type TelemetryBackend } from '../support/telemetry-backend.ts';
import {
  assertTraceA,
  assertTraceB,
  describeError,
  leaksIn,
  linkedTraceIds,
  NAMES,
  readLogRecords,
  readTrace,
  type Trace,
} from '../support/trace-reader.ts';
import { submitPairingCode } from '../support/world.ts';

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

function requireProxy(state: TelemetryState): RecordingProxy {
  if (state.agentProxy === undefined) {
    throw new Error('the agent proxy is not running: the headless agent was not started in this scenario');
  }
  return state.agentProxy;
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

/** True when the trace holds a chain of spans named `names`, each the child of the one before it. */
function chainNamed(trace: Trace, names: readonly string[]): boolean {
  const [first, ...rest] = names;
  const descend = (parentId: string, remaining: readonly string[]): boolean => {
    const [next, ...others] = remaining;
    if (next === undefined) return true;
    return trace.spans.some(
      (child) => child.parentSpanId === parentId && child.name === next && descend(child.spanId, others),
    );
  };
  return trace.spans.some((span) => span.name === first && descend(span.spanId, rest));
}

/** The agent's requests the proxy recorded, as `POST /v1/...` with the trace id each one carried. */
function requestsOf(records: readonly AgentRequestRecord[]): string {
  if (records.length === 0) return 'none';
  return records
    .map((record) => {
      const trace = /^00-([0-9a-f]{32})-/u.exec(record.traceparent ?? '')?.[1] ?? 'no traceparent';
      return `${record.method} ${record.path} (trace ${trace})`;
    })
    .join('\n  ');
}

/**
 * What a failing trace B read can say: the agent's last events and stderr, the requests it sent, and the API's relay lines
 * from its logs. The forwarder logs one line per failed or dropped forward (`relay-forward-failed`, `relay-forward-dropped`)
 * and no body. The log read is best effort: its failure is printed next to the trace error, not in place of it.
 */
async function traceBDiagnostics(state: TelemetryState, grafanaUrl: string): Promise<string> {
  const events = (state.agent?.events ?? []).slice(-20).map((item) => JSON.stringify(item));
  const relay = await readLogRecords(grafanaUrl).then(
    (records) => {
      const lines = records.map((record) => record.line).filter((line) => line.includes('relay-'));
      return lines.length === 0 ? 'none' : lines.slice(0, 20).join('\n  ');
    },
    (error: unknown) => `unreadable (${describeError(error)})`,
  );
  return [
    'headless agent events (last 20):',
    `  ${events.length === 0 ? 'none' : events.join('\n  ')}`,
    'headless agent stderr (last 20 lines):',
    state.agent?.stderrTail(20) ?? 'no agent was started',
    'requests the agent sent through the proxy:',
    `  ${requestsOf(state.agentProxy?.requests() ?? [])}`,
    'API relay log lines (up to 20 from Loki):',
    `  ${relay}`,
  ].join('\n');
}

// Closes what the telemetry steps of the scenario started: the headless agent, the wall-clock follower, the traced stack and
// the fake backend.
After({ tags: '@NFR-09' }, async ({ world }) => {
  const state = existingStateOf(world);
  await state?.agent?.stop();
  await state?.agentProxy?.close();
  state?.stopClock?.();
  await state?.traced?.close();
  await state?.fake?.stop();
  if (state?.fixtureDir !== undefined) {
    rmSync(state.fixtureDir, { recursive: true, force: true });
  }
});

// Scenario: A test match leaves one trace through the site, the API, the database, the outbox and the stream.
Given('the telemetry backend is running locally', async ({ world }) => {
  test.setTimeout(TRACED_START_TIMEOUT_MS);
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
  test.setTimeout(HEADLESS_START_TIMEOUT_MS);
  const host = world.matchOwner;
  expect(host, 'the host of the match').toBeDefined();
  const room = world.player(String(host)).room;
  expect(room, 'the room of the host').toBeDefined();
  const session = await world.sessionOf(String(host));
  const state = stateOf(world);
  state.fixtureDir = mkdtempSync(path.join(tmpdir(), 'd2rmm-headless-'));
  const fixture = prepareFixture(state.fixtureDir, String(room?.gameName));
  // The API's clock is anchored at its start and does not move on its own, but the agent checks a code's expiry against
  // the wall clock. The build runs first, so the code is issued seconds after the start, and the API clock is moved to
  // the wall clock right before it: the code's five minutes then hold for the agent as well.
  await HeadlessAgent.build();
  const traced = state.traced;
  expect(traced, 'the traced stack runs in this scenario').toBeDefined();
  await traced?.advanceClock(Math.max(0, Date.now() - (traced?.apiClockMs() ?? 0)));
  // From here the API's clock follows the wall clock, so its relay windows and lookup bucket refill while the agent runs.
  if (traced !== undefined) state.stopClock = traced.followWallClock();
  state.startedAt = Date.now();
  // The agent talks to the API through a recording proxy: it keeps the trace id of each request, so the trace is read by
  // its id, as trace A is, and not through the backend's search, whose index lags the ingest.
  state.agentProxy = await startRecordingProxy(world.site.api);
  // The example pairs itself as the host's agent, the way an agent pairs: it shows a code and the host types it on the site.
  state.agent = HeadlessAgent.start({ apiBase: state.agentProxy.url, fixture: fixture.png });
  const shown = await state.agent.waitFor('code', HEADLESS_START_TIMEOUT_MS);
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
    // The agent's observation request carries the traceparent of its HTTP span, which is a child of the observation root:
    // its trace id is the trace to read. The trace is read by id, as trace A is (a search would wait for the index).
    const state = stateOf(world);
    const running = await requireBackend();
    const proxy = requireProxy(state);
    const trace = await awaitRequest(
      proxy,
      'observation',
      (record) => record.method === 'POST' && /^\/v1\/lobby-rooms\/[^/]+\/observations$/u.test(record.path),
    )
      .then((request) => readTrace(running.queryUrl, traceIdOf(request.traceparent), holds(assertTraceB)))
      .catch(async (error: unknown) => {
        throw new Error(`${describeError(error)}\n${await traceBDiagnostics(state, running.grafanaUrl)}`);
      });
    assertTraceB(trace);
    process.stdout.write(`trace B, the agent observation (OBS-12): ${trace.traceId}\n`);
  },
);

Then(
  `the API span of the agent's heartbeat and the API span of the agent's stream request are each a child of the agent's own span for that request, with the same trace id`,
  async ({ world }) => {
    // The agent roots each heartbeat in its own trace, and its HTTP span of a call (`agent.http.*`) ends when the response
    // headers arrive, so each chain is read in the trace its request carried. The long-lived `agent.stream.connect` span
    // is not required: the API span is the child of `agent.http.stream`.
    const state = stateOf(world);
    const running = await requireBackend();
    const proxy = requireProxy(state);
    const heartbeat = await awaitRequest(
      proxy,
      'heartbeat',
      (record) => record.method === 'POST' && record.path === '/v1/agents/heartbeat',
    );
    const heartbeatTrace = await readTrace(running.queryUrl, traceIdOf(heartbeat.traceparent), (candidate) =>
      chainNamed(candidate, ['agent.heartbeat', 'agent.http.heartbeat', NAMES.apiRequest]),
    ).catch(async (error: unknown) => {
      throw new Error(`${describeError(error)}\n${await traceBDiagnostics(state, running.grafanaUrl)}`);
    });
    // The agent's span of the stream request ends when the headers arrive, and the agent exports at its ticks: the trace is
    // read for that span while the agent still runs. The API ends its span of the stream only when the stream closes, and
    // exports it then, so the agent is stopped next and the chain is read after that.
    const stream = await awaitRequest(
      proxy,
      'stream request',
      (record) => record.method === 'GET' && record.path === '/v1/stream',
    );
    const streamId = traceIdOf(stream.traceparent);
    const withAgentSpan = (candidate: Trace): boolean =>
      candidate.spans.some((span) => span.name === 'agent.http.stream');
    await readTrace(running.queryUrl, streamId, withAgentSpan).catch(async (error: unknown) => {
      throw new Error(`${describeError(error)}\n${await traceBDiagnostics(state, running.grafanaUrl)}`);
    });
    await state.agent?.stop();
    const streamTrace = await readTrace(running.queryUrl, streamId, (candidate) =>
      chainNamed(candidate, ['agent.http.stream', 'GET']),
    ).catch(async (error: unknown) => {
      throw new Error(`${describeError(error)}\n${await traceBDiagnostics(state, running.grafanaUrl)}`);
    });
    expect(heartbeatTrace.traceId, 'the heartbeat trace').toMatch(/^[0-9a-f]{32}$/u);
    expect(streamTrace.traceId, 'the stream trace').toMatch(/^[0-9a-f]{32}$/u);
  },
);

// Scenario: The agent's observation links to the trace of the test match (RTL-09). The observation span of the API carries
// one link, to the trace of the match that opened the room (RTL-03).
const RECORD_OBSERVATION = 'lobby.record-observation';

/** True when the trace has the agent's observation as its root, with the API request of that observation below it. */
function observationRooted(trace: Trace): boolean {
  return (
    trace.spans.some((span) => span.name === NAMES.agentObservation && span.parentSpanId === '') &&
    chainNamed(trace, [NAMES.agentObservation, NAMES.agentHttpObservation, NAMES.apiRequest])
  );
}

/** True when the trace has the site's test match action as its root. */
function siteActionRooted(trace: Trace): boolean {
  return trace.spans.some((span) => span.name === NAMES.siteAction && span.parentSpanId === '');
}

/** The agent's observation request the proxy recorded last: the trace it carried is the agent's trace B. */
function observationRequest(proxy: RecordingProxy): Promise<AgentRequestRecord> {
  return awaitRequest(
    proxy,
    'observation',
    (record) => record.method === 'POST' && /^\/v1\/lobby-rooms\/[^/]+\/observations$/u.test(record.path),
  );
}

Then(
  `the telemetry backend holds, within 30 seconds, the trace whose root is the agent's observation span`,
  async ({ world }) => {
    const state = stateOf(world);
    const running = await requireBackend();
    const request = await observationRequest(requireProxy(state));
    await readTrace(running.queryUrl, traceIdOf(request.traceparent), observationRooted).catch(
      async (error: unknown) => {
        throw new Error(`${describeError(error)}\n${await traceBDiagnostics(state, running.grafanaUrl)}`);
      },
    );
    process.stdout.write(`trace B, the agent observation (RTL-09): ${traceIdOf(request.traceparent)}\n`);
  },
);

Then(
  `its "lobby.record-observation" span links to the trace whose root is the site's test match action`,
  async ({ world }) => {
    const state = stateOf(world);
    const running = await requireBackend();
    // The site action's trace is read from the backend by the id its request carried: the link must name that id.
    const siteTrace = await readTrace(
      running.queryUrl,
      traceIdOf(state.siteTraceparent),
      siteActionRooted,
    ).catch(async (error: unknown) => {
      throw new Error(`${describeError(error)}\n${await traceBDiagnostics(state, running.grafanaUrl)}`);
    });
    const request = await observationRequest(requireProxy(state));
    const traceB = await readTrace(running.queryUrl, traceIdOf(request.traceparent), (trace) =>
      linkedTraceIds(trace, RECORD_OBSERVATION).includes(siteTrace.traceId),
    ).catch(async (error: unknown) => {
      throw new Error(`${describeError(error)}\n${await traceBDiagnostics(state, running.grafanaUrl)}`);
    });
    expect(
      linkedTraceIds(traceB, RECORD_OBSERVATION),
      'the trace ids the observation span links to',
    ).toContain(siteTrace.traceId);
  },
);
