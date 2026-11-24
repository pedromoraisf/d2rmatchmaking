import { matchCharacterName } from '../../../../shared-kernel/index.ts';
import { characterKey, type Character } from './character.ts';

/** What a stored character offers a read card to be compared with. */
export interface StoredFacts {
  readonly name: string;
  readonly class: Character['class'];
  readonly level: number;
  readonly hardcore: boolean;
}

export interface Reconciled {
  readonly characters: readonly Character[];
  /** How many cards took the name of a stored character. Only this count is ever recorded (SNM-04). */
  readonly reconciled: number;
}

/**
 * A card whose name the account does not hold may be a stored character the screen misread (item g, the `O` of a name read
 * as `g`, `e` or `b`). It is that character when exactly one stored name stands for the read name (`matchCharacterName`),
 * the stored character has the same class and mode, the card's level is not lower than the stored level, and the batch
 * holds no other card for that stored name. The card then takes the stored spelling and the misread is gone. Every doubt
 * leaves the card as read, a new character: a duplicate on the site costs less than an overwritten level (SNM-07).
 */
export function reconcileCards(batch: readonly Character[], stored: readonly StoredFacts[]): Reconciled {
  const taken = new Set(batch.map((card) => characterKey(card.name)));
  const storedNames = stored.map((character) => character.name);
  let reconciled = 0;
  const characters = batch.map((card) => {
    const match = matchCharacterName(card.name, storedNames);
    const target = match.kind === 'one' ? stored[match.index] : undefined;
    if (
      target === undefined ||
      target.class !== card.class ||
      target.hardcore !== card.hardcore ||
      card.level < target.level ||
      taken.has(characterKey(target.name))
    ) {
      return card;
    }
    taken.add(characterKey(target.name));
    reconciled += 1;
    return { ...card, name: target.name };
  });
  return { characters, reconciled };
}
