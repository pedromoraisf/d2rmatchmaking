// The Identity HTTP routes (design.md § Identity module): test sign-in on staging, the Battle.net sign-in round trip,
// sign-out and the signed-in player's account.
import { ErrorResponse, MeResponse, TestLoginRequest } from '@d2rmm/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withRecordingSpan, type Clock, type RandomSource } from '../../../../shared-kernel/index.ts';
import type { IdentityUseCases } from '../../application/identity-use-cases.ts';
import {
  checkCallback,
  encodeOAuthAttempt,
  startOAuthAttempt,
  type CallbackFailure,
} from '../../application/oauth-state.ts';
import type { BattleNetOAuth } from '../../application/ports.ts';

/** The session cookie: `__Host-` (host-only, Secure, Path=/, never a Domain attribute). Same name as platform/http. */
export const SESSION_COOKIE_NAME = '__Host-d2rmm_session';

/** The state cookie of one Battle.net sign-in: `__Host-`, and it lives as long as the state is valid (IDB-01). */
export const OAUTH_COOKIE_NAME = '__Host-d2rmm_oauth';

/** Seven days, in seconds: the session lifetime of the cookie (design.md § Identity module). */
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** Ten minutes, in seconds: the lifetime of the state cookie (IDB-01). */
const OAUTH_MAX_AGE_SECONDS = 10 * 60;

/** The attributes of every cookie this module sets or clears: HttpOnly, Secure, SameSite=Lax, Path=/ (IDB-01, IDB-02). */
const SECURE_COOKIE = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;

/** Why a Battle.net sign-in failed: the callback's checks (IDB-04) or the two calls to Battle.net. */
export type BattleNetFailure = CallbackFailure | 'exchange-failed' | 'userinfo-failed';

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;

/** The guards this module needs, typed structurally: modules never import platform code (design.md § Platform). */
export interface IdentityRouteGuards {
  readonly requireSession: Guard;
  readonly requireSameOrigin: Guard;
}

/** The Battle.net sign-in settings of the routes. */
export interface BattleNetRouteDeps {
  /** True when both client settings are configured (IDB-06): otherwise the login and callback routes answer 404. */
  readonly enabled: boolean;
  /** The adapter's authorize URL; the callback's exchange goes through the use case. */
  readonly oauth: BattleNetOAuth;
  /** `SITE_ORIGIN`: the callback URI and every redirect to the site are built from it. */
  readonly siteOrigin: string;
}

export interface IdentityRouteDeps {
  readonly useCases: Pick<
    IdentityUseCases,
    'signInTestAccount' | 'signInWithBattleNet' | 'signOut' | 'getMe'
  >;
  readonly guards: IdentityRouteGuards;
  /** Test sign-in exists only when staging endpoints are on (AWS-03): otherwise the route answers 404. */
  readonly stagingEndpoints: boolean;
  readonly bnet: BattleNetRouteDeps;
  readonly clock: Clock;
  readonly random: RandomSource;
}

/** The callback URI registered with Battle.net: `<SITE_ORIGIN>/api/v1/auth/bnet/callback` (IDB-01). */
function redirectUriOf(siteOrigin: string): string {
  return `${siteOrigin}/api/v1/auth/bnet/callback`;
}

/** A query parameter as text, or undefined when it is absent or not a single string. */
function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** The query string as a record; anything else reads as no parameters. */
function queryOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...value } : {};
}

/** A redirect the browser follows with GET, never cached: the callback and the login answer with one. */
function redirectTo(reply: FastifyReply, location: string): FastifyReply {
  return reply.code(302).header('cache-control', 'no-store').header('location', location).send();
}

