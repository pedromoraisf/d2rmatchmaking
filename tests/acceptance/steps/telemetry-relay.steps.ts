// The relay scenarios of the acceptance feature (OBS-10 to OBS-15, OBS-17, OBS-20): a client sends spans to the relay of the
// API, the relay answers by its rules, and a fake backend records what it forwards. Each scenario runs on the traced stack
// pointed at the fake backend (the Before hook). The API's own exporter shares that endpoint, so the steps count only the
// batches they sent: a batch is "received" when the backend holds its exact bytes.
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { Before, Given, Then, When, test } from '../fixtures.ts';
import {
  existingStateOf,
  stateOf,
  TRACED_START_TIMEOUT_MS,
  type RelayAnswer,
} from '../support/scenario-state.ts';
import {
  FakeTelemetryBackend,
  startTracedStack,
  type FakeBackendMode,
  type TracedStack,
} from '../support/stack.ts';
import { SESSION_COOKIE, type World } from '../support/world.ts';

const PLAYER = 'PlayerOne';
const RELAY_PATH = '/v1/telemetry/traces';
const ONE_MIB = 1024 * 1024;
const PROTOBUF_BATCH = Buffer.from([0x0a, 0x00, 0x12, 0x00]);
const TEXT_BODY = Buffer.from('plain text, not spans');
const OTHER_ORIGIN = 'https://elsewhere.example';
const SETTLE_MS = 1_000;
/**
 * The clock gap between two requests of a signed-in player. A session lookup takes a token of the relay's lookup bucket (10
 * a second, design § Relay route). The traced API runs on a controllable clock that does not move on its own, so the bucket
 * would never refill: each player request advances that clock by this gap instead, which keeps the sender under 10 lookups
 * a second and leaves the per-minute rate limit under test in charge.
 */
const PLAYER_PACE_MS = 150;

/** A small valid batch with bytes of its own: the backend tells the batches apart by their exact bytes. */
function newBatch(): Buffer {
  return Buffer.from(JSON.stringify({ resourceSpans: [], batch: randomUUID() }));
}

type Sender = 'agent' | 'player' | 'anonymous';
type Origin = 'site' | 'other' | 'none';

/** One request the relay receives: who sends it, its headers and its body. */
interface Form {
  readonly sender: Sender;
  readonly contentType?: string;
  readonly contentEncoding?: string;
  readonly origin?: Origin;
  readonly body: () => Buffer;
}

/** The request forms of the outline "The relay accepts only what it should", by the text of its Examples. */
const FORMS: Record<string, Form> = {
  'as a paired agent with a JSON body': {
    sender: 'agent',
    contentType: 'application/json',
    body: newBatch,
  },
  'as a signed-in player from the site with a protobuf body': {
    sender: 'player',
    contentType: 'application/x-protobuf',
    origin: 'site',
    body: () => PROTOBUF_BATCH,
  },
  'as a paired agent with a body of exactly 1 MiB': {
    sender: 'agent',
    contentType: 'application/json',
    body: () => Buffer.alloc(ONE_MIB, 0x20),
  },
  'with no credentials': {
    sender: 'anonymous',
    contentType: 'application/json',
    body: newBatch,
  },
  'as a signed-in player from another origin': {
    sender: 'player',
    contentType: 'application/json',
    origin: 'other',
    body: newBatch,
  },
  'as a signed-in player with no origin header': {
    sender: 'player',
    contentType: 'application/json',
    origin: 'none',
    body: newBatch,
  },
  'as a paired agent with a text body': {
    sender: 'agent',
    contentType: 'text/plain',
    body: () => TEXT_BODY,
  },
  'as a paired agent with a gzip-encoded JSON body': {
    sender: 'agent',
    contentType: 'application/json',
    contentEncoding: 'gzip',
    body: newBatch,
  },
  'as a paired agent with a body of 1 MiB plus one byte': {
    sender: 'agent',
    contentType: 'application/json',
    body: () => Buffer.alloc(ONE_MIB + 1, 0x20),
  },
  'with no credentials and a text body': {
    sender: 'anonymous',
    contentType: 'text/plain',
    body: () => TEXT_BODY,
  },
};

