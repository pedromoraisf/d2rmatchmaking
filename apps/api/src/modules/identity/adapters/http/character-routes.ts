// The character HTTP routes (design.md § Identity module): the agent posts the cards it read, the signed-in player lists them.
import { ErrorResponse, MyCharactersResponse, RecordCharactersRequest } from '@d2rmm/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AgentsPort } from '../../../agents/index.ts';
import type { CharacterUseCases } from '../../application/character-use-cases.ts';

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;

/** The guards this module needs, typed structurally: modules never import platform code (design.md § Platform). */
export interface CharacterRouteGuards {
  readonly requireAgentVersion: Guard;
  readonly requireAgent: Guard;
  readonly requireSession: Guard;
}

export interface CharacterRouteDeps {
  readonly useCases: CharacterUseCases;
  /** The agent's account comes from the Agents module's public port, never from its tables (CHR-09). */
  readonly agents: Pick<AgentsPort, 'accountOfAgent'>;
  readonly guards: CharacterRouteGuards;
}

/** Registers `POST /v1/me/characters` (agent token) and `GET /v1/me/characters` (session). */
export function characterRoutes(app: FastifyInstance, deps: CharacterRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { useCases, agents, guards } = deps;

  typed.post(
    '/v1/me/characters',
    {
      preHandler: [guards.requireAgentVersion, guards.requireAgent],
      schema: {
        body: RecordCharactersRequest,
        response: { 204: z.null(), 400: ErrorResponse, 401: ErrorResponse },
      },
    },
    async (request, reply) => {
      const agentId = request.agentId;
      const accountId = agentId === undefined ? null : await agents.accountOfAgent(agentId);
      if (accountId === null) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      const recorded = await useCases.recordCharacters({ accountId, characters: request.body.characters });
      if (!recorded.ok) {
        return reply.code(400).send({ error: recorded.error });
      }
      return reply.code(204).send(null);
    },
  );

  typed.get(
    '/v1/me/characters',
    {
      preHandler: [guards.requireSession],
      schema: { response: { 200: MyCharactersResponse, 401: ErrorResponse } },
    },
    async (request, reply) => {
      if (request.accountId === undefined) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      const stored = await useCases.listMyCharacters({ accountId: request.accountId });
      return reply.code(200).send({
        characters: stored.map((character) => ({
          name: character.name,
          class: character.class,
          level: character.level,
          ladder: character.ladder,
          era: character.era,
          unlockedDifficulties: [...character.unlockedDifficulties],
          readAt: character.readAt.toISOString(),
        })),
      });
    },
  );
}
