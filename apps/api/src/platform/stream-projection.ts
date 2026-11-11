import type { AgentStreamEvent, SiteStreamEvent } from '@d2rmm/contracts';
import type { AgentsPort } from '../modules/agents/index.ts';
import {
  err,
  ok,
  type AnyDomainEvent,
  type ReadyCheckChangedPayload,
  type Result,
} from '../shared-kernel/index.ts';

/** One message for one stream: a site stream of an account, or the agent stream of an agent. */
export type Delivery =
  | { readonly stream: 'site'; readonly accountId: string; readonly event: SiteStreamEvent }
  | { readonly stream: 'agent'; readonly agentId: string; readonly event: AgentStreamEvent };

export type CurrentAgentLookup = Pick<AgentsPort, 'currentAgentOf'>;

/**
 * Maps a domain event to the stream messages it produces (design.md § Platform, stream projection):
 * `RoomAssignmentChanged` → `room.assigned` to each member's site and to each member's current agent;
 * `RoomStageChanged` → `room.stage_changed` to each member's site; `RoomRunOpened` → `room.run_opened` to each member's
 * site and agent; `RoomMemberChanged` → `room.member_changed` to each member's site (and the member who left); `AgentPresenceChanged` → `agent.presence_changed`
 * to the owner's site. `MatchFormed` and `AgentRevoked` are not streamed (AgentRevoked closes streams instead).
 */
export async function projectStreamEvent(
  event: AnyDomainEvent,
  agents: CurrentAgentLookup,
): Promise<Delivery[]> {
  switch (event.type) {
    case 'RoomAssignmentChanged': {
      const { payload } = event;
      const data = {
        roomId: payload.roomId,
        run: payload.run,
        expectedGameName: payload.expectedGameName,
        members: [...payload.members],
      };
      const deliveries: Delivery[] = [];
      for (const member of payload.members) {
        deliveries.push({
          stream: 'site',
          accountId: member.accountId,
          event: { type: 'room.assigned', data },
        });
        const agentId = await agents.currentAgentOf(member.accountId);
        if (agentId !== null) {
          deliveries.push({ stream: 'agent', agentId, event: { type: 'room.assigned', data } });
        }
      }
      return deliveries;
    }
    case 'RoomStageChanged': {
      const { payload } = event;
      return payload.members.map((member) => ({
        stream: 'site' as const,
        accountId: member.accountId,
        event: {
          type: 'room.stage_changed' as const,
          data: { roomId: payload.roomId, stage: payload.stage, members: [...payload.members] },
        },
      }));
    }
    case 'RoomRunOpened': {
      // The next run (LBR-06): every member's site and current agent get the new name; the agent reads for it from now on.
      const { payload } = event;
      const data = {
        roomId: payload.roomId,
        run: payload.run,
        expectedGameName: payload.expectedGameName,
        members: [...payload.members],
      };
      const deliveries: Delivery[] = [];
      for (const member of payload.members) {
        deliveries.push({
          stream: 'site',
          accountId: member.accountId,
          event: { type: 'room.run_opened', data },
        });
        const agentId = await agents.currentAgentOf(member.accountId);
        if (agentId !== null) {
          deliveries.push({ stream: 'agent', agentId, event: { type: 'room.run_opened', data } });
        }
      }
      return deliveries;
    }
    case 'RoomMemberChanged': {
      // A confirmation, a departure or a new host (LBR-04, LBR-07, LBR-08): the remaining members' sites, and the member
      // who left, who is no longer among the members.
      const { payload } = event;
      const accountIds = payload.members.map((member) => member.accountId);
      if (payload.change === 'left' && !accountIds.includes(payload.accountId)) {
        accountIds.push(payload.accountId);
      }
      return accountIds.map((accountId) => ({
        stream: 'site' as const,
        accountId,
        event: {
          type: 'room.member_changed' as const,
          data: {
            roomId: payload.roomId,
            change: payload.change,
            accountId: payload.accountId,
            members: [...payload.members],
          },
        },
      }));
    }
    case 'AgentPresenceChanged': {
      const { payload } = event;
      return [
        {
          stream: 'site',
          accountId: payload.accountId,
          event: {
            type: 'agent.presence_changed',
            data: {
              agentId: payload.agentId,
              online: payload.online,
              gameRunning: payload.gameRunning,
              screen: payload.screen,
            },
          },
        },
      ];
    }
    case 'QueueUpdated': {
      // The waiting view, or `left` with its reason (QUE-14, QUE-15). The body carries no account id: the stream routes by owner.
      return [
        {
          stream: 'site',
          accountId: event.payload.accountId,
          event: { type: 'queue.updated', data: event.payload.update },
        },
      ];
    }
    case 'ReadyCheckStarted': {
      // The open check goes to each member's site and agent (RDY-01).
      const { payload } = event;
      const deliveries: Delivery[] = [];
      for (const member of payload.members) {
        const data = readyCheckViewFor(payload, member.accountId);
        deliveries.push({
          stream: 'site',
          accountId: member.accountId,
          event: { type: 'ready_check.started', data },
        });
        const agentId = await agents.currentAgentOf(member.accountId);
        if (agentId !== null) {
          deliveries.push({ stream: 'agent', agentId, event: { type: 'ready_check.started', data } });
        }
      }
      return deliveries;
    }
    case 'ReadyCheckUpdated': {
      // An acceptance, while the check is open, goes to each member's site only (RDY-02).
      const { payload } = event;
      return payload.members.map((member) => ({
        stream: 'site' as const,
        accountId: member.accountId,
        event: {
          type: 'ready_check.updated' as const,
          data: readyCheckViewFor(payload, member.accountId),
        },
      }));
    }
    case 'ReadyCheckResolved': {
      // The outcome goes to every member's site and agent; the body names no one (RDY-03 … RDY-05).
      const { payload } = event;
      const deliveries: Delivery[] = [];
      for (const accountId of payload.accountIds) {
        const data = { id: payload.readyCheckId, outcome: payload.outcome };
        deliveries.push({ stream: 'site', accountId, event: { type: 'ready_check.resolved', data } });
        const agentId = await agents.currentAgentOf(accountId);
        if (agentId !== null) {
          deliveries.push({ stream: 'agent', agentId, event: { type: 'ready_check.resolved', data } });
        }
      }
      return deliveries;
    }
    case 'CharactersRecorded': {
      // The site refetches its list; the event carries no character (CHR-12, CHR-13).
      return [
        {
          stream: 'site',
          accountId: event.payload.accountId,
          event: { type: 'characters.updated', data: {} },
        },
      ];
    }
    default:
      return [];
  }
}

