// The characters the agent read for the player (CHR-11). The list is one labelled region, so a keyboard user reaches it
// with Tab and reads its entries in order; with no characters it says how to add them.
import type { CharacterView } from '@d2rmm/contracts';
import { useTranslation } from 'react-i18next';
import { classKey, difficultyKey, eraKey, ladderKey, modeKey } from '../../shared/labels.ts';

export function CharacterList({ characters }: { characters: readonly CharacterView[] }) {
  const { t, i18n } = useTranslation();
  const joinWords = new Intl.ListFormat(i18n.language, { style: 'long', type: 'conjunction' });
  return (
    <section aria-labelledby="characters-heading" tabIndex={0}>
      <h2 id="characters-heading">{t('characters.heading')}</h2>
      {characters.length === 0 ? (
        <p>{t('characters.empty')}</p>
      ) : (
        <ul>
          {characters.map((character) => (
            <li key={character.name}>
              <p>
                <strong>{character.name}</strong>
              </p>
              <p>{t(classKey(character.class))}</p>
              <p>{t('characters.level', { level: character.level })}</p>
              <p>{t(modeKey(character.ladder))}</p>
              <p>{t(ladderKey(character.ladder))}</p>
              <p>{t(eraKey(character.era))}</p>
              <p>
                {t('characters.unlocked', {
                  difficulties: joinWords.format(
                    character.unlockedDifficulties.map((difficulty) => t(difficultyKey(difficulty))),
                  ),
                })}
              </p>
              <p>
                {t('characters.readAt', { time: new Date(character.readAt).toLocaleString(i18n.language) })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
