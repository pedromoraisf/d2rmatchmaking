import { describe, expect, it } from 'vitest';
import type { MatchFormedPayload } from '../shared-kernel/index.ts';
import { openRoomForMatch } from './match-formed.ts';

const match: MatchFormedPayload = {
  matchId: 'match-1',
  mode: 'pvp',
  activity: 'pvp',
  difficulty: 'hell',
  region: 'americas',
  ladder: 'sc-ladder',
  era: 'rotw',
  members: [
    { accountId: 'account-1', characterId: null, joinOrder: 1, role: 'host' },
    { accountId: 'account-2', characterId: null, joinOrder: 2, role: 'member' },
  ],
};

function logDouble() {
  const lines: Array<{ fields: Record<string, unknown>; message: string }> = [];
  return {
    lines,
    log: { error: (fields: Record<string, unknown>, message: string) => lines.push({ fields, message }) },
  };
}

describe('openRoomForMatch (UPK-09, #77)', () => {
  it('logs a refused match at error level with the match id and the reason, and nothing else', async () => {
    const { lines, log } = logDouble();
    const lobby = { onMatchFormed: async () => ({ ok: false as const, error: 'unsupported-difficulty' }) };

    await openRoomForMatch(lobby, match, log);

    expect(lines).toEqual([
      {
        fields: { matchId: 'match-1', reason: 'unsupported-difficulty' },
        message: 'a match was formed but no room could be opened for it',
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain('account-');
  });

  it('logs nothing when the room opens, and hands the lobby the match it was given', async () => {
    const { lines, log } = logDouble();
    const seen: MatchFormedPayload[] = [];
    const lobby = {
      onMatchFormed: async (payload: MatchFormedPayload) => {
        seen.push(payload);
        return { ok: true as const, value: 'created' };
      },
    };

    await openRoomForMatch(lobby, match, log);

    expect(lines).toEqual([]);
    expect(seen).toEqual([match]);
  });
});
