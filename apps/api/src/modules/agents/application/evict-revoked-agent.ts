import type { BusEvent } from '../../../shared-kernel/index.ts';
import type { AgentRepository, AgentTokenCache } from './ports.ts';

export interface EvictRevokedAgentDeps {
  readonly agents: AgentRepository;
  readonly cache: AgentTokenCache;
}

/** Subscriber for `AgentRevoked`: drops the revoked agent's token from the cache so it stops authenticating. */
export function createEvictRevokedAgent(deps: EvictRevokedAgentDeps) {
  return async (event: BusEvent): Promise<void> => {
    const domainEvent = event.event;
    if (domainEvent.type !== 'AgentRevoked') {
      return;
    }
    const agent = await deps.agents.findById(domainEvent.payload.agentId);
    const tokenHash = agent?.tokenHash;
    if (tokenHash !== undefined) {
      deps.cache.invalidate(tokenHash);
    }
  };
}
