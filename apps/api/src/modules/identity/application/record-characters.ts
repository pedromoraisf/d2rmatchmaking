import { parseCharacterBatch, type CharacterInput } from '../domain/character/character.ts';
import {
  err,
  ok,
  withSpan,
  type Clock,
  type Outbox,
  type Result,
  type UnitOfWork,
} from '../../../shared-kernel/index.ts';
import type { CharacterRepository } from './character-ports.ts';

export interface RecordCharactersDeps {
  readonly characters: CharacterRepository;
  readonly uow: UnitOfWork;
  readonly outbox: Outbox;
  readonly clock: Clock;
}

/**
 * Stores one agent batch under the agent's account (CHR-09). A batch that breaks any rule of CHR-10 is refused whole and
 * stores nothing. The write and the `CharactersRecorded` outbox row share one transaction, so the site is told exactly
 * when the rows exist. Names never reach the span: only the count (CHR-13).
 */
export function createRecordCharacters(deps: RecordCharactersDeps) {
  return (input: {
    readonly accountId: string;
    readonly characters: readonly CharacterInput[];
  }): Promise<Result<{ readonly count: number }, 'invalid-characters'>> =>
    withSpan(
      'identity.record-characters',
      { 'd2r.characters.count': input.characters.length },
      async (): Promise<Result<{ readonly count: number }, 'invalid-characters'>> => {
        const batch = parseCharacterBatch(input.characters);
        if (!batch.ok) {
          return err('invalid-characters');
        }
        const readAt = deps.clock.now();
        await deps.uow.run(async (tx) => {
          await deps.characters.upsertMany(tx, input.accountId, batch.value, readAt);
          await deps.outbox.append(tx, [
            { type: 'CharactersRecorded', payload: { accountId: input.accountId } },
          ]);
        });
        return ok({ count: batch.value.length });
      },
    );
}
