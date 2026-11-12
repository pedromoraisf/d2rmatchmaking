// The Lobby Room HTTP routes (design.md § Lobby Room module): an agent's observation of its room, the agent's
// assignment and the site's view of its room. The observation body is capped at 4 KB (AWS-23).
import { Assignment, ErrorResponse, Id, Observation, RoomActionRequest, RoomView } from '@d2rmm/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type {
  LobbyRoomUseCases,
  RoomActionError,
  RoomSnapshot,
} from '../../application/lobby-room-use-cases.ts';

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;

/** The guards this module needs, typed structurally: modules never import platform code (design.md § Platform). */
export interface LobbyRouteGuards {
  readonly requireAgentVersion: Guard;
  readonly requireAgent: Guard;
  readonly requireSession: Guard;
  readonly requireSameOrigin: Guard;
}

export interface LobbyRouteDeps {
  readonly useCases: Pick<
    LobbyRoomUseCases,
    'recordObservation' | 'getCurrentRoom' | 'getAssignment' | 'openNextRun' | 'leaveRoom' | 'closeRoom'
  >;
  readonly guards: LobbyRouteGuards;
}

/** The observation body limit (AWS-23): a larger body answers 413 before it is parsed. */
export const OBSERVATION_BODY_LIMIT_BYTES = 4 * 1024;

/** The status each refusal of a room action answers: not the player's room 404, not the host 403, wrong stage 409. */
export function statusOfRoomAction(error: RoomActionError): 404 | 403 | 409 {
  switch (error) {
    case 'not-found':
      return 404;
    case 'forbidden':
      return 403;
    case 'conflict':
      return 409;
  }
}

/** Registers the observation, assignment and site room routes. */
export function lobbyRoomRoutes(app: FastifyInstance, deps: LobbyRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { useCases, guards } = deps;

  typed.post(
    '/v1/lobby-rooms/:id/observations',
    {
      bodyLimit: OBSERVATION_BODY_LIMIT_BYTES,
      preHandler: [guards.requireAgentVersion, guards.requireAgent],
      schema: {
        params: z.object({ id: Id }),
        body: Observation,
        response: {
          202: z.object({ stored: z.boolean() }),
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const agentId = request.agentId;
      if (agentId === undefined) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      const { body } = request;
      const recorded = await useCases.recordObservation({
        agentId,
        roomId: request.params.id,
        body: {
          idempotencyKey: body.idempotencyKey,
          type: body.type,
          run: body.run,
          value: body.value,
          confidence: body.confidence,
          capturedAt: new Date(body.capturedAt),
        },
      });
      if (!recorded.ok) {
        if (recorded.error === 'forbidden') {
          return reply.code(403).send({ error: 'forbidden' });
        }
        return reply.code(400).send({ error: 'invalid-observation' });
      }
      return reply.code(202).send({ stored: recorded.value.stored });
    },
  );

  typed.get(
    '/v1/agents/me/assignment',
    {
      preHandler: [guards.requireAgentVersion, guards.requireAgent],
      schema: {
        response: { 200: Assignment, 401: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request, reply) => {
      const agentId = request.agentId;
      if (agentId === undefined) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      const assignment = await useCases.getAssignment({ agentId });
      if (assignment === null) {
        return reply.code(404).send({ error: 'no-assignment' });
      }
      return reply.code(200).send({
        roomId: assignment.roomId,
        run: assignment.run,
        expectedGameName: assignment.expectedGameName,
        members: [...assignment.members],
      });
    },
  );

  typed.get(
    '/v1/me/room',
    {
      preHandler: [guards.requireSession],
      schema: {
        response: { 200: RoomView, 401: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request, reply) => {
      const accountId = request.accountId;
      if (accountId === undefined) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      const room: RoomSnapshot | null = await useCases.getCurrentRoom({ accountId });
      if (room === null) {
        return reply.code(404).send({ error: 'no-room' });
      }
      return reply.code(200).send({ ...room, members: [...room.members], runs: [...room.runs] });
    },
  );

  const actions = [
    { path: 'runs', use: useCases.openNextRun },
    { path: 'leave', use: useCases.leaveRoom },
    { path: 'close', use: useCases.closeRoom },
  ] as const;
  for (const action of actions) {
    typed.post(
      `/v1/lobby-rooms/:id/${action.path}`,
      {
        preHandler: [guards.requireSameOrigin, guards.requireSession],
        schema: {
          params: z.object({ id: Id }),
          body: RoomActionRequest,
          response: {
            204: z.null(),
            401: ErrorResponse,
            403: ErrorResponse,
            404: ErrorResponse,
            409: ErrorResponse,
          },
        },
      },
      async (request, reply) => {
        if (request.accountId === undefined) {
          return reply.code(401).send({ error: 'unauthenticated' });
        }
        const done = await action.use({ accountId: request.accountId, roomId: request.params.id });
        if (!done.ok) {
          return reply.code(statusOfRoomAction(done.error)).send({ error: done.error });
        }
        return reply.code(204).send(null);
      },
    );
  }
}
