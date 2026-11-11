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

/**
 * The instant the account's current agent went offline (45 s after its last heartbeat), or null when it is online now,
 * has never reported, or the account has no agent. The Lobby Room reads it to tell how long a member has been away
 * (FR-32, LBR-08).
 */
export function createAgentOfflineSinceOf(deps: AgentOnlineDeps) {
  return (accountId: string): Promise<Date | null> =>
    withSpan('agents.agent-offline-since-of', {}, async (): Promise<Date | null> => {
      const agent = await deps.agents.findCurrentByAccount(accountId);
      if (agent === null) {
        return null;
      }
      const entry = deps.presence.get(agent.id);
      if (entry === undefined || !Presence.isOfflineAt(entry.presence, deps.clock.now())) {
        return null;
      }
      return Presence.offlineSince(entry.presence);
    });
}
