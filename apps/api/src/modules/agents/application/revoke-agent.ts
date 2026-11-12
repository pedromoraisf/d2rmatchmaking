import {
  err,
  ok,
  withRecordingSpan,
  type Clock,
  type EventBus,
  type Result,
  type UnitOfWork,
} from '../../../shared-kernel/index.ts';
import type { AgentRepository } from './ports.ts';

export interface RevokeAgentDeps {
  readonly agents: AgentRepository;
  readonly clock: Clock;
  readonly uow: UnitOfWork;
  readonly bus: EventBus;
}

/**
 * Revokes the account's current agent, but only when it is the agent named (FR-04, IDB-08). An agent that is unknown,
 * already revoked, or paired to another account is `not-found` and changes nothing (IDB-09). The revoke is stored in a
 * transaction and `AgentRevoked` is published the way pairing a second agent publishes it (AD-037): the token cache is
 * evicted and the agent's stream closes.
 */
export function createRevokeAgent(deps: RevokeAgentDeps) {
  return (input: {
    readonly accountId: string;
    readonly agentId: string;
  }): Promise<Result<{ readonly agentId: string }, 'not-found'>> =>
    withRecordingSpan(
      'agents.revoke',
      {},
      async (span): Promise<Result<{ readonly agentId: string }, 'not-found'>> => {
        const current = await deps.agents.findCurrentByAccount(input.accountId);
        if (current === null || current.id !== input.agentId) {
          span.setAttribute('outcome', 'not-found');
          return err('not-found');
        }
        const now = deps.clock.now();
        await deps.uow.run(async (tx) => {
          await deps.agents.save(tx, current.revoke(now));
        });
        await deps.bus.publish({
          kind: 'transient',
          event: { type: 'AgentRevoked', payload: { agentId: current.id, accountId: input.accountId } },
        });
        span.setAttribute('outcome', 'ok');
        return ok({ agentId: current.id });
      },
    );
}
