import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { ServerResponse } from 'node:http';
import { trace, type Meter, type UpDownCounter } from '@opentelemetry/api';
import { D2R_STREAM_KIND, INSTRUMENT_NAMES } from '@d2rmm/telemetry';
import type { AnyDomainEvent, BusEvent, Cancel, EventBus, Scheduler } from '../shared-kernel/index.ts';
import type { Guards } from './http/guards.ts';
import type { ErrorLog } from './error-log.ts';
import type { PlatformDatabase } from './postgres/database.ts';
import {
  parseStreamId,
  projectStreamEvent,
  type CurrentAgentLookup,
  type Delivery,
} from './stream-projection.ts';

/** Keep-alive comment interval (AWS-40, ADR 007). */
export const KEEP_ALIVE_MS = 25_000;

/** A sixth stream for the same account or agent closes the oldest one (design.md § Platform, stream hub). */
export const MAX_STREAMS_PER_KEY = 5;

/** The durable events a stream can carry; replay reads only these rows. */
const STREAMED_DURABLE_TYPES = ['RoomAssignmentChanged', 'RoomStageChanged'] as const;

/** The events the hub subscribes to on the bus. */
const SUBSCRIBED_TYPES = [
  'RoomAssignmentChanged',
  'RoomStageChanged',
  'AgentPresenceChanged',
  'AgentRevoked',
] as const;

/** Query parameters that would carry a credential: refused with 400 so tokens never reach a URL (AWS-11). */
const CREDENTIAL_QUERY_KEYS: ReadonlySet<string> = new Set([
  'token',
  'access_token',
  'authorization',
  'session',
]);

export interface StreamHubDeps {
  readonly db: Kysely<PlatformDatabase>;
  readonly bus: EventBus;
  readonly agents: CurrentAgentLookup;
  readonly guards: Guards;
  readonly scheduler: Scheduler;
  /** Where a failed replay is reported (the application logger). */
  readonly log: ErrorLog;
  /** The meter of `sse.connections` (the application meter). */
  readonly meter: Meter;
}

/** The tracer of the API's own spans, as in shared-kernel/tracing.ts. */
const TRACER_NAME = 'd2rmm-api';
/** One delivery to one accepting stream, a child of the span that published the event (OBS-06). */
const DELIVER_SPAN = 'platform.stream.deliver';

/** Who the stream belongs to: the site of an account, or one agent. */
type Principal =
  | { readonly kind: 'site'; readonly accountId: string }
  | { readonly kind: 'agent'; readonly agentId: string };

interface PendingDispatch {
  readonly outboxId: bigint | undefined;
  readonly deliveries: readonly Delivery[];
}

function hasCredentialInQuery(query: unknown): boolean {
  if (typeof query !== 'object' || query === null) {
    return false;
  }
  return Object.keys(query).some((key) => CREDENTIAL_QUERY_KEYS.has(key.toLowerCase()));
}

/**
 * One open SSE response. Its cursor is the highest durable outbox id it has handled: a durable event at or below the
 * cursor is a duplicate and is skipped. While the connection replays, live events are buffered and flushed after the
 * replay, so the client gets the missed events in order, then the live ones, with no duplicate.
 */
class Connection {
  readonly principal: Principal;
  cursor: bigint;
  readonly #raw: ServerResponse;
  readonly #cancels: Cancel[] = [];
  readonly #onClose: (connection: Connection) => void;
  readonly #buffer: PendingDispatch[] = [];
  #replaying: boolean;
  #transientCount = 0;
  #closed = false;

