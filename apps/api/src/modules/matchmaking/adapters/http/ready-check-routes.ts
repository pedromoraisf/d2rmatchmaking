// The ready-check answer routes (RDY-02, RDY-04, RDY-06, RDY-07): a member accepts or declines. Accepting also takes the
// agent's bearer token, so the agent's hotkey calls the same route (RDY-07); declining is the site's alone.
import {
  ErrorResponse,
  Id,
  ReadyCheckAnswerRefusal,
  ReadyCheckView,
  type ReadyCheckAnswerRefusalCode,
} from '@d2rmm/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { QueueUseCases } from '../../application/queue-use-cases.ts';
import type { ReadyCheckChangedPayload } from '../../../../shared-kernel/index.ts';

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;

export interface ReadyCheckRouteGuards {
  /** A bearer token of an active agent, or the site's session cookie on the site's origin (the relay's guard). */
  readonly requireAgentOrSite: Guard;
  /** The minimum agent version (426, ADR 011) for an agent's request; every agent route applies it. */
  readonly requireAgentVersion: Guard;
  readonly requireSameOrigin: Guard;
  readonly requireSession: Guard;
}

export interface ReadyCheckRouteDeps {
  readonly useCases: Pick<QueueUseCases, 'answerReadyCheck' | 'openReadyCheckOf'>;
  readonly guards: ReadyCheckRouteGuards;
}

/**
 * The check as one member sees it: the members by position and class mark, the member's own mark as `you`, and no account
 * id (RDY-01, RDY-02). Pure, so the mapping has its own unit tests.
 */
export function readyCheckViewOf(payload: ReadyCheckChangedPayload, accountId: string) {
  return {
    id: payload.readyCheckId,
    mode: payload.mode,
    difficulty: payload.difficulty,
    deadline: payload.deadline,
    members: payload.members.map((member) => ({
      position: member.position,
      class: member.characterClass,
      level: member.level,
      accepted: member.accepted,
      you: member.accountId === accountId,
    })),
  };
}

/**
 * The read's guard: an agent's bearer token meets the minimum version (426) before the agent check; the site reads with
 * its session, which is not on the relay's lookup bucket (RDY-11).
 */
function readOwnerGuard(guards: ReadyCheckRouteGuards): Guard {
  return async (request, reply) => {
    if (request.headers.authorization !== undefined) {
      const versioned = await guards.requireAgentVersion(request, reply);
      if (versioned !== undefined) {
        return versioned;
      }
      return guards.requireAgentOrSite(request, reply);
    }
    return guards.requireSession(request, reply);
  };
}

/**
 * The accept route's guard. An agent's bearer token must meet the minimum agent version (426) and then passes the agent
 * check (RDY-07). The site's answer takes the session and the same-origin check, not the relay's lookup bucket: the
 * site's own telemetry draws on that bucket, and a click must not wait behind it (answered 429 in the acceptance run).
 */
function acceptGuard(guards: ReadyCheckRouteGuards): Guard {
  return async (request, reply) => {
    if (request.headers.authorization !== undefined) {
      const versioned = await guards.requireAgentVersion(request, reply);
      if (versioned !== undefined) {
        return versioned;
      }
      return guards.requireAgentOrSite(request, reply);
    }
    const sameOrigin = await guards.requireSameOrigin(request, reply);
    if (sameOrigin !== undefined) {
      return sameOrigin;
    }
    return guards.requireSession(request, reply);
  };
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

  // The open check of the caller: the agent's (bearer token, version gated) or the site's (session cookie).
  typed.get(
    '/v1/ready-checks/me',
    {
      preHandler: [readOwnerGuard(guards)],
      schema: { response: { 200: ReadyCheckView, 204: z.null(), 401: ErrorResponse, 426: ErrorResponse } },
    },
    async (request, reply) => {
      const accountId = request.agentAccountId ?? request.accountId;
      if (accountId === undefined) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      const open = await useCases.openReadyCheckOf({ accountId });
      if (open === null) {
        return reply.code(204).send(null);
      }
      return reply.code(200).send(readyCheckViewOf(open, accountId));
    },
  );

  typed.post(
    '/v1/ready-checks/:id/accept',
    {
      preHandler: [acceptGuard(guards)],
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
