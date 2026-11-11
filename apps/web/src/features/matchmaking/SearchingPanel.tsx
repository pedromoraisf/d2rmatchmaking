// The searching view (QUE-15): the time waited, the PvP band, the pool and "Leave queue". The clock ticks every second, so
// the wait on screen never lags the stream by more than one tick.
import { useEffect, useState } from 'react';
import type { QueueTicketView } from '@d2rmm/contracts';
import { useTranslation } from 'react-i18next';
import type { ApiClient } from '../../shared/api-client.ts';

/** `m:ss` for the seconds waited (the player sees one clock, never a rounded minute). */
export function formatWait(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function SearchingPanel({
  ticket,
  client,
  onLeft,
}: {
  readonly ticket: QueueTicketView;
  readonly client: ApiClient;
  /** Called after the ticket has left the queue on the player's request. */
  readonly onLeft: () => void;
}) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const clock = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(clock);
    };
  }, []);

  async function leave() {
    setSending(true);
    const left = await client.leaveQueue(ticket.id);
    setSending(false);
    setFailed(!left.ok);
    if (left.ok) {
      onLeft();
    }
  }

  const waited = (now - Date.parse(ticket.joinedAt)) / 1000;
  return (
    <section className="panel pad search-panel" aria-labelledby="searching-heading">
      <div className="s-top">
        <div>
          <div className="lbl">
            <span className="pulse" aria-hidden="true" />
          </div>
          <h2 id="searching-heading">{t('queue.searching.heading')}</h2>
          <div className="pairs">
            {ticket.band !== null ? (
              <span className="tag">
                {t('queue.searching.band', { low: ticket.band.low, high: ticket.band.high })}
              </span>
            ) : null}
            <span className="tag">{t('queue.searching.pool', { players: ticket.poolSize })}</span>
          </div>
        </div>
        <div className="num-block">
          <div className="clock">{formatWait(waited)}</div>
          <div className="note">{t('queue.searching.waited', { time: formatWait(waited) })}</div>
        </div>
      </div>
      <div className="cta">
        <button type="button" className="btn bad" onClick={() => void leave()} disabled={sending}>
          {t('queue.searching.leave')}
        </button>
      </div>
      {failed ? (
        <p role="alert" className="note">
          {t('queue.searching.leaveFailed')}
        </p>
      ) : null}
    </section>
  );
}
