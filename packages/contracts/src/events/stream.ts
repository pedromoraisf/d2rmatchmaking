// Stream events of GET /v1/stream (ADR 007). The SSE event name is `type`; the JSON body is the `data` payload.
// Room events carry the same Assignment and Member shapes the agent and the site read (docs/domain/events.md).
import { z } from 'zod';
import { Assignment } from '../http/lobby.ts';
import { Id, Member, RoomStage, Screen } from '../http/common.ts';

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

// The site stream carries room changes of its account, the presence of its agent and its characters.
export const SiteStreamEvent = z.discriminatedUnion('type', [
  RoomAssignedEvent,
  RoomStageChangedEvent,
  AgentPresenceChangedEvent,
  CharactersUpdatedEvent,
]);
export type SiteStreamEvent = z.infer<typeof SiteStreamEvent>;

// The agent stream carries only the assignment: the agent never receives presence of itself or of others.
export const AgentStreamEvent = z.discriminatedUnion('type', [RoomAssignedEvent]);
export type AgentStreamEvent = z.infer<typeof AgentStreamEvent>;
