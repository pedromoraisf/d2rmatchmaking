import type { Result } from '../../shared-kernel/index.ts';

export { createAgentsUseCases } from './application/agents-use-cases.ts';
export type { AgentsRuntimeDeps, AgentsUseCases } from './application/agents-use-cases.ts';
export type { AgentIdentity } from './application/authenticate-agent.ts';
export { AgentVersion } from './domain/agent-version.ts';

/**
 * The Agents module's public port (design.md § Agents module). The platform guards and the stream hub use it; no
 * other module reaches the Agents internals.
 */
export interface AgentsPort {
  authenticateAgent(
    token: string,
  ): Promise<Result<{ agentId: string; accountId: string }, 'unauthenticated'>>;
  accountOfAgent(agentId: string): Promise<string | null>;
  currentAgentOf(accountId: string): Promise<string | null>;
}
