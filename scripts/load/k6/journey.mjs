// The k6 journey of one step (design.md § k6 journey; LB-03, LB-04, LB-05, LB-06, LB-14, LB-21). Plain k6 JavaScript,
// run by the k6 container of the step: the orchestrator copies it into the work directory's in/ next to plan.json and
// journey-state.mjs, and the container mounts in/ read-only at /work/in.
//
// Roles per player: a `site` VU holds the site stream (an explicit Cookie header) and starts the player's test match on
// open and every matchEverySeconds; on `room.assigned` it posts the observation with the player's agent token, and the
// `created` frame of the room closes the iteration (journey-state.mjs). An `agent` VU holds the agent stream and counts
// its `room.assigned` frames. A `heartbeat` scenario (a constant arrival rate of players / 15 per second) posts each
// player's heartbeat in turn. A `control` VU opens and closes the meters' windows at the plan's offsets, on k6's clock.
//
// Every number is tallied with a `window` tag from k6's own clock (`measure` inside the measuring window, `other`
// outside it). handleSummary writes the window totals to /work/out/step.json. The per-iteration latency samples cannot
// reach handleSummary (each VU keeps its own values), so each one inside the window is printed as a console line
// `LB_SAMPLE <ms>`; the orchestrator reads those lines from the container's output. Only the warn and error channels
// are used, no trace header is sent, and nothing about a header, a cookie or a token is printed.

/* global open */
import http from 'k6/http';
import sse from 'k6/x/sse';
import exec from 'k6/execution';
import { sleep } from 'k6';
import { Counter } from 'k6/metrics';
import {
  isError,
  onAssigned,
  onCreated,
  onObservationSent,
  onStatus,
  onTick,
  start,
  TIMEOUT_MS,
} from './journey-state.mjs';

const PLAN = JSON.parse(open('/work/in/plan.json'));
const BASE = PLAN.base;
const ORIGIN = PLAN.origin;
const VERSION = PLAN.version;
const PLAYERS = PLAN.players;
const COUNT = PLAYERS.length;
const OFFSETS = PLAN.offsets;
const RAMP_MS = OFFSETS.rampSeconds * 1000;
const WINDOW_START_MS = OFFSETS.windowStartSeconds * 1000;
const WINDOW_END_MS = OFFSETS.windowEndSeconds * 1000;
const END_MS = (OFFSETS.rampSeconds + OFFSETS.holdSeconds) * 1000;
const END_SECONDS = Math.ceil(END_MS / 1000);
const MAX_SCENARIO_SECONDS = END_SECONDS + 60;
const MATCH_EVERY_MS = PLAN.matchEverySeconds * 1000;
const HEARTBEAT_RATE = Math.max(1, Math.ceil(COUNT / 15));
const STREAM_SLACK_MS = 1000;
const GAME_WINDOW = 'Diablo II: Resurrected';

const requests = new Counter('journey_requests');
const errors = new Counter('journey_errors');
const iterations = new Counter('journey_iterations');
const agentAssigned = new Counter('journey_agent_assigned');
const meterBytes = new Counter('journey_meter_bytes');
const sinkBytes = new Counter('journey_sink_bytes');
const windowSeconds = new Counter('journey_window_seconds');

const MEASURED = ['journey_requests', 'journey_errors', 'journey_iterations', 'journey_agent_assigned'];
const TOTALS = ['journey_meter_bytes', 'journey_sink_bytes', 'journey_window_seconds'];

// Every tallied metric has a threshold that is always true: k6 reports a sub-metric (a tag value) in the summary only
// when a threshold names it, and handleSummary reads the window totals from there.
const thresholds = {};
for (const name of MEASURED) thresholds[name + '{window:measure}'] = ['count>=0'];
for (const name of TOTALS) thresholds[name] = ['count>=0'];

export const options = {
  scenarios: {
    site: {
      executor: 'per-vu-iterations',
      vus: COUNT,
      iterations: 1,
      maxDuration: MAX_SCENARIO_SECONDS + 's',
      exec: 'site',
    },
    agent: {
      executor: 'per-vu-iterations',
      vus: COUNT,
      iterations: 1,
      maxDuration: MAX_SCENARIO_SECONDS + 's',
      exec: 'agent',
    },
    heartbeat: {
      executor: 'constant-arrival-rate',
      rate: HEARTBEAT_RATE,
      timeUnit: '1s',
      duration: END_SECONDS + 's',
      preAllocatedVUs: HEARTBEAT_RATE * 2,
      maxVUs: HEARTBEAT_RATE * 4 + 2,
      exec: 'heartbeat',
    },
    control: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: MAX_SCENARIO_SECONDS + 's',
      exec: 'control',
    },
  },
  thresholds,
};

