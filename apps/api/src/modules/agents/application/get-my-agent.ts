import { Presence, type AgentScreen } from '../domain/presence.ts';
import { withSpan, type Clock } from '../../../shared-kernel/index.ts';
import type { AgentRepository, PresenceStore } from './ports.ts';

export type MyAgentView =
  | { readonly status: 'none' }
  | {
      readonly status: 'paired';
      readonly agentId: string;
      readonly online: boolean;
      readonly gameRunning: boolean;
      readonly screen: AgentScreen;
      readonly lastSeenAt: Date | null;
    };

export interface GetMyAgentDeps {
  readonly agents: AgentRepository;
  readonly presence: PresenceStore;
  readonly clock: Clock;
}

/** The account's current agent and its presence, or `none`. Offline is read from the clock, not only from the sweep. */
export function createGetMyAgent(deps: GetMyAgentDeps) {
  return (input: { readonly accountId: string }): Promise<MyAgentView> =>
    withSpan('agents.get-my-agent', {}, async (): Promise<MyAgentView> => {
      const agent = await deps.agents.findCurrentByAccount(input.accountId);
      if (agent === null) {
        return { status: 'none' };
      }
      const entry = deps.presence.get(agent.id);
      if (entry === undefined) {
        return {
          status: 'paired',
          agentId: agent.id,
          online: false,
          gameRunning: false,
          screen: 'UNKNOWN',
          lastSeenAt: null,
        };
      }
      const online = entry.presence.online && !Presence.isOfflineAt(entry.presence, deps.clock.now());
      return {
        status: 'paired',
        agentId: agent.id,
        online,
        gameRunning: entry.presence.gameRunning,
        screen: entry.presence.screen,
        lastSeenAt: entry.presence.lastSeenAt,
      };
    });
}
