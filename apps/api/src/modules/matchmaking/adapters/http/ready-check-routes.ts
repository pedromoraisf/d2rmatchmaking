// The ready-check answer routes (RDY-02, RDY-04, RDY-06, RDY-07): a member accepts or declines. Accepting also takes the
// agent's bearer token, so the agent's hotkey calls the same route (RDY-07); declining is the site's alone.
import {
  ErrorResponse,
  Id,
  ReadyCheckAnswerRefusal,
  type ReadyCheckAnswerRefusalCode,
} from '@d2rmm/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { QueueUseCases } from '../../application/queue-use-cases.ts';

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;

export interface ReadyCheckRouteGuards {
  /** A bearer token of an active agent, or the site's session cookie on the site's origin (the relay's guard). */
  readonly requireAgentOrSite: Guard;
  readonly requireSameOrigin: Guard;
  readonly requireSession: Guard;
}

export interface ReadyCheckRouteDeps {
  readonly useCases: Pick<QueueUseCases, 'answerReadyCheck'>;
  readonly guards: ReadyCheckRouteGuards;
}

/**
 * The status of a refused answer (RDY-06): 404 for a player who is not in the check, 409 for a check that ended, or an
 * answer already given. Pure, so the mapping has its own unit tests.
 */
export function readyCheckRefusalStatus(refusal: ReadyCheckAnswerRefusalCode): 404 | 409 {
  return refusal === 'not-found' ? 404 : 409;
}

/**
 * Registers `POST /v1/ready-checks/:id/accept` (204, or 404/409 with the refusal) and `.../decline` (204, or 404/409). The
 * account is the agent's when the bearer token is an agent's, otherwise the session's.
 */
export function readyCheckRoutes(app: FastifyInstance, deps: ReadyCheckRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { useCases, guards } = deps;
  const params = z.object({ id: Id });

  typed.post(
    '/v1/ready-checks/:id/accept',
    {
      preHandler: [guards.requireAgentOrSite],
      schema: {
        params,
        response: {
          204: z.null(),
          401: ErrorResponse,
          404: ReadyCheckAnswerRefusal,
          409: ReadyCheckAnswerRefusal,
        },
      },
    },
    async (request, reply) => {
      const accountId = request.agentAccountId ?? request.accountId;
      if (accountId === undefined) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      const answered = await useCases.answerReadyCheck({
        accountId,
        checkId: request.params.id,
        answer: 'accept',
      });
      if (!answered.ok) {
        return reply.code(readyCheckRefusalStatus(answered.error)).send({ error: answered.error });
      }
      return reply.code(204).send(null);
    },
  );

  typed.post(
    '/v1/ready-checks/:id/decline',
    {
      preHandler: [guards.requireSameOrigin, guards.requireSession],
      schema: {
        params,
        response: {
          204: z.null(),
          401: ErrorResponse,
          404: ReadyCheckAnswerRefusal,
          409: ReadyCheckAnswerRefusal,
        },
      },
    },
    async (request, reply) => {
      const accountId = request.accountId;
      if (accountId === undefined) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      const answered = await useCases.answerReadyCheck({
        accountId,
        checkId: request.params.id,
        answer: 'decline',
      });
      if (!answered.ok) {
        return reply.code(readyCheckRefusalStatus(answered.error)).send({ error: answered.error });
      }
      return reply.code(204).send(null);
    },
  );
}
