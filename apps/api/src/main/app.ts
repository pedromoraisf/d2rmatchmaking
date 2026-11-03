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
import type { LobbyDatabase } from '../modules/lobby-room/adapters/postgres/schema.ts';
import { OtelRoomMetrics } from '../modules/lobby-room/adapters/telemetry/otel-room-metrics.ts';
import { createLobbyRoomUseCases } from '../modules/lobby-room/index.ts';
import { matchmakingRoutes } from '../modules/matchmaking/adapters/http/routes.ts';
import { createMatchmakingUseCases } from '../modules/matchmaking/index.ts';
import { MemoryAgentTokenCache } from '../modules/agents/adapters/memory/memory-agent-token-cache.ts';
import { MemoryPresenceStore } from '../modules/agents/adapters/memory/memory-presence-store.ts';
import { MemoryRateLimitStore } from '../modules/agents/adapters/memory/memory-rate-limit-store.ts';
import { PostgresAgentRepository } from '../modules/agents/adapters/postgres/postgres-agent-repository.ts';
import { PostgresPairingCodeRepository } from '../modules/agents/adapters/postgres/postgres-pairing-code-repository.ts';
import type { AgentsDatabase } from '../modules/agents/adapters/postgres/schema.ts';
import { createAgentsUseCases } from '../modules/agents/application/agents-use-cases.ts';
import type { IdentityPort } from '../modules/identity/index.ts';
import { identityRoutes } from '../modules/identity/adapters/http/routes.ts';
import { PostgresAccountRepository } from '../modules/identity/adapters/postgres/postgres-account-repository.ts';
import { PostgresSessionRepository } from '../modules/identity/adapters/postgres/postgres-session-repository.ts';
import { Sha256SecretHasher } from '../modules/identity/adapters/postgres/sha256-secret-hasher.ts';
import type { IdentityDatabase } from '../modules/identity/adapters/postgres/schema.ts';
import { createIdentityUseCases } from '../modules/identity/application/identity-use-cases.ts';
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
import type { Clock, IdGenerator, RandomSource, Scheduler } from '../shared-kernel/index.ts';

/** Every table of the API. One Kysely instance serves every module; each module reads only its own schema. */
export type AppDatabase = PlatformDatabase & IdentityDatabase & AgentsDatabase & LobbyDatabase;

/** How often the Agents sweep runs: presence offline marks and rate-limit pruning (design.md § Agents module). */
const SWEEP_EVERY_MS = 1_000;

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

/** The Fastify logger of the app: credentials redacted, and every line carries the trace fields (OBS-26). */
export function appLoggerOptions(sink?: Writable) {
  return {
    level: 'info',
    redact: { paths: REDACTED_LOG_PATHS, censor: '[redacted]' },
    mixin: traceFields,
    ...(sink === undefined ? {} : { stream: sink }),
  };
}

export interface AppConfig {
  readonly stagingEndpoints: boolean;
  readonly minAgentVersion: string;
  readonly siteOrigin: string;
  readonly trustProxyHops: number;
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
  /** The in-memory stores of the process (ADR 006): the only state outside Postgres. */
  readonly stores: {
    readonly presence: MemoryPresenceStore;
    readonly rateLimits: MemoryRateLimitStore;
    readonly tokenCache: MemoryAgentTokenCache;
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

  const identity = createIdentityUseCases({
    accounts: new PostgresAccountRepository(db as unknown as Kysely<IdentityDatabase>, clock),
    sessions: new PostgresSessionRepository(db as unknown as Kysely<IdentityDatabase>),
    hasher,
    clock,
    random,
    ids,
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
  }));
  identityRoutes(app, { useCases: identity, guards, stagingEndpoints: config.stagingEndpoints });
  agentsRoutes(app, { useCases: agents, guards });
  lobbyRoomRoutes(app, { useCases: lobby, guards });
  matchmakingRoutes(app, { useCases: matchmaking, guards, stagingEndpoints: config.stagingEndpoints });
  hub.register(app);

  return { app, relay, bus, hub, stores };
}
