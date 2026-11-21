// The subscriber of `MatchFormed` (LBR-01): the lobby opens the room, and a refusal is logged, never dropped (#77, UPK-09).
// Extracted from `app.ts` so the refused branch has a direct unit test.
import type { MatchFormedPayload, Result } from '../shared-kernel/index.ts';

/** The one lobby operation this subscriber needs, typed structurally. */
export interface RoomOpener {
  onMatchFormed(match: MatchFormedPayload): Promise<Result<unknown, string>>;
}

/** The slice of the logger it writes to. */
export interface ErrorLog {
  error(fields: Record<string, unknown>, message: string): void;
}

/**
 * Opens the room of a formed match. A formed match without a room leaves its players waiting, so a refusal is logged at
 * error level with the match id and the reason (never the players).
 */
export async function openRoomForMatch(
  lobby: RoomOpener,
  match: MatchFormedPayload,
  log: ErrorLog,
): Promise<void> {
  const opened = await lobby.onMatchFormed(match);
  if (!opened.ok) {
    log.error(
      { matchId: match.matchId, reason: opened.error },
      'a match was formed but no room could be opened for it',
    );
  }
}