  constructor(options: {
    principal: Principal;
    raw: ServerResponse;
    cursor: bigint;
    replaying: boolean;
    onClose: (connection: Connection) => void;
  }) {
    this.principal = options.principal;
    this.#raw = options.raw;
    this.cursor = options.cursor;
    this.#replaying = options.replaying;
    this.#onClose = options.onClose;
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** The stream key used to cap the streams of one account or agent. */
  sameAs(principal: Principal): boolean {
    if (principal.kind === 'site') {
      return this.principal.kind === 'site' && this.principal.accountId === principal.accountId;
    }
    return this.principal.kind === 'agent' && this.principal.agentId === principal.agentId;
  }

  track(cancel: Cancel): void {
    this.#cancels.push(cancel);
  }

  /** True when this stream takes at least one of the deliveries of an event. */
  accepts(deliveries: readonly Delivery[]): boolean {
    return deliveries.some((delivery) => this.#accepts(delivery));
  }

  /** Hands a live dispatch to the connection: buffered while it replays, written otherwise. */
  offer(outboxId: bigint | undefined, deliveries: readonly Delivery[]): void {
    if (this.#closed) {
      return;
    }
    if (this.#replaying) {
      this.#buffer.push({ outboxId, deliveries });
      return;
    }
    this.emit(outboxId, deliveries);
  }

  /** Writes the deliveries of one durable event (or one transient event) that this stream accepts. */
  emit(outboxId: bigint | undefined, deliveries: readonly Delivery[]): void {
    if (this.#closed) {
      return;
    }
    if (outboxId !== undefined) {
      if (outboxId <= this.cursor) {
        return;
      }
      this.cursor = outboxId;
    }
    for (const delivery of deliveries) {
      if (!this.#accepts(delivery)) {
        continue;
      }
      const id = outboxId !== undefined ? outboxId.toString() : `${this.cursor}.${++this.#transientCount}`;
      this.#write(
        `id: ${id}\nevent: ${delivery.event.type}\ndata: ${JSON.stringify(delivery.event.data)}\n\n`,
      );
    }
  }

  /** Ends the replay: flushes what arrived meanwhile and switches to live writes. */
  endReplay(): void {
    this.#replaying = false;
    for (const pending of this.#buffer.splice(0)) {
      this.emit(pending.outboxId, pending.deliveries);
    }
  }

  keepAlive(): void {
    this.#write(': ka\n\n');
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    for (const cancel of this.#cancels.splice(0)) {
      cancel();
    }
    this.#onClose(this);
    if (!this.#raw.writableEnded) {
      this.#raw.end();
    }
  }

  #accepts(delivery: Delivery): boolean {
    if (this.principal.kind === 'site') {
      return delivery.stream === 'site' && delivery.accountId === this.principal.accountId;
    }
    return delivery.stream === 'agent' && delivery.agentId === this.principal.agentId;
  }

  #write(chunk: string): void {
    if (!this.#closed && !this.#raw.writableEnded && !this.#raw.destroyed) {
      this.#raw.write(chunk);
    }
  }
}

/**
 * `GET /v1/stream` (design.md § Platform, stream hub; ADR 007). One SSE route for both clients: an `Authorization`
 * header selects an agent stream (version gate, then bearer token, never a cookie fallback), otherwise the session
 * cookie selects a site stream. Durable events carry their outbox id; transient ones carry `<cursor>.<k>` (AWS-39).
 */
export class StreamHub {
  readonly #deps: StreamHubDeps;
  readonly #connections = new Set<Connection>();
  readonly #sseConnections: UpDownCounter;

