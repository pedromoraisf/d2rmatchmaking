// Applies one live stream event to the site state. Pure: the App owns the state and this computes the next one.
import type {
  AgentView,
  Member,
  QueueTicketView,
  ReadyCheckView,
  RoomView,
  SiteStreamEvent,
} from '@d2rmm/contracts';
import type { RoomMemberShown, RoomShown } from '../features/lobby-room/RoomPanel.tsx';

/** The reason a queue ticket left the queue on its own, shown to the player (QUE-14); null when nothing is shown. */
export type SiteNotice = 'agent-offline' | 'agent-revoked' | 'site-closed' | null;

interface SiteView {
  agent: AgentView | null;
  room: RoomShown | null;
  /** The signed-in account: a `left` event about it clears the room. */
  session?: { accountId: string } | null;
  /** The player's waiting ticket, or null when not queued (QUE-15). */
  queue?: QueueTicketView | null;
  /** Why the last ticket left the queue, when the player should be told (QUE-14); null otherwise. */
  queueNotice?: SiteNotice;
  /** The open ready check the player is in, or null (RDY-01 … RDY-03). */
  readyCheck?: ReadyCheckView | null;
}

/** The room the API read, as the panel shows it. */
export function shownRoom(view: RoomView): RoomShown {
  return {
    roomId: view.roomId,
    gameName: view.expectedGameName,
    stage: view.stage,
    run: view.run,
    members: view.members.map((member) => ({
      accountId: member.accountId,
      joinOrder: member.joinOrder,
      role: member.role,
      confirmed: member.confirmed ?? false,
      class: member.class,
      level: member.level,
    })),
    runs: view.runs.map((run) => ({ run: run.run, gameName: run.gameName })),
  };
}

/** The members an event lists, each keeping the class and level already read for it (events carry neither). */
function withMarks(known: readonly RoomMemberShown[], listed: readonly Member[]): RoomMemberShown[] {
  return listed.map((member) => {
    const before = known.find((candidate) => candidate.accountId === member.accountId);
    return {
      accountId: member.accountId,
      joinOrder: member.joinOrder,
      role: member.role,
      confirmed: member.confirmed ?? false,
      class: before?.class ?? null,
      level: before?.level ?? null,
    };
  });
}

export function applyStreamEvent<S extends SiteView>(state: S, event: SiteStreamEvent): S {
  switch (event.type) {
    case 'agent.presence_changed': {
      const { agentId, online, gameRunning, screen } = event.data;
      const lastSeenAt = state.agent?.status === 'paired' ? state.agent.lastSeenAt : null;
      return { ...state, agent: { status: 'paired', agentId, online, gameRunning, screen, lastSeenAt } };
    }
    case 'room.assigned':
      // A newer assignment replaces the room on screen; a fresh room starts "Formed" (LBR-01). The panel reads the
      // members' class and level on the next read.
      return {
        ...state,
        room: {
          roomId: event.data.roomId,
          gameName: event.data.expectedGameName,
          stage: 'formed',
          run: event.data.run,
          members: withMarks([], event.data.members),
          runs: [{ run: event.data.run, gameName: event.data.expectedGameName }],
        },
      };
    case 'room.stage_changed':
      return state.room !== null && state.room.roomId === event.data.roomId
        ? {
            ...state,
            room: {
              ...state.room,
              stage: event.data.stage,
              members: withMarks(state.room.members, event.data.members),
            },
          }
        : state;
    // The host opened the next run (LBR-06): the new name and run join the history; nobody is confirmed for it yet.
    case 'room.run_opened': {
      const { room } = state;
      if (room === null || room.roomId !== event.data.roomId) {
        return state;
      }
      const runs = room.runs.some((known) => known.run === event.data.run)
        ? room.runs
        : [...room.runs, { run: event.data.run, gameName: event.data.expectedGameName }];
      return {
        ...state,
        room: {
          ...room,
          gameName: event.data.expectedGameName,
          run: event.data.run,
          runs,
          members: withMarks(room.members, event.data.members),
        },
      };
    }
    // A member confirmed, left, or the host changed (LBR-04, LBR-07): the room lists the members after the change. The
    // player's own departure clears the room.
    case 'room.member_changed': {
      const { room } = state;
      if (room === null || room.roomId !== event.data.roomId) {
        return state;
      }
      if (event.data.change === 'left' && event.data.accountId === state.session?.accountId) {
        return { ...state, room: null };
      }
      return { ...state, room: { ...room, members: withMarks(room.members, event.data.members) } };
    }
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
