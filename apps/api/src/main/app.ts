// `buildApp(deps)`: the one HTTP application both composition roots and the OpenAPI generator build (design.md §
// Composition roots). Providers arrive through `AppDeps`; this file wires the modules, the platform and the routes.
import cookie from '@fastify/cookie';
import swagger from '@fastify/swagger';
import { ConfigResponse } from '@d2rmm/contracts';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import type { Writable } from 'node:stream';
import { z } from 'zod';
import type { AgentsPort } from '../modules/agents/index.ts';
import { MemoryAgentTokenCache } from '../modules/agents/adapters/memory/memory-agent-token-cache.ts';
import { MemoryPresenceStore } from '../modules/agents/adapters/memory/memory-presence-store.ts';
import { MemoryRateLimitStore } from '../modules/agents/adapters/memory/memory-rate-limit-store.ts';
import { PostgresAgentRepository } from '../modules/agents/adapters/postgres/postgres-agent-repository.ts';
import { PostgresPairingCodeRepository } from '../modules/agents/adapters/postgres/postgres-pairing-code-repository.ts';
import type { AgentsDatabase } from '../modules/agents/adapters/postgres/schema.ts';
import { createAgentsUseCases } from '../modules/agents/application/agents-use-cases.ts';
import type { IdentityPort } from '../modules/identity/index.ts';
import { PostgresAccountRepository } from '../modules/identity/adapters/postgres/postgres-account-repository.ts';
import { PostgresSessionRepository } from '../modules/identity/adapters/postgres/postgres-session-repository.ts';
import { Sha256SecretHasher } from '../modules/identity/adapters/postgres/sha256-secret-hasher.ts';
import type { IdentityDatabase } from '../modules/identity/adapters/postgres/schema.ts';
import { createIdentityUseCases } from '../modules/identity/application/identity-use-cases.ts';
import { InMemoryEventBus } from '../platform/event-bus.ts';
import { createGuards } from '../platform/http/guards.ts';
import { OutboxRelay } from '../platform/outbox-relay.ts';
import type { PlatformDatabase } from '../platform/postgres/database.ts';
import { PostgresOutbox } from '../platform/postgres/outbox.ts';
import { PostgresUnitOfWork } from '../platform/postgres/unit-of-work.ts';
import { StreamHub } from '../platform/stream-hub.ts';
import type { Clock, IdGenerator, RandomSource, Scheduler } from '../shared-kernel/index.ts';

/** Every table of the API. One Kysely instance serves every module; each module reads only its own schema. */
export type AppDatabase = PlatformDatabase & IdentityDatabase & AgentsDatabase;

/** How often the Agents sweep runs: presence offline marks and rate-limit pruning (design.md § Agents module). */
const SWEEP_EVERY_MS = 1_000;

/** Log fields that may carry a credential: redacted from every log line (design.md § Composition roots). */
const REDACTED_LOG_PATHS = ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'];

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
  /** Called once per dead-lettered outbox row. Defaults to a console error with the id and type. */
  readonly onDeadLetter?: (outboxId: string, eventType: string) => void;
}

export interface BuiltApp {
  readonly app: FastifyInstance;
  /** The outbox relay. The composition root calls `sweep()` once the app listens (the start-up sweep). */
  readonly relay: OutboxRelay;
  readonly bus: InMemoryEventBus;
  /** The in-memory stores of the process (ADR 006): the only state outside Postgres. */
  readonly stores: {
    readonly presence: MemoryPresenceStore;
    readonly rateLimits: MemoryRateLimitStore;
    readonly tokenCache: MemoryAgentTokenCache;
  };
}

/** A database failure answers 503 `unavailable` (design.md § Error Handling). Driver errors carry a code or a pool message. */
function isDatabaseFailure(error: FastifyError): boolean {
  const code: unknown = error.code;
  const driverCode = typeof code === 'string' && !code.startsWith('FST_');
  return driverCode || /pool|connect/i.test(error.message);
}

/** Maps every error to the contract's `{ error }` body. Messages are never sent: they can echo values (codes, names). */
function answerError(error: FastifyError, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  if (hasZodFastifySchemaValidationErrors(error)) {
    const fields = [...new Set((error.validation ?? []).map((issue) => issue.instancePath.slice(1)))];
    return reply.code(400).send({ error: 'invalid-request', fields });
  }
  const status = error.statusCode ?? 500;
  if (status < 500) {
    const code =
      status === 413 ? 'payload-too-large' : status === 415 ? 'unsupported-media-type' : 'invalid-request';
    return reply.code(status).send({ error: code });
  }
  request.log.warn({ errorName: error.name, errorCode: error.code }, 'request failed');
  if (isDatabaseFailure(error)) {
    return reply.code(503).send({ error: 'unavailable' });
  }
  return reply.code(500).send({ error: 'internal' });
}

/**
 * Builds the HTTP app: Zod validation and serialization, cookies, the OpenAPI document, the guards, every module and
 * the platform. Starts nothing: the relay's start-up sweep and the listening socket belong to the composition root.
 */
export async function buildApp(deps: AppDeps): Promise<BuiltApp> {
  const { db, config, clock, scheduler, random, ids } = deps;
  const bus = new InMemoryEventBus();
  const outbox = new PostgresOutbox(clock);
  const relay = new OutboxRelay({
    db: db as unknown as Kysely<PlatformDatabase>,
    bus,
    scheduler,
    clock,
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
    authenticateAgent: (token) => agents.authenticateAgent({ token }),
    accountOfAgent: agents.accountOfAgent,
    currentAgentOf: agents.currentAgentOf,
  };
  const guards = createGuards({
    identity: identityPort,
    agents: agentsPort,
    agentMinVersion: config.minAgentVersion,
    siteOrigin: config.siteOrigin,
  });

  bus.subscribe('AgentRevoked', agents.evictRevokedAgent);
  const hub = new StreamHub({
    db: db as unknown as Kysely<PlatformDatabase>,
    bus,
    agents: agentsPort,
    guards,
    scheduler,
  });
  hub.subscribe();

  const stopSweep = scheduler.every(SWEEP_EVERY_MS, () => {
    void agents.sweep().catch(() => {
      console.error('agents sweep failed; it runs again in one second');
    });
  });

  // Trust the first `TRUST_PROXY_HOPS` proxies only: `request.ip` is the first address past them, so a forged left-most
  // X-Forwarded-For never becomes the client address (AWS-09, design.md § Security controls).
  const app = Fastify({
    trustProxy: (_address: string, hop: number) => hop < config.trustProxyHops,
    logger: {
      level: 'info',
      redact: { paths: REDACTED_LOG_PATHS, censor: '[redacted]' },
      ...(deps.logSink === undefined ? {} : { stream: deps.logSink }),
    },
  });
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

  const typed = app.withTypeProvider<ZodTypeProvider>();
  typed.get('/healthz', { schema: { response: { 200: z.object({ status: z.literal('ok') }) } } }, () => ({
    status: 'ok' as const,
  }));
  typed.get('/v1/config', { schema: { response: { 200: ConfigResponse } } }, () => ({
    stagingEndpoints: config.stagingEndpoints,
    minAgentVersion: config.minAgentVersion,
  }));
  hub.register(app);

  return { app, relay, bus, stores };
}
