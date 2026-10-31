// The Agents HTTP routes (design.md § Agents module): pairing, the one-time token claim, heartbeats and the site's view
// of its agent. Agent routes need `X-Agent-Version` (426 before auth, AWS-12) and a bearer token where they need one.
import {
  AgentView,
  ClaimRequest,
  ClaimResponse,
  ErrorResponse,
  Heartbeat,
  PairingCodeResponse,
} from '@d2rmm/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AgentsUseCases } from '../../application/agents-use-cases.ts';

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;

/** The guards this module needs, typed structurally: modules never import platform code (design.md § Platform). */
export interface AgentsRouteGuards {
  readonly requireAgentVersion: Guard;
  readonly requireAgent: Guard;
  readonly requireSession: Guard;
  readonly requireSameOrigin: Guard;
}

export interface AgentsRouteDeps {
  readonly useCases: Pick<
    AgentsUseCases,
    'requestPairingCode' | 'pairAgent' | 'claimToken' | 'authenticateAgent' | 'recordHeartbeat' | 'getMyAgent'
  >;
  readonly guards: AgentsRouteGuards;
}

/** The pairing code body of the site (`POST /v1/agents/pair`). Any other value is an unknown code: `invalid-code`. */
const PairRequest = z.object({ code: z.string().min(1).max(16) });

/** Retry-After for a limited pairing-code request: the one-hour window (AD-041), an upper bound. */
const IP_CODE_RETRY_AFTER_SECONDS = 60 * 60;
/** Retry-After for a limited pair submission: the five-minute window (AD-032), an upper bound. */
const ACCOUNT_CODE_RETRY_AFTER_SECONDS = 5 * 60;

/** The bearer token of an Authorization header, or undefined. The guards read the same header on their side. */
function bearerTokenOf(authorization: string | undefined): string {
  return /^Bearer (\S+)$/i.exec(authorization ?? '')?.[1] ?? '';
}

/** Registers the five Agents routes. Claim and pairing-code responses are never cached (`Cache-Control: no-store`). */
export function agentsRoutes(app: FastifyInstance, deps: AgentsRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { useCases, guards } = deps;

  typed.post(
    '/v1/agents/pairing-codes',
    {
      preHandler: [guards.requireAgentVersion],
      schema: { response: { 201: PairingCodeResponse, 429: ErrorResponse } },
    },
    async (request, reply) => {
      const issued = await useCases.requestPairingCode({ ip: request.ip });
      if (!issued.ok) {
        return reply
          .header('cache-control', 'no-store')
          .header('retry-after', IP_CODE_RETRY_AFTER_SECONDS)
          .code(429)
          .send({ error: 'rate-limited' });
      }
      return reply.header('cache-control', 'no-store').code(201).send({
        code: issued.value.code,
        expiresAt: issued.value.expiresAt.toISOString(),
        claimSecret: issued.value.claimSecret,
      });
    },
  );

  typed.post(
    '/v1/agents/pairing-codes/claim',
    {
      preHandler: [guards.requireAgentVersion],
      schema: {
        body: ClaimRequest,
        response: {
          200: ClaimResponse,
          202: z.object({ status: z.literal('pending') }),
          410: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const outcome = await useCases.claimToken({ claimSecret: request.body.claimSecret });
      reply.header('cache-control', 'no-store');
      if (outcome.state === 'pending') {
        return reply.code(202).send({ status: 'pending' as const });
      }
      if (outcome.state === 'gone') {
        return reply.code(410).send({ error: 'gone' });
      }
      return reply.code(200).send({ token: outcome.token });
    },
  );

  typed.post(
    '/v1/agents/pair',
    {
      preHandler: [guards.requireSameOrigin, guards.requireSession],
      schema: {
        body: PairRequest,
        response: { 200: AgentView, 400: ErrorResponse, 401: ErrorResponse, 429: ErrorResponse },
      },
    },
    async (request, reply) => {
      const accountId = request.accountId;
      if (accountId === undefined) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      const paired = await useCases.pairAgent({ accountId, code: request.body.code });
      if (!paired.ok) {
        if (paired.error === 'rate-limited') {
          return reply
            .header('retry-after', ACCOUNT_CODE_RETRY_AFTER_SECONDS)
            .code(429)
            .send({ error: 'rate-limited' });
        }
        return reply.code(400).send({ error: 'invalid-code' });
      }
      const view = await useCases.getMyAgent({ accountId });
      return reply.code(200).send(toAgentView(view));
    },
  );

  typed.post(
    '/v1/agents/heartbeat',
    {
      preHandler: [guards.requireAgentVersion, guards.requireAgent],
      schema: {
        body: Heartbeat,
        response: { 204: z.null(), 400: ErrorResponse, 401: ErrorResponse },
      },
    },
    async (request, reply) => {
      // The guard resolved the token into the token cache; this second resolution is a cache hit, so the heartbeat
      // issues no SQL (AWS-33). It supplies the account the presence is kept for.
      const identity = await useCases.authenticateAgent({
        token: bearerTokenOf(request.headers.authorization),
      });
      if (!identity.ok) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      await useCases.recordHeartbeat({
        agentId: identity.value.agentId,
        accountId: identity.value.accountId,
        gameRunning: request.body.game.running,
        screen: request.body.game.screen,
      });
      return reply.code(204).send(null);
    },
  );

  typed.get(
    '/v1/agents/me',
    {
      preHandler: [guards.requireSession],
      schema: { response: { 200: AgentView, 401: ErrorResponse } },
    },
    async (request, reply) => {
      const accountId = request.accountId;
      if (accountId === undefined) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      return reply.code(200).send(toAgentView(await useCases.getMyAgent({ accountId })));
    },
  );
}

/** Maps the use case view to the contract: dates become ISO strings, which the response serializer requires. */
function toAgentView(view: Awaited<ReturnType<AgentsUseCases['getMyAgent']>>): z.infer<typeof AgentView> {
  if (view.status === 'none') {
    return { status: 'none' };
  }
  return {
    status: 'paired',
    agentId: view.agentId,
    online: view.online,
    gameRunning: view.gameRunning,
    screen: view.screen,
    lastSeenAt: view.lastSeenAt === null ? null : view.lastSeenAt.toISOString(),
  };
}
