import { err, ok, withSpan, type Result } from '../../../shared-kernel/index.ts';
import type { AgentRepository, AgentTokenCache, SecretHasher } from './ports.ts';

export interface AgentIdentity {
  readonly agentId: string;
  readonly accountId: string;
}

export interface AuthenticateAgentDeps {
  readonly agents: AgentRepository;
  readonly cache: AgentTokenCache;
  readonly hasher: SecretHasher;
}

/**
 * Resolves an agent token to its agent. An empty token is refused before any lookup. A cache hit needs no repository
 * call; a miss reads the repository once and caches a paired, unrevoked agent.
 */
export function createAuthenticateAgent(deps: AuthenticateAgentDeps) {
  return (input: { readonly token: string }): Promise<Result<AgentIdentity, 'unauthenticated'>> =>
    withSpan('agents.authenticate-agent', {}, async (): Promise<Result<AgentIdentity, 'unauthenticated'>> => {
      if (input.token === '') {
        return err('unauthenticated');
      }
      const tokenHash = deps.hasher.hash('agent', input.token);
      const cached = deps.cache.get(tokenHash);
      if (cached !== undefined) {
        return ok(cached);
      }
      const agent = await deps.agents.findByTokenHash(tokenHash);
      if (
        agent === null ||
        agent.tokenHash === undefined ||
        agent.revokedAt !== undefined ||
        agent.accountId === undefined
      ) {
        return err('unauthenticated');
      }
      const identity: AgentIdentity = { agentId: agent.id, accountId: agent.accountId };
      deps.cache.set(tokenHash, identity);
      return ok(identity);
    });
}
