// Applies one live stream event to the site state. Pure: the App owns the state and this computes the next one.
import type { AgentView, SiteStreamEvent } from '@d2rmm/contracts';
import type { RoomShown } from '../features/lobby-room/RoomPanel.tsx';

interface SiteView {
  agent: AgentView | null;
  room: RoomShown | null;
}

export function applyStreamEvent<S extends SiteView>(state: S, event: SiteStreamEvent): S {
  switch (event.type) {
    case 'agent.presence_changed': {
      const { agentId, online, gameRunning, screen } = event.data;
      const lastSeenAt = state.agent?.status === 'paired' ? state.agent.lastSeenAt : null;
      return { ...state, agent: { status: 'paired', agentId, online, gameRunning, screen, lastSeenAt } };
    }
    case 'room.assigned':
      // A newer assignment replaces the room on screen; a fresh room starts at "Awaiting host" (AD-039).
      return {
        ...state,
        room: { roomId: event.data.roomId, gameName: event.data.expectedGameName, stage: 'awaiting_host' },
      };
    case 'room.stage_changed':
      return state.room !== null && state.room.roomId === event.data.roomId
        ? { ...state, room: { ...state.room, stage: event.data.stage } }
        : state;
    // The character list refetches on this event; the presence and room state do not change.
    case 'characters.updated':
      return state;
  }
}
