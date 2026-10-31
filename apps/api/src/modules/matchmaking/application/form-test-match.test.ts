import { describe, expect, it } from 'vitest';
import { SequentialIdGenerator, type MatchFormedEvent } from '../../../shared-kernel/index.ts';
import { createFormTestMatch } from './form-test-match.ts';
import { InMemoryUnitOfWork } from './testing/in-memory-unit-of-work.ts';
import { RecordingOutbox } from './testing/recording-outbox.ts';

function setup() {
  const outbox = new RecordingOutbox();
  const formTestMatch = createFormTestMatch({
    ids: new SequentialIdGenerator('match'),
    uow: new InMemoryUnitOfWork(),
    outbox,
  });
  return { formTestMatch, outbox };
}

describe('formTestMatch', () => {
  it('appends a leveling baal hell match for americas on sc-ladder in rotw with the caller as host', async () => {
    const { formTestMatch, outbox } = setup();

    await formTestMatch({ accountId: 'account-1' });

    const [event] = outbox.appended as MatchFormedEvent[];
    expect(outbox.appended).toHaveLength(1);
    expect(event?.type).toBe('MatchFormed');
    expect(event?.payload).toEqual({
      matchId: 'match-1',
      mode: 'leveling',
      activity: 'baal',
      difficulty: 'hell',
      region: 'americas',
      ladder: 'sc-ladder',
      era: 'rotw',
      members: [{ accountId: 'account-1', characterId: null, joinOrder: 1, role: 'host' }],
    });
  });

  it('gives each call a new matchId', async () => {
    const { formTestMatch, outbox } = setup();

    const first = await formTestMatch({ accountId: 'account-1' });
    const second = await formTestMatch({ accountId: 'account-1' });

    expect(first.matchId).not.toBe(second.matchId);
    expect(outbox.appended.map((event) => (event.payload as { matchId: string }).matchId)).toEqual([
      first.matchId,
      second.matchId,
    ]);
  });

  it('returns the matchId of the match it formed', async () => {
    const { formTestMatch } = setup();

    expect(await formTestMatch({ accountId: 'account-1' })).toEqual({ matchId: 'match-1' });
  });
});