function nowMs() {
  return exec.instance.currentTestRunDuration;
}

function windowOf(ms) {
  return ms >= WINDOW_START_MS && ms < WINDOW_END_MS ? 'measure' : 'other';
}

function tally(counter, ms) {
  counter.add(1, { window: windowOf(ms) });
}

function waitUntil(ms) {
  const left = ms - nowMs();
  if (left > 0) sleep(left / 1000);
}

function finished(state) {
  return state.phase === 'created' || state.phase === 'timed-out';
}

/** Counts the errors a transition added, and the iteration when it finishes. Returns the next state. */
function settle(previous, next, ms) {
  for (let count = previous.errors; count < next.errors; count += 1) tally(errors, ms);
  if (!finished(previous) && finished(next)) tally(iterations, ms);
  return next;
}

function agentHeaders(player) {
  return {
    Authorization: 'Bearer ' + player.token,
    'X-Agent-Version': VERSION,
    'X-Forwarded-For': player.address,
    'Content-Type': 'application/json',
  };
}

function heartbeatBody() {
  return {
    agentVersion: VERSION,
    pcState: 'IDLE',
    game: { running: true, window: GAME_WINDOW, screen: 'UNKNOWN' },
    capture: { method: 'acceptance', readRate: 1 },
  };
}

/** One site stream for one player: matches on open and every matchEverySeconds, observations and latency. */
export function site() {
  const index = exec.scenario.iterationInScenario;
  const player = PLAYERS[index];
  waitUntil((RAMP_MS * index) / COUNT);

  let closed = false;
  let iteration = null;
  let sequence = 0;
  let matchTimer = null;

  function observe(frame) {
    sequence += 1;
    const body = JSON.stringify({
      idempotencyKey: player.name + '-' + sequence,
      type: 'GAME_NAME_SEEN',
      run: frame.run,
      value: frame.expectedGameName,
      confidence: 0.99,
      capturedAt: new Date().toISOString(),
    });
    const res = http.post(
      BASE + '/v1/lobby-rooms/' + encodeURIComponent(iteration.roomId) + '/observations',
      body,
      {
        headers: agentHeaders(player),
      },
    );
    const sent = nowMs();
    tally(requests, sent);
    const before = iteration;
    iteration = settle(before, onStatus(onObservationSent(before, sent), res.status), sent);
    setTimeout(function () {
      if (iteration === null) return;
      const now = nowMs();
      iteration = settle(iteration, onTick(iteration, now), now);
    }, TIMEOUT_MS);
  }

  function startMatch() {
    if (closed) return;
    const at = nowMs();
    if (iteration !== null && iteration.phase === 'waiting-assigned') {
      // The previous match was never assigned before the next one: one error, no answer (status 0), and it ends.
      iteration = onStatus(iteration, 0);
      tally(errors, at);
      tally(iterations, at);
    }
    iteration = start();
    const res = http.post(BASE + '/v1/staging/match-formed', '{}', {
      headers: {
        Cookie: player.cookie,
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        'X-Forwarded-For': player.address,
      },
    });
    tally(requests, at);
    if (isError(res.status)) {
      tally(errors, at);
      iteration = null;
    }
  }

  function onEvent(event) {
    if (event.name === 'room.assigned') {
      if (iteration === null) return;
      const frame = JSON.parse(event.data);
      const next = onAssigned(iteration, frame, nowMs());
      if (next === iteration) return;
      iteration = next;
      observe(frame);
    } else if (event.name === 'room.stage_changed') {
      if (iteration === null) return;
      const frame = JSON.parse(event.data);
      if (frame.stage !== 'created' || frame.roomId !== iteration.roomId) return;
      const at = nowMs();
      const before = iteration;
      iteration = settle(before, onCreated(before, at), at);
      if (iteration.phase === 'created' && before.phase !== 'created' && windowOf(at) === 'measure') {
        console.warn('LB_SAMPLE ' + iteration.latencyMs);
      }
    }
  }

  const openedAt = nowMs();
  tally(requests, openedAt);
  const res = sse.open(
    BASE + '/v1/stream',
    { headers: { Cookie: player.cookie, 'X-Forwarded-For': player.address } },
    function (client) {
      client.on('open', function () {
        startMatch();
      });
      client.on('event', onEvent);
      matchTimer = setInterval(startMatch, MATCH_EVERY_MS);
      setTimeout(
        function () {
          closed = true;
          clearInterval(matchTimer);
          client.close();
        },
        Math.max(0, END_MS - nowMs()),
      );
    },
  );
  closed = true;
  if (matchTimer !== null) clearInterval(matchTimer);
  const closedAt = nowMs();
  if (res.status !== 200 || closedAt < END_MS - STREAM_SLACK_MS) tally(errors, closedAt);
}

