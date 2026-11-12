// The characters the agent read for the player (CHR-11). The list is one labelled region, so a keyboard user reaches it
// with Tab and reads its entries in order; with no characters it says how to add them. A character whose ladder and era
// the player has not declared shows a form to declare them (CHR-15): two groups of native radio buttons, usable with the
// keyboard alone.
import { useState, type FormEvent } from 'react';
import type { CharacterView, DeclaredLadder, Era } from '@d2rmm/contracts';
import { useTranslation } from 'react-i18next';
import type { ApiClient } from '../../shared/api-client.ts';
import {
  classKey,
  classMark,
  difficultyKey,
  difficultyTone,
  eraKey,
  ladderKey,
  modeKey,
} from '../../shared/labels.ts';

const LADDERS: readonly DeclaredLadder[] = ['ladder', 'non-ladder'];
const ERAS: readonly Era[] = ['classic', 'lod', 'rotw'];

export function CharacterList({
  characters,
  client,
  onDeclared,
}: {
  readonly characters: readonly CharacterView[];
  readonly client: ApiClient;
  /** Called after a declaration is saved, so the list is read again (CHR-15). */
  readonly onDeclared: () => void;
}) {
  const { t, i18n } = useTranslation();
  const joinWords = new Intl.ListFormat(i18n.language, { style: 'long', type: 'conjunction' });
  return (
    <section className="panel" aria-labelledby="characters-heading" tabIndex={0}>
      <h2 id="characters-heading">{t('characters.heading')}</h2>
      {characters.length === 0 ? (
        <p>{t('characters.empty')}</p>
      ) : (
        <ul className="chars">
          {characters.map((character) => (
            <li key={character.id} className="char">
              <div className="char-id">
                <span className="av" aria-hidden="true">
                  {classMark(character.class)}
                </span>
                <div>
                  <p>
                    <strong>{character.name}</strong>
                  </p>
                  <span>{t(classKey(character.class))}</span>
                </div>
              </div>
              <div className="char-meta">
                <span>{t('characters.level', { level: character.level })}</span>
                <span>{t(modeKey(character.hardcore))}</span>
                {character.ladder !== null && character.era !== null ? (
                  <>
                    <span>{t(ladderKey(character.ladder))}</span>
                    <span>{t(eraKey(character.era))}</span>
                  </>
                ) : null}
              </div>
              {/* The difficulties as coloured tags (SHL-04). The sentence below says the same to a screen reader. */}
              <ul className="tags" aria-hidden="true">
                {character.unlockedDifficulties.map((difficulty) => (
                  <li key={difficulty} className={`tag ${difficultyTone(difficulty)}`}>
                    {t(difficultyKey(difficulty))}
                  </li>
                ))}
              </ul>
              <p className="sr-only">
                {t('characters.unlocked', {
                  difficulties: joinWords.format(
                    character.unlockedDifficulties.map((difficulty) => t(difficultyKey(difficulty))),
                  ),
                })}
              </p>
              {character.ladder === null || character.era === null ? (
                <DeclareForm
                  characterId={character.id}
                  characterName={character.name}
                  client={client}
                  onDeclared={onDeclared}
                />
              ) : null}
              <p className="muted">
                {t('characters.readAt', { time: new Date(character.readAt).toLocaleString(i18n.language) })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The player's declaration of ladder and era for one character (CHR-15). Submit stays off until both are chosen. */
function DeclareForm({
  characterId,
  characterName,
  client,
  onDeclared,
}: {
  readonly characterId: string;
  readonly characterName: string;
  readonly client: ApiClient;
  readonly onDeclared: () => void;
}) {
  const { t } = useTranslation();
  const [ladder, setLadder] = useState<DeclaredLadder | null>(null);
  const [era, setEra] = useState<Era | null>(null);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const groupName = `declare-${characterId}-ladder`;
  const eraGroupName = `declare-${characterId}-era`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ladder === null || era === null) {
      return;
    }
    setSending(true);
    const saved = await client.declareCharacter(characterId, { ladder, era });
    setSending(false);
    setFailed(!saved.ok);
    if (saved.ok) {
      onDeclared();
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      aria-label={t('characters.declare.formLabel', { name: characterName })}
    >
      <p>{t('characters.declare.prompt')}</p>
      <fieldset>
        <legend>{t('characters.declare.ladderLegend')}</legend>
        {LADDERS.map((value) => (
          <label key={value}>
            <input
              type="radio"
              name={groupName}
              value={value}
              checked={ladder === value}
              onChange={() => setLadder(value)}
            />{' '}
            {t(ladderKey(value))}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>{t('characters.declare.eraLegend')}</legend>
        {ERAS.map((value) => (
          <label key={value}>
            <input
              type="radio"
              name={eraGroupName}
              value={value}
              checked={era === value}
              onChange={() => setEra(value)}
            />{' '}
            {t(eraKey(value))}
          </label>
        ))}
      </fieldset>
      <button type="submit" className="btn" disabled={ladder === null || era === null || sending}>
        {t('characters.declare.submit')}
      </button>
      {failed ? <p role="alert">{t('characters.declare.failed')}</p> : null}
    </form>
  );
}
