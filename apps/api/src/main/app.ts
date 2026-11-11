// `buildApp(deps)`: the one HTTP application both composition roots and the OpenAPI generator build (design.md §
// Composition roots). Providers arrive through `AppDeps`; this file wires the modules, the platform and the routes.
import cookie from '@fastify/cookie';
import swagger from '@fastify/swagger';
import { ConfigResponse } from '@d2rmm/contracts';
import { APP_METER_NAME } from '@d2rmm/telemetry';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { isSpanContextValid, metrics, trace } from '@opentelemetry/api';
import type { Kysely } from 'kysely';
import type { Writable } from 'node:stream';
import { z } from 'zod';
import type { AgentsPort } from '../modules/agents/index.ts';
import { agentsRoutes } from '../modules/agents/adapters/http/routes.ts';
import { lobbyRoomRoutes } from '../modules/lobby-room/adapters/http/routes.ts';
import { PostgresGameNameSequence } from '../modules/lobby-room/adapters/postgres/postgres-game-name-sequence.ts';
import { PostgresLobbyRoomRepository } from '../modules/lobby-room/adapters/postgres/postgres-lobby-room-repository.ts';
import { PostgresObservationRepository } from '../modules/lobby-room/adapters/postgres/postgres-observation-repository.ts';
import { PostgresRoomTraceContexts } from '../modules/lobby-room/adapters/postgres/postgres-room-trace-contexts.ts';
import type { LobbyDatabase } from '../modules/lobby-room/adapters/postgres/schema.ts';
import { OtelRoomMetrics } from '../modules/lobby-room/adapters/telemetry/otel-room-metrics.ts';
import { createLobbyRoomUseCases } from '../modules/lobby-room/index.ts';
import { matchmakingRoutes } from '../modules/matchmaking/adapters/http/routes.ts';
import { queueRoutes } from '../modules/matchmaking/adapters/http/queue-routes.ts';
import { readyCheckRoutes } from '../modules/matchmaking/adapters/http/ready-check-routes.ts';
import { MemoryQueueStore } from '../modules/matchmaking/adapters/memory/memory-queue-store.ts';
import { MemoryJoinLimitStore } from '../modules/matchmaking/adapters/memory/memory-join-limit-store.ts';
import { MemoryReadyCheckStore } from '../modules/matchmaking/adapters/memory/memory-ready-check-store.ts';
import { PostgresPenaltyStore } from '../modules/matchmaking/adapters/postgres/postgres-penalty-store.ts';
import type { MatchmakingDatabase } from '../modules/matchmaking/adapters/postgres/schema.ts';
import { JOIN_LIMIT } from '../modules/matchmaking/domain/queue-limits.ts';
import { OtelQueueMetrics } from '../modules/matchmaking/adapters/telemetry/otel-queue-metrics.ts';
import { createMatchmakingUseCases, createQueueUseCases } from '../modules/matchmaking/index.ts';
import { MemoryAgentTokenCache } from '../modules/agents/adapters/memory/memory-agent-token-cache.ts';
import { MemoryPresenceStore } from '../modules/agents/adapters/memory/memory-presence-store.ts';
import { MemoryRateLimitStore } from '../modules/agents/adapters/memory/memory-rate-limit-store.ts';
import { PostgresAgentRepository } from '../modules/agents/adapters/postgres/postgres-agent-repository.ts';
import { PostgresPairingCodeRepository } from '../modules/agents/adapters/postgres/postgres-pairing-code-repository.ts';
import type { AgentsDatabase } from '../modules/agents/adapters/postgres/schema.ts';
import { createAgentsUseCases } from '../modules/agents/application/agents-use-cases.ts';
import type { IdentityPort } from '../modules/identity/index.ts';
import { characterRoutes } from '../modules/identity/adapters/http/character-routes.ts';
import { identityRoutes } from '../modules/identity/adapters/http/routes.ts';
import { PostgresAccountRepository } from '../modules/identity/adapters/postgres/postgres-account-repository.ts';
import { PostgresCharacterRepository } from '../modules/identity/adapters/postgres/postgres-character-repository.ts';
import { PostgresSessionRepository } from '../modules/identity/adapters/postgres/postgres-session-repository.ts';
import { Sha256SecretHasher } from '../modules/identity/adapters/postgres/sha256-secret-hasher.ts';
import type { IdentityDatabase } from '../modules/identity/adapters/postgres/schema.ts';
import { FetchBattleNetOAuth } from '../modules/identity/adapters/bnet/fetch-battle-net-oauth.ts';
import { UnconfiguredBattleNetOAuth } from '../modules/identity/adapters/bnet/unconfigured-battle-net-oauth.ts';
import { createCharacterUseCases } from '../modules/identity/application/character-use-cases.ts';
import { createIdentityUseCases } from '../modules/identity/application/identity-use-cases.ts';
import type { BnetSettings } from './config.ts';
import { atMostOnePerMinute } from '../platform/error-log.ts';
import { InMemoryEventBus } from '../platform/event-bus.ts';
import { answerError } from '../platform/http/answer-error.ts';
import { registerRequestMetrics } from '../platform/http/request-metrics.ts';
import { registerOutboxLag } from '../platform/outbox-lag.ts';
import { createGuards } from '../platform/http/guards.ts';
import { Forwarder } from '../platform/http/relay-forwarder.ts';
import { RelayBudget } from '../platform/http/relay-budget.ts';
import { RelayLimiter } from '../platform/http/relay-limiter.ts';
import { telemetryRelayPlugin } from '../platform/http/telemetry-relay.ts';
import { OutboxRelay } from '../platform/outbox-relay.ts';
import type { PlatformDatabase } from '../platform/postgres/database.ts';
import { PostgresOutbox } from '../platform/postgres/outbox.ts';
import { PostgresUnitOfWork } from '../platform/postgres/unit-of-work.ts';
import { StreamHub } from '../platform/stream-hub.ts';
import type { Cancel, Clock, IdGenerator, RandomSource, Scheduler } from '../shared-kernel/index.ts';

