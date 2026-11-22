import { describe, expect, it } from 'vitest';
import { gameFacts, journeyIds, runIdOf } from './journey-attributes.ts';

describe('journeyIds (OBT-03)', () => {
  it('names every id by its key', () => {
    expect(
      journeyIds({
        accountId: 'a-1',
        agentId: 'g-1',
        roomId: 'r-1',
        runId: 'u-1',
        ticketId: 't-1',
        readyCheckId: 'c-1',
      }),
    ).toStrictEqual({
      'd2r.account.id': 'a-1',
      'd2r.agent.id': 'g-1',
      'd2r.room.id': 'r-1',
      'd2r.run.id': 'u-1',
      'd2r.ticket.id': 't-1',
      'd2r.ready_check.id': 'c-1',
    });
  });

  it('leaves out an id the use case does not know, an empty one included', () => {
    expect(journeyIds({ roomId: 'r-1', accountId: undefined, agentId: '' })).toStrictEqual({
      'd2r.room.id': 'r-1',
    });
    expect(journeyIds({})).toStrictEqual({});
  });
});

describe('gameFacts (OBT-03)', () => {
  it('names the game name, the difficulty, the mode and the stage', () => {
    expect(
      gameFacts({ gameName: 'mmpvpnm-3', difficulty: 1, mode: 'pvp', stage: 'awaiting_host' }),
    ).toStrictEqual({
      'd2r.game.name': 'mmpvpnm-3',
      'd2r.difficulty': 1,
      'd2r.queue.mode': 'pvp',
      'd2r.room.stage': 'awaiting_host',
    });
  });

  it('keeps a difficulty of zero (normal) and drops the unknown facts', () => {
    expect(gameFacts({ difficulty: 0 })).toStrictEqual({ 'd2r.difficulty': 0 });
    expect(gameFacts({})).toStrictEqual({});
  });
});

describe('runIdOf (OBT-03)', () => {
  it('joins the room id and the run number', () => {
    expect(runIdOf('r-1', 2)).toBe('r-1/2');
  });
});
