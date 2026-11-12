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
  you: 'acc-1',
  runs: [{ run: 1, gameName: 'mmbaalh-12' }],
  expiresAt: null,
  serverNow: '2026-11-01T10:00:00.000Z',
  members: [{ accountId: 'acc-1', characterId: null, joinOrder: 1, role: 'host', class: null, level: null }],
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

  it('signs out with a POST carrying the JSON content type and an empty JSON object', async () => {
    const { fetch, calls } = routeFetch({ 'POST /api/v1/auth/logout': () => jsonResponse(204) });

    expect(await createApiClient(fetch).signOut()).toStrictEqual({ ok: true, value: undefined });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.headers).toStrictEqual({ 'Content-Type': 'application/json' });
    expect(calls[0]?.init.body).toBe('{}');
  });

  it('revokes an agent with a DELETE on its id, carrying the JSON content type and an empty JSON object', async () => {
    const { fetch, calls } = routeFetch({ 'DELETE /api/v1/agents/agent-1': () => jsonResponse(204) });

    expect(await createApiClient(fetch).revokeAgent('agent-1')).toStrictEqual({ ok: true, value: undefined });
    expect(calls[0]?.url).toBe('/api/v1/agents/agent-1');
    expect(calls[0]?.init.method).toBe('DELETE');
    expect(calls[0]?.init.headers).toStrictEqual({ 'Content-Type': 'application/json' });
    expect(calls[0]?.init.body).toBe('{}');
  });

  it('maps a 404 on revoke to not-found and a 401 on sign-out to unauthenticated', async () => {
    const { fetch } = routeFetch({
      'DELETE /api/v1/agents/agent-9': () => jsonResponse(404),
      'POST /api/v1/auth/logout': () => jsonResponse(401),
    });
    const client = createApiClient(fetch);

    expect(await client.revokeAgent('agent-9')).toStrictEqual({ ok: false, failure: 'not-found' });
    expect(await client.signOut()).toStrictEqual({ ok: false, failure: 'unauthenticated' });
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

  it('answers a ready check with a JSON POST to its accept and decline routes (RDY-02, RDY-04)', async () => {
    const { fetch, calls } = routeFetch({
      'POST /api/v1/ready-checks/rc-1/accept': () => jsonResponse(204),
      'POST /api/v1/ready-checks/rc-1/decline': () => jsonResponse(204),
    });
    const client = createApiClient(fetch);
    expect(await client.acceptReadyCheck('rc-1')).toStrictEqual({ ok: true, value: undefined });
    expect(await client.declineReadyCheck('rc-1')).toStrictEqual({ ok: true, value: undefined });
    expect(calls.map((call) => call.init.headers)).toStrictEqual([
      { 'Content-Type': 'application/json' },
      { 'Content-Type': 'application/json' },
    ]);
  });

  it('maps a 409 on an answer to failed, so the site says the answer did not count', async () => {
    const { fetch } = routeFetch({
      'POST /api/v1/ready-checks/rc-1/accept': () => jsonResponse(409, { error: 'ready-check-ended' }),
    });
    expect(await createApiClient(fetch).acceptReadyCheck('rc-1')).toStrictEqual({
      ok: false,
      failure: 'failed',
    });
  });

  it('keeps the seconds left of a ready-check penalty refusal', async () => {
    const { fetch } = routeFetch({
      'POST /api/v1/queue/tickets': () =>
        jsonResponse(422, { error: 'ready-check-penalty', secondsLeft: 42 }),
    });
    const body = {
      mode: 'pvp' as const,
      characterId: 'c-1',
      difficulty: 'normal' as const,
      region: 'americas' as const,
      format: 'duel' as const,
      rules: 'gm' as const,
    };
    expect(await createApiClient(fetch).joinQueue(body)).toStrictEqual({
      ok: false,
      failure: 'refused',
      refusal: 'ready-check-penalty',
      secondsLeft: 42,
    });
  });

  it('reads the open ready check, or null on 204 (RDY-11)', async () => {
    const check = {
      id: 'rc-1',
      mode: 'pvp',
      difficulty: 'hell',
      deadline: '2026-11-10T12:01:00.000Z',
      now: '2026-11-10T12:00:00.000Z',
      members: [
        { position: 1, class: 'sorceress', level: 91, accepted: false, you: true },
        { position: 2, class: 'barbarian', level: 84, accepted: false, you: false },
      ],
    };
    const { fetch } = routeFetch({
      'GET /api/v1/ready-checks/me': () => jsonResponse(200, check),
    });
    expect(await createApiClient(fetch).myReadyCheck()).toStrictEqual({ ok: true, value: check });

    const none = routeFetch({ 'GET /api/v1/ready-checks/me': () => new Response(null, { status: 204 }) });
    expect(await createApiClient(none.fetch).myReadyCheck()).toStrictEqual({ ok: true, value: null });
  });
});