/**
 * The open check as one member sees it: the members by position and class mark, and the member's own mark as `you`
 * (RDY-01, RDY-02). No account id and no name leaves the server.
 */
function readyCheckViewFor(payload: ReadyCheckChangedPayload, accountId: string) {
  return {
    id: payload.readyCheckId,
    mode: payload.mode,
    difficulty: payload.difficulty,
    deadline: payload.deadline,
    now: payload.serverNow,
    members: payload.members.map((other) => ({
      position: other.position,
      class: other.characterClass,
      level: other.level,
      accepted: other.accepted,
      you: other.accountId === accountId,
    })),
  };
}

/** A stream event id: `<outboxId>` for a durable event, `<outboxId>.<k>` for a transient one (AWS-39). */
export interface StreamId {
  readonly outboxId: bigint;
  readonly k: number;
}

const STREAM_ID_PATTERN = /^(\d+)(?:\.(\d+))?$/;

/** Parses an id the stream hub issued. Anything else, including a client's `Last-Event-ID`, is refused. */
export function parseStreamId(raw: string): Result<StreamId, 'invalid-stream-id'> {
  const match = STREAM_ID_PATTERN.exec(raw);
  if (match === null) {
    return err('invalid-stream-id');
  }
  return ok({ outboxId: BigInt(match[1] ?? '0'), k: Number(match[2] ?? '0') });
}

/**
 * Orders two stream ids by `(outboxId, k)`, so `12 < 12.1 < 12.2 < 13`. Callers parse untrusted input with
 * `parseStreamId` first; this function throws on a malformed id.
 */
export function compareStreamIds(a: string, b: string): number {
  const left = parseStreamId(a);
  const right = parseStreamId(b);
  if (!left.ok || !right.ok) {
    throw new RangeError('stream ids have the form <outboxId> or <outboxId>.<k>');
  }
  if (left.value.outboxId !== right.value.outboxId) {
    return left.value.outboxId < right.value.outboxId ? -1 : 1;
  }
  return Math.sign(left.value.k - right.value.k);
}
