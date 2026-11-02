import Fastify, { type FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type DataPoint,
} from '@opentelemetry/sdk-metrics';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { APP_METER_NAME, D2R_STREAM_KIND, INSTRUMENT_NAMES } from '@d2rmm/telemetry';
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import type { AgentsPort } from '../modules/agents/index.ts';
import type { IdentityPort } from '../modules/identity/index.ts';
import {
  createMigratedTestDatabase,
  type MigratedTestDatabase,
} from '../../test/support/migrated-database.ts';
import {
  FakeClock,
  FakeScheduler,
  err,
  ok,
  type AnyDomainEvent,
  type MatchMember,
} from '../shared-kernel/index.ts';
import { createGuards } from './http/guards.ts';
import { InMemoryEventBus } from './event-bus.ts';
import type { PlatformDatabase } from './postgres/database.ts';
import { compareStreamIds } from './stream-projection.ts';
import { StreamHub } from './stream-hub.ts';

const START = new Date('2026-10-31T12:00:00.000Z');
const SITE_ORIGIN = 'https://site.example';
const FRAME_TIMEOUT_MS = 3_000;
const silentLog = { error: (): void => undefined };

/** The telemetry the hub writes: its spans in memory, and its `sse.connections` through an in-memory reader. */
const spanExporter = new InMemorySpanExporter();
const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const metricReader = new PeriodicExportingMetricReader({
  exporter: metricExporter,
  exportIntervalMillis: 60_000,
});
const sseMeter = new MeterProvider({ readers: [metricReader] }).getMeter(APP_METER_NAME);

const SESSION_A = 'd2rmm_s_account_a';
const SESSION_B = 'd2rmm_s_account_b';
const SESSION_SHORT = 'd2rmm_s_short';
const AGENT_A = 'd2rmm_a_agent_a';
const AGENT_B = 'd2rmm_a_agent_b';

/** Sessions: A and B are valid for 7 days, the short one for one minute. */
const identity: IdentityPort = {
  async authenticateSession(token) {
    if (token === SESSION_A) {
      return ok({ accountId: 'account-a', expiresAt: new Date(START.getTime() + 7 * 86_400_000) });
    }
    if (token === SESSION_B) {
      return ok({ accountId: 'account-b', expiresAt: new Date(START.getTime() + 7 * 86_400_000) });
    }
    if (token === SESSION_SHORT) {
      return ok({ accountId: 'account-a', expiresAt: new Date(START.getTime() + 60_000) });
    }
    return err('unauthenticated');
  },
};

const CURRENT_AGENT: Readonly<Record<string, string>> = { 'account-a': 'agent-a', 'account-b': 'agent-b' };
const AGENT_OWNER: Readonly<Record<string, { agentId: string; accountId: string }>> = {
  [AGENT_A]: { agentId: 'agent-a', accountId: 'account-a' },
  [AGENT_B]: { agentId: 'agent-b', accountId: 'account-b' },
};

const agents: AgentsPort = {
  async authenticateAgent(token) {
    const owner = AGENT_OWNER[token];
    return owner === undefined ? err('unauthenticated') : ok(owner);
  },
  async accountOfAgent(agentId) {
    return Object.values(AGENT_OWNER).find((owner) => owner.agentId === agentId)?.accountId ?? null;
  },
  async currentAgentOf(accountId) {
    return CURRENT_AGENT[accountId] ?? null;
  },
};

function member(accountId: string, joinOrder: number): MatchMember {
  return { accountId, characterId: null, joinOrder, role: joinOrder === 1 ? 'host' : 'member' };
}

function stageChanged(roomId: string, accountIds: readonly string[]): AnyDomainEvent {
  return {
    type: 'RoomStageChanged',
    payload: {
      roomId,
      stage: 'awaiting_host',
      members: accountIds.map((accountId, index) => member(accountId, index + 1)),
    },
  };
}

function roomAssigned(roomId: string, accountIds: readonly string[]): AnyDomainEvent {
  return {
    type: 'RoomAssignmentChanged',
    payload: {
      roomId,
      run: 1,
      expectedGameName: 'mmbaalh-1',
      members: accountIds.map((accountId, index) => member(accountId, index + 1)),
    },
  };
}

interface Frame {
  readonly id?: string;
  readonly event?: string;
  readonly data?: unknown;
  readonly comment?: string;
}

/** Reads SSE frames from a response body; `'end'` once the server has closed the stream. */
class SseReader {
  readonly #reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly #decoder = new TextDecoder();
  #buffer = '';

  constructor(body: ReadableStream<Uint8Array>) {
    this.#reader = body.getReader();
  }