/** The senders of the rate scenarios, by the words the feature uses for them. */
const SENDER_OF: Record<string, Sender> = {
  'the agent': 'agent',
  'a paired agent': 'agent',
  'a signed-in player': 'player',
  'a client with no credentials': 'anonymous',
  'that client': 'anonymous',
};

const BACKEND_MODE_OF: Record<string, FakeBackendMode> = {
  'refuses connections': 'refuse',
  'accepts and never answers': 'hang',
  'answers with a server error': 'error',
};

/** A small, valid batch from `sender`: the request the rate scenarios repeat. */
function smallBatch(sender: Sender): Form {
  return sender === 'player'
    ? { sender, contentType: 'application/json', origin: 'site', body: newBatch }
    : { sender, contentType: 'application/json', body: newBatch };
}

function tracedOf(world: World): TracedStack {
  const traced = stateOf(world).traced;
  expect(traced, 'the traced stack runs in this scenario').toBeDefined();
  return traced as TracedStack;
}

function fakeOf(world: World): FakeTelemetryBackend {
  const fake = stateOf(world).fake;
  expect(fake, 'the fake telemetry backend runs in this scenario').toBeDefined();
  return fake as FakeTelemetryBackend;
}

function relayOf(world: World): RelayAnswer {
  const answer = stateOf(world).relay;
  expect(answer, 'the relay received a request in this scenario').toBeDefined();
  return answer as RelayAnswer;
}

/** Sends one request to the relay of the scenario's API, and records what it answered. */
async function send(world: World, form: Form): Promise<RelayAnswer> {
  const headers: Record<string, string> = {};
  if (form.contentType !== undefined) headers['Content-Type'] = form.contentType;
  if (form.contentEncoding !== undefined) headers['Content-Encoding'] = form.contentEncoding;
  if (form.sender === 'agent') {
    // The flood scenarios name a paired agent without pairing it first: the first agent sender pairs one for PlayerOne.
    if (world.paired.length === 0) await world.pairAgent(PLAYER);
    const token = world.lastAgent.token;
    expect(token, 'the paired agent holds its token').toBeDefined();
    headers['Authorization'] = `Bearer ${String(token)}`;
  }
  if (form.sender === 'player') {
    await tracedOf(world).advanceClock(PLAYER_PACE_MS);
    headers['Cookie'] = `${SESSION_COOKIE}=${await world.sessionOf(PLAYER)}`;
  }
  if (form.origin === 'site') headers['Origin'] = world.site.site;
  if (form.origin === 'other') headers['Origin'] = OTHER_ORIGIN;
  const body = form.body();
  const response = await fetch(`${world.site.api}${RELAY_PATH}`, {
    method: 'POST',
    headers,
    // The same bytes as a view the fetch types accept; `body` keeps the Buffer for the comparison with what arrives.
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(30_000),
  });
  const answered = Buffer.from(await response.arrayBuffer());
  const answer: RelayAnswer = {
    body,
    status: response.status,
    retryAfter: response.headers.get('retry-after'),
    bodyLength: answered.length,
  };
  stateOf(world).relay = answer;
  return answer;
}

