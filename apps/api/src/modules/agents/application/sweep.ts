import { ACCOUNT_CODE_SUBMISSIONS, IP_CODE_REQUESTS } from '../domain/sliding-window.ts';
import { Presence } from '../domain/presence.ts';
import { withSpan, type Clock, type EventBus } from '../../../shared-kernel/index.ts';
import type { PresenceStore, RateLimitStore } from './ports.ts';

const WIDEST_WINDOW_MS = Math.max(ACCOUNT_CODE_SUBMISSIONS.windowMs, IP_CODE_REQUESTS.windowMs);

export interface SweepDeps {
  readonly presence: PresenceStore;
  readonly rateLimits: RateLimitStore;
  readonly clock: Clock;
  readonly bus: EventBus;
}

/** Marks agents offline 45 s after their last heartbeat (publishing once) and prunes rate-limit timestamps. */
export function createSweep(deps: SweepDeps) {
  return (): Promise<void> =>
    withSpan('agents.sweep', {}, async () => {
      const now = deps.clock.now();
      for (const entry of deps.presence.list()) {
        if (entry.presence.online && Presence.isOfflineAt(entry.presence, now)) {
          const offline: Presence = { ...entry.presence, online: false };
          deps.presence.set({ ...entry, presence: offline });
          await deps.bus.publish({
            kind: 'transient',
            event: {
              type: 'AgentPresenceChanged',
              payload: {
                agentId: entry.agentId,
                accountId: entry.accountId,
                online: false,
                gameRunning: offline.gameRunning,
                screen: offline.screen,
              },
            },
          });
        }
      }
      await deps.rateLimits.prune(new Date(now.getTime() - WIDEST_WINDOW_MS));
    });
}
