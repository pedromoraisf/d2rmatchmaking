import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { servedConfigOf } from '../domain/agent-config.ts';
import { createGetAgentConfig } from './get-agent-config.ts';

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
  );
});

beforeEach(() => {
  exporter.reset();
});

const served = servedConfigOf(4, '{"version":4}');

describe('getAgentConfig', () => {
  it('answers the document with its tag when the caller names no version', async () => {
    const getAgentConfig = createGetAgentConfig({ configSource: { current: () => served } });
    expect(await getAgentConfig({})).toStrictEqual({
      status: 'ok',
      body: '{"version":4}',
      etag: '"agent-config-v4"',
    });
  });

  it('answers the document when the caller holds another version', async () => {
    const getAgentConfig = createGetAgentConfig({ configSource: { current: () => served } });
    expect((await getAgentConfig({ ifNoneMatch: '"agent-config-v3"' })).status).toBe('ok');
  });

  it('answers not-modified, with no body, when the caller names the served version', async () => {
    const getAgentConfig = createGetAgentConfig({ configSource: { current: () => served } });
    expect(await getAgentConfig({ ifNoneMatch: '"agent-config-v4"' })).toStrictEqual({
      status: 'not-modified',
      etag: '"agent-config-v4"',
    });
  });

  it('answers none when the source holds no document', async () => {
    const getAgentConfig = createGetAgentConfig({ configSource: { current: () => undefined } });
    expect(await getAgentConfig({ ifNoneMatch: '"agent-config-v4"' })).toStrictEqual({ status: 'none' });
  });

  it('reads the source on every call, so a replaced document is served at once', async () => {
    let current = served;
    const getAgentConfig = createGetAgentConfig({ configSource: { current: () => current } });
    expect((await getAgentConfig({ ifNoneMatch: served.etag })).status).toBe('not-modified');
    current = servedConfigOf(5, '{"version":5}');
    expect(await getAgentConfig({ ifNoneMatch: served.etag })).toStrictEqual({
      status: 'ok',
      body: '{"version":5}',
      etag: '"agent-config-v5"',
    });
  });

  it('records one span with no attribute (nothing of the document or the caller)', async () => {
    const getAgentConfig = createGetAgentConfig({ configSource: { current: () => served } });
    await getAgentConfig({});
    const spans = exporter.getFinishedSpans();
    expect(spans.map((span) => span.name)).toEqual(['agents.get-agent-config']);
    expect(spans[0]?.attributes).toStrictEqual({});
  });
});
