import { fitsAccountLimit, parseCharacterBatch, type CharacterInput } from '../domain/character/character.ts';
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
 * stores nothing. A batch that would take the account past MAX_CHARACTERS_PER_ACCOUNT new names is refused whole as well
 * (security finding 2). The lock, the count, the write and the `CharactersRecorded` outbox row share one transaction, so
 * the site is told exactly when the rows exist. Names never reach the span: only the count (CHR-13).
 */
export function createRecordCharacters(deps: RecordCharactersDeps) {
  return (input: {
    readonly accountId: string;
    readonly characters: readonly CharacterInput[];
  }): Promise<Result<{ readonly count: number }, RecordCharactersError>> =>
    withSpan(
      'identity.record-characters',
      { 'd2r.characters.count': input.characters.length },
      async (): Promise<Result<{ readonly count: number }, RecordCharactersError>> => {
        const batch = parseCharacterBatch(input.characters);
        if (!batch.ok) {
          return err('invalid-characters');
        }
        const readAt = deps.clock.now();
        return deps.uow.run(
          async (tx): Promise<Result<{ readonly count: number }, RecordCharactersError>> => {
            await deps.characters.lockAccount(tx, input.accountId);
            const stored = await deps.characters.storedNames(tx, input.accountId);
            if (!fitsAccountLimit(stored, batch.value)) {
              return err('too-many-characters');
            }
            await deps.characters.upsertMany(tx, input.accountId, batch.value, readAt);
            await deps.outbox.append(tx, [
              { type: 'CharactersRecorded', payload: { accountId: input.accountId } },
            ]);
            return ok({ count: batch.value.length });
          },
        );
      },
    );
}

/** The refusals of a batch (CHR-10, security finding 2). Each one stores nothing. */
export type RecordCharactersError = 'invalid-characters' | 'too-many-characters';
