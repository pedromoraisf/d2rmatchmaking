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

/** Options of one authentication. `beforeLookup` is asked only on a cache miss; `false` refuses the lookup (`throttled`). */
export interface AuthenticateAgentOptions {
  readonly beforeLookup?: () => boolean;
}

export type AuthenticateAgentError = 'unauthenticated' | 'throttled';

/**
 * Resolves an agent token to its agent. An empty token is refused before any lookup. A cache hit needs no repository
 * call and never asks `beforeLookup`; a miss asks it, and when it refuses the miss is `throttled` with no repository
 * read. A miss that is allowed reads the repository once and caches a paired, unrevoked agent.
 */
export function createAuthenticateAgent(deps: AuthenticateAgentDeps) {
  return (
    input: { readonly token: string },
    opts?: AuthenticateAgentOptions,
  ): Promise<Result<AgentIdentity, AuthenticateAgentError>> =>
    withSpan(
      'agents.authenticate-agent',
      {},
      async (): Promise<Result<AgentIdentity, AuthenticateAgentError>> => {
        if (input.token === '') {
          return err('unauthenticated');
        }
        const tokenHash = deps.hasher.hash('agent', input.token);
        const cached = deps.cache.get(tokenHash);
        if (cached !== undefined) {
          return ok(cached);
        }
        if (opts?.beforeLookup !== undefined && !opts.beforeLookup()) {
          return err('throttled');
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
      },
    );
}
