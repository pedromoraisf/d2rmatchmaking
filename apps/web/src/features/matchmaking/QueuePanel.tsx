// The queue form (QUE-15, prototype "Partida"): mode, character, difficulty, region and the mode's options, with "Find match"
// off and its reason shown while an entry rule fails. Every control is a native element, so the keyboard reaches all of it.
import { useId, useState, type FormEvent } from 'react';
import type { CharacterView, QueueTicketView } from '@d2rmm/contracts';
import { useTranslation } from 'react-i18next';
import type { ApiClient } from '../../shared/api-client.ts';
import { classKey, difficultyKey } from '../../shared/labels.ts';
import { firstEntryReason, LEVEL_FLOORS, type JoinChoice, type QueueDifficulty } from './entry-reason.ts';
import {
  activityKey,
  formatKey,
  leftNoticeKey,
  reasonKey,
  regionKey,
  roleKey,
  rulesKey,
  type QueueActivityValue,
  type QueueFormatValue,
  type QueueRegionValue,
  type QueueRoleValue,
  type QueueRulesValue,
} from './queue-labels.ts';

type Mode = 'pvp' | 'leveling';

const DIFFICULTIES: readonly QueueDifficulty[] = ['normal', 'nightmare', 'hell'];
const REGIONS: readonly QueueRegionValue[] = ['americas', 'europe', 'asia'];
const FORMATS: readonly QueueFormatValue[] = ['duel', '2v2', 'arena'];
const RULES: readonly QueueRulesValue[] = ['gm', 'bm'];
const ACTIVITIES: readonly QueueActivityValue[] = ['baal', 'chaos', 'cows', 'tz', 'heralds'];
const ROLES: readonly QueueRoleValue[] = ['teleporter', 'bo', 'killer', 'leech'];

