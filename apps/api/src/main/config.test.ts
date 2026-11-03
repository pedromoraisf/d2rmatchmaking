import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

const SECRET = 'user-secret-value';

describe('loadConfig telemetry settings (OBS-40, OBS-43)', () => {
  it('rejects an http endpoint off loopback and an endpoint with user info', () => {
    expect(() => loadConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.example:4318' })).toThrow(
      'OTEL_EXPORTER_OTLP_ENDPOINT',
    );
    expect(() =>
      loadConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: `https://user:${SECRET}@collector.example` }),
    ).toThrow('OTEL_EXPORTER_OTLP_ENDPOINT');
  });

  it('never echoes the endpoint credentials in the refusal', () => {
    let message = '';
    try {
      loadConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: `https://user:${SECRET}@collector.example` });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toBe('');
    expect(message).not.toContain(SECRET);
  });

  it('accepts an https endpoint and an http endpoint on loopback', () => {
    expect(
      loadConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com:4318' }).telemetry.endpoint,
    ).toBe('https://otlp.example.com:4318');
    expect(loadConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318' }).telemetry.endpoint).toBe(
      'http://127.0.0.1:4318',
    );
    expect(loadConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318' }).telemetry.endpoint).toBe(
      'http://localhost:4318',
    );
    expect(loadConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://[::1]:4318' }).telemetry.endpoint).toBe(
      'http://[::1]:4318',
    );
  });

  it('leaves the endpoint undefined when it is unset or empty', () => {
    expect(loadConfig({}).telemetry.endpoint).toBeUndefined();
    expect(loadConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: '' }).telemetry.endpoint).toBeUndefined();
  });

  it('refuses a sampler argument outside [0, 1]', () => {
    expect(() => loadConfig({ OTEL_TRACES_SAMPLER_ARG: '1.5' })).toThrow('OTEL_TRACES_SAMPLER_ARG');
    expect(() => loadConfig({ OTEL_TRACES_SAMPLER_ARG: 'often' })).toThrow('OTEL_TRACES_SAMPLER_ARG');
    expect(loadConfig({ OTEL_TRACES_SAMPLER_ARG: '0' }).telemetry.samplerArg).toBe('0');
  });

  it('defaults the sampler ratio and the metric interval', () => {
    const telemetry = loadConfig({}).telemetry;

    expect(telemetry.samplerArg).toBe('0.1');
    expect(telemetry.intervalMs).toBe(60_000);
    expect(telemetry.headers).toEqual({});
  });

  it('parses the OTLP headers into a map and refuses a malformed pair without echoing it', () => {
    const parsed = loadConfig({
      OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Bearer%20abc,x-team=d2r',
    }).telemetry.headers;

    expect(parsed).toEqual({ authorization: 'Bearer abc', 'x-team': 'd2r' });
    expect(() => loadConfig({ OTEL_EXPORTER_OTLP_HEADERS: `=${SECRET}` })).toThrow(
      'OTEL_EXPORTER_OTLP_HEADERS',
    );
    try {
      loadConfig({ OTEL_EXPORTER_OTLP_HEADERS: `=${SECRET}` });
    } catch (error) {
      expect(String(error)).not.toContain(SECRET);
    }
  });
});
