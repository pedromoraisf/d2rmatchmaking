import type { Clock, EventBus, IdGenerator, RandomSource, UnitOfWork } from '../../../shared-kernel/index.ts';
import { createClaimToken } from './claim-token.ts';
import { createPairAgent } from './pair-agent.ts';
import type { AgentRepository, PairingCodeRepository, RateLimitStore, SecretHasher } from './ports.ts';
import { createRequestPairingCode } from './request-pairing-code.ts';

export interface AgentsDeps {
  readonly agents: AgentRepository;
  readonly codes: PairingCodeRepository;
  readonly rateLimits: RateLimitStore;
  readonly hasher: SecretHasher;
  readonly clock: Clock;
  readonly random: RandomSource;
  readonly ids: IdGenerator;
  readonly uow: UnitOfWork;
  readonly bus: EventBus;
}

/** Builds the pairing and claim use cases over their ports. */
export function createPairingUseCases(deps: AgentsDeps) {
  return {
    requestPairingCode: createRequestPairingCode(deps),
    pairAgent: createPairAgent(deps),
    claimToken: createClaimToken(deps),
  };
}

export type PairingUseCases = ReturnType<typeof createPairingUseCases>;
