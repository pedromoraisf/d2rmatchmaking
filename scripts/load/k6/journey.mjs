// The k6 journey of one step (design.md § k6 journey and Revision 1; LB-03, LB-04, LB-05, LB-06, LB-09, LB-14, LB-21).
// Plain k6 JavaScript, run by the k6 container of the step: the orchestrator copies it into the work directory's in/ next
// to plan.json and journey-state.mjs, and the container mounts in/ read-only at /work/in.
//
// Roles per player: a `site` VU holds the site stream (an explicit Cookie header). On each `room.assigned` frame it settles
// a stale observation, starts the iteration of the frame and posts the observation with the player's agent token; the
// `created` frame of the room closes the iteration (journey-state.mjs). An `agent` VU holds the agent stream and counts its
// `room.assigned` frames. A `heartbeat` scenario (a constant arrival rate of players / 15 per second) posts each player's
// heartbeat in turn. A `match` scenario posts one test match per player per 60 s, starting when the ramp ends. A `control`
// VU opens and closes the meters' windows at the plan's offsets, on k6's clock.
//
// No JavaScript timer runs while a stream is open (AD-121): k6 stops one that a stream handler creates. Every stream ends by
// its `timeout` argument at the window end plus the tail. The 5 s `created` rule is evaluated where a frame or the end of a
// stream arrives, and each error and iteration is tallied with the window of its observation (`window` tag, k6's clock).
// handleSummary writes the totals to /work/out/step.json. The per-iteration latency samples cannot reach handleSummary (each
// VU keeps its own values), so each one inside the window is printed as a console line `LB_SAMPLE <ms>`; the orchestrator
// reads those lines from the container's output. Only the warn and error channels are used, no trace header is sent, and
// nothing about a header, a cookie or a token is printed.

/* global open */
import http from 'k6/http';
import sse from 'k6/x/sse';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import {
  isError,
  kindOf,
  observationKeyOf,
  onAssigned,
  onClose,
  onCreated,
  onObservationSent,
  onStatus,
  onTick,
  quarterOf,
  start,
  statusKind,
} from './journey-state.mjs';

const PLAN = JSON.parse(open('/work/in/plan.json'));
const BASE = PLAN.base;
const ORIGIN = PLAN.origin;
const VERSION = PLAN.version;
const PLAYERS = PLAN.players;
const COUNT = PLAYERS.length;
const OFFSETS = PLAN.offsets;
if (typeof OFFSETS.tailSeconds !== 'number') {
  throw new Error('the plan has no offsets.tailSeconds: the orchestrator writes the tail of the step');
}
const RAMP_MS = OFFSETS.rampSeconds * 1000;
const WINDOW_START_MS = OFFSETS.windowStartSeconds * 1000;
const WINDOW_END_MS = OFFSETS.windowEndSeconds * 1000;
const CLOSE_MS = WINDOW_END_MS + OFFSETS.tailSeconds * 1000;
const CLOSE_SECONDS = Math.ceil(CLOSE_MS / 1000);
// The streams end by their timeout argument at the close. These limits bound a stream that does not end that way (the
// contingency of design.md Revision 1): k6 stops the scenario 5 s after the close.
const MAX_SCENARIO_SECONDS = CLOSE_SECONDS + 5;
const MATCH_DURATION_SECONDS = OFFSETS.windowEndSeconds - OFFSETS.rampSeconds;
const MATCH_RATE = COUNT;
const MATCH_VUS = Math.max(2, Math.ceil(COUNT / 10));
const HEARTBEAT_RATE = Math.max(1, Math.ceil(COUNT / 15));
const STREAM_SLACK_MS = 1000;
const GAME_WINDOW = 'Diablo II: Resurrected';

const requests = new Counter('journey_requests');
const errors = new Counter('journey_errors');
const iterations = new Counter('journey_iterations');
const agentAssigned = new Counter('journey_agent_assigned');
const matchesPosted = new Counter('journey_matches_posted');
const iterationsStarted = new Counter('journey_iterations_started');
const meterBytes = new Counter('journey_meter_bytes');
const sinkBytes = new Counter('journey_sink_bytes');
const windowSeconds = new Counter('journey_window_seconds');

const MEASURED = ['journey_requests', 'journey_errors', 'journey_iterations', 'journey_agent_assigned'];
const TOTALS = [
  'journey_matches_posted',
  'journey_iterations_started',
  'journey_meter_bytes',
  'journey_sink_bytes',
  'journey_window_seconds',
  'dropped_iterations',
];

