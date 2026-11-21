// The rate limit of `POST /v1/lobby-rooms/:id/observations` (security review of #101, ADR 036): a sliding window of 20 a
// minute for each agent and 40 a minute for each room. The agent keeps its own bound of 20 a minute, but a modified client
// does not, and every chat sighting costs a member lookup. In memory, like every limiter of the MVP (ADR 006): a restart
// resets it. It reuses the relay's limiter, whose two maps are capped and swept (`watch(scheduler)`), so a flood of
// room ids cannot grow the memory without bound.
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Cancel, Clock, Scheduler } from '../../shared-kernel/index.ts';
import { RelayLimiter } from './relay-limiter.ts';

export const AGENT_OBSERVATIONS_PER_MINUTE = 20;
export const ROOM_OBSERVATIONS_PER_MINUTE = 40;
const MINUTE_MS = 60 * 1000;

/**
 * Postgres reads a uuid written in upper case, wrapped in braces or without hyphens as the same id, so one room can be
 * reached under many spellings. The room's budget is keyed by the canonical form (lowercase, no braces, no hyphens), or
 * a client could split the 40 a minute across spellings.
 */
export function canonicalRoomKey(roomId: string): string {
  return roomId.toLowerCase().replace(/[{}-]/g, '');
}

export interface ObservationLimit {
  /** A preHandler for the observation route: it runs after `requireAgent`, so the agent is known. Answers 429 `rate-limited`. */
  readonly guard: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;
  /** Sweeps the expired windows every 30 s until the returned function is called. */
  watch(scheduler: Scheduler): Cancel;
  /** The keys held now, for the sweep's test. */
  keyCounts(): { readonly principals: number; readonly addresses: number };
}

export function createObservationLimit(deps: { readonly clock: Clock }): ObservationLimit {
  const limiter = new RelayLimiter(deps.clock);

  function refuse(reply: FastifyReply, retryAt: Date): FastifyReply {
    const seconds = Math.max(1, Math.ceil((retryAt.getTime() - deps.clock.now().getTime()) / 1000));
    return reply.code(429).header('retry-after', String(seconds)).send({ error: 'rate-limited' });
  }

  return {
    async guard(request, reply) {
      const agentId = request.agentId;
      if (agentId === undefined) {
        return undefined;
      }
      const byAgent = limiter.arriveAsPrincipal(
        `agent-obs:${agentId}`,
        AGENT_OBSERVATIONS_PER_MINUTE,
        MINUTE_MS,
      );
      if (byAgent.outcome === 'limited') {
        return refuse(reply, byAgent.retryAt);
      }
      const roomId = (request.params as { readonly id?: unknown } | undefined)?.id;
      if (typeof roomId === 'string') {
        const byRoom = limiter.arriveAsPrincipal(
          `room-obs:${canonicalRoomKey(roomId)}`,
          ROOM_OBSERVATIONS_PER_MINUTE,
          MINUTE_MS,
        );
        if (byRoom.outcome === 'limited') {
          return refuse(reply, byRoom.retryAt);
        }
      }
      return undefined;
    },
    watch: (scheduler) => limiter.watch(scheduler),
    keyCounts: () => limiter.keyCounts(),
  };
}
