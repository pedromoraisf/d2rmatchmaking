// The Identity HTTP routes (design.md § Identity module): test sign-in on staging and the signed-in player's account.
import { ErrorResponse, MeResponse, TestLoginRequest } from '@d2rmm/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { IdentityUseCases } from '../../application/identity-use-cases.ts';

/** The session cookie: `__Host-` (host-only, Secure, Path=/, never a Domain attribute). Same name as platform/http. */
export const SESSION_COOKIE_NAME = '__Host-d2rmm_session';

/** Seven days, in seconds: the session lifetime of the cookie (design.md § Identity module). */
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;

/** The guards this module needs, typed structurally: modules never import platform code (design.md § Platform). */
export interface IdentityRouteGuards {
  readonly requireSession: Guard;
  readonly requireSameOrigin: Guard;
}

export interface IdentityRouteDeps {
  readonly useCases: Pick<IdentityUseCases, 'signInTestAccount' | 'getMe'>;
  readonly guards: IdentityRouteGuards;
  /** Test sign-in exists only when staging endpoints are on (AWS-03): otherwise the route answers 404. */
  readonly stagingEndpoints: boolean;
}

/** Registers `POST /v1/auth/test-login` (staging only) and `GET /v1/me`. */
export function identityRoutes(app: FastifyInstance, deps: IdentityRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  if (deps.stagingEndpoints) {
    typed.post(
      '/v1/auth/test-login',
      {
        preHandler: [deps.guards.requireSameOrigin],
        schema: { body: TestLoginRequest, response: { 200: MeResponse, 400: ErrorResponse } },
      },
      async (request, reply) => {
        const signedIn = await deps.useCases.signInTestAccount({ name: request.body.name });
        if (!signedIn.ok) {
          return reply.code(400).send({ error: 'invalid-player-name' });
        }
        reply.setCookie(SESSION_COOKIE_NAME, signedIn.value.sessionToken, {
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          path: '/',
          maxAge: SESSION_MAX_AGE_SECONDS,
        });
        return reply
          .code(200)
          .send({ accountId: signedIn.value.accountId, displayName: signedIn.value.displayName });
      },
    );
  }

  typed.get(
    '/v1/me',
    {
      preHandler: [deps.guards.requireSession],
      schema: { response: { 200: MeResponse, 401: ErrorResponse } },
    },
    async (request, reply) => {
      if (request.accountId === undefined) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      const me = await deps.useCases.getMe({ accountId: request.accountId });
      if (!me.ok) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      return reply.code(200).send({ accountId: me.value.accountId, displayName: me.value.displayName });
    },
  );
}