export function QueuePanel({
  characters,
  client,
  notice,
  onJoined,
}: {
  readonly characters: readonly CharacterView[];
  readonly client: ApiClient;
  /** Why the last ticket left on its own, shown once above the form (QUE-14). */
  readonly notice: 'agent-offline' | 'agent-revoked' | 'site-closed' | null;
  /** Called with the waiting ticket after a join is accepted. */
  readonly onJoined: (ticket: QueueTicketView) => void;
}) {
  const { t } = useTranslation();
  const ids = useId();
  const [mode, setMode] = useState<Mode>('pvp');
  const [characterId, setCharacterId] = useState('');
  const [difficulty, setDifficulty] = useState<QueueDifficulty>('normal');
  const [region, setRegion] = useState<QueueRegionValue>('americas');
  const [format, setFormat] = useState<QueueFormatValue>('duel');
  const [rules, setRules] = useState<QueueRulesValue>('gm');
  const [activity, setActivity] = useState<QueueActivityValue>('baal');
  const [role, setRole] = useState<QueueRoleValue>('killer');
  const [minLevel, setMinLevel] = useState(LEVEL_FLOORS.normal);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  // The chosen character, or the first one when the choice is gone (a character list can change under the form).
  const character = characters.find((candidate) => candidate.id === characterId) ?? characters[0];
  const choice: JoinChoice = mode === 'pvp' ? { mode, difficulty } : { mode, difficulty, activity, minLevel };
  const reason = firstEntryReason(character, choice);

  function chooseDifficulty(next: QueueDifficulty) {
    setDifficulty(next);
    setMinLevel(LEVEL_FLOORS[next]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reason !== null || character === undefined) {
      return;
    }
    const base = { characterId: character.id, difficulty, region };
    const body =
      mode === 'pvp'
        ? { mode: 'pvp' as const, ...base, format, rules }
        : { mode: 'leveling' as const, ...base, activity, role, minLevel };
    setSending(true);
    const joined = await client.joinQueue(body);
    setSending(false);
    setFailed(!joined.ok);
    if (joined.ok) {
      onJoined(joined.value);
    }
  }

  const describedBy = reason === null ? undefined : `${ids}-reason`;

  return (
    <section aria-labelledby={`${ids}-heading`}>
      <h2 id={`${ids}-heading`}>{t('queue.heading')}</h2>
      {notice !== null ? <p role="status">{t(leftNoticeKey(notice))}</p> : null}
      <form onSubmit={(event) => void submit(event)} aria-label={t('queue.heading')}>
        <fieldset>
          <legend>{t('queue.modeLegend')}</legend>
          <button type="button" aria-pressed={mode === 'pvp'} onClick={() => setMode('pvp')}>
            {t('queue.modePvp')}
          </button>{' '}
          <button type="button" aria-pressed={mode === 'leveling'} onClick={() => setMode('leveling')}>
            {t('queue.modeLeveling')}
          </button>
        </fieldset>

        <label>
          {t('queue.character')}{' '}
          <select
            value={character?.id ?? ''}
            onChange={(event) => setCharacterId(event.target.value)}
            disabled={characters.length === 0}
          >
            {characters.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {t('queue.characterOption', {
                  name: candidate.name,
                  characterClass: t(classKey(candidate.class)),
                  level: candidate.level,
                })}
              </option>
            ))}
          </select>
        </label>

        <fieldset>
          <legend>{t('queue.difficulty')}</legend>
          {DIFFICULTIES.map((value) => {
            const locked = character !== undefined && !character.unlockedDifficulties.includes(value);
            const lockedId = `${ids}-locked-${value}`;
            return (
              <label key={value}>
                <input
                  type="radio"
                  name={`${ids}-difficulty`}
                  value={value}
                  checked={difficulty === value}
                  disabled={locked}
                  aria-describedby={locked ? lockedId : undefined}
                  onChange={() => chooseDifficulty(value)}
                />{' '}
                {t(difficultyKey(value))}
                {locked ? <span id={lockedId}> {t(reasonKey('difficultyLocked'))}</span> : null}
              </label>
            );
          })}
        </fieldset>

        <fieldset>
          <legend>{t('queue.region')}</legend>
          {REGIONS.map((value) => (
            <label key={value}>
              <input
                type="radio"
                name={`${ids}-region`}
                value={value}
                checked={region === value}
                onChange={() => setRegion(value)}
              />{' '}
              {t(regionKey(value))}
            </label>
          ))}
        </fieldset>

        {mode === 'pvp' ? (
          <>
            <fieldset>
              <legend>{t('queue.format')}</legend>
              {FORMATS.map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name={`${ids}-format`}
                    value={value}
                    checked={format === value}
                    onChange={() => setFormat(value)}
                  />{' '}
                  {t(formatKey(value))}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>{t('queue.rules')}</legend>
              {RULES.map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name={`${ids}-rules`}
                    value={value}
                    checked={rules === value}
                    onChange={() => setRules(value)}
                  />{' '}
                  {t(rulesKey(value))}
                </label>
              ))}
            </fieldset>
          </>
        ) : (
          <>
            <label>
              {t('queue.activity')}{' '}
              <select
                value={activity}
                onChange={(event) => setActivity(event.target.value as QueueActivityValue)}
              >
                {ACTIVITIES.map((value) => (
                  <option key={value} value={value}>
                    {t(activityKey(value))}
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>{t('queue.role')}</legend>
              {ROLES.map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name={`${ids}-role`}
                    value={value}
                    checked={role === value}
                    onChange={() => setRole(value)}
                  />{' '}
                  {t(roleKey(value))}
                </label>
              ))}
            </fieldset>
            <label>
              {t('queue.minLevel')}{' '}
              <input
                type="range"
                min={1}
                max={99}
                value={minLevel}
                onChange={(event) => setMinLevel(Number(event.target.value))}
              />{' '}
              <output>{minLevel}</output>
            </label>
          </>
        )}

        <p>
          <button type="submit" disabled={reason !== null || sending} aria-describedby={describedBy}>
            {t('queue.findMatch')}
          </button>
        </p>
        {reason !== null ? <p id={`${ids}-reason`}>{t(reasonKey(reason))}</p> : null}
        {failed ? <p role="alert">{t('queue.joinFailed')}</p> : null}
      </form>
    </section>
  );
}