/**
 * Registers `POST /v1/auth/test-login` (staging only), the Battle.net sign-in round trip (`GET /v1/auth/bnet/login`,
 * `GET /v1/auth/bnet/callback`), `POST /v1/auth/logout` and `GET /v1/me`.
 */
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
          ...SECURE_COOKIE,
          maxAge: SESSION_MAX_AGE_SECONDS,
        });
        return reply
          .code(200)
          .send({ accountId: signedIn.value.accountId, displayName: signedIn.value.displayName });
      },
    );
  }

  typed.get('/v1/auth/bnet/login', { schema: { response: { 404: ErrorResponse } } }, (_request, reply) =>
    withRecordingSpan('identity.bnet-login', {}, async (span) => {
      if (!deps.bnet.enabled) {
        span.setAttribute('outcome', 'not-configured');
        return reply.code(404).send({ error: 'not-found' });
      }
      const attempt = startOAuthAttempt(deps.random, deps.clock.now());
      reply.setCookie(OAUTH_COOKIE_NAME, encodeOAuthAttempt(attempt), {
        ...SECURE_COOKIE,
        maxAge: OAUTH_MAX_AGE_SECONDS,
      });
      span.setAttribute('outcome', 'ok');
      return redirectTo(
        reply,
        deps.bnet.oauth.authorizeUrl({
          state: attempt.state,
          codeChallenge: attempt.codeChallenge,
          redirectUri: redirectUriOf(deps.bnet.siteOrigin),
        }),
      );
    }),
  );

  // No querystring schema: a callback with a malformed parameter must still be refused with a redirect (IDB-04), not a
  // validation 400. The parameters are read as text below, and anything that is not text counts as absent.
  typed.get('/v1/auth/bnet/callback', { schema: { response: { 404: ErrorResponse } } }, (request, reply) =>
    withRecordingSpan('identity.bnet-callback', {}, async (span) => {
      if (!deps.bnet.enabled) {
        span.setAttribute('outcome', 'not-configured');
        return reply.code(404).send({ error: 'not-found' });
      }
      // Every path out of the callback clears the state cookie: a state is used once (IDB-04).
      const fail = (reason: BattleNetFailure): FastifyReply => {
        span.setAttribute('outcome', reason);
        reply.clearCookie(OAUTH_COOKIE_NAME, SECURE_COOKIE);
        return redirectTo(reply, `${deps.bnet.siteOrigin}/?signin=failed`);
      };
      const query = queryOf(request.query);
      const checked = checkCallback(
        request.cookies[OAUTH_COOKIE_NAME],
        { code: textOf(query['code']), state: textOf(query['state']), error: textOf(query['error']) },
        deps.clock.now(),
      );
      if (!checked.ok) {
        return fail(checked.error);
      }
      const signedIn = await deps.useCases.signInWithBattleNet({
        code: checked.value.code,
        verifier: checked.value.verifier,
        redirectUri: redirectUriOf(deps.bnet.siteOrigin),
      });
      if (!signedIn.ok) {
        return fail(signedIn.error);
      }
      reply.clearCookie(OAUTH_COOKIE_NAME, SECURE_COOKIE);
      reply.setCookie(SESSION_COOKIE_NAME, signedIn.value.sessionToken, {
        ...SECURE_COOKIE,
        maxAge: SESSION_MAX_AGE_SECONDS,
      });
      span.setAttribute('outcome', 'ok');
      return redirectTo(reply, `${deps.bnet.siteOrigin}/`);
    }),
  );

  // No body schema: an unauthenticated request must answer 401 before any body is validated. The body is ignored.
  typed.post(
    '/v1/auth/logout',
    {
      preHandler: [deps.guards.requireSession, deps.guards.requireSameOrigin],
      schema: { response: { 204: z.null(), 401: ErrorResponse, 403: ErrorResponse } },
    },
    (request, reply) =>
      withRecordingSpan('identity.sign-out', {}, async (span) => {
        const sessionToken = request.cookies[SESSION_COOKIE_NAME];
        if (sessionToken !== undefined) {
          await deps.useCases.signOut({ sessionToken });
        }
        reply.clearCookie(SESSION_COOKIE_NAME, SECURE_COOKIE);
        span.setAttribute('outcome', 'ok');
        return reply.code(204).send(null);
      }),
  );

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
