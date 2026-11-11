import { Presence } from '../domain/presence.ts';
import { withSpan, type Clock } from '../../../shared-kernel/index.ts';
import type { AgentRepository, PresenceStore } from './ports.ts';

export interface AgentOnlineDeps {
  readonly agents: AgentRepository;
  readonly presence: PresenceStore;
  readonly clock: Clock;
}

/**
 * True when the account's current agent is online now: it reported within the last 45 seconds and its presence says
 * so (FR-31, the queues' agent check). A revoked or unpaired agent, or one never seen, is offline.
 */
export function createAgentOnlineOf(deps: AgentOnlineDeps) {
  return (accountId: string): Promise<boolean> =>
    withSpan('agents.agent-online-of', {}, async (): Promise<boolean> => {
      const agent = await deps.agents.findCurrentByAccount(accountId);
      if (agent === null) {
        return false;
      }
      const entry = deps.presence.get(agent.id);
      if (entry === undefined || !entry.presence.online) {
        return false;
      }
      return !Presence.isOfflineAt(entry.presence, deps.clock.now());
    });
}
