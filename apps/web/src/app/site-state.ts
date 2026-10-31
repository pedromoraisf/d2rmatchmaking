// Applies one live stream event to the site state. Pure: the App owns the state and this computes the next one.
import type { AgentView, SiteStreamEvent } from '@d2rmm/contracts';

export function applyStreamEvent<S extends { agent: AgentView | null }>(state: S, event: SiteStreamEvent): S {
  switch (event.type) {
    case 'agent.presence_changed': {
      const { agentId, online, gameRunning, screen } = event.data;
      const lastSeenAt = state.agent?.status === 'paired' ? state.agent.lastSeenAt : null;
      return { ...state, agent: { status: 'paired', agentId, online, gameRunning, screen, lastSeenAt } };
    }
    default:
      return state;
  }
}