/** One agent stream for one player: held for the step, its `room.assigned` frames counted. */
export function agent() {
  const index = exec.scenario.iterationInScenario;
  const player = PLAYERS[index];
  waitUntil((RAMP_MS * index) / COUNT);

  const openedAt = nowMs();
  tally(requests, openedAt);
  const res = sse.open(
    BASE + '/v1/stream',
    {
      headers: {
        Authorization: 'Bearer ' + player.token,
        'X-Agent-Version': VERSION,
        'X-Forwarded-For': player.address,
      },
    },
    function (client) {
      client.on('event', function (event) {
        if (event.name === 'room.assigned') tally(agentAssigned, nowMs());
      });
      setTimeout(
        function () {
          client.close();
        },
        Math.max(0, END_MS - nowMs()),
      );
    },
  );
  const closedAt = nowMs();
  if (res.status !== 200 || closedAt < END_MS - STREAM_SLACK_MS) tally(errors, closedAt);
}

/** One heartbeat, the next player in turn: the scenario's iterations go round the players. */
export function heartbeat() {
  const player = PLAYERS[exec.scenario.iterationInScenario % COUNT];
  const at = nowMs();
  const res = http.post(BASE + '/v1/agents/heartbeat', JSON.stringify(heartbeatBody()), {
    headers: agentHeaders(player),
  });
  tally(requests, at);
  if (isError(res.status)) tally(errors, at);
}

/** One control call of a meter or the sink. A failure is printed (never a secret) and answers zero. */
function controlCall(target, action) {
  const res = http.post(target.url + '/window/' + action, null, {
    headers: { Authorization: 'Bearer ' + PLAN.control.bearer, Host: target.host },
    tags: { role: 'control' },
  });
  if (res.status !== 200) {
    console.error('window ' + action + ' of ' + target.host + ' answered ' + res.status);
    return { bytes: 0, seconds: 0 };
  }
  return JSON.parse(res.body);
}

/** Opens the windows of the meter and the sink at the plan's offsets, then closes them. */
export function control() {
  waitUntil(WINDOW_START_MS);
  controlCall(PLAN.control.meter, 'start');
  controlCall(PLAN.control.sink, 'start');
  waitUntil(WINDOW_END_MS);
  const meter = controlCall(PLAN.control.meter, 'stop');
  const sink = controlCall(PLAN.control.sink, 'stop');
  meterBytes.add(meter.bytes);
  sinkBytes.add(sink.bytes);
  windowSeconds.add(meter.seconds);
}

function measuredOf(data, name) {
  const metric = data.metrics[name + '{window:measure}'];
  return metric && metric.values && typeof metric.values.count === 'number' ? metric.values.count : 0;
}

function totalOf(data, name) {
  const metric = data.metrics[name];
  return metric && metric.values && typeof metric.values.count === 'number' ? metric.values.count : 0;
}

/**
 * The step file the orchestrator reads. `latencySamplesMs` is empty here: the samples come from the `LB_SAMPLE` lines,
 * which handleSummary cannot see; the orchestrator fills the field from them.
 */
export function handleSummary(data) {
  const step = {
    latencySamplesMs: [],
    errors: measuredOf(data, 'journey_errors'),
    requests: measuredOf(data, 'journey_requests'),
    iterations: measuredOf(data, 'journey_iterations'),
    agentAssignedFrames: measuredOf(data, 'journey_agent_assigned'),
    meterBytes: totalOf(data, 'journey_meter_bytes'),
    sinkBytes: totalOf(data, 'journey_sink_bytes'),
    windowSeconds: totalOf(data, 'journey_window_seconds'),
  };
  return { '/work/out/step.json': JSON.stringify(step) + '\n' };
}
