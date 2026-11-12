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

describe('loopback hosts for plain http (IDB-06, OBS-40)', () => {
  it('refuses a hostname that only starts with 127. for both URL settings', () => {
    for (const host of ['127.evil.example', '127.0.0.1.nip.io']) {
      expect(() => loadConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: `http://${host}:4318` })).toThrow(
        'OTEL_EXPORTER_OTLP_ENDPOINT',
      );
      expect(() =>
        loadConfig({
          BNET_CLIENT_ID: 'public-client-id',
          BNET_CLIENT_SECRET: 'bnet-client-secret-value',
          BNET_OAUTH_BASE_URL: `http://${host}:9000`,
        }),
      ).toThrow('BNET_OAUTH_BASE_URL');
    }
  });

  it('accepts a full IPv4 address in 127.0.0.0/8 for both URL settings', () => {
    for (const host of ['127.0.0.1', '127.1.2.3']) {
      expect(loadConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: `http://${host}:4318` }).telemetry.endpoint).toBe(
        `http://${host}:4318`,
      );
      expect(
        loadConfig({
          BNET_CLIENT_ID: 'public-client-id',
          BNET_CLIENT_SECRET: 'bnet-client-secret-value',
          BNET_OAUTH_BASE_URL: `http://${host}:9000`,
        }).bnet?.baseUrl,
      ).toBe(`http://${host}:9000`);
    }
  });

  it('refuses an IPv4 address with a part above 255', () => {
    expect(() => loadConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.256:4318' })).toThrow(
      'OTEL_EXPORTER_OTLP_ENDPOINT',
    );
  });
});

describe('loadConfig Battle.net settings (IDB-06, IDB-11)', () => {
  const CLIENT_SECRET = 'bnet-client-secret-value';
  const credentials = { BNET_CLIENT_ID: 'public-client-id', BNET_CLIENT_SECRET: CLIENT_SECRET };

  it('is undefined unless both the client id and the client secret are set', () => {
    expect(loadConfig({}).bnet).toBeUndefined();
    expect(loadConfig({ BNET_CLIENT_ID: 'public-client-id' }).bnet).toBeUndefined();
    expect(loadConfig({ BNET_CLIENT_SECRET: CLIENT_SECRET }).bnet).toBeUndefined();
    expect(loadConfig({ BNET_CLIENT_ID: '', BNET_CLIENT_SECRET: CLIENT_SECRET }).bnet).toBeUndefined();
    expect(loadConfig({ BNET_CLIENT_ID: 'public-client-id', BNET_CLIENT_SECRET: '' }).bnet).toBeUndefined();
  });

  it('reads the client id and secret when both are set, with the default base URL', () => {
    expect(loadConfig(credentials).bnet).toEqual({
      clientId: 'public-client-id',
      clientSecret: CLIENT_SECRET,
      baseUrl: 'https://oauth.battle.net',
    });
  });

  it('defaults the base URL to the Battle.net OAuth host when it is unset or empty', () => {
    expect(loadConfig({ ...credentials, BNET_OAUTH_BASE_URL: '' }).bnet?.baseUrl).toBe(
      'https://oauth.battle.net',
    );
  });

  it('accepts an https base URL and an http base URL on loopback, for the fake provider', () => {
    expect(
      loadConfig({ ...credentials, BNET_OAUTH_BASE_URL: 'https://oauth.example.test' }).bnet?.baseUrl,
    ).toBe('https://oauth.example.test');
    expect(loadConfig({ ...credentials, BNET_OAUTH_BASE_URL: 'http://127.0.0.1:9000' }).bnet?.baseUrl).toBe(
      'http://127.0.0.1:9000',
    );
    expect(loadConfig({ ...credentials, BNET_OAUTH_BASE_URL: 'http://localhost:9000' }).bnet?.baseUrl).toBe(
      'http://localhost:9000',
    );
  });

  it('refuses an http base URL off loopback, and one with user info, without echoing it', () => {
    expect(() => loadConfig({ ...credentials, BNET_OAUTH_BASE_URL: 'http://oauth.example.test' })).toThrow(
      'BNET_OAUTH_BASE_URL',
    );
    let message = '';
    try {
      loadConfig({ ...credentials, BNET_OAUTH_BASE_URL: `https://user:${CLIENT_SECRET}@oauth.example.test` });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('BNET_OAUTH_BASE_URL');
    expect(message).not.toContain(CLIENT_SECRET);
  });

  it('refuses a malformed base URL even when the credentials are not set', () => {
    expect(() => loadConfig({ BNET_OAUTH_BASE_URL: 'not a url' })).toThrow('BNET_OAUTH_BASE_URL');
  });
});

describe('loadConfig room drop tolerance (LBR-08)', () => {
  it('defaults to 60 seconds', () => {
    expect(loadConfig({}).roomDropToleranceSeconds).toBe(60);
  });

  it('reads ROOM_DROP_TOLERANCE_SECONDS and refuses zero and text', () => {
    expect(loadConfig({ ROOM_DROP_TOLERANCE_SECONDS: '90' }).roomDropToleranceSeconds).toBe(90);
    expect(() => loadConfig({ ROOM_DROP_TOLERANCE_SECONDS: '0' })).toThrow('ROOM_DROP_TOLERANCE_SECONDS');
    expect(() => loadConfig({ ROOM_DROP_TOLERANCE_SECONDS: 'soon' })).toThrow('ROOM_DROP_TOLERANCE_SECONDS');
  });
});
