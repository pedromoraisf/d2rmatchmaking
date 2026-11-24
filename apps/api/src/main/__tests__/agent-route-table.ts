// The credential each route of the API accepts (AGT-01, NFR-06). The table is the reviewed list of the agent token's
// reach: a route that is in the OpenAPI document and not here fails `agent-token-reach.int.test.ts`, so giving a route
// to the agent token (or adding any route) is a visible change to this file. Paths use the document's `{id}` syntax.

/** Which credential a route takes: none, the site's session, an agent token alone, or an agent token or a session. */
export type Reach = 'public' | 'session' | 'agent' | 'agent-or-site';

export interface RouteReach {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly reach: Reach;
}

/** Every operation of `openapi.json` (staging on) with the credential it takes. */
export const ROUTE_REACH: readonly RouteReach[] = [
  { method: 'GET', path: '/healthz', reach: 'public' },
  { method: 'GET', path: '/v1/config', reach: 'public' },
  { method: 'POST', path: '/v1/auth/test-login', reach: 'public' },
  { method: 'GET', path: '/v1/auth/bnet/login', reach: 'public' },
  { method: 'GET', path: '/v1/auth/bnet/callback', reach: 'public' },
  { method: 'POST', path: '/v1/agents/pairing-codes', reach: 'public' },
  { method: 'POST', path: '/v1/agents/pairing-codes/claim', reach: 'public' },

  { method: 'POST', path: '/v1/auth/logout', reach: 'session' },
  { method: 'GET', path: '/v1/me', reach: 'session' },
  { method: 'GET', path: '/v1/me/characters', reach: 'session' },
  { method: 'PATCH', path: '/v1/me/characters/{id}', reach: 'session' },
  { method: 'POST', path: '/v1/agents/pair', reach: 'session' },
  { method: 'GET', path: '/v1/agents/me', reach: 'session' },
  { method: 'DELETE', path: '/v1/agents/{id}', reach: 'session' },
  { method: 'GET', path: '/v1/me/room', reach: 'session' },
  { method: 'POST', path: '/v1/lobby-rooms/{id}/runs', reach: 'session' },
  { method: 'POST', path: '/v1/lobby-rooms/{id}/leave', reach: 'session' },
  { method: 'POST', path: '/v1/lobby-rooms/{id}/close', reach: 'session' },
  { method: 'POST', path: '/v1/staging/match-formed', reach: 'session' },
  { method: 'POST', path: '/v1/queue/tickets', reach: 'session' },
  { method: 'GET', path: '/v1/queue/tickets/me', reach: 'session' },
  { method: 'DELETE', path: '/v1/queue/tickets/{id}', reach: 'session' },
  { method: 'POST', path: '/v1/ready-checks/{id}/decline', reach: 'session' },

  { method: 'POST', path: '/v1/agents/heartbeat', reach: 'agent' },
  { method: 'GET', path: '/v1/agents/me/assignment', reach: 'agent' },
  { method: 'GET', path: '/v1/agents/config', reach: 'agent' },
  { method: 'POST', path: '/v1/lobby-rooms/{id}/observations', reach: 'agent' },
  { method: 'POST', path: '/v1/me/characters', reach: 'agent' },

  { method: 'GET', path: '/v1/ready-checks/me', reach: 'agent-or-site' },
  { method: 'POST', path: '/v1/ready-checks/{id}/accept', reach: 'agent-or-site' },
  { method: 'GET', path: '/v1/stream', reach: 'agent-or-site' },
  { method: 'POST', path: '/v1/telemetry/traces', reach: 'agent-or-site' },
];

/** A route as the app registers it: `{id}` becomes a fixed id. */
export function urlOf(route: RouteReach): string {
  return route.path.replaceAll('{id}', '00000000-0000-4000-8000-000000000000');
}

/** The routes that answer an agent token: the agent's own routes and the ones it shares with the site. */
export function agentRoutes(): readonly RouteReach[] {
  return ROUTE_REACH.filter((route) => route.reach === 'agent' || route.reach === 'agent-or-site');
}

/**
 * A body each route accepts, so a request reaches the guard: the body is validated before the guards run, and an empty
 * one answers 400 on these routes. Routes with no entry take `{}`.
 */
const BODIES: Readonly<Record<string, unknown>> = {
  'PATCH /v1/me/characters/{id}': { ladder: 'non-ladder', era: 'rotw' },
  'POST /v1/agents/pair': { code: '123456' },
  'POST /v1/queue/tickets': {
    mode: 'pvp',
    characterId: '5f0c2c1e-0000-4000-8000-000000000001',
    difficulty: 'hell',
    region: 'americas',
    format: 'duel',
    rules: 'gm',
  },
  'POST /v1/agents/heartbeat': {
    agentVersion: '1.0.0',
    pcState: 'IN_QUEUE',
    game: { running: true, window: 'Diablo II', screen: 'UNKNOWN' },
    capture: { method: 'pixels', readRate: 0.9 },
  },
  'POST /v1/lobby-rooms/{id}/observations': {
    idempotencyKey: 'agt-01-probe',
    type: 'GAME_NAME_SEEN',
    run: 1,
    value: 'probe',
    confidence: 0.9,
    capturedAt: '2026-10-31T12:00:00.000Z',
  },
  'POST /v1/me/characters': {
    characters: [
      {
        name: 'Sorc',
        class: 'sorceress',
        level: 85,
        hardcore: false,
        unlockedDifficulties: ['normal', 'nightmare', 'hell'],
      },
    ],
  },
};

/** The body of a request to the route. */
export function bodyFor(route: RouteReach): unknown {
  return BODIES[`${route.method} ${route.path}`] ?? {};
}
