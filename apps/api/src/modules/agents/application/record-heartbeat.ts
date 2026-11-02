import { Presence, type AgentScreen } from '../domain/presence.ts';
import { withSpan, type Clock, type EventBus } from '../../../shared-kernel/index.ts';
import type { PresenceStore } from './ports.ts';

export interface RecordHeartbeatDeps {
  readonly presence: PresenceStore;
  readonly clock: Clock;
  readonly bus: EventBus;
}

export interface HeartbeatInput {
  readonly agentId: string;
  readonly accountId: string;
  readonly gameRunning: boolean;
  readonly screen: AgentScreen;
}

/**
 * Stores the agent's presence in memory (no SQL, AWS-33). Publishes a transient `AgentPresenceChanged` only when the
 * online flag, the game flag or the screen differs from the previous presence.
 */
export function createRecordHeartbeat(deps: RecordHeartbeatDeps) {
  return (input: HeartbeatInput): Promise<void> =>
    withSpan('agents.record-heartbeat', {}, async () => {
      const next = Presence.fromHeartbeat(
        { gameRunning: input.gameRunning, screen: input.screen },
        deps.clock.now(),
      );
      const previous = deps.presence.get(input.agentId);
      deps.presence.set({ agentId: input.agentId, accountId: input.accountId, presence: next });
      if (previous === undefined || Presence.differs(previous.presence, next)) {
        await deps.bus.publish({
          kind: 'transient',
          event: {
            type: 'AgentPresenceChanged',
            payload: {
              agentId: input.agentId,
              accountId: input.accountId,
              online: true,
              gameRunning: input.gameRunning,
              screen: input.screen,
            },
          },
        });
      }
    });
}