// Every tallied metric has a threshold that is always true: k6 reports a sub-metric (a tag value) in the summary only
// when a threshold names it, and handleSummary reads the totals from there.
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
      gracefulStop: '5s',
      exec: 'site',
    },
    agent: {
      executor: 'per-vu-iterations',
      vus: COUNT,
      iterations: 1,
      maxDuration: MAX_SCENARIO_SECONDS + 's',
      gracefulStop: '5s',
      exec: 'agent',
    },
    heartbeat: {
      executor: 'constant-arrival-rate',
      rate: HEARTBEAT_RATE,
      timeUnit: '1s',
      duration: CLOSE_SECONDS + 's',
      preAllocatedVUs: HEARTBEAT_RATE * 2,
      maxVUs: HEARTBEAT_RATE * 4 + 2,
      exec: 'heartbeat',
    },
    match: {
      executor: 'constant-arrival-rate',
      rate: MATCH_RATE,
      timeUnit: '60s',
      startTime: OFFSETS.rampSeconds + 's',
      duration: MATCH_DURATION_SECONDS + 's',
      preAllocatedVUs: MATCH_VUS,
      maxVUs: MATCH_VUS * 4,
      exec: 'match',
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

/** The `timeout` argument of a stream: the time left to the close of the step, as a Go duration (the extension parses it). */
function streamTimeout(openedAt) {
  return Math.max(1, Math.ceil(CLOSE_MS - openedAt)) + 'ms';
}

/**
 * The close of a stream runs once (AD-123): the `error` event and the code after `sse.open` both call the returned function,
 * and the second call does nothing.
 */
function once(run) {
  let done = false;
  return function (closedAt, status) {
    if (done) return;
    done = true;
    run(closedAt, status);
  };
}

/**
 * A stream failed when it answered other than 200 (`status` is left out at the `error` event) or ended before the tail. The
 * cut of the `timeout` is the expected end, at or after the close, so a read error there is not a failure.
 */
function streamFailed(status, closedAt) {
  return (status !== undefined && status !== 200) || closedAt < CLOSE_MS - STREAM_SLACK_MS;
}

function finished(state) {
  return state.phase === 'created' || state.phase === 'timed-out';
}

/** A check that always fails: each call of it is one fail of the check's name. */
function failed() {
  return false;
}

/**
 * One error, tallied in the window of its time (the window it belongs to, never the moment it is found) and, inside the
 * measuring window, by its kind and by the quarter of its player. The kind and the quarter are checks: a check's fails count
 * is read back by handleSummary under its name, and a name needs no declaration at init.
 */
function fail(kind, index, ms) {
  tally(errors, ms);
  if (windowOf(ms) !== 'measure') return;
  const sets = {};
  sets['kind:' + kindOf(kind)] = failed;
  sets['quarter:' + quarterOf(index, COUNT)] = failed;
  check(null, sets);
}

/** The kind of a stream that closed with an error: a status other than 200 at the open, else it ended early. */
function streamKind(status, route) {
  return status !== undefined && status !== 200 ? statusKind(status, route) : 'stream-early';
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

/** One site stream for one player: the iterations of its assignments, observations and latency. */
export function site() {
  const index = exec.scenario.iterationInInstance;
  const player = PLAYERS[index];
  waitUntil((RAMP_MS * index) / COUNT);

  let iteration = null;

  /**
   * Tallies what a transition added to the iteration: each new error, under the kind the state names, and the iteration once
   * it has finished, in the window of its observation.
   */
  function settle(previous, next) {
    const at = next.observedAt;
    for (let count = previous.errors; count < next.errors; count += 1) fail(next.lastErrorKind, index, at);
    if (!finished(previous) && finished(next)) tally(iterations, at);
    return next;
  }

  function observe(frame) {
    const body = JSON.stringify({
      idempotencyKey: observationKeyOf(player.name, iteration.roomId),
      type: 'GAME_NAME_SEEN',
      run: frame.run,
      value: frame.expectedGameName,
      confidence: 0.99,
      capturedAt: new Date().toISOString(),
    });
    const res = http.post(
      BASE + '/v1/lobby-rooms/' + encodeURIComponent(iteration.roomId) + '/observations',
      body,
      { headers: agentHeaders(player) },
    );
    const sent = nowMs();
    tally(requests, sent);
    const before = iteration;
    iteration = settle(before, onStatus(onObservationSent(before, sent), res.status, 'observation'));
  }

  /** A `room.assigned` frame: a stale observation is settled first, then the frame starts an iteration and is observed. */
  function assigned(frame) {
    const at = nowMs();
    if (iteration !== null) {
      const previous = iteration;
      iteration = settle(previous, onTick(previous, at));
    }
    const started = onAssigned(start(), frame, at);
    if (started.assignedAt === null) return;
    iterationsStarted.add(1);
    iteration = started;
    observe(frame);
  }

  function created(frame) {
    if (iteration === null) return;
    if (frame.stage !== 'created' || frame.roomId !== iteration.roomId) return;
    const at = nowMs();
    const before = iteration;
    iteration = settle(before, onCreated(before, at));
    if (
      iteration.phase === 'created' &&
      before.phase !== 'created' &&
      windowOf(iteration.observedAt) === 'measure'
    ) {
      console.warn('LB_SAMPLE ' + iteration.latencyMs);
    }
  }

  function onEvent(event) {
    if (event.name === 'room.assigned') assigned(JSON.parse(event.data));
    else if (event.name === 'room.stage_changed') created(JSON.parse(event.data));
  }

  // The close runs at the `error` event (the `timeout` cut, AD-123), or after sse.open returns when no error comes first.
  const closeStream = once(function (closedAt, status) {
    if (iteration !== null) {
      const pending = iteration;
      iteration = settle(pending, onClose(pending, closedAt));
    }
    if (streamFailed(status, closedAt)) fail(streamKind(status, 'stream-site'), index, closedAt);
  });

  const openedAt = nowMs();
  tally(requests, openedAt);
  const res = sse.open(
    BASE + '/v1/stream',
    {
      headers: { Cookie: player.cookie, 'X-Forwarded-For': player.address },
      timeout: streamTimeout(openedAt),
    },
    function (client) {
      client.on('event', onEvent);
      client.on('error', function () {
        closeStream(nowMs());
      });
    },
  );
  closeStream(nowMs(), res.status);
}

/** One agent stream for one player: held to the close of the step, its `room.assigned` frames counted. */
export function agent() {
  const index = exec.scenario.iterationInInstance;
  const player = PLAYERS[index];
  waitUntil((RAMP_MS * index) / COUNT);

  const closeStream = once(function (closedAt, status) {
    if (streamFailed(status, closedAt)) fail(streamKind(status, 'stream-agent'), index, closedAt);
  });

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
      timeout: streamTimeout(openedAt),
    },
    function (client) {
      client.on('event', function (event) {
        if (event.name === 'room.assigned') tally(agentAssigned, nowMs());
      });
      client.on('error', function () {
        closeStream(nowMs());
      });
    },
  );
  closeStream(nowMs(), res.status);
}

