// The per-principal limit on the read and answer routes of the site and the agent (UPK-02, UPK-03). One sliding window of
// `ROUTE_LIMIT` requests a minute per principal and per route group, in memory in the one API instance (ADR 006). It reuses
// `RelayLimiter` (its own instance, so these keys never share the relay's maps or caps): a request over the limit is refused
// and still counted, so a loop keeps its own window full.
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Clock } from '../../shared-kernel/index.ts';
import type { RelayLimiter } from './relay-limiter.ts';

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;

/** Requests a principal may make to one route group in a window. About 20 times what the site and the agent send. */
export const ROUTE_LIMIT = 60;
export const ROUTE_WINDOW_MS = 60 * 1000;

/** Whole seconds until `retryAt`, at least 1: the value of `Retry-After` for a limited request. Pure. */
export function retryAfterSeconds(retryAt: Date, now: Date): number {
  return Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 1000));
}

/**
 * A guard that counts one request of the principal `keyOf` names, under `group`, and answers `429 { error: 'rate-limited' }`
 * with `Retry-After` once the window is full. It runs after the authenticating guard: a request without a principal (the
 * guard before it already answered, or set none) passes untouched.
 */
export function createRouteLimit(
  limiter: RelayLimiter,
  clock: Clock,
  group: string,
  keyOf: (request: FastifyRequest) => string | undefined,
): Guard {
  return async (request, reply) => {
    const principal = keyOf(request);
    if (principal === undefined) {
      return undefined;
    }
    const admission = limiter.arriveAsPrincipal(`${group}:${principal}`, ROUTE_LIMIT, ROUTE_WINDOW_MS);
    if (admission.outcome === 'allowed') {
      return undefined;
    }
    return reply
      .code(429)
      .header('retry-after', String(retryAfterSeconds(admission.retryAt, clock.now())))
      .send({ error: 'rate-limited' });
  };
}