  async next(): Promise<Frame | 'end'> {
    for (;;) {
      const separator = this.#buffer.indexOf('\n\n');
      if (separator !== -1) {
        const raw = this.#buffer.slice(0, separator);
        this.#buffer = this.#buffer.slice(separator + 2);
        return parseFrame(raw);
      }
      const chunk = await withTimeout(this.#reader.read());
      if (chunk.done) {
        return 'end';
      }
      this.#buffer += this.#decoder.decode(chunk.value, { stream: true });
    }
  }

  /** The next data or comment frame, skipping nothing: used where the test expects a specific frame. */
  async nextMessage(): Promise<Frame> {
    const frame = await this.next();
    if (frame === 'end') {
      throw new Error('the stream ended where a frame was expected');
    }
    return frame;
  }

  async ids(count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const frame = await this.nextMessage();
      ids.push(frame.id ?? '');
    }
    return ids;
  }

  async cancel(): Promise<void> {
    await this.#reader.cancel().catch(() => undefined);
  }
}

function parseFrame(raw: string): Frame {
  const frame: { id?: string; event?: string; data?: unknown; comment?: string } = {};
  for (const line of raw.split('\n')) {
    if (line.startsWith(':')) {
      frame.comment = line.slice(1).trim();
    } else if (line.startsWith('id: ')) {
      frame.id = line.slice(4);
    } else if (line.startsWith('event: ')) {
      frame.event = line.slice(7);
    } else if (line.startsWith('data: ')) {
      frame.data = JSON.parse(line.slice(6));
    }
  }
  return frame;
}

