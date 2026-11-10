// Generated contract documents (ADR 009, ADR 020). `pnpm contracts:openapi` writes asyncapi.json (AsyncAPI 3.0 for the
// stream) and one JSON Schema per agent-facing message under json-schema/ (consumed by typify in the Rust agent).
// openapi.json is not written here: the API generates it from its routes (apps/api/src/main/openapi.ts).
import { z } from 'zod';
import {
  AgentPresenceChangedEvent,
  CharactersUpdatedEvent,
  RoomAssignedEvent,
  RoomStageChangedEvent,
} from './events/stream.ts';
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
  AgentPresenceChanged: { name: 'agent.presence_changed', schema: AgentPresenceChangedEvent },
  CharactersUpdated: { name: 'characters.updated', schema: CharactersUpdatedEvent },
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
  'agent-event-room-assigned.json': RoomAssignedEvent,
  'record-characters-request.json': RecordCharactersRequest,
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

export function buildJsonSchemaFiles(): Record<string, JsonSchema> {
  return Object.fromEntries(
    Object.entries(JSON_SCHEMA_SOURCES).map(([fileName, schema]) => [
      fileName,
      z.toJSONSchema(schema, { target: AGENT_JSON_SCHEMA_TARGET }),
    ]),
  );
}
