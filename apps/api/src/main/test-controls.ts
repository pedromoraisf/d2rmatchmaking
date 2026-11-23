// The test controls of the acceptance stack (design.md § Composition roots, AD-045, AD-062): `POST /__test/reset`,
// `POST /__test/clock`, `POST /__test/redeliver-match-formed` (the at-least-once redelivery of AWS-20) and the site-stream
// controls of QUE-05 (`GET /__test/site-streams/:accountId`, `POST /__test/site-streams/:accountId/close`) and the remote
// configuration control of remote-config (`PUT /__test/agent-config`, RCF-05, RCF-06). Only `local.ts`
// registers them, and only when `D2RMM_ACCEPTANCE=true`; `render.ts` never does, and they are never in `openapi.json`.
import { timingSafeEqual } from 'node:crypto';
import { AGENT_CONFIG_MAX_BYTES, ErrorResponse } from '@d2rmm/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import { digestOf } from '../modules/agents/adapters/file/agent-config-file.ts';
import { servedConfigOf, type ServedAgentConfig } from '../modules/agents/domain/agent-config.ts';
import type { AnyDomainEvent, Clock, EventBus } from '../shared-kernel/index.ts';
import type { AppDatabase } from './app.ts';

/** The header that carries `TEST_CONTROL_SECRET` (the acceptance stack generates it per run). */
export const TEST_CONTROL_HEADER = 'x-test-control';

/** Reset and redelivery run only on a per-worker acceptance database and only on loopback (AD-045). */
const ACCEPTANCE_DATABASE = /^acc_w\d+$/;
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1']);

/** The largest text the agent-config control serves: twice the contract's 64 KiB, so a scenario can send one over it. */
const MAX_AGENT_CONFIG_TEXT = AGENT_CONFIG_MAX_BYTES * 2;

/** Largest clock advance in one call: one year. Scenarios move time by days, never by more. */
const MAX_ADVANCE_MS = 365 * 24 * 60 * 60 * 1000;

/** A clock that moves only when a test moves it (`POST /__test/clock`). Every read copies the date. */
export class ControllableClock implements Clock {
  #now: number;

  constructor(start: Date) {
    this.#now = start.getTime();
  }

