// A small in-memory staging API for the staging-bots tests: just enough routes to run a bot from sign-in to a closed room.
// It records every request (method, path, whether it carried a cookie or a token) so a test can assert the order and the
// headers. It validates nothing the real API's own tests already cover.
const TOKEN = `d2rmm_a_${'A'.repeat(43)}`;

export function createFakeApi({ stagingEndpoints = true, pool = 2, host = true, roomScript = true } = {}) {
  const calls = [];
  let accounts = 0;
  let poolSize = pool;
  const state = { tickets: new Set(), agents: new Set(), sessions: new Set(), aborted: false };
  const json = (status, body, headers = {}) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });

  function stream(url, init) {
    const agent = String(init.headers?.Authorization ?? '').startsWith('Bearer ');
    const encoder = new TextEncoder();
    const events = [];
    if (agent && roomScript) {
      const me = state.lastAccountId;
      events.push(['ready_check.started', { id: 'rc-1', members: [] }]);
      events.push([
        'room.assigned',
        {
          roomId: 'room-1',
          run: 1,
          expectedGameName: 'mmpvph-1',
          members: [{ accountId: me, role: host ? 'host' : 'member', joinOrder: 1 }],
        },
      ]);
      events.push(['room.stage_changed', { roomId: 'room-1', stage: 'created' }]);
      events.push(['room.stage_changed', { roomId: 'room-1', stage: 'closed' }]);
    }
    return new Response(
      new ReadableStream({
        start(controller) {
          events.forEach(([type, data], at) =>
            controller.enqueue(
              encoder.encode(`id: ${at + 1}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`),
            ),
          );
          init.signal?.addEventListener('abort', () => controller.error(new Error('aborted')), {
            once: true,
          });
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );
  }

  async function fetchFake(url, init = {}) {
    const { pathname } = new URL(url);
    const method = init.method ?? 'GET';
    const headers = init.headers ?? {};
    calls.push({
      method,
      path: pathname,
      cookie: headers.Cookie !== undefined,
      token: headers.Authorization !== undefined,
      origin: headers.Origin,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    });
    const key = `${method} ${pathname}`;
    if (key === 'GET /healthz') return json(200, { status: 'ok', version: 'x' });
    if (key === 'GET /v1/config')
      return json(200, { stagingEndpoints, minAgentVersion: '0.5.0', bnetSignIn: false });
    if (key === 'POST /v1/auth/test-login') {
      accounts += 1;
      state.lastAccountId = `acc-${accounts}`;
      state.sessions.add(state.lastAccountId);
      return json(
        200,
        { accountId: state.lastAccountId, displayName: 'bot' },
        {
          'set-cookie': `__Host-d2rmm_session=secretsession${accounts}abc; Path=/; Secure; HttpOnly`,
        },
      );
    }
    if (key === 'POST /v1/agents/pairing-codes')
      return json(201, { code: '123456', expiresAt: 'x', claimSecret: 'claimsecret-1234' });
    if (key === 'POST /v1/agents/pair') return json(200, {});
    if (key === 'POST /v1/agents/pairing-codes/claim') return json(200, { token: TOKEN });
    if (key === 'GET /v1/agents/me') {
      state.agents.add('agent-1');
      return json(200, {
        status: 'paired',
        agentId: 'agent-1',
        online: true,
        gameRunning: false,
        screen: 'UNKNOWN',
        lastSeenAt: null,
      });
    }
    if (key === 'POST /v1/me/characters') return json(200, {});
    if (key === 'GET /v1/me/characters') {
      return json(200, {
        characters: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf'].map((word, at) => ({
          id: `char-${at}`,
          name: `Bot${word}`,
        })),
      });
    }
    if (method === 'PATCH' && pathname.startsWith('/v1/me/characters/')) return json(200, {});
    if (key === 'POST /v1/agents/heartbeat') return json(204);
    if (key === 'POST /v1/queue/tickets') {
      state.tickets.add('ticket-1');
      return json(201, { id: 'ticket-1', status: 'waiting', poolSize });
    }
    if (key === 'GET /v1/queue/tickets/me') return json(200, { ticket: { id: 'ticket-1', poolSize } });
    if (key === 'GET /v1/stream') return stream(url, init);
    if (key === 'POST /v1/ready-checks/rc-1/accept') return json(204);
    if (key === 'POST /v1/lobby-rooms/room-1/observations') return json(202, {});
    if (key === 'POST /v1/lobby-rooms/room-1/leave') return json(204);
    if (method === 'DELETE' && pathname.startsWith('/v1/queue/tickets/')) return json(204);
    if (method === 'DELETE' && pathname === '/v1/agents/agent-1') {
      state.agents.delete('agent-1');
      return json(204);
    }
    if (key === 'POST /v1/auth/logout') return json(204);
    return json(404, { error: 'not-found' });
  }
  return {
    fetch: fetchFake,
    calls,
    state,
    token: TOKEN,
    setPool: (value) => {
      poolSize = value;
    },
  };
}
