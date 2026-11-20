// Helpers of the agent-token tests (AGT-01, AGT-02): a signed-in player, a paired agent and one request to a route.
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type { BuiltApp } from '../app.ts';
import { bodyFor, urlOf, type RouteReach } from './agent-route-table.ts';

export const SITE_ORIGIN = 'https://site.example';
export const AGENT_VERSION = '1.0.0';

export function bodyOf<T>(response: { readonly body: string }): T {
  return JSON.parse(response.body) as T;
}

export async function sessionFor(app: BuiltApp): Promise<string> {
  const response = await app.app.inject({
    method: 'POST',
    url: '/v1/auth/test-login',
    headers: { origin: SITE_ORIGIN, 'content-type': 'application/json' },
    payload: { name: `p${randomUUID().replaceAll('-', '').slice(0, 14)}` },
  });
  expect(response.statusCode).toBe(200);
  const header = response.headers['set-cookie'];
  return (Array.isArray(header) ? (header[0] ?? '') : String(header ?? '')).split(';')[0] ?? '';
}

/** Pairs an agent for the session and returns its token. */
export async function tokenFor(app: BuiltApp, cookie: string): Promise<string> {
  const headers = { 'x-agent-version': AGENT_VERSION };
  const issued = bodyOf<{ code: string; claimSecret: string }>(
    await app.app.inject({ method: 'POST', url: '/v1/agents/pairing-codes', headers }),
  );
  const claim = async () =>
    await app.app.inject({
      method: 'POST',
      url: '/v1/agents/pairing-codes/claim',
      headers: { ...headers, 'content-type': 'application/json' },
      payload: { claimSecret: issued.claimSecret },
    });
  await claim();
  const paired = await app.app.inject({
    method: 'POST',
    url: '/v1/agents/pair',
    headers: { origin: SITE_ORIGIN, 'content-type': 'application/json', cookie },
    payload: { code: issued.code },
  });
  expect(paired.statusCode).toBe(200);
  return bodyOf<{ token: string }>(await claim()).token;
}

/** One request to a route with the given credential headers. A body is sent where the route takes one. */
export function send(app: BuiltApp, route: RouteReach, credential: Record<string, string>) {
  return app.app.inject({
    method: route.method,
    url: urlOf(route),
    headers: {
      'x-agent-version': AGENT_VERSION,
      origin: SITE_ORIGIN,
      'content-type': 'application/json',
      ...credential,
    },
    ...(route.method === 'GET' ? {} : { payload: bodyFor(route) as object }),
  });
}
