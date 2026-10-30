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

  it('builds an AsyncAPI 3.0 document with the stream channel and its three messages', () => {
    const document = buildAsyncApiDocument();
    expect(document.asyncapi).toBe('3.0.0');
    expect(document.channels.stream.address).toBe('/v1/stream');
    expect(Object.keys(document.channels.stream.messages)).toStrictEqual([
      'RoomAssigned',
      'RoomStageChanged',
      'AgentPresenceChanged',
    ]);
    expect(document.components.messages['RoomStageChanged']?.name).toBe('room.stage_changed');
  });

  it('writes one JSON Schema per agent message', () => {
    expect(Object.keys(buildJsonSchemaFiles()).sort()).toStrictEqual([
      'agent-stream-event.json',
      'assignment.json',
      'claim.json',
      'heartbeat.json',
      'observation.json',
      'pairing-code.json',
    ]);
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
