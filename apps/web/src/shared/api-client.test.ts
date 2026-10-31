import { describe, expect, it } from 'vitest';
import { createApiClient } from './api-client.ts';
import { jsonResponse, routeFetch } from '../test/fake-api.ts';

const room = {
  roomId: '4821',
  mode: 'leveling',
  activity: 'baal',
  difficulty: 'hell',
  stage: 'awaiting_host',
  run: 1,
  expectedGameName: 'mmbaalh-12',
  password: '',
  members: [{ accountId: 'acc-1', characterId: null, joinOrder: 1, role: 'host' }],
};

describe('api client', () => {
  it('every POST sends the JSON content type and a JSON body', async () => {
    const { fetch, calls } = routeFetch({
      'POST /api/v1/auth/test-login': () => jsonResponse(204),
      'POST /api/v1/agents/pair': () => jsonResponse(200),
      'POST /api/v1/staging/match-formed': () => jsonResponse(202),
    });
    const client = createApiClient(fetch);

    expect((await client.testLogin('PlayerOne')).ok).toBe(true);
    expect((await client.pair('123456')).ok).toBe(true);
    expect((await client.matchFormed()).ok).toBe(true);

    for (const call of calls) {
      expect(call.init.headers).toStrictEqual({ 'Content-Type': 'application/json' });
    }
    expect(calls.map((call) => call.init.body)).toStrictEqual([
      '{"name":"PlayerOne"}',
      '{"code":"123456"}',
      '{}',
    ]);
  });

  it('calls only the same-origin /api/v1 routes', async () => {
    const { fetch, calls } = routeFetch({ 'GET /api/v1/me/room': () => jsonResponse(200, room) });
    await createApiClient(fetch).myRoom();
    expect(calls.map((call) => call.url)).toStrictEqual(['/api/v1/me/room']);
  });

  it('maps a 401 to unauthenticated', async () => {
    const { fetch } = routeFetch({ 'GET /api/v1/me': () => jsonResponse(401) });
    expect(await createApiClient(fetch).me()).toStrictEqual({ ok: false, failure: 'unauthenticated' });
  });

  it('maps a 400 on sign-in to invalid and a 429 on pairing to rate-limited', async () => {
    const { fetch } = routeFetch({
      'POST /api/v1/auth/test-login': () => jsonResponse(400),
      'POST /api/v1/agents/pair': () => jsonResponse(429),
    });
    const client = createApiClient(fetch);
    expect(await client.testLogin('x')).toStrictEqual({ ok: false, failure: 'invalid' });
    expect(await client.pair('123456')).toStrictEqual({ ok: false, failure: 'rate-limited' });
  });

  it('maps a 404 on the room to not-found', async () => {
    const { fetch } = routeFetch({});
    expect(await createApiClient(fetch).myRoom()).toStrictEqual({ ok: false, failure: 'not-found' });
  });

  it('maps a network error to failed', async () => {
    const client = createApiClient(() => Promise.reject(new TypeError('offline')));
    expect(await client.config()).toStrictEqual({ ok: false, failure: 'failed' });
  });

  it('maps a body that breaks the contract to failed', async () => {
    const { fetch } = routeFetch({ 'GET /api/v1/me': () => jsonResponse(200, { accountId: 1 }) });
    expect(await createApiClient(fetch).me()).toStrictEqual({ ok: false, failure: 'failed' });
  });

  it('reads the room the contract describes', async () => {
    const { fetch } = routeFetch({ 'GET /api/v1/me/room': () => jsonResponse(200, room) });
    const result = await createApiClient(fetch).myRoom();
    expect(result.ok && result.value.expectedGameName).toBe('mmbaalh-12');
  });
});
