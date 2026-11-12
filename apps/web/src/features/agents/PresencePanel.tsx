// The paired agent's presence: online or offline, game open or closed, and the screen it reports (FR-05). The player can
// revoke the agent (FR-04, IDB-08): a confirmation comes first, and once the agent is cut off the pairing form returns.
import { useState } from 'react';
import type { AgentView } from '@d2rmm/contracts';
import { useTranslation } from 'react-i18next';
import type { ApiClient } from '../../shared/api-client.ts';
import { gameKey, onlineKey, screenKey } from '../../shared/labels.ts';

export type PairedAgent = Extract<AgentView, { status: 'paired' }>;

export interface PresencePanelProps {
  client: ApiClient;
  agent: PairedAgent;
  onRevoked: () => void;
}

export function PresencePanel({ client, agent, onRevoked }: PresencePanelProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function revoke() {
    setBusy(true);
    const result = await client.revokeAgent(agent.agentId);
    setBusy(false);
    // A 404 means the agent is no longer this player's: the site reads again rather than keep a stale view (IDB-09).
    if (result.ok || result.failure === 'not-found') {
      setConfirming(false);
      setFailed(false);
      onRevoked();
    } else {
      setFailed(true);
    }
  }

  return (
    <section className="presence">
      <p>{t(onlineKey(agent.online))}</p>
      <p>{t(gameKey(agent.gameRunning))}</p>
      <p>{t(screenKey(agent.screen))}</p>
      {confirming ? (
        <div className="stack">
          <p>{t('revoke.confirm')}</p>
          <div className="tags">
            <button type="button" className="btn bad" disabled={busy} onClick={() => void revoke()}>
              {t('revoke.confirmButton')}
            </button>
            <button type="button" className="btn quiet" disabled={busy} onClick={() => setConfirming(false)}>
              {t('revoke.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn quiet" onClick={() => setConfirming(true)}>
          {t('revoke.button')}
        </button>
      )}
      {failed ? <p role="alert">{t('app.error')}</p> : null}
    </section>
  );
}
