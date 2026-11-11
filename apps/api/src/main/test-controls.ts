// The test controls of the acceptance stack (design.md § Composition roots, AD-045, AD-062): `POST /__test/reset`,
// `POST /__test/clock` and `POST /__test/redeliver-match-formed` (the at-least-once redelivery of AWS-20). Only `local.ts`
// registers them, and only when `D2RMM_ACCEPTANCE=true`; `render.ts` never does, and they are never in `openapi.json`.
import { timingSafeEqual } from 'node:crypto';
import { ErrorResponse } from '@d2rmm/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import type { AnyDomainEvent, Clock, EventBus } from '../shared-kernel/index.ts';
import type { AppDatabase } from './app.ts';

/** The header that carries `TEST_CONTROL_SECRET` (the acceptance stack generates it per run). */
export const TEST_CONTROL_HEADER = 'x-test-control';

/** Reset and redelivery run only on a per-worker acceptance database and only on loopback (AD-045). */
const ACCEPTANCE_DATABASE = /^acc_w\d+$/;
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1']);

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
  };
  readonly hub: { closeAll(): void };
  readonly relay: { sweep(): Promise<void> };
  /** The bus the redelivery publishes on: the one the relay and the consumers of this process share (AD-062). */
  readonly bus: EventBus;
}

/** True when the process is connected to a per-worker acceptance database on loopback (AD-045). */
function onAcceptanceDatabase(deps: TestControlDeps): boolean {
  return ACCEPTANCE_DATABASE.test(deps.database.name) && LOOPBACK_HOSTS.has(deps.database.host);
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
  'platform.outbox',
] as const;

/** Constant-time comparison of the presented secret with the configured one. */
function secretMatches(presented: unknown, expected: string): boolean {
  if (typeof presented !== 'string') {
    return false;
  }
  const given = Buffer.from(presented);
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/** Registers the three control routes. Call before the app listens. */
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
      schema: { response: { 204: z.null(), 403: ErrorResponse } },
    },
    async (_request, reply) => {
      if (!onAcceptanceDatabase(deps)) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      await sql`truncate table ${sql.raw(TABLES.join(', '))} restart identity cascade`.execute(deps.db);
      await sql`alter sequence lobby.game_name_seq restart with 1`.execute(deps.db);
      deps.stores.presence.clear();
      deps.stores.rateLimits.clear();
      deps.stores.tokenCache.clear();
      deps.stores.queue.clear();
      deps.hub.closeAll();
      await deps.relay.sweep();
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
