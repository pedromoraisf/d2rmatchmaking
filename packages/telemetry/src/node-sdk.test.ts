import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startNodeTelemetry, type TelemetryHandle } from './node-sdk.ts';

type Recorded = { path: string; authorization: string | undefined };

// A local OTLP/HTTP endpoint that records every request and answers with a fixed status.
async function startRecorder(
  status: number,
): Promise<{ endpoint: string; requests: Recorded[]; close(): Promise<void> }> {
  const requests: Recorded[] = [];
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    request.on('data', () => undefined);
    request.on('end', () => {
      requests.push({ path: request.url ?? '', authorization: request.headers.authorization });
      response.writeHead(status);
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const handles: TelemetryHandle[] = [];
const recorders: { close(): Promise<void> }[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.shutdown();
  for (const recorder of recorders.splice(0)) await recorder.close();
});

describe('startNodeTelemetry', () => {
  it('exports traces and metrics to the endpoint', async () => {
    const recorder = await startRecorder(200);
    recorders.push(recorder);
    const handle = startNodeTelemetry({
      serviceName: 'd2rmm-test',
      serviceVersion: '0.0.0',
      environment: 'test',
      endpoint: recorder.endpoint,
      headers: { authorization: 'Bearer test-credential' },
      samplerArg: '1',
      intervalMs: 60_000,
      onExportError: vi.fn(),
    });
    handles.push(handle);

    handle.tracerProvider.getTracer('test').startSpan('operation').end();
    handle.meterProvider.getMeter('d2rmm').createCounter('d2rmm.test.counter').add(1);
    // Severity 13 is WARN: below it a record leaves only when its span is sampled (RedactingLogRecordExporter).
    handle.loggerProvider.getLogger('test').emit({ body: 'hello', severityNumber: 13 });
    await handle.shutdown();
    handles.splice(0);

    const paths = recorder.requests.map((request) => request.path);
    expect(paths).toEqual(expect.arrayContaining(['/v1/traces', '/v1/metrics', '/v1/logs']));
    expect(recorder.requests.every((request) => request.authorization === 'Bearer test-credential')).toBe(
      true,
    );
  });

  it('reports at most one export error a minute', async () => {
    const recorder = await startRecorder(400);
    recorders.push(recorder);
    let clock = 0;
    const onExportError = vi.fn();
    const handle = startNodeTelemetry({
      serviceName: 'd2rmm-test',
      serviceVersion: '0.0.0',
      environment: 'test',
      endpoint: recorder.endpoint,
      samplerArg: '1',
      intervalMs: 60_000,
      onExportError,
      now: () => clock,
    });
    handles.push(handle);

    // Each flush rejects with the export failure (the span processor's contract); the report is what is limited.
    const failingFlush = async (name: string): Promise<void> => {
      handle.tracerProvider.getTracer('test').startSpan(name).end();
      await expect(handle.tracerProvider.forceFlush()).rejects.toThrow();
    };

    await failingFlush('first');
    await failingFlush('second');
    expect(onExportError).toHaveBeenCalledTimes(1);

    clock = 59_999;
    await failingFlush('third');
    expect(onExportError).toHaveBeenCalledTimes(1);

    clock = 60_000;
    await failingFlush('fourth');
    expect(onExportError).toHaveBeenCalledTimes(2);
  });
});