  constructor(deps: StreamHubDeps) {
    this.#deps = deps;
    this.#sseConnections = deps.meter.createUpDownCounter(INSTRUMENT_NAMES.sseConnections, {
      description: 'Open event streams, by stream kind.',
    });
  }

  /** Subscribes to the events a stream carries. Call once, at start-up, before the route receives requests. */
  subscribe(): void {
    for (const type of SUBSCRIBED_TYPES) {
      this.#deps.bus.subscribe(type, (event) => this.#dispatch(event));
    }
  }

  /** Closes every open stream (the test controls' reset). Each closed stream leaves the set through its `onClose`. */
  closeAll(): void {
    for (const connection of [...this.#connections]) {
      connection.close();
    }
  }

  /** Registers the route on the app. */
  register(app: FastifyInstance): void {
    app.get('/v1/stream', (request, reply) => this.#open(request, reply));
  }

  async #open(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    if (hasCredentialInQuery(request.query)) {
      return reply.code(400).send({ error: 'invalid-request' });
    }
    const principal = await this.#authenticate(request, reply);
    if (principal === undefined) {
      return reply;
    }
    const header = request.headers['last-event-id'];
    let afterId: bigint | undefined;
    if (header !== undefined) {
      const parsed = parseStreamId(String(header));
      if (!parsed.ok) {
        return reply.code(400).send({ error: 'invalid-stream-id' });
      }
      afterId = parsed.value.outboxId;
    }

    this.#makeRoomFor(principal);
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    });
    raw.flushHeaders();
    const connection = new Connection({
      principal,
      raw,
      cursor: afterId ?? 0n,
      replaying: afterId !== undefined,
      onClose: (closing) => {
        if (this.#connections.delete(closing)) {
          this.#sseConnections.add(-1, { [D2R_STREAM_KIND]: closing.principal.kind });
        }
      },
    });
    this.#connections.add(connection);
    this.#sseConnections.add(1, { [D2R_STREAM_KIND]: principal.kind });
    raw.on('close', () => {
      connection.close();
    });
    connection.track(
      this.#deps.scheduler.every(KEEP_ALIVE_MS, () => {
        connection.keepAlive();
      }),
    );
    if (principal.kind === 'site' && request.sessionExpiresAt !== undefined) {
      connection.track(
        this.#deps.scheduler.at(request.sessionExpiresAt, () => {
          connection.close();
        }),
      );
    }
    if (afterId !== undefined) {
      await this.#replay(connection, afterId);
    }
    return reply;
  }

  /** The agent or site principal of the request, or undefined after the guard has answered. */
  async #authenticate(request: FastifyRequest, reply: FastifyReply): Promise<Principal | undefined> {
    if (request.headers.authorization !== undefined) {
      await this.#deps.guards.requireAgentVersion(request, reply);
      if (reply.sent) {
        return undefined;
      }
      await this.#deps.guards.requireAgent(request, reply);
      if (reply.sent || request.agentId === undefined) {
        return undefined;
      }
      return { kind: 'agent', agentId: request.agentId };
    }
    await this.#deps.guards.requireSession(request, reply);
    if (reply.sent || request.accountId === undefined) {
      return undefined;
    }
    return { kind: 'site', accountId: request.accountId };
  }

  /** Closes the oldest streams of the same account or agent so that the new one is the sixth at most. */
  #makeRoomFor(principal: Principal): void {
    const sameKey = [...this.#connections].filter((connection) => connection.sameAs(principal));
    const excess = sameKey.length - (MAX_STREAMS_PER_KEY - 1);
    for (const oldest of sameKey.slice(0, Math.max(0, excess))) {
      oldest.close();
    }
  }

  /**
   * Sends the outbox rows after `afterId` in id order, projected for this stream, then ends the replay. Rows are read
   * from the outbox, so a reconnect gets what was published while the client was away (AWS-28).
   */
  async #replay(connection: Connection, afterId: bigint): Promise<void> {
    try {
      const rows = await this.#deps.db
        .selectFrom('platform.outbox')
        .select(['id', 'event_type', 'payload'])
        .where('id', '>', afterId.toString())
        .where('failed_at', 'is', null)
        .where('event_type', 'in', [...STREAMED_DURABLE_TYPES])
        .orderBy('id')
        .execute();
      for (const row of rows) {
        if (connection.closed) {
          return;
        }
        const event = { type: row.event_type, payload: row.payload } as AnyDomainEvent;
        const deliveries = await projectStreamEvent(event, this.#deps.agents);
        connection.emit(BigInt(row.id), deliveries);
      }
      connection.endReplay();
    } catch {
      this.#deps.log.error(
        'stream replay failed on the database; closing the stream so the client reconnects',
      );
      connection.close();
    }
  }

  async #dispatch(event: BusEvent): Promise<void> {
    const domain = event.event;
    if (domain.type === 'AgentRevoked') {
      for (const connection of [...this.#connections]) {
        if (
          connection.principal.kind === 'agent' &&
          connection.principal.agentId === domain.payload.agentId
        ) {
          connection.close();
        }
      }
      return;
    }
    if (this.#connections.size === 0) {
      return;
    }
    const deliveries = await projectStreamEvent(domain, this.#deps.agents);
    const outboxId = event.kind === 'durable' ? event.id : undefined;
    for (const connection of [...this.#connections]) {
      if (connection.accepts(deliveries)) {
        this.#deliver(connection, outboxId, deliveries);
      }
    }
  }

  /** Hands the event to one accepting stream inside its delivery span, a child of the span that published it. */
  #deliver(connection: Connection, outboxId: bigint | undefined, deliveries: readonly Delivery[]): void {
    trace
      .getTracer(TRACER_NAME)
      .startActiveSpan(
        DELIVER_SPAN,
        { attributes: { [D2R_STREAM_KIND]: connection.principal.kind } },
        (span) => {
          try {
            connection.offer(outboxId, deliveries);
          } finally {
            span.end();
          }
        },
      );
  }
}
