import { ACCOUNT_CODE_SUBMISSIONS } from '../domain/sliding-window.ts';
import {
  err,
  ok,
  withSpan,
  type Clock,
  type EventBus,
  type Result,
  type UnitOfWork,
} from '../../../shared-kernel/index.ts';
import type { AgentRepository, PairingCodeRepository, RateLimitStore } from './ports.ts';

export interface PairAgentDeps {
  readonly agents: AgentRepository;
  readonly codes: PairingCodeRepository;
  readonly rateLimits: RateLimitStore;
  readonly clock: Clock;
  readonly uow: UnitOfWork;
  readonly bus: EventBus;
}

/**
 * Binds the agent of an unused code to the account. Every submission counts toward 10 per 5 minutes per account
 * (AD-032). The account's previous agent is revoked in the same transaction (AD-037) and `AgentRevoked` is published.
 */
export function createPairAgent(deps: PairAgentDeps) {
  return (input: {
    readonly accountId: string;
    readonly code: string;
  }): Promise<Result<{ readonly agentId: string }, 'invalid-code' | 'rate-limited'>> =>
    withSpan(
      'agents.pair-agent',
      { accountId: input.accountId },
      async (): Promise<Result<{ readonly agentId: string }, 'invalid-code' | 'rate-limited'>> => {
        const now = deps.clock.now();
        const key = `account:${input.accountId}`;
        const timestamps = await deps.rateLimits.timestamps(key);
        if (ACCOUNT_CODE_SUBMISSIONS.check(timestamps, now).outcome === 'limited') {
          return err('rate-limited');
        }
        await deps.rateLimits.record(key, now);

        const pending = await deps.codes.findUnusedByCode(input.code);
        if (pending === null) {
          return err('invalid-code');
        }
        const used = pending.use(input.accountId, now);
        if (!used.ok) {
          return err('invalid-code');
        }
        const usedCode = used.value;
        const agent = await deps.agents.findById(usedCode.agentId);
        if (agent === null || agent.revokedAt !== undefined) {
          return err('invalid-code');
        }

        const revokedAgentId = await deps.uow.run(async (tx): Promise<string | undefined> => {
          const previous = await deps.agents.findCurrentByAccount(input.accountId);
          let revokedId: string | undefined;
          if (previous !== null && previous.id !== agent.id) {
            await deps.agents.save(tx, previous.revoke(now));
            revokedId = previous.id;
          }
          await deps.agents.save(tx, agent.pair(input.accountId, now));
          await deps.codes.save(tx, usedCode);
          return revokedId;
        });
        if (revokedAgentId !== undefined) {
          await deps.bus.publish({
            kind: 'transient',
            event: { type: 'AgentRevoked', payload: { agentId: revokedAgentId, accountId: input.accountId } },
          });
        }
        return ok({ agentId: agent.id });
      },
    );
}
