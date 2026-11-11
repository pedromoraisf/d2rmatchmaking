export type AgentScreen = 'UNKNOWN' | 'CHARACTER_SELECT' | 'IN_GAME' | 'AUTOMAP_OPEN';

const OFFLINE_AFTER_MS = 45 * 1000;

/** What an agent reported about the game, and when it last reported (AWS-15). */
export interface Presence {
  readonly online: boolean;
  readonly gameRunning: boolean;
  readonly screen: AgentScreen;
  readonly lastSeenAt: Date;
}

/** A heartbeat body, as the contract validates it. */
export interface Heartbeat {
  readonly gameRunning: boolean;
  readonly screen: AgentScreen;
}

export const Presence = {
  fromHeartbeat(heartbeat: Heartbeat, now: Date): Presence {
    return {
      online: true,
      gameRunning: heartbeat.gameRunning,
      screen: heartbeat.screen,
      lastSeenAt: new Date(now.getTime()),
    };
  },

  /** Offline from exactly 45 s after the last heartbeat. */
  isOfflineAt(presence: Presence, now: Date): boolean {
    return now.getTime() - presence.lastSeenAt.getTime() >= OFFLINE_AFTER_MS;
  },

  /** True when `online`, `gameRunning` or `screen` differ. `lastSeenAt` does not count. */
  differs(a: Presence, b: Presence): boolean {
    return a.online !== b.online || a.gameRunning !== b.gameRunning || a.screen !== b.screen;
  },
};
