import type { FastifyReply, FastifyRequest } from 'fastify';
import { AgentVersion, type AgentsPort } from '../../modules/agents/index.ts';
import type { IdentityPort } from '../../modules/identity/index.ts';
import type { Clock } from '../../shared-kernel/index.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireAgent`: the agent that presented a valid bearer token. */
    agentId?: string;
    /** Set by `requireAgentOrSite` on the bearer path: the account the agent belongs to (the relay's budget key). */
    agentAccountId?: string;
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
  /** The clock of the relay's lookup bucket. */
  readonly clock: Clock;
}

export type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;

export interface Guards {
  readonly requireAgentVersion: Guard;
  readonly requireAgent: Guard;
  readonly requireSession: Guard;
  readonly requireSameOrigin: Guard;
  readonly requireAgentOrSite: Guard;
}

const LOOKUPS_PER_SECOND = 10;
const LOOKUPS_IN_FLIGHT = 3;

/**
 * The relay's lookup bucket (design § Relay route, AD-097): a credential that misses the cache, and every session lookup
 * (sessions have no cache), takes one token of 10 a second and one of 3 lookups in flight. An empty bucket answers 429.
 */
class LookupBucket {
  readonly #clock: Clock;
  #tokens = LOOKUPS_PER_SECOND;
  #refilledAt: number;
  #inFlight = 0;

  constructor(clock: Clock) {
    this.#clock = clock;
    this.#refilledAt = clock.now().getTime();
  }

  /** Takes a token and a slot, or answers false with nothing taken. Release the slot when the lookup settles. */
  take(): boolean {
    this.#refill();
    if (this.#tokens < 1 || this.#inFlight >= LOOKUPS_IN_FLIGHT) {
      return false;
    }
    this.#tokens -= 1;
    this.#inFlight += 1;
    return true;
  }

  release(): void {
    this.#inFlight -= 1;
  }

  #refill(): void {
    const now = this.#clock.now().getTime();
    const earned = ((now - this.#refilledAt) * LOOKUPS_PER_SECOND) / 1000;
    this.#tokens = Math.min(LOOKUPS_PER_SECOND, this.#tokens + earned);
    this.#refilledAt = now;
  }
}

/** The value of the session cookie in a `Cookie` header, or undefined when absent or empty. */
export function sessionCookieValue(cookieHeader: string | undefined): string | undefined {
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
  const lookups = new LookupBucket(deps.clock);

  /** One agent lookup through the bucket: a miss asks the gate first. `throttled` when the gate refused. */
  async function lookupAgent(
    token: string,
  ): Promise<Awaited<ReturnType<AgentsPort['authenticateAgent']>> | 'throttled'> {
    let slot = false;
    try {
      const result = await deps.agents.authenticateAgent(token, {
        beforeLookup: () => {
          slot = lookups.take();
          return slot;
        },
      });
      return result.ok === false && result.error === 'throttled' ? 'throttled' : result;
    } finally {
      if (slot) {
        lookups.release();
      }
    }
  }

  /** One session lookup through the bucket (no cache, so every session lookup takes a token). */
  async function lookupSession(token: string) {
    if (!lookups.take()) {
      return 'throttled' as const;
    }
    try {
      return await deps.identity.authenticateSession(token);
    } finally {
      lookups.release();
    }
  }

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

    /**
     * The relay route's guard (design § Relay route, AD-099). An `Authorization` header selects the bearer path and the
     * cookie is never read on it; otherwise the session cookie. No credential, or an empty cookie, is `401`. A lookup the
     * bucket refuses is `429` with `Retry-After: 1`. A valid session whose `Origin` is not exactly the site origin is
     * `403`. The minimum agent version is not applied here, so old agents' spans are still accepted.
     */
    async requireAgentOrSite(request, reply) {
      if (request.headers.authorization !== undefined) {
        const token = bearerToken(request.headers.authorization);
        if (token === undefined) {
          return reply.code(401).send({ error: 'unauthenticated' });
        }
        const identity = await lookupAgent(token);
        if (identity === 'throttled') {
          return reply.code(429).header('retry-after', '1').send({ error: 'rate-limited' });
        }
        if (!identity.ok) {
          return reply.code(401).send({ error: 'unauthenticated' });
        }
        request.agentId = identity.value.agentId;
        request.agentAccountId = identity.value.accountId;
        return undefined;
      }
      const token = sessionCookieValue(request.headers.cookie);
      if (token === undefined) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      const session = await lookupSession(token);
      if (session === 'throttled') {
        return reply.code(429).header('retry-after', '1').send({ error: 'rate-limited' });
      }
      if (!session.ok) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      if (request.headers.origin !== deps.siteOrigin) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      request.accountId = session.value.accountId;
      request.sessionExpiresAt = session.value.expiresAt;
      return undefined;
    },
  };
}
