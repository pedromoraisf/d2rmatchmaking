// Generated contract documents (ADR 009, ADR 020). `pnpm contracts:openapi` writes asyncapi.json (AsyncAPI 3.0 for the
// stream) and one JSON Schema per agent-facing message under json-schema/ (consumed by typify in the Rust agent).
// openapi.json is not written here: the API generates it from its routes (apps/api/src/main/openapi.ts).
import { z } from 'zod';
import {
  AgentPresenceChangedEvent,
  AgentRoomAssignedEvent,
  AgentReadyCheckStartedEvent,
  AgentRoomRunOpenedEvent,
  CharactersUpdatedEvent,
  QueueUpdatedEvent,
  ReadyCheckResolvedEvent,
  ReadyCheckStartedEvent,
  ReadyCheckUpdatedEvent,
  RoomAssignedEvent,
  RoomMemberChangedEvent,
  RoomRunOpenedEvent,
  RoomStageChangedEvent,
  AgentRoomStageChangedEvent,
} from './events/stream.ts';
import { AgentConfig } from './http/agent-config.ts';
import { ClaimRequest, ClaimResponse, Heartbeat, PairingCodeResponse } from './http/agents.ts';
import { RecordCharactersRequest } from './http/characters.ts';
import { Assignment, Observation } from './http/lobby.ts';

export interface OpenApiDocument {
  openapi: '3.1.0';
  info: { title: string; version: string };
  paths: Record<string, never>;
}

export interface AsyncApiDocument {
  asyncapi: '3.0.0';
  info: { title: string; version: string };
  channels: {
    stream: { address: '/v1/stream'; messages: Record<string, { $ref: string }> };
  };
  operations: {
    receiveStreamEvent: { action: 'receive'; channel: { $ref: '#/channels/stream' } };
  };
  components: {
    messages: Record<string, { name: string; contentType: 'application/json'; payload: JsonSchema }>;
  };
}

export type JsonSchema = z.core.JSONSchema.BaseSchema;

const STREAM_MESSAGES = {
  RoomAssigned: { name: 'room.assigned', schema: RoomAssignedEvent },
  RoomStageChanged: { name: 'room.stage_changed', schema: RoomStageChangedEvent },
  // The agent's copies: no member list, or an empty one (stream-egress SEG-01, SEG-03).
  AgentRoomAssigned: { name: 'room.assigned', schema: AgentRoomAssignedEvent },
  AgentRoomRunOpened: { name: 'room.run_opened', schema: AgentRoomRunOpenedEvent },
  AgentReadyCheckStarted: { name: 'ready_check.started', schema: AgentReadyCheckStartedEvent },
  AgentRoomStageChanged: { name: 'room.stage_changed', schema: AgentRoomStageChangedEvent },
  RoomRunOpened: { name: 'room.run_opened', schema: RoomRunOpenedEvent },
  RoomMemberChanged: { name: 'room.member_changed', schema: RoomMemberChangedEvent },
  AgentPresenceChanged: { name: 'agent.presence_changed', schema: AgentPresenceChangedEvent },
  CharactersUpdated: { name: 'characters.updated', schema: CharactersUpdatedEvent },
  QueueUpdated: { name: 'queue.updated', schema: QueueUpdatedEvent },
  ReadyCheckStarted: { name: 'ready_check.started', schema: ReadyCheckStartedEvent },
  ReadyCheckUpdated: { name: 'ready_check.updated', schema: ReadyCheckUpdatedEvent },
  ReadyCheckResolved: { name: 'ready_check.resolved', schema: ReadyCheckResolvedEvent },
} as const;

// One file per agent-facing message (AWS-36). The claim file carries the response, the message that holds the token.
// The agent's stream event is one schema per event (typify does not map the union, AD-060).
const JSON_SCHEMA_SOURCES = {
  'pairing-code.json': PairingCodeResponse,
  'claim-request.json': ClaimRequest,
  'claim.json': ClaimResponse,
  'heartbeat.json': Heartbeat,
  'assignment.json': Assignment,
  'observation.json': Observation,
  // The remote configuration (remote-config RCF-02): the agent tests its defaults against the generated type.
  'agent-config.json': AgentConfig,
  'agent-event-room-assigned.json': AgentRoomAssignedEvent,
  'agent-event-room-run-opened.json': AgentRoomRunOpenedEvent,
  'agent-event-room-stage-changed.json': AgentRoomStageChangedEvent,
  'record-characters-request.json': RecordCharactersRequest,
  'agent-event-ready-check-started.json': AgentReadyCheckStartedEvent,
  'agent-event-ready-check-resolved.json': ReadyCheckResolvedEvent,
} as const;

// Agent schemas are draft-07: typify reads that dialect (ADR 009, AD-060).
const AGENT_JSON_SCHEMA_TARGET = 'draft-7';

export function buildOpenApiDocument(): OpenApiDocument {
  return {
    openapi: '3.1.0',
    info: { title: 'D2R Match Making API', version: '0.0.0' },
    paths: {},
  };
}

export function buildAsyncApiDocument(): AsyncApiDocument {
  const messages = Object.fromEntries(
    Object.keys(STREAM_MESSAGES).map((key) => [key, { $ref: `#/components/messages/${key}` }]),
  );
  const components = Object.fromEntries(
    Object.entries(STREAM_MESSAGES).map(([key, message]) => [
      key,
      {
        name: message.name,
        contentType: 'application/json' as const,
        payload: z.toJSONSchema(message.schema),
      },
    ]),
  );
  return {
    asyncapi: '3.0.0',
    info: { title: 'D2R Match Making events', version: '0.0.0' },
    channels: { stream: { address: '/v1/stream', messages } },
    operations: { receiveStreamEvent: { action: 'receive', channel: { $ref: '#/channels/stream' } } },
    components: { messages: components },
  };
}

// The agent's stage change is the room and the stage only (stream-egress SEG-01), yet an agent keeps hearing the end of a room
// from an API that still sends the member list (docs/engineering/stream-events.md: the agent accepts a dropped field). Its
// `data` therefore allows extra properties in the agent's schema, so the generated type has no `deny_unknown_fields`. The API's
// own schema stays strict: it strips the member list, so none leaks onto the agent's stream.
const TOLERANT_DATA = new Set<string>(['agent-event-room-stage-changed.json']);

function allowExtraData(schema: JsonSchema): JsonSchema {
  const properties = schema['properties'] as Record<string, Record<string, unknown>> | undefined;
  const data = properties?.['data'];
  if (data === undefined) {
    throw new Error('an agent event schema has no data object to relax');
  }
  return { ...schema, properties: { ...properties, data: { ...data, additionalProperties: true } } };
}

export function buildJsonSchemaFiles(): Record<string, JsonSchema> {
  return Object.fromEntries(
    Object.entries(JSON_SCHEMA_SOURCES).map(([fileName, schema]) => {
      const generated = z.toJSONSchema(schema, { target: AGENT_JSON_SCHEMA_TARGET });
      return [fileName, TOLERANT_DATA.has(fileName) ? allowExtraData(generated) : generated];
    }),
  );
}
