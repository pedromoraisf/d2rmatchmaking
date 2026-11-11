// The queue HTTP routes (design.md § Contracts): joining, leaving and reading the account's waiting ticket (QUE-01 …
// QUE-06, QUE-13). Every route needs the site session; the two that change the queue also need the site's origin.
import {
  ErrorResponse,
  Id,
  JoinQueueRequest,
  MyQueueTicketResponse,
  QueueRefusal,
  QueueTicketView,
} from '@d2rmm/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { QueueUseCases } from '../../application/queue-use-cases.ts';

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;

export interface QueueRouteGuards {
  readonly requireSession: Guard;
  readonly requireSameOrigin: Guard;
}

export interface QueueRouteDeps {
  readonly useCases: QueueUseCases;
  readonly guards: QueueRouteGuards;
}

/** The refusals that answer 409: the player already has a ticket or a room. Every other refusal answers 422. */
const CONFLICT_REFUSALS: ReadonlySet<string> = new Set(['already-queued', 'in-room']);

/** The status of a refused join (QUE-18): 429 for the joins limit, 409 for a ticket or room already held, else 422. */
export function joinRefusalStatus(refusal: string): 409 | 422 | 429 {
  if (refusal === 'too-many-joins') {
    return 429;
  }
  return CONFLICT_REFUSALS.has(refusal) ? 409 : 422;
}

/**
 * Registers `POST /v1/queue/tickets` (201 with the ticket, or 409/422 with the refusal), `DELETE /v1/queue/tickets/:id`
 * (204, or 404 for a ticket that is not the player's) and `GET /v1/queue/tickets/me` (200 with the ticket or null). The
 * same-origin guard requires a JSON body on the two changing routes, so the site sends `{}` on the delete.
 */
export function queueRoutes(app: FastifyInstance, deps: QueueRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { useCases, guards } = deps;

  typed.post(
    '/v1/queue/tickets',
    {
      preHandler: [guards.requireSameOrigin, guards.requireSession],
      schema: {
        body: JoinQueueRequest,
        response: {
          201: QueueTicketView,
          401: ErrorResponse,
          409: QueueRefusal,
          422: QueueRefusal,
          429: QueueRefusal,
        },
      },
    },
    async (request, reply) => {
      if (request.accountId === undefined) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      const joined = await useCases.joinQueue({ accountId: request.accountId, request: request.body });
      if (!joined.ok) {
        // A ready-check penalty carries the whole seconds left (RDY-05); every other refusal is its code alone.
        if (typeof joined.error === 'string') {
          return reply.code(joinRefusalStatus(joined.error)).send({ error: joined.error });
        }
        return reply.code(422).send({ error: joined.error.error, secondsLeft: joined.error.secondsLeft });
      }
      return reply.code(201).send(joined.value);
    },
  );

  typed.delete(
    '/v1/queue/tickets/:id',
    {
      preHandler: [guards.requireSameOrigin, guards.requireSession],
      schema: {
        params: z.object({ id: Id }),
        response: { 204: z.null(), 401: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request, reply) => {
      if (request.accountId === undefined) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      const left = await useCases.leaveQueue({ accountId: request.accountId, ticketId: request.params.id });
      if (!left.ok) {
        return reply.code(404).send({ error: 'not-found' });
      }
      return reply.code(204).send(null);
    },
  );

  typed.get(
    '/v1/queue/tickets/me',
    {
      preHandler: [guards.requireSession],
      schema: { response: { 200: MyQueueTicketResponse, 401: ErrorResponse } },
    },
    async (request, reply) => {
      if (request.accountId === undefined) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      const ticket = await useCases.myTicket({ accountId: request.accountId });
      return reply.code(200).send({ ticket });
    },
  );
}
