import { withSpan, type Clock, type RandomSource } from '../../../shared-kernel/index.ts';
import type { AgentRepository, PairingCodeRepository, SecretHasher } from './ports.ts';
import { newAgentToken } from './secret-tokens.ts';

export type ClaimOutcome =
  | { readonly state: 'pending' }
  | { readonly state: 'claimed'; readonly token: string }
  | { readonly state: 'gone' };

export interface ClaimTokenDeps {
  readonly agents: AgentRepository;
  readonly codes: PairingCodeRepository;
  readonly hasher: SecretHasher;
  readonly clock: Clock;
  readonly random: RandomSource;
}

/**
 * Hands out the agent token once. `pending` while the code is unused, `claimed` with the token on the one claim that
 * wins the atomic update, `gone` afterwards or once the code expired unused.
 */
export function createClaimToken(deps: ClaimTokenDeps) {
  return (input: { readonly claimSecret: string }): Promise<ClaimOutcome> =>
    withSpan('agents.claim-token', {}, async (): Promise<ClaimOutcome> => {
      const now = deps.clock.now();
      const claimSecretHash = deps.hasher.hash('claim', input.claimSecret);
      const token = newAgentToken(deps.random);
      const claimed = await deps.agents.claimTokenAtomically(
        claimSecretHash,
        deps.hasher.hash('agent', token),
        now,
      );
      if (claimed !== null) {
        return { state: 'claimed', token };
      }
      const agent = await deps.agents.findByClaimSecretHash(claimSecretHash);
      if (agent === null || agent.tokenClaimedAt !== undefined || agent.revokedAt !== undefined) {
        return { state: 'gone' };
      }
      if (agent.accountId !== undefined) {
        return { state: 'gone' };
      }
      const code = await deps.codes.findByAgentId(agent.id);
      return code !== null && code.claimState(now) === 'pending' ? { state: 'pending' } : { state: 'gone' };
    });
}
