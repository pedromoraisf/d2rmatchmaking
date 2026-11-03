import { withSpan } from '../../../shared-kernel/index.ts';
import type { AgentRepository } from './ports.ts';

export interface AgentLookupDeps {
  readonly agents: AgentRepository;
}

/**
 * The account an agent is paired to, or null when the agent is unknown, unpaired or revoked. Lobby Room reads it to
 * check room membership, so a revoked agent cannot report on a room (AWS-25).
 */
export function createAccountOfAgent(deps: AgentLookupDeps) {
  return (agentId: string): Promise<string | null> =>
    withSpan('agents.account-of-agent', {}, async (): Promise<string | null> => {
      const agent = await deps.agents.findById(agentId);
      if (agent === null || agent.revokedAt !== undefined || agent.accountId === undefined) {
        return null;
      }
      return agent.accountId;
    });
}

/** The account's current agent (not revoked), or null when it has none. Stream recipients are resolved with it. */
export function createCurrentAgentOf(deps: AgentLookupDeps) {
  return (accountId: string): Promise<string | null> =>
    withSpan('agents.current-agent-of', {}, async (): Promise<string | null> => {
      const agent = await deps.agents.findCurrentByAccount(accountId);
      return agent === null ? null : agent.id;
    });
}
