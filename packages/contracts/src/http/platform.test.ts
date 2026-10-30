import { describe, expect, it } from 'vitest';
import { ConfigResponse, ErrorResponse, MeResponse, TestLoginRequest } from './platform.ts';

describe('TestLoginRequest', () => {
  it('accepts a player name', () => {
    expect(TestLoginRequest.parse({ name: 'PlayerOne' })).toStrictEqual({ name: 'PlayerOne' });
  });

  it('rejects a name longer than 64 characters', () => {
    expect(TestLoginRequest.safeParse({ name: 'x'.repeat(65) }).success).toBe(false);
  });
});

describe('MeResponse', () => {
  it('accepts the signed-in account', () => {
    const me = { accountId: 'acc-1', displayName: 'PlayerOne' };
    expect(MeResponse.parse(me)).toStrictEqual(me);
  });
});

describe('ConfigResponse', () => {
  it('accepts the feature flags and the minimum agent version', () => {
    const config = { stagingEndpoints: true, minAgentVersion: '0.0.1' };
    expect(ConfigResponse.parse(config)).toStrictEqual(config);
  });

  it('rejects a minimum agent version that is not semantic', () => {
    expect(ConfigResponse.safeParse({ stagingEndpoints: false, minAgentVersion: '1.0' }).success).toBe(false);
  });
});

describe('ErrorResponse', () => {
  it('accepts an invalid-request error that lists field paths only', () => {
    const body = { error: 'invalid-request', fields: ['code'] };
    expect(ErrorResponse.parse(body)).toStrictEqual(body);
  });
});
