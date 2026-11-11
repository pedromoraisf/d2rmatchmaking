// Applies one live stream event to the site state. Pure: the App owns the state and this computes the next one.
import type { AgentView, QueueTicketView, ReadyCheckView, SiteStreamEvent } from '@d2rmm/contracts';
import type { RoomShown } from '../features/lobby-room/RoomPanel.tsx';

/** The reason a queue ticket left the queue on its own, shown to the player (QUE-14); null when nothing is shown. */
export type SiteNotice = 'agent-offline' | 'agent-revoked' | 'site-closed' | null;

interface SiteView {
  agent: AgentView | null;
  room: RoomShown | null;
  /** The player's waiting ticket, or null when not queued (QUE-15). */
  queue?: QueueTicketView | null;
  /** Why the last ticket left the queue, when the player should be told (QUE-14); null otherwise. */
  queueNotice?: SiteNotice;
  /** The open ready check the player is in, or null (RDY-01 … RDY-03). */
  readyCheck?: ReadyCheckView | null;
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
    case 'queue.updated': {
      const { data } = event;
      if (data.status === 'waiting') {
        return { ...state, queue: data, queueNotice: null };
      }
      // A player's own leave and a match are not news to the player; the other reasons are (QUE-14).
      const notice =
        data.reason === 'agent-offline' || data.reason === 'agent-revoked' || data.reason === 'site-closed'
          ? data.reason
          : null;
      return { ...state, queue: null, queueNotice: notice };
    }
    // The check opens for the group (RDY-01); an acceptance replaces its view (RDY-02); its end clears it (RDY-03 … RDY-05).
    case 'ready_check.started':
      return { ...state, readyCheck: event.data };
    case 'ready_check.updated':
      return state.readyCheck?.id === event.data.id ? { ...state, readyCheck: event.data } : state;
    case 'ready_check.resolved':
      return state.readyCheck?.id === event.data.id ? { ...state, readyCheck: null } : state;
  }
}
