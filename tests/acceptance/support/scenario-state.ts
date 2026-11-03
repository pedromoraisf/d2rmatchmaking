// What the telemetry steps of one scenario share: the traced stack, the fake backend, the headless agent and what the last
// relay request answered. Every scenario gets its own state, keyed by its World, and the After hook of the trace steps
// closes what it holds.
import type { HeadlessAgent } from './headless-agent.ts';
import type { RecordingProxy } from './agent-proxy.ts';
import type { FakeTelemetryBackend, TracedStack } from './stack.ts';
import type { Trace } from './trace-reader.ts';
import type { World } from './world.ts';

/** The last request the relay received from a test client, and what it answered. */
export interface RelayAnswer {
  readonly body: Buffer;
  readonly status: number;
  readonly retryAfter: string | null;
  readonly bodyLength: number;
}

export interface TelemetryState {
  traced?: TracedStack;
  fake?: FakeTelemetryBackend;
  siteTraceparent?: string | undefined;
  traceA?: Trace;
  agent?: HeadlessAgent;
  /** The proxy the headless agent talks through: it records the trace id of each request the agent sends. */
  agentProxy?: RecordingProxy;
  /** Stops the traced API's clock from following the wall clock (set while the headless agent runs). */
  stopClock?: () => void;
  fixtureDir?: string;
  startedAt?: number;
  relay?: RelayAnswer;
}

/** A scenario that starts a traced stack may wait this long: the first one of a worker builds the telemetry site. */
export const TRACED_START_TIMEOUT_MS = 300_000;
/** A scenario that starts the headless agent may wait this long: the first run of the example compiles it. */
export const HEADLESS_START_TIMEOUT_MS = 480_000;

const states = new WeakMap<World, TelemetryState>();

/** The telemetry state of the scenario that owns `world`. Created on first use. */
export function stateOf(world: World): TelemetryState {
  let state = states.get(world);
  if (state === undefined) {
    state = {};
    states.set(world, state);
  }
  return state;
}

/** The state of a scenario that has one, or undefined: the After hook closes only what was started. */
export function existingStateOf(world: World): TelemetryState | undefined {
  return states.get(world);
}