function withTimeout<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`no frame within ${FRAME_TIMEOUT_MS} ms`));
    }, FRAME_TIMEOUT_MS);
  });
  return Promise.race([pending, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

let database: MigratedTestDatabase<PlatformDatabase>;

beforeAll(async () => {
  database = await createMigratedTestDatabase<PlatformDatabase>();
});

afterAll(async () => {
  await database.close();
});

/** A running hub on a real port, with a clock the test moves and the outbox of the test database. */
interface Harness {
  readonly base: string;
  readonly clock: FakeClock;
  readonly bus: InMemoryEventBus;
  readonly readers: SseReader[];
  stream(
    path: string,
    headers?: Record<string, string>,
  ): Promise<{ status: number; reader?: SseReader; body: string }>;
  publishDurable(id: number, event: AnyDomainEvent): Promise<void>;
  publishTransient(event: AnyDomainEvent): Promise<void>;
  close(): Promise<void>;
}

let harness: Harness | undefined;

async function startHarness(): Promise<Harness> {
  const clock = new FakeClock(START);
  const scheduler = new FakeScheduler(clock);
  const bus = new InMemoryEventBus();
  const hub = new StreamHub({
    db: database.db,
    bus,
    agents,
    guards: createGuards({ identity, agents, agentMinVersion: '0.0.1', siteOrigin: SITE_ORIGIN, clock }),
    scheduler,
    log: silentLog,
    meter: sseMeter,
  });
  hub.subscribe();
  const app: FastifyInstance = Fastify();
  hub.register(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const readers: SseReader[] = [];
  const running: Harness = {
    base,
    clock,
    bus,
    readers,
    async stream(path, headers = {}) {
      const response = await fetch(`${base}${path}`, { headers });
      if (response.status !== 200 || response.body === null) {
        return { status: response.status, body: await response.text() };
      }
      const reader = new SseReader(response.body);
      readers.push(reader);
      return { status: 200, reader, body: '' };
    },
    async publishDurable(id, event) {
      await database.pool.query(
        'insert into platform.outbox (id, event_type, payload, created_at, published_at) values ($1, $2, $3, $4, $4)',
        [id, event.type, JSON.stringify(event.payload), START],
      );
      await bus.publish({ kind: 'durable', id: BigInt(id), event });
    },
    async publishTransient(event) {
      await bus.publish({ kind: 'transient', event });
    },
    async close() {
      for (const reader of readers) {
        await reader.cancel();
      }
      app.server.closeAllConnections();
      await app.close();
    },
  };
  return running;
}

const SITE_A = { cookie: `__Host-d2rmm_session=${SESSION_A}` };
const SITE_B = { cookie: `__Host-d2rmm_session=${SESSION_B}` };
const AGENT_A_HEADERS = { authorization: `Bearer ${AGENT_A}`, 'x-agent-version': '0.0.1' };
const AGENT_B_HEADERS = { authorization: `Bearer ${AGENT_B}`, 'x-agent-version': '0.0.1' };

beforeEach(async () => {
  await database.pool.query('truncate platform.outbox restart identity');
  harness = await startHarness();
});

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

function running(): Harness {
  if (harness === undefined) {
    throw new Error('the harness is not running');
  }
  return harness;
}

describe('GET /v1/stream', () => {
  it('a site stream gets only its account events', async () => {
    const h = running();
    const a = await h.stream('/v1/stream', SITE_A);
    const b = await h.stream('/v1/stream', SITE_B);
    expect(a.reader && b.reader).toBeTruthy();

    await h.publishDurable(1, stageChanged('room-1', ['account-a']));
    await h.publishDurable(2, stageChanged('room-2', ['account-b']));
    await h.publishDurable(3, stageChanged('room-3', ['account-a']));

    expect(await a.reader?.ids(2)).toEqual(['1', '3']);
    expect(await b.reader?.ids(1)).toEqual(['2']);
  });

  it('an agent stream gets only its agent events', async () => {
    const h = running();
    const agentA = await h.stream('/v1/stream', AGENT_A_HEADERS);
    const agentB = await h.stream('/v1/stream', AGENT_B_HEADERS);

    await h.publishDurable(1, roomAssigned('room-1', ['account-a']));
    await h.publishDurable(2, roomAssigned('room-2', ['account-b']));

    const frameA = await agentA.reader?.nextMessage();
    const frameB = await agentB.reader?.nextMessage();
    expect(frameA?.event).toBe('room.assigned');
    expect(frameA?.id).toBe('1');
    expect(frameB?.event).toBe('room.assigned');
    expect(frameB?.id).toBe('2');
  });

  it('replays the events after Last-Event-ID in order', async () => {
    const h = running();
    await h.publishDurable(1, stageChanged('room-1', ['account-a']));
    await h.publishDurable(2, stageChanged('room-1', ['account-a']));
    await h.publishDurable(3, stageChanged('room-1', ['account-a']));
    await h.publishDurable(4, stageChanged('room-1', ['account-a']));
    await h.publishDurable(5, stageChanged('room-1', ['account-a']));

    const reconnect = await h.stream('/v1/stream', { ...SITE_A, 'last-event-id': '3' });
    expect(await reconnect.reader?.ids(2)).toEqual(['4', '5']);

    // Event 5 reaches the bus again (a relay redelivery): the stream already sent it and must not repeat it.
    await h.bus.publish({ kind: 'durable', id: 5n, event: stageChanged('room-1', ['account-a']) });
    await h.publishDurable(6, stageChanged('room-1', ['account-a']));
    expect(await reconnect.reader?.ids(1)).toEqual(['6']);
  });

  it('event ids increase', async () => {
    const h = running();
    const site = await h.stream('/v1/stream', SITE_A);

    await h.publishDurable(7, stageChanged('room-1', ['account-a']));
    await h.publishTransient({
      type: 'AgentPresenceChanged',
      payload: {
        agentId: 'agent-a',
        accountId: 'account-a',
        online: true,
        gameRunning: true,
        screen: 'UNKNOWN',
      },
    });
    await h.publishTransient({
      type: 'AgentPresenceChanged',
      payload: {
        agentId: 'agent-a',
        accountId: 'account-a',
        online: true,
        gameRunning: false,
        screen: 'UNKNOWN',
      },
    });

    const ids = (await site.reader?.ids(3)) ?? [];
    expect(ids).toEqual(['7', '7.1', '7.2']);
    expect(compareStreamIds(ids[0] ?? '', ids[1] ?? '')).toBeLessThan(0);
    expect(compareStreamIds(ids[1] ?? '', ids[2] ?? '')).toBeLessThan(0);
  });

  it('sends a keep-alive comment every 25 seconds', async () => {
    const h = running();
    const site = await h.stream('/v1/stream', SITE_A);

    h.clock.advance(25_000);
    expect(await site.reader?.nextMessage()).toEqual({ comment: 'ka' });
    h.clock.advance(25_000);
    expect(await site.reader?.nextMessage()).toEqual({ comment: 'ka' });
  });

  it('closes an agent stream when its agent is revoked', async () => {
    const h = running();
    const agent = await h.stream('/v1/stream', AGENT_A_HEADERS);

    await h.publishTransient({
      type: 'AgentRevoked',
      payload: { agentId: 'agent-a', accountId: 'account-a' },
    });

    expect(await agent.reader?.next()).toBe('end');
  });

  it('closes the oldest stream when a sixth opens for the same account', async () => {
    const h = running();
    const streams = [];
    for (let index = 0; index < 6; index += 1) {
      streams.push(await h.stream('/v1/stream', SITE_A));
    }

    expect(await streams[0]?.reader?.next()).toBe('end');
    await h.publishDurable(1, stageChanged('room-1', ['account-a']));
    expect(await streams[5]?.reader?.ids(1)).toEqual(['1']);
  });

  it('refuses a credential in the query string with 400', async () => {
    const h = running();

    const response = await h.stream(`/v1/stream?token=${AGENT_A}`, AGENT_A_HEADERS);

    expect(response.status).toBe(400);
  });

  it('refuses a Last-Event-ID that the hub never issued with 400', async () => {
    const h = running();

    const response = await h.stream('/v1/stream', { ...SITE_A, 'last-event-id': 'abc' });

    expect(response.status).toBe(400);
  });

  it('answers 401 to a site stream without a session and to a bad bearer with no cookie fallback', async () => {
    const h = running();

    expect((await h.stream('/v1/stream')).status).toBe(401);
    const badBearer = await h.stream('/v1/stream', {
      ...SITE_A,
      authorization: 'Bearer d2rmm_a_nope',
      'x-agent-version': '0.0.1',
    });
    expect(badBearer.status).toBe(401);
  });

  it('closes a site stream at its session expiry', async () => {
    const h = running();
    const site = await h.stream('/v1/stream', { cookie: `__Host-d2rmm_session=${SESSION_SHORT}` });

    h.clock.advance(60_000);

    // The keep-alive comments due at 25 s and 50 s arrive first; the stream then ends at 60 s.
    let frame = await site.reader?.next();
    while (frame !== undefined && frame !== 'end' && frame.comment === 'ka') {
      frame = await site.reader?.next();
    }
    expect(frame).toBe('end');
  });

  it('sends presence to the owner account only', async () => {
    const h = running();
    const a = await h.stream('/v1/stream', SITE_A);

    await h.publishTransient({
      type: 'AgentPresenceChanged',
      payload: {
        agentId: 'agent-b',
        accountId: 'account-b',
        online: true,
        gameRunning: true,
        screen: 'UNKNOWN',
      },
    });
    await h.publishDurable(1, stageChanged('room-1', ['account-a']));

    expect(await a.reader?.ids(1)).toEqual(['1']);
  });
});

/** The sum of `sse.connections` for one stream kind, read through the in-memory reader. */
async function sseConnections(kind: 'site' | 'agent'): Promise<number> {
  await metricReader.forceFlush();
  // The exporter keeps every export: the latest one holds the current sums of a cumulative instrument.
  const latest = metricExporter.getMetrics().at(-1);
  const metric = latest?.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find((candidate) => candidate.descriptor.name === INSTRUMENT_NAMES.sseConnections);
  const points = metric?.dataPoints as DataPoint<number>[] | undefined;
  return points?.find((point) => point.attributes[D2R_STREAM_KIND] === kind)?.value ?? 0;
}

/** Polls `read` until it returns `expected`, for up to three seconds; returns the last value read. */
async function eventually(read: () => Promise<number>, expected: number): Promise<number> {
  const deadline = Date.now() + 3_000;
  let value = await read();
  while (value !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    value = await read();
  }
  return value;
}

describe('the telemetry of the stream hub', () => {
  beforeAll(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    trace.setGlobalTracerProvider(
      new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spanExporter)] }),
    );
  });

  afterAll(() => {
    context.disable();
  });

  beforeEach(() => {
    spanExporter.reset();
  });

  it('delivers inside a span that is a child of the outbox relay', async () => {
    const h = running();
    const a = await h.stream('/v1/stream', SITE_A);
    const relay = trace.getTracer('test').startSpan('platform.outbox.relay');
    const relayContext = relay.spanContext();

    await context.with(trace.setSpan(context.active(), relay), () =>
      h.publishDurable(1, stageChanged('room-1', ['account-a'])),
    );
    relay.end();

    expect(await a.reader?.ids(1)).toEqual(['1']);
    const deliveries = spanExporter
      .getFinishedSpans()
      .filter((span) => span.name === 'platform.stream.deliver');
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.parentSpanContext?.spanId).toBe(relayContext.spanId);
    expect(deliveries[0]?.spanContext().traceId).toBe(relayContext.traceId);
    expect(deliveries[0]?.attributes[D2R_STREAM_KIND]).toBe('site');
  });

  it('sse.connections goes up and down with the connection', async () => {
    const h = running();
    const before = await sseConnections('site');

    const a = await h.stream('/v1/stream', SITE_A);
    expect(await sseConnections('site')).toBe(before + 1);

    await a.reader?.cancel();
    expect(await eventually(() => sseConnections('site'), before)).toBe(before);
  });
});
