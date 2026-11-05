// The paired agent's presence: online or offline, game open or closed, and the screen it reports (FR-05).
import type { AgentView } from '@d2rmm/contracts';
import { useTranslation } from 'react-i18next';
import { gameKey, onlineKey, screenKey } from '../../shared/labels.ts';

export type PairedAgent = Extract<AgentView, { status: 'paired' }>;

export function PresencePanel({ agent }: { agent: PairedAgent }) {
  const { t } = useTranslation();
  return (
    <section>
      <p>{t(onlineKey(agent.online))}</p>
      <p>{t(gameKey(agent.gameRunning))}</p>
      <p>{t(screenKey(agent.screen))}</p>
    </section>
  );
}
