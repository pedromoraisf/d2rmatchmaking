// The agent's state in the header (SHL-02): no agent paired, offline, online with the game closed, or online with the
// game open. The state is a pure mapping of the agent view (tested apart from the rendering).
import type { AgentView } from '@d2rmm/contracts';
import { useTranslation } from 'react-i18next';

export type AgentPillState = 'none' | 'offline' | 'online';

export interface AgentPillShown {
  state: AgentPillState;
  /** The translation key of the label the header shows. */
  key: string;
}

export function agentPillShown(agent: AgentView | null): AgentPillShown {
  if (agent === null || agent.status === 'none') {
    return { state: 'none', key: 'header.agent.none' };
  }
  if (!agent.online) {
    return { state: 'offline', key: 'header.agent.offline' };
  }
  return agent.gameRunning
    ? { state: 'online', key: 'header.agent.gameOpen' }
    : { state: 'online', key: 'header.agent.gameClosed' };
}

export function AgentPill({ agent }: { agent: AgentView | null }) {
  const { t } = useTranslation();
  const shown = agentPillShown(agent);
  return (
    <div className="agent-pill" data-state={shown.state}>
      <span className="dot" aria-hidden="true" />
      <span>{t(shown.key)}</span>
    </div>
  );
}
