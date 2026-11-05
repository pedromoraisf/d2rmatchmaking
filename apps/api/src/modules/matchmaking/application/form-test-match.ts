import {
  withSpan,
  type IdGenerator,
  type MatchFormedEvent,
  type Outbox,
  type UnitOfWork,
} from '../../../shared-kernel/index.ts';

export interface FormTestMatchDeps {
  readonly ids: IdGenerator;
  readonly uow: UnitOfWork;
  readonly outbox: Outbox;
}

/**
 * Staging only (AWS-19, AD-033): one solo leveling match on baal hell, with the caller as its only member and host.
 * The `MatchFormed` event goes to the outbox in one transaction; the Lobby Room opens the room when it consumes it.
 */
export function createFormTestMatch(deps: FormTestMatchDeps) {
  return (input: { readonly accountId: string }): Promise<{ readonly matchId: string }> =>
    withSpan('matchmaking.form-test-match', {}, async () => {
      const matchId = deps.ids.next();
      const event: MatchFormedEvent = {
        type: 'MatchFormed',
        payload: {
          matchId,
          mode: 'leveling',
          activity: 'baal',
          difficulty: 'hell',
          region: 'americas',
          ladder: 'sc-ladder',
          era: 'rotw',
          members: [{ accountId: input.accountId, characterId: null, joinOrder: 1, role: 'host' }],
        },
      };
      await deps.uow.run(async (tx) => {
        await deps.outbox.append(tx, [event]);
      });
      return { matchId };
    });
}