/** The batches the fake backend holds with exactly these bytes, once the forward of the relay has had time to arrive. */
async function forwardedCopies(world: World, expectAtLeastOne: boolean): Promise<number> {
  const fake = fakeOf(world);
  const body = relayOf(world).body;
  const count = (): number => fake.requests.filter((request) => request.body.equals(body)).length;
  const deadline = Date.now() + (expectAtLeastOne ? 10_000 : 0);
  while (count() === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // A second forward would arrive after the first: wait once more before counting.
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  return count();
}

// The relay scenarios run on the traced stack, pointed at a fake backend. The backend's mode is set by the steps below.
Before({ tags: '@api and @NFR-09' }, async ({ world }) => {
  // The first traced stack of a worker builds the telemetry site: the scenario's default timeout does not cover it.
  test.setTimeout(TRACED_START_TIMEOUT_MS);
  const state = stateOf(world);
  state.fake = new FakeTelemetryBackend();
  await state.fake.start();
  state.traced = await startTracedStack({ otlpEndpoint: state.fake.url });
  world.site = state.traced.staging;
});

Given('a fake telemetry backend is listening', ({ world }) => {
  expect(existingStateOf(world)?.fake, 'the fake telemetry backend').toBeDefined();
});

Given(
  /^the telemetry backend (refuses connections|accepts and never answers|answers with a server error)$/,
  async ({ world }, failure: string) => {
    await fakeOf(world).setMode(BACKEND_MODE_OF[failure] ?? 'accept');
  },
);

Given(
  /^(the agent|a paired agent|a signed-in player|a client with no credentials) has sent (\d+) span batches to the relay in the last minute$/,
  async ({ world }, who: string, count: string) => {
    const sender = SENDER_OF[who] ?? 'agent';
    for (let index = 0; index < Number(count); index += 1) {
      const answer = await send(world, smallBatch(sender));
      expect(answer.status, `batch ${index + 1} of ${who}`).toBe(sender === 'anonymous' ? 401 : 202);
    }
  },
);

When(
  /^(the agent|a paired agent|a signed-in player|that client) sends one more batch$/,
  async ({ world }, who: string) => {
    await send(world, smallBatch(SENDER_OF[who] ?? 'agent'));
  },
);

When('a paired agent sends a small span batch to the relay', async ({ world }) => {
  await send(world, smallBatch('agent'));
});

When(/^the agent sends a text body of (1 KiB|2 MiB)$/, async ({ world }, size: string) => {
  const bytes = size === '1 KiB' ? 1024 : 2 * ONE_MIB;
  await send(world, {
    sender: 'agent',
    contentType: 'text/plain',
    body: () => Buffer.alloc(bytes, 0x61),
  });
});

When(/^a client sends spans to the relay (.+)$/, async ({ world }, how: string) => {
  const form = FORMS[how];
  expect(form, `the request form "${how}"`).toBeDefined();
  await send(world, form as Form);
});

// The relay's answer when the scenario sent to the relay; otherwise the last answer a step recorded (characters, CHR-09).
Then(/^the API answers (\d{3})$/, ({ world }, code: string) => {
  const relay = stateOf(world).relay;
  const status = relay !== undefined ? relay.status : world.last?.status;
  expect(status, 'the API answer').toBe(Number(code));
});

Then('the API answers 202 with no content', ({ world }) => {
  const answer = relayOf(world);
  expect(answer.status, 'the relay answer').toBe(202);
  expect(answer.bodyLength, 'the body of the 202 answer').toBe(0);
});

Then('the API answers 429 and says when to try again', ({ world }) => {
  const answer = relayOf(world);
  expect(answer.status, 'the relay answer').toBe(429);
  expect(Number(answer.retryAfter), 'the Retry-After seconds').toBeGreaterThan(0);
});

Then(
  'the fake telemetry backend received that exact body once, with the backend credentials added',
  async ({ world }) => {
    const copies = await forwardedCopies(world, true);
    expect(copies, 'copies of the batch at the backend').toBe(1);
    const forwarded = fakeOf(world).requests.find((request) => request.body.equals(relayOf(world).body));
    expect(forwarded?.headers['x-acceptance-backend'], 'the backend credential the relay added').toBe(
      'present',
    );
  },
);

Then('the fake telemetry backend received nothing', async ({ world }) => {
  expect(await forwardedCopies(world, false), 'copies of the batch at the backend').toBe(0);
});

Then('the fake telemetry backend does not receive that batch', async ({ world }) => {
  expect(await forwardedCopies(world, false), 'copies of the batch at the backend').toBe(0);
});
