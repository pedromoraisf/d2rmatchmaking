// The ready check (RDY-08, prototype "ready check"): a modal over the site shell with a countdown ring, the members by
// position and class mark, Accept and Decline. Accept takes the focus when the check opens and Enter accepts; Escape does
// nothing, so a stray key never declines (RDY-08). Declining has no penalty; not answering gives a 5-minute wait.
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import './ready-check.css';
import type { ReadyCheckView } from '@d2rmm/contracts';
import { Trans, useTranslation } from 'react-i18next';
import type { ApiClient } from '../../shared/api-client.ts';
import { classKey, classMark, difficultyKey } from '../../shared/labels.ts';

/** The time members have to answer (RDY-01): the ring starts full at this many seconds. */
export const READY_CHECK_SECONDS = 60;

/** The keyboard shortcut the agent registers (RDY-07); it is fixed in F1 (the spec's decisions). */
export const AGENT_HOTKEY = 'Ctrl+Shift+A';

/** Whole seconds left before the deadline, never negative. */
export function secondsUntil(deadline: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000));
}

export function ReadyCheckOverlay({
  readyCheck,
  client,
}: {
  readonly readyCheck: ReadyCheckView;
  readonly client: ApiClient;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const acceptRef = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  // The focus goes to Accept as the check opens (RDY-08). The parent renders one overlay per check, so it is set once.
  useEffect(() => {
    acceptRef.current?.focus();
  }, []);

  useEffect(() => {
    const clock = setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => {
      clearInterval(clock);
    };
  }, []);

  const left = secondsUntil(readyCheck.deadline, now);
  const me = readyCheck.members.find((member) => member.you);
  const answered = me?.accepted === true;

  async function answer(kind: 'accept' | 'decline') {
    setSending(true);
    setFailed(false);
    const result =
      kind === 'accept'
        ? await client.acceptReadyCheck(readyCheck.id)
        : await client.declineReadyCheck(readyCheck.id);
    setSending(false);
    if (!result.ok) {
      setFailed(true);
    }
  }

  // The ring's fill is the share of the minute left; the stylesheet reads it as the custom property `--p`.
  const ring = { '--p': Math.max(0, (left / READY_CHECK_SECONDS) * 100) } as CSSProperties;

  return (
    <div className="rc-overlay">
      <section className="rc" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="rc-sub">
          {t('readyCheck.subtitle', { difficulty: t(difficultyKey(readyCheck.difficulty)) })}
        </div>
        <h2 id={titleId} className="rc-title">
          {t('readyCheck.heading')}
        </h2>
        <div className="rc-ring" style={ring}>
          <span aria-hidden="true">{left}</span>
          <span className="sr-only">{t('readyCheck.secondsLeft', { seconds: left })}</span>
        </div>
        <ul className="rc-members" aria-label={t('readyCheck.membersLabel')}>
          {readyCheck.members.map((member) => {
            const cls = t(classKey(member.class));
            return (
              <li
                key={member.position}
                className={member.accepted ? 'rc-member yes' : 'rc-member'}
                aria-label={t('readyCheck.memberLabel', {
                  position: member.position,
                  characterClass: cls,
                  level: member.level,
                })}
              >
                <span className="av" aria-hidden="true">
                  {classMark(member.class)}
                </span>
                <span className="rc-member-text" aria-hidden="true">
                  <span>{cls}</span>
                  <span className="muted">
                    {t(member.accepted ? 'readyCheck.accepted' : 'readyCheck.waiting')}
                  </span>
                </span>
                {member.you ? <span className="you">{t('readyCheck.you')}</span> : null}
              </li>
            );
          })}
        </ul>
        <div className="rc-acts">
          <button
            ref={acceptRef}
            type="button"
            className="btn-blood"
            onClick={() => void answer('accept')}
            disabled={sending || answered}
          >
            {t('readyCheck.accept')}
          </button>
          <button
            type="button"
            className="btn bad"
            onClick={() => void answer('decline')}
            disabled={sending || answered}
          >
            {t('readyCheck.decline')}
          </button>
        </div>
        {failed ? (
          <p role="alert" className="note">
            {t('readyCheck.answerFailed')}
          </p>
        ) : null}
        <p className="rc-notes muted">
          <Trans
            i18nKey="readyCheck.hotkeyHint"
            values={{ hotkey: AGENT_HOTKEY }}
            components={{ kbd: <kbd /> }}
          />
        </p>
        <p className="rc-notes muted">{t('readyCheck.penaltyNotice')}</p>
      </section>
    </div>
  );
}
