// The Matchmaking HTTP route (design.md § Matchmaking module): the staging-only test match (AWS-19, AD-033).
import { ErrorResponse, Id } from '@d2rmm/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { MatchmakingUseCases } from '../../index.ts';

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;

export interface MatchmakingRouteGuards {
  readonly requireSameOrigin: Guard;
  readonly requireSession: Guard;
}

export interface MatchmakingRouteDeps {
  readonly useCases: Pick<MatchmakingUseCases, 'formTestMatch'>;
  readonly guards: MatchmakingRouteGuards;
  /** The route exists only when staging endpoints are on: otherwise it answers 404 (AWS-03). */
  readonly stagingEndpoints: boolean;
}

/**
 * Registers `POST /v1/staging/match-formed` (staging only, 202). The body is the empty JSON object: the same-origin
 * guard requires a JSON body on every non-GET route.
 */
export function matchmakingRoutes(app: FastifyInstance, deps: MatchmakingRouteDeps): void {
  if (!deps.stagingEndpoints) {
    return;
  }
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    '/v1/staging/match-formed',
    {
      preHandler: [deps.guards.requireSameOrigin, deps.guards.requireSession],
      schema: {
        body: z.object({}),
        response: { 202: z.object({ matchId: Id }), 401: ErrorResponse },
      },
    },
    async (request, reply) => {
      const accountId = request.accountId;
      if (accountId === undefined) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      const formed = await deps.useCases.formTestMatch({ accountId });
      return reply.code(202).send({ matchId: formed.matchId });
    },
  );
}
