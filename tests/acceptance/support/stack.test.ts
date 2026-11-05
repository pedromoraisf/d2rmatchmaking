import { afterEach, describe, expect, it } from 'vitest';
import { FakeTelemetryBackend } from './stack.ts';

const payload = Buffer.from('{"resourceSpans":[]}');

describe('FakeTelemetryBackend', () => {
  let backend: FakeTelemetryBackend | undefined;

  afterEach(async () => {
    await backend?.stop();
    backend = undefined;
  });

  it('the fake telemetry backend records requests and can refuse, hang or answer an error', async () => {
    backend = new FakeTelemetryBackend();
    await backend.start();
    const post = (signal?: AbortSignal): Promise<Response> =>
      fetch(`${backend?.url ?? ''}/v1/traces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        ...(signal === undefined ? {} : { signal }),
      });

    const accepted = await post();
    expect(accepted.status).toBe(200);
    expect(backend.requests).toHaveLength(1);
    expect(backend.requests[0]).toMatchObject({ method: 'POST', path: '/v1/traces' });
    expect(backend.requests[0]?.body.equals(payload)).toBe(true);

    await backend.setMode('error');
    const failed = await post();
    expect(failed.status).toBe(500);
    expect(backend.requests).toHaveLength(2);

    await backend.setMode('refuse');
    await expect(post()).rejects.toMatchObject({ cause: { code: 'ECONNREFUSED' } });
    expect(backend.requests).toHaveLength(2);

    await backend.setMode('hang');
    await expect(post(AbortSignal.timeout(300))).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(backend.requests).toHaveLength(3);
  });
});