/** One heartbeat, the next player in turn: the scenario's iterations go round the players. */
export function heartbeat() {
  const index = exec.scenario.iterationInInstance % COUNT;
  const player = PLAYERS[index];
  const at = nowMs();
  const res = http.post(BASE + '/v1/agents/heartbeat', JSON.stringify(heartbeatBody()), {
    headers: agentHeaders(player),
  });
  tally(requests, at);
  if (isError(res.status)) fail(statusKind(res.status, 'heartbeat'), index, at);
}

/**
 * One test match of the player in turn (one match per player per 60 s). Only a 2xx answer is a match: a failed post is an
 * error and no match, so a match that never gets an assignment is counted from matchesPosted against iterationsStarted.
 */
export function match() {
  const index = exec.scenario.iterationInInstance % COUNT;
  const player = PLAYERS[index];
  const at = nowMs();
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
    fail(statusKind(res.status, 'match-formed'), index, at);
    return;
  }
  matchesPosted.add(1);
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
 * which handleSummary cannot see; the orchestrator fills the field from them. `matchesPosted`, `iterationsStarted` and
 * `droppedIterations` cover the whole step; the orchestrator counts their difference as errors.
 */
/**
 * The fails of the root group's checks whose names start with a prefix, keyed by the rest of the name: one entry per kind
 * (`kind:`) or per quarter (`quarter:`) of a window error. A check with no fail is not in the summary, so it is absent.
 */
function failsOf(data, prefix) {
  const found = {};
  const groupChecks = data.root_group && Array.isArray(data.root_group.checks) ? data.root_group.checks : [];
  for (const entry of groupChecks) {
    if (entry.name.indexOf(prefix) === 0) found[entry.name.slice(prefix.length)] = entry.fails;
  }
  return found;
}

/**
 * The step file the orchestrator reads. `latencySamplesMs` is empty here: the samples come from the `LB_SAMPLE` lines,
 * which handleSummary cannot see; the orchestrator fills the field from them. `matchesPosted`, `iterationsStarted` and
 * `droppedIterations` cover the whole step; the orchestrator counts their difference as errors. `errorsByKind` counts the
 * window's errors by kind, and `errorsByPlayerRange` by quarter of the player index (AD-124); the orchestrator adds the
 * lost assignments and the dropped arrivals, which have no player.
 */
export function handleSummary(data) {
  const quarters = failsOf(data, 'quarter:');
  const step = {
    latencySamplesMs: [],
    errors: measuredOf(data, 'journey_errors'),
    errorsByKind: failsOf(data, 'kind:'),
    errorsByPlayerRange: [0, 1, 2, 3].map((quarter) => quarters[String(quarter)] || 0),
    requests: measuredOf(data, 'journey_requests'),
    iterations: measuredOf(data, 'journey_iterations'),
    agentAssignedFrames: measuredOf(data, 'journey_agent_assigned'),
    meterBytes: totalOf(data, 'journey_meter_bytes'),
    sinkBytes: totalOf(data, 'journey_sink_bytes'),
    windowSeconds: totalOf(data, 'journey_window_seconds'),
    matchesPosted: totalOf(data, 'journey_matches_posted'),
    iterationsStarted: totalOf(data, 'journey_iterations_started'),
    droppedIterations: totalOf(data, 'dropped_iterations'),
  };
  return { '/work/out/step.json': JSON.stringify(step) + '\n' };
}