  now(): Date {
    return new Date(this.#now);
  }

  advance(ms: number): void {
    this.#now += ms;
  }
}

/** A memory store the reset empties. */
export interface ClearableStore {
  clear(): void;
}

export interface TestControlDeps {
  readonly db: Kysely<AppDatabase>;
  readonly clock: ControllableClock;
  /** `TEST_CONTROL_SECRET`: every control request must present it in `X-Test-Control`. */
  readonly secret: string;
  /** The database the process is connected to: reset refuses unless it is an acceptance database on loopback. */
  readonly database: { readonly name: string; readonly host: string };
  readonly stores: {
    readonly presence: ClearableStore;
    readonly rateLimits: ClearableStore;
    readonly tokenCache: ClearableStore;
    /** The waiting queue (queues QUE-01 … QUE-14): a scenario starts with nobody queued. */
    readonly queue: ClearableStore;
    /** The joins attempted per account (QUE-18): a scenario starts with no attempt counted. */
    readonly joins: ClearableStore;
    /** The open ready checks (RDY-09): a scenario starts with none open. */
    readonly readyChecks: ClearableStore;
    /** The served remote configuration: reset puts the committed document back; the control replaces it. */
    readonly agentConfig: {
      replace(served: ServedAgentConfig | undefined): void;
      reset(): void;
    };
  };
  readonly hub: {
    closeAll(): void;
    /** The open site streams of an account (QUE-05): the site-streams control reads it. */
    siteStreamCount(accountId: string): number;
    /** Closes the open site streams of an account, as a dropped connection would (QUE-05, QUE-14). */
    closeSiteStreams(accountId: string): number;
  };
  readonly relay: { sweep(): Promise<void>; quiesce(): Promise<void> };
  /** The scheduled database jobs (matcher, sweeps, site-closed drops): paused, and awaited, for the length of a reset. */
  readonly background: { pause(): Promise<void>; resume(): void };
  /** The pending site-closed drops: reset cancels them, after the streams close (QUE-14). */
  readonly siteClosedTimers: ClearableStore;
  /** The bus the redelivery publishes on: the one the relay and the consumers of this process share (AD-062). */
  readonly bus: EventBus;
}

/** True when the process is connected to a per-worker acceptance database on loopback (AD-045). */
function onAcceptanceDatabase(deps: TestControlDeps): boolean {
  return ACCEPTANCE_DATABASE.test(deps.database.name) && LOOPBACK_HOSTS.has(deps.database.host);
}

/**
 * What reset stops before it touches the database: the streams and the pending site-closed drops write to the database
 * when they fire, so a drop alive during the truncate holds row locks the truncate queues behind, and its next
 * statement queues behind the truncate (40P01, answered 503). Closing the streams schedules their drops, so the timers
 * are cleared after the close.
 */
export function stopLeftoverWork(deps: Pick<TestControlDeps, 'hub' | 'siteClosedTimers'>): void {
  deps.hub.closeAll();
  deps.siteClosedTimers.clear();
}

/** Every table of the API, truncated in one statement by reset (design.md § Data Models). */
const TABLES = [
  'identity.sessions',
  'identity.accounts',
  'agents.pairing_codes',
  'agents.agents',
  'lobby.observations',
  'lobby.runs',
  'lobby.members',
  'lobby.rooms',
  'matchmaking.penalties',
  'platform.outbox',
] as const;

type ResetStep = 'stop' | 'quiesce' | 'truncate' | 'sequence' | 'stores' | 'sweep';

const ResetFailureResponse = z.object({
  error: z.literal('reset-failed'),
  step: z.string(),
  pgCode: z.string().optional(),
});

/** The 503 body of a failed reset: the step and the Postgres error code only, never a message or data. */
export function resetFailure(error: unknown, step: string): z.infer<typeof ResetFailureResponse> {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return {
    error: 'reset-failed',
    step,
    ...(typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? { pgCode: code } : {}),
  };
}

/** Constant-time comparison of the presented secret with the configured one. */
function secretMatches(presented: unknown, expected: string): boolean {
  if (typeof presented !== 'string') {
    return false;
  }
  const given = Buffer.from(presented);
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/** Registers the control routes. Call before the app listens. */
export function registerTestControls(app: FastifyInstance, deps: TestControlDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  const requireSecret = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply | undefined> => {
    if (!secretMatches(request.headers[TEST_CONTROL_HEADER], deps.secret)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    return undefined;
  };

  typed.post(
    '/__test/reset',
    {
      preHandler: [requireSecret],
      schema: { response: { 204: z.null(), 403: ErrorResponse, 503: ResetFailureResponse } },
    },
    async (request, reply) => {
      if (!onAcceptanceDatabase(deps)) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      let step: ResetStep = 'stop';
      try {
        stopLeftoverWork(deps);
        // A drain still running from the last scenario holds locks the truncate needs (see OutboxRelay.quiesce).
        step = 'quiesce';
        // The clock advance of the last scenario started jobs that outlive its step: stop them, and wait for the ones
        // that are writing, before the truncate (they would hold locks it queues behind: 40P01).
        await deps.background.pause();
        await deps.relay.quiesce();
        step = 'truncate';
        await sql`truncate table ${sql.raw(TABLES.join(', '))} restart identity cascade`.execute(deps.db);
        step = 'sequence';
        await sql`alter sequence lobby.game_name_seq restart with 1`.execute(deps.db);
        step = 'stores';
        deps.stores.presence.clear();
        deps.stores.rateLimits.clear();
        deps.stores.tokenCache.clear();
        deps.stores.queue.clear();
        deps.stores.joins.clear();
        deps.stores.readyChecks.clear();
        deps.stores.agentConfig.reset();
        step = 'sweep';
        await deps.relay.sweep();
      } catch (error) {
        // Test controls only: names the database error (40P01 deadlock, 55P03 lock timeout…) a bare 503 hides.
        const code = (error as { code?: unknown }).code;
        request.log.error({ errorCode: code, message: (error as Error).message }, 'acceptance reset failed');
        return reply.code(503).send(resetFailure(error, step));
      } finally {
        deps.background.resume();
      }
      return reply.code(204).send(null);
    },
  );

  typed.post(
    '/__test/clock',
    {
      preHandler: [requireSecret],
      schema: {
        body: z.object({ advanceMs: z.number().int().min(0).max(MAX_ADVANCE_MS) }),
        response: { 204: z.null(), 403: ErrorResponse },
      },
    },
    async (request, reply) => {
      deps.clock.advance(request.body.advanceMs);
      return reply.code(204).send(null);
    },
  );

  // QUE-05 (acceptance): the site streams of one account. The browser's own close is not reliable enough to wait on, so a
  // scenario that says "has closed the site" closes them here, through the same path a dropped connection takes.
  typed.get(
    '/__test/site-streams/:accountId',
    {
      preHandler: [requireSecret],
      schema: {
        params: z.object({ accountId: z.string().min(1) }),
        response: { 200: z.object({ open: z.number().int().min(0) }), 403: ErrorResponse },
      },
    },
    async (request, reply) => {
      return reply.code(200).send({ open: deps.hub.siteStreamCount(request.params.accountId) });
    },
  );

  typed.post(
    '/__test/site-streams/:accountId/close',
    {
      preHandler: [requireSecret],
      schema: {
        params: z.object({ accountId: z.string().min(1) }),
        response: { 200: z.object({ closed: z.number().int().min(0) }), 403: ErrorResponse },
      },
    },
    async (request, reply) => {
      return reply.code(200).send({ closed: deps.hub.closeSiteStreams(request.params.accountId) });
    },
  );

  // RCF-05, RCF-06 (acceptance): what `GET /v1/agents/config` serves, as raw text. A scenario needs a value outside its
  // range, an unknown field or a body that is not JSON, none of which the committed file may hold. `body: null` serves
  // nothing (404); `version` is the version the ETag names. Reset puts the committed document back.
  typed.put(
    '/__test/agent-config',
    {
      preHandler: [requireSecret],
      schema: {
        body: z.object({
          version: z.number().int().min(1).max(2147483647).optional(),
          body: z.string().max(MAX_AGENT_CONFIG_TEXT).nullable(),
        }),
        response: { 204: z.null(), 403: ErrorResponse },
      },
    },
    async (request, reply) => {
      // Like reset: only on a per-worker acceptance database on loopback (AD-045), never on any other database.
      if (!onAcceptanceDatabase(deps)) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const { body, version } = request.body;
      deps.stores.agentConfig.replace(
        body === null ? undefined : servedConfigOf(version ?? 1, body, digestOf(body)),
      );
      return reply.code(204).send(null);
    },
  );

  // AD-062: the relay's at-least-once redelivery, on demand. The real consumers run on the bus, so a repeated match
  // must not make a second room (AWS-20). Guards run in reset's order, before the outbox is read.
  typed.post(
    '/__test/redeliver-match-formed',
    {
      preHandler: [requireSecret],
      schema: { response: { 204: z.null(), 403: ErrorResponse, 404: ErrorResponse } },
    },
    async (_request, reply) => {
      if (!onAcceptanceDatabase(deps)) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const row = await deps.db
        .selectFrom('platform.outbox')
        .select(['id', 'event_type', 'payload'])
        .where('event_type', '=', 'MatchFormed')
        .orderBy('id', 'desc')
        .limit(1)
        .executeTakeFirst();
      if (row === undefined) {
        return reply.code(404).send({ error: 'no-match' });
      }
      // The same call the relay makes in its #publish (outbox-relay.ts): the original outbox id and the stored payload.
      const event = { type: row.event_type, payload: row.payload } as AnyDomainEvent;
      await deps.bus.publish({ kind: 'durable', id: BigInt(row.id), event });
      return reply.code(204).send(null);
    },
  );
}
