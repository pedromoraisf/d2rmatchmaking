// Stream events of GET /v1/stream (ADR 007). The SSE event name is `type`; the JSON body is the `data` payload.
// Room events carry the same Assignment and Member shapes the agent and the site read (docs/domain/events.md).
import { z } from 'zod';
import { Assignment } from '../http/lobby.ts';
import { Id, Member, RoomStage, Screen } from '../http/common.ts';
import { QueueLeft, QueueTicketView } from '../http/queues.ts';
import { ReadyCheckResolved, ReadyCheckView } from '../http/ready-checks.ts';

export const RoomAssignedEvent = z.object({
  type: z.literal('room.assigned'),
  data: Assignment,
});
export type RoomAssignedEvent = z.infer<typeof RoomAssignedEvent>;

export const RoomStageChangedEvent = z.object({
  type: z.literal('room.stage_changed'),
  data: z.object({
    roomId: Id,
    stage: RoomStage,
    members: z.array(Member).min(1),
  }),
});
export type RoomStageChangedEvent = z.infer<typeof RoomStageChangedEvent>;

// The host opened the next run (LBR-06): the same assignment shape with the new run and name. The agent replaces the
// name it reads for; the site refetches its room.
export const RoomRunOpenedEvent = z.object({
  type: z.literal('room.run_opened'),
  data: Assignment,
});
export type RoomRunOpenedEvent = z.infer<typeof RoomRunOpenedEvent>;

// A member confirmed, left, or the host changed (LBR-04, LBR-07, LBR-08): the members after the change.
export const RoomMemberChangedEvent = z.object({
  type: z.literal('room.member_changed'),
  data: z.object({
    roomId: Id,
    change: z.enum(['confirmed', 'left', 'host_changed']),
    accountId: Id,
    members: z.array(Member),
  }),
});
export type RoomMemberChangedEvent = z.infer<typeof RoomMemberChangedEvent>;

export const AgentPresenceChangedEvent = z.object({
  type: z.literal('agent.presence_changed'),
  data: z.object({
    agentId: Id,
    online: z.boolean(),
    gameRunning: z.boolean(),
    screen: Screen,
  }),
});
export type AgentPresenceChangedEvent = z.infer<typeof AgentPresenceChangedEvent>;

// The account's characters changed (CHR-12). The body is empty: the site refetches GET /v1/me/characters.
export const CharactersUpdatedEvent = z.object({
  type: z.literal('characters.updated'),
  data: z.object({}),
});
export type CharactersUpdatedEvent = z.infer<typeof CharactersUpdatedEvent>;

// The account's ticket changed (QUE-14): the waiting view, or `left` with the reason the site shows.
export const QueueUpdatedEvent = z.object({
  type: z.literal('queue.updated'),
  data: z.discriminatedUnion('status', [QueueTicketView, QueueLeft]),
});
export type QueueUpdatedEvent = z.infer<typeof QueueUpdatedEvent>;

// A ready check opened for the account's group (RDY-01): the view of that member, with the deadline.
export const ReadyCheckStartedEvent = z.object({
  type: z.literal('ready_check.started'),
  data: ReadyCheckView,
});
export type ReadyCheckStartedEvent = z.infer<typeof ReadyCheckStartedEvent>;

// A member accepted, or the check changed for the members still in it (RDY-02): the same view, with the new marks.
export const ReadyCheckUpdatedEvent = z.object({
  type: z.literal('ready_check.updated'),
  data: ReadyCheckView,
});
export type ReadyCheckUpdatedEvent = z.infer<typeof ReadyCheckUpdatedEvent>;

// The check ended (RDY-03 … RDY-05): accepted, declined or timed out.
export const ReadyCheckResolvedEvent = z.object({
  type: z.literal('ready_check.resolved'),
  data: ReadyCheckResolved,
});
export type ReadyCheckResolvedEvent = z.infer<typeof ReadyCheckResolvedEvent>;

// The site stream carries room changes of its account, the presence of its agent, its characters, its queue ticket and
// its ready check.
export const SiteStreamEvent = z.discriminatedUnion('type', [
  RoomAssignedEvent,
  RoomStageChangedEvent,
  RoomRunOpenedEvent,
  RoomMemberChangedEvent,
  AgentPresenceChangedEvent,
  CharactersUpdatedEvent,
  QueueUpdatedEvent,
  ReadyCheckStartedEvent,
  ReadyCheckUpdatedEvent,
  ReadyCheckResolvedEvent,
]);
export type SiteStreamEvent = z.infer<typeof SiteStreamEvent>;

// The agent stream carries the assignment and the ready check's start and end (the agent answers its hotkey, RDY-07);
// it never receives presence of itself or of others.
export const AgentStreamEvent = z.discriminatedUnion('type', [
  RoomAssignedEvent,
  RoomRunOpenedEvent,
  ReadyCheckStartedEvent,
  ReadyCheckResolvedEvent,
]);
export type AgentStreamEvent = z.infer<typeof AgentStreamEvent>;
