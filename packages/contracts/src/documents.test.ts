import { describe, expect, it } from 'vitest';
import { buildAsyncApiDocument, buildJsonSchemaFiles, buildOpenApiDocument } from './documents.ts';

describe('contract documents', () => {
  it('builds an OpenAPI 3.1 document with no paths', () => {
    expect(buildOpenApiDocument()).toStrictEqual({
      openapi: '3.1.0',
      info: { title: 'D2R Match Making API', version: '0.0.0' },
      paths: {},
    });
  });

  it('builds an AsyncAPI 3.0 document with the stream channel and its ten messages', () => {
    const document = buildAsyncApiDocument();
    expect(document.asyncapi).toBe('3.0.0');
    expect(document.channels.stream.address).toBe('/v1/stream');
    expect(Object.keys(document.channels.stream.messages)).toStrictEqual([
      'RoomAssigned',
      'RoomStageChanged',
      'RoomRunOpened',
      'RoomMemberChanged',
      'AgentPresenceChanged',
      'CharactersUpdated',
      'QueueUpdated',
      'ReadyCheckStarted',
      'ReadyCheckUpdated',
      'ReadyCheckResolved',
    ]);
    expect(document.components.messages['RoomStageChanged']?.name).toBe('room.stage_changed');
  });

  it('writes one JSON Schema per agent message', () => {
    expect(Object.keys(buildJsonSchemaFiles()).sort()).toStrictEqual([
      'agent-event-ready-check-resolved.json',
      'agent-event-ready-check-started.json',
      'agent-event-room-assigned.json',
      'agent-event-room-run-opened.json',
      'assignment.json',
      'claim-request.json',
      'claim.json',
      'heartbeat.json',
      'observation.json',
      'pairing-code.json',
      'record-characters-request.json',
    ]);
  });

  it('writes the draft-07 agent schemas', () => {
    const files = buildJsonSchemaFiles();
    for (const schema of Object.values(files)) {
      expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    }
  });

  it('keeps image data out of the observation schema', () => {
    const observation = JSON.stringify(buildJsonSchemaFiles()['observation.json']);
    expect(observation).not.toMatch(/image|bitmap|base64|pixels|png/i);
  });

  it('returns equal documents on every call', () => {
    expect(buildOpenApiDocument()).toStrictEqual(buildOpenApiDocument());
    expect(buildAsyncApiDocument()).toStrictEqual(buildAsyncApiDocument());
  });

  it('produces byte-identical output on every run', () => {
    expect(JSON.stringify(buildAsyncApiDocument())).toBe(JSON.stringify(buildAsyncApiDocument()));
    expect(JSON.stringify(buildJsonSchemaFiles())).toBe(JSON.stringify(buildJsonSchemaFiles()));
  });
});