/** Every table of the API. One Kysely instance serves every module; each module reads only its own schema. */
export type AppDatabase = PlatformDatabase & IdentityDatabase & AgentsDatabase & LobbyDatabase;

/** How often the Agents sweep runs: presence offline marks and rate-limit pruning (design.md § Agents module). */
const SWEEP_EVERY_MS = 1_000;
/** How often the queue's matcher runs (QUE-11: when a ticket joins and every second). */
const MATCHER_EVERY_MS = 1_000;
/** How long a player's site stream may stay closed before the queue drops their ticket (QUE-14). */
const SITE_CLOSED_DROP_MS = 30_000;
/** How often the Lobby Room expires rooms and drops absent members (LBR-05, LBR-08). */
const ROOM_SWEEP_EVERY_MS = 1_000;
/** The default drop tolerance of a member whose agent or site stream is away (LBR-08). */
const DEFAULT_DROP_TOLERANCE_SECONDS = 60;
/** The rating every character is banded on until Ranking exists (ADR 018, the queue's spec decisions). */
const INITIAL_RATING = 1500;

/** Log fields that may carry a credential: redacted from every log line (design.md § Composition roots). */
const REDACTED_LOG_PATHS = ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'];

/** The trace fields of a log line: the active span's ids, and none outside a span (OBS-26). */
export function traceFields(): Record<string, string> {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (spanContext === undefined || !isSpanContextValid(spanContext)) {
    return {};
  }
  return { trace_id: spanContext.traceId, span_id: spanContext.spanId };
}

/** The request fields a log line of a request carries: Fastify's default set, with the URL cut at its query (IDB-11). */
interface RequestLike {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, unknown>>;
  readonly host: string;
  readonly ip: string;
  readonly socket: { readonly remotePort: number | undefined } | undefined;
}

