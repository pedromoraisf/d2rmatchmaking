import type { FastifyReply, FastifyRequest } from 'fastify';
import { AgentVersion, type AgentsPort } from '../../modules/agents/index.ts';
import type { IdentityPort } from '../../modules/identity/index.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireAgent`: the agent that presented a valid bearer token. */
    agentId?: string;
    /** Set by `requireSession`: the account of a valid session cookie. */
    accountId?: string;
    /** Set by `requireSession`: when the session cookie stops being valid (the stream hub closes at this instant). */
    sessionExpiresAt?: Date;
  }
}

/** The session cookie name (design.md § Identity module: `__Host-`, host-only, never a `Domain` attribute). */
export const SESSION_COOKIE = '__Host-d2rmm_session';

export interface GuardDeps {
  readonly identity: IdentityPort;
  readonly agents: AgentsPort;
  /** `AGENT_MIN_VERSION`, a semantic version (AD-043). */
  readonly agentMinVersion: string;
  /** `SITE_ORIGIN`, the exact origin of the site. */
  readonly siteOrigin: string;
}

export type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;

export interface Guards {
  readonly requireAgentVersion: Guard;
  readonly requireAgent: Guard;
  readonly requireSession: Guard;
  readonly requireSameOrigin: Guard;
}

/** The value of the session cookie in a `Cookie` header, or undefined when absent or empty. */
function sessionCookieValue(cookieHeader: string | undefined): string | undefined {
  if (cookieHeader === undefined) {
    return undefined;
  }
  for (const pair of cookieHeader.split(';')) {
    const trimmed = pair.trim();
    if (trimmed.startsWith(`${SESSION_COOKIE}=`)) {
      const value = trimmed.slice(SESSION_COOKIE.length + 1);
      return value === '' ? undefined : value;
    }
  }
  return undefined;
}

function bearerToken(authorization: string | undefined): string | undefined {
  const match = /^Bearer (\S+)$/i.exec(authorization ?? '');
  return match?.[1];
}

function isJsonMediaType(contentType: string | undefined): boolean {
  return contentType?.split(';')[0]?.trim().toLowerCase() === 'application/json';
}

/**
 * The Fastify preHandlers of the HTTP surface (design.md § Platform, guards). Each one answers and stops the chain
 * with `return reply.send(...)`, or lets the request continue by returning nothing.
 */
export function createGuards(deps: GuardDeps): Guards {
  const minimumVersion = AgentVersion.parse(deps.agentMinVersion);
  if (!minimumVersion.ok) {
    throw new Error('AGENT_MIN_VERSION must be a semantic version');
  }
  const minimum = minimumVersion.value;

  return {
    /** Every agent route: no header, a value that is not a semantic version, or one below the minimum → 426 (AWS-12). */
    async requireAgentVersion(request, reply) {
      const header = request.headers['x-agent-version'];
      const version = typeof header === 'string' ? AgentVersion.parse(header) : undefined;
      if (version === undefined || !version.ok || version.value.isBelow(minimum)) {
        return reply.code(426).send({ error: 'upgrade-required' });
      }
      return undefined;
    },

    /** Agent routes: a bearer token of an active agent → `request.agentId`; anything else → 401. Cookies are ignored. */
    async requireAgent(request, reply) {
      const token = bearerToken(request.headers.authorization);
      const identity = token === undefined ? undefined : await deps.agents.authenticateAgent(token);
      if (identity === undefined || !identity.ok) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      request.agentId = identity.value.agentId;
      return undefined;
    },

    /** Site routes: a valid session cookie → `request.accountId`. An Authorization header on a site route is 401. */
    async requireSession(request, reply) {
      if (request.headers.authorization !== undefined) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      const token = sessionCookieValue(request.headers.cookie);
      const session = token === undefined ? undefined : await deps.identity.authenticateSession(token);
      if (session === undefined || !session.ok) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      request.accountId = session.value.accountId;
      request.sessionExpiresAt = session.value.expiresAt;
      return undefined;
    },

    /**
     * Non-GET routes: the `Origin` must equal `SITE_ORIGIN` and the body must be JSON, else 403 (CSRF, ADR 012). The
     * API sends no CORS headers, so a cross-origin request never reaches a handler.
     */
    async requireSameOrigin(request, reply) {
      if (request.method === 'GET' || request.method === 'HEAD') {
        return undefined;
      }
      if (request.headers.origin !== deps.siteOrigin || !isJsonMediaType(request.headers['content-type'])) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      return undefined;
    },
  };
}
