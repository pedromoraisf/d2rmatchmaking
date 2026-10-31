import type { Clock, EventBus, IdGenerator, RandomSource, UnitOfWork } from '../../../shared-kernel/index.ts';
import { createAuthenticateAgent } from './authenticate-agent.ts';
import { createClaimToken } from './claim-token.ts';
import { createEvictRevokedAgent } from './evict-revoked-agent.ts';
import { createGetMyAgent } from './get-my-agent.ts';
import { createPairAgent } from './pair-agent.ts';
import type {
  AgentRepository,
  AgentTokenCache,
  PairingCodeRepository,
  PresenceStore,
  RateLimitStore,
  SecretHasher,
} from './ports.ts';
import { createRecordHeartbeat } from './record-heartbeat.ts';
import { createRequestPairingCode } from './request-pairing-code.ts';
import { createSweep } from './sweep.ts';

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

export interface AgentsRuntimeDeps extends AgentsDeps {
  readonly cache: AgentTokenCache;
  readonly presence: PresenceStore;
}

/** Builds every Agents use case, including authentication, presence and the sweep. */
export function createAgentsUseCases(deps: AgentsRuntimeDeps) {
  return {
    ...createPairingUseCases(deps),
    authenticateAgent: createAuthenticateAgent(deps),
    recordHeartbeat: createRecordHeartbeat(deps),
    sweep: createSweep(deps),
    getMyAgent: createGetMyAgent(deps),
    evictRevokedAgent: createEvictRevokedAgent(deps),
  };
}

export type AgentsUseCases = ReturnType<typeof createAgentsUseCases>;