/** The request's path without its query string or fragment: the callback's `code` and `state` never reach a log line. */
export function pathOf(rawUrl: string): string {
  const cut = rawUrl.search(/[?#]/);
  return cut === -1 ? rawUrl : rawUrl.slice(0, cut);
}

/** The `req` serializer of the app logger: Fastify's default fields, with `url` reduced to the path (IDB-11). */
export function requestLogFieldsOf(request: RequestLike) {
  const version = request.headers['accept-version'];
  const remotePort = request.socket?.remotePort;
  return {
    method: request.method,
    url: pathOf(request.url),
    ...(typeof version === 'string' ? { version } : {}),
    host: request.host,
    remoteAddress: request.ip,
    ...(remotePort === undefined ? {} : { remotePort }),
  };
}

/** The Fastify logger of the app: credentials redacted, the query kept out of request lines, and every line carries the trace fields (OBS-26). */
export function appLoggerOptions(sink?: Writable) {
  return {
    level: 'info',
    redact: { paths: REDACTED_LOG_PATHS, censor: '[redacted]' },
    serializers: { req: requestLogFieldsOf },
    mixin: traceFields,
    ...(sink === undefined ? {} : { stream: sink }),
  };
}

export interface AppConfig {
  readonly stagingEndpoints: boolean;
  readonly minAgentVersion: string;
  readonly siteOrigin: string;
  readonly trustProxyHops: number;
  /** `ROOM_DROP_TOLERANCE_SECONDS`: how long a member may be away before they leave their room. Default 60 (LBR-08). */
  readonly roomDropToleranceSeconds?: number | undefined;
  /** Battle.net sign-in settings (`BNET_*`, main/config.ts). Undefined: the login and callback routes answer 404. */
  readonly bnet?: BnetSettings | undefined;
}

export interface AppDeps {
  readonly db: Kysely<AppDatabase>;
  readonly config: AppConfig;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly random: RandomSource;
  readonly ids: IdGenerator;
  /** Where log lines go. Defaults to standard output. */
  readonly logSink?: Writable;
  /** Called once per dead-lettered outbox row. Defaults to a log error with the id and type. */
  readonly onDeadLetter?: (outboxId: string, eventType: string) => void;
  /** Where the telemetry relay forwards (OBS-15). Defaults to no endpoint: every forward is dropped. */
  readonly telemetryBackend?: TelemetryBackend;
}

/** The OTLP backend the relay forwards to, from the `OTEL_EXPORTER_OTLP_*` settings (main/config.ts). */
export interface TelemetryBackend {
  /** `OTEL_EXPORTER_OTLP_ENDPOINT`, or undefined: then every forward is dropped. */
  readonly endpoint: string | undefined;
  /** `OTEL_EXPORTER_OTLP_HEADERS`: the backend credentials, sent on forwards only. */
  readonly headers: Readonly<Record<string, string>>;
}

export interface BuiltApp {
  readonly app: FastifyInstance;
  /** The outbox relay. The composition root calls `sweep()` once the app listens (the start-up sweep). */
  readonly relay: OutboxRelay;
  readonly bus: InMemoryEventBus;
  /** The open event streams. The test controls close them on reset. */
  readonly hub: StreamHub;
  /** The pending site-closed drops (QUE-14). The test controls cancel them on reset. */
  readonly siteClosedTimers: { clear(): void };
  /** The in-memory stores of the process (ADR 006): the only state outside Postgres. */
  readonly stores: {
    readonly presence: MemoryPresenceStore;
    readonly rateLimits: MemoryRateLimitStore;
    readonly tokenCache: MemoryAgentTokenCache;
    readonly queue: MemoryQueueStore;
    /** The joins attempted per account (QUE-18): a scenario starts with no attempt counted. */
    readonly joins: MemoryJoinLimitStore;
    /** The open ready checks (RDY-09): a scenario starts with none open. */
    readonly readyChecks: MemoryReadyCheckStore;
  };
}

/**
 * Builds the HTTP app: Zod validation and serialization, cookies, the OpenAPI document, the guards, every module and
 * the platform. Starts nothing: the relay's start-up sweep and the listening socket belong to the composition root.
 */
export async function buildApp(deps: AppDeps): Promise<BuiltApp> {
  const { db, config, clock, scheduler, random, ids } = deps;
  // Trust the first `TRUST_PROXY_HOPS` proxies only: `request.ip` is the first address past them, so a forged left-most
  // X-Forwarded-For never becomes the client address (AWS-09, design.md § Security controls). The app is created first:
  // the relay and the stream hub log through its logger.
  const app = Fastify({
    trustProxy: (_address: string, hop: number) => hop < config.trustProxyHops,
    logger: appLoggerOptions(deps.logSink),
  });
  const bus = new InMemoryEventBus();
  const outbox = new PostgresOutbox(clock);
  const relay = new OutboxRelay({
    db: db as unknown as Kysely<PlatformDatabase>,
    bus,
    scheduler,
    clock,
    log: app.log,
    ...(deps.onDeadLetter === undefined ? {} : { onDeadLetter: deps.onDeadLetter }),
  });
  const uow = new PostgresUnitOfWork(db as unknown as Kysely<PlatformDatabase>, outbox, relay);
  const stores = {
    presence: new MemoryPresenceStore(),
    rateLimits: new MemoryRateLimitStore(),
    tokenCache: new MemoryAgentTokenCache(),
  };
  const hasher = new Sha256SecretHasher();
  // Battle.net is reached only when both client settings are configured; the routes answer 404 otherwise (IDB-06).
  const battleNet =
    config.bnet === undefined
      ? new UnconfiguredBattleNetOAuth()
      : new FetchBattleNetOAuth({
          baseUrl: config.bnet.baseUrl,
          clientId: config.bnet.clientId,
          clientSecret: config.bnet.clientSecret,
          fetch: (url, init) => fetch(url, init),
        });

  const identity = createIdentityUseCases({
    accounts: new PostgresAccountRepository(db as unknown as Kysely<IdentityDatabase>, clock),
    sessions: new PostgresSessionRepository(db as unknown as Kysely<IdentityDatabase>),
    hasher,
    clock,
    random,
    ids,
    battleNet,
    stagingEndpoints: config.stagingEndpoints,
  });
  const characters = createCharacterUseCases({
    characters: new PostgresCharacterRepository(db as unknown as Kysely<IdentityDatabase>),
    uow,
    outbox,
    clock,
  });
  const agents = createAgentsUseCases({
    agents: new PostgresAgentRepository(db as unknown as Kysely<AgentsDatabase>, clock),
    codes: new PostgresPairingCodeRepository(db as unknown as Kysely<AgentsDatabase>, clock),
    rateLimits: stores.rateLimits,
    hasher,
    clock,
    random,
    ids,
    uow,
    bus,
    cache: stores.tokenCache,
    presence: stores.presence,
  });

  const identityPort: IdentityPort = {
    authenticateSession: (token) => identity.authenticateSession(token),
  };
  const agentsPort: AgentsPort = {
    authenticateAgent: (token, opts) => agents.authenticateAgent({ token }, opts),
    accountOfAgent: agents.accountOfAgent,
    currentAgentOf: agents.currentAgentOf,
  };
  const guards = createGuards({
    identity: identityPort,
    agents: agentsPort,
    agentMinVersion: config.minAgentVersion,
    siteOrigin: config.siteOrigin,
    clock,
  });

  bus.subscribe('AgentRevoked', agents.evictRevokedAgent);

  // When each account's last site stream closed (kept while no stream of the account is open): the Lobby Room's drop
  // tolerance counts from it (LBR-08). `hub` is created below; the connectivity port reads it only when called.
  const siteClosedAt = new Map<string, Date>();
  // The Lobby Room opens one room per `MatchFormed` it consumes (AWS-19, idempotent by match id).
  const lobby = createLobbyRoomUseCases({
    rooms: new PostgresLobbyRoomRepository(db as unknown as Kysely<LobbyDatabase>, clock),
    observations: new PostgresObservationRepository(db as unknown as Kysely<LobbyDatabase>, clock),
    sequence: new PostgresGameNameSequence(db as unknown as Kysely<LobbyDatabase>),
    agents: agentsPort,
    ids,
    uow,
    outbox,
    clock,
    roomMetrics: new OtelRoomMetrics(metrics.getMeter(APP_METER_NAME)),
    traceContexts: new PostgresRoomTraceContexts(db as unknown as Kysely<LobbyDatabase>),
    connectivity: {
      agentOfflineSince: agents.agentOfflineSinceOf,
      siteStreamClosedSince: (accountId) =>
        hub.hasSiteStream(accountId) ? null : (siteClosedAt.get(accountId) ?? null),
    },
    characters: {
      characterOf: async (accountId, characterId) => {
        const facts = await characters.characterOf(accountId, characterId);
        return facts === null ? null : { characterClass: facts.characterClass, level: facts.level };
      },
    },
    dropToleranceMs: (config.roomDropToleranceSeconds ?? DEFAULT_DROP_TOLERANCE_SECONDS) * 1000,
  });
  const matchmaking = createMatchmakingUseCases({ ids, uow, outbox });
  bus.subscribe('MatchFormed', async (event) => {
    if (event.event.type === 'MatchFormed') {
      await lobby.onMatchFormed(event.event.payload);
    }
  });
  const hub = new StreamHub({
    db: db as unknown as Kysely<PlatformDatabase>,
    bus,
    agents: agentsPort,
    guards,
    scheduler,
    log: app.log,
    meter: metrics.getMeter(APP_METER_NAME),
  });
  hub.subscribe();
  // A host whose agent has a stream open receives `room.assigned` live: the room waits for the host (LBR-02). An agent
  // that is not connected yet fetches the assignment instead (GET /v1/agents/me/assignment).
  bus.subscribe('RoomAssignmentChanged', async (event) => {
    if (event.event.type !== 'RoomAssignmentChanged') {
      return;
    }
    const host = event.event.payload.members.find((member) => member.role === 'host');
    const agentId = host === undefined ? null : await agentsPort.currentAgentOf(host.accountId);
    if (host !== undefined && agentId !== null && hub.hasAgentStream(agentId)) {
      await lobby.onAssignmentDelivered({ accountId: host.accountId });
    }
  });

  // The queue (QUE-01 … QUE-16): in memory (ADR 006). Its ports are the public methods of the other modules and the hub.
  const queueStore = new MemoryQueueStore();
  const joinLimits = new MemoryJoinLimitStore(JOIN_LIMIT);
  const readyChecks = new MemoryReadyCheckStore();
  const penalties = new PostgresPenaltyStore(db as unknown as Kysely<MatchmakingDatabase>);
  const queue = createQueueUseCases({
    store: queueStore,
    joinLimits,
    characters: { characterOf: characters.characterOf },
    presence: { isOnline: agents.agentOnlineOf },
    links: { isLinked: identity.isLinked },
    sites: { hasSiteStream: async (accountId) => hub.hasSiteStream(accountId) },
    rooms: { hasOpenRoom: lobby.hasOpenRoom },
    ratings: { ratingOf: async () => INITIAL_RATING },
    checks: readyChecks,
    penalties,
    scheduler,
    onError: (error) => {
      app.log.error({ err: error }, 'a ready check deadline failed; the check was not settled');
    },
    ids,
    clock,
    uow,
    outbox,
    bus,
    metrics: new OtelQueueMetrics(metrics.getMeter(APP_METER_NAME)),
  });
  // A player's agent going offline or being revoked takes the ticket out of the queue (QUE-14).
  bus.subscribe('AgentPresenceChanged', async (event) => {
    if (event.event.type === 'AgentPresenceChanged' && !event.event.payload.online) {
      await queue.dropTicket({ accountId: event.event.payload.accountId, reason: 'agent-offline' });
    }
  });
  bus.subscribe('AgentRevoked', async (event) => {
    if (event.event.type === 'AgentRevoked') {
      await queue.dropTicket({ accountId: event.event.payload.accountId, reason: 'agent-revoked' });
    }
  });
  // A site stream that stays closed for 30 seconds takes the ticket out of the queue; a reconnect in time keeps it (QUE-14).
  const siteClosedClocks = new Map<string, Cancel>();
  // Cancels every pending 30-second drop: the test controls' reset calls it so no timer of a scenario fires in the next.
  const siteClosedTimers = {
    clear(): void {
      for (const cancel of siteClosedClocks.values()) {
        cancel();
      }
      siteClosedClocks.clear();
    },
  };
  hub.onSiteStreamsClosed((accountId) => {
    siteClosedAt.set(accountId, clock.now());
    siteClosedClocks.get(accountId)?.();
    const cancel = scheduler.at(new Date(clock.now().getTime() + SITE_CLOSED_DROP_MS), () => {
      siteClosedClocks.delete(accountId);
      if (!hub.hasSiteStream(accountId)) {
        queue.dropTicket({ accountId, reason: 'site-closed' }).catch(() => {
          app.log.error('dropping a queue ticket after the site closed failed');
        });
      }
    });
    siteClosedClocks.set(accountId, cancel);
  });
  const stopMatcher = scheduler.every(MATCHER_EVERY_MS, () => {
    void queue.runMatcher().catch(() => {
      app.log.error('queue matcher run failed; it runs again in one second');
    });
  });

  // Rooms expire 3 minutes after they wait for the host, and members who stayed away for the tolerance leave (LBR-05, LBR-08).
  // One sweep at a time: a tick that finds the previous one still reading the database does nothing, so a clock that
  // jumps (a test advancing days) never queues thousands of queries.
  let roomSweepRunning = false;
  const stopRoomSweep = scheduler.every(ROOM_SWEEP_EVERY_MS, () => {
    if (roomSweepRunning) {
      return;
    }
    roomSweepRunning = true;
    void lobby
      .expireRooms()
      .then(() => lobby.dropAbsentMembers())
      .catch(() => {
        app.log.error('room sweep failed; it runs again in one second');
      })
      .finally(() => {
        roomSweepRunning = false;
      });
  });

  const stopSweep = scheduler.every(SWEEP_EVERY_MS, () => {
    void agents.sweep().catch(() => {
      app.log.error('agents sweep failed; it runs again in one second');
    });
  });

  registerRequestMetrics(app, metrics.getMeter(APP_METER_NAME));
  registerOutboxLag(metrics.getMeter(APP_METER_NAME), db as unknown as Kysely<PlatformDatabase>, clock);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(answerError);
  app.addHook('onClose', () => {
    stopSweep();
    stopMatcher();
    stopRoomSweep();
    siteClosedTimers.clear();
  });
  await app.register(cookie);
  await app.register(swagger, {
    openapi: { openapi: '3.1.0', info: { title: 'D2R Match Making API', version: '0.0.0' } },
    transform: jsonSchemaTransform,
  });
  // The relay's forwarder logs at most one line a minute when the backend is down (OBS-37).
  const backend = deps.telemetryBackend ?? { endpoint: undefined, headers: {} };
  await app.register(telemetryRelayPlugin, {
    guards,
    limiter: new RelayLimiter(clock),
    budget: new RelayBudget(clock),
    forwarder: new Forwarder({
      endpoint: backend.endpoint,
      credentials: backend.headers,
      fetch: (url, init) => fetch(url, init),
      log: atMostOnePerMinute(app.log, clock),
    }),
    clock,
    scheduler,
  });

  const typed = app.withTypeProvider<ZodTypeProvider>();
  typed.get('/healthz', { schema: { response: { 200: z.object({ status: z.literal('ok') }) } } }, () => ({
    status: 'ok' as const,
  }));
  typed.get('/v1/config', { schema: { response: { 200: ConfigResponse } } }, () => ({
    stagingEndpoints: config.stagingEndpoints,
    minAgentVersion: config.minAgentVersion,
    bnetSignIn: config.bnet !== undefined,
  }));
  identityRoutes(app, {
    useCases: identity,
    guards,
    stagingEndpoints: config.stagingEndpoints,
    bnet: { enabled: config.bnet !== undefined, oauth: battleNet, siteOrigin: config.siteOrigin },
    clock,
    random,
  });
  characterRoutes(app, { useCases: characters, agents: agentsPort, guards });
  agentsRoutes(app, { useCases: agents, guards });
  lobbyRoomRoutes(app, { useCases: lobby, guards });
  matchmakingRoutes(app, { useCases: matchmaking, guards, stagingEndpoints: config.stagingEndpoints });
  queueRoutes(app, { useCases: queue, guards });
  readyCheckRoutes(app, { useCases: queue, guards });
  hub.register(app);

  return {
    app,
    relay,
    bus,
    hub,
    siteClosedTimers,
    stores: { ...stores, queue: queueStore, joins: joinLimits, readyChecks },
  };
}
