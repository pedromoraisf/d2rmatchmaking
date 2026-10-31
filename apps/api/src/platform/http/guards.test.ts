import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentsPort } from '../../modules/agents/index.ts';
import type { IdentityPort } from '../../modules/identity/index.ts';
import { err, ok } from '../../shared-kernel/index.ts';
import { createGuards } from './guards.ts';

const SITE_ORIGIN = 'https://site.example';
const GOOD_AGENT_TOKEN = 'd2rmm_a_good';
const GOOD_SESSION = 'd2rmm_s_good';
const SESSION_COOKIE = `__Host-d2rmm_session=${GOOD_SESSION}`;

/** Fake Agents port: counts authentication calls so a test can prove the guard ran before (or without) auth. */
class FakeAgents implements AgentsPort {
  authCalls = 0;

  async authenticateAgent(token: string) {
    this.authCalls += 1;
    return token === GOOD_AGENT_TOKEN
      ? ok({ agentId: 'agent-1', accountId: 'account-1' })
      : err('unauthenticated' as const);
  }

  async accountOfAgent(): Promise<string | null> {
    return null;
  }

  async currentAgentOf(): Promise<string | null> {
    return null;
  }
}

/** Fake Identity port: only the good session is valid. */
const fakeIdentity: IdentityPort = {
  async authenticateSession(token) {
    return token === GOOD_SESSION
      ? ok({ accountId: 'account-1', expiresAt: new Date('2026-11-07T10:00:00.000Z') })
      : err('unauthenticated');
  },
};

let app: FastifyInstance;
let agents: FakeAgents;

beforeEach(async () => {
  agents = new FakeAgents();
  const guards = createGuards({
    identity: fakeIdentity,
    agents,
    agentMinVersion: '0.0.1',
    siteOrigin: SITE_ORIGIN,
  });
  app = Fastify();
  app.get('/agent', { preHandler: [guards.requireAgentVersion, guards.requireAgent] }, async (request) => ({
    agentId: request.agentId,
  }));
  app.get('/site', { preHandler: [guards.requireSession] }, async (request) => ({
    accountId: request.accountId,
  }));
  app.post('/site-write', { preHandler: [guards.requireSameOrigin, guards.requireSession] }, async () => ({
    ok: true,
  }));
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

const AGENT_HEADERS = { authorization: `Bearer ${GOOD_AGENT_TOKEN}`, 'x-agent-version': '0.0.1' };

describe('requireAgentVersion', () => {
  it('answers 426 before authentication', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/agent',
      headers: { authorization: `Bearer ${GOOD_AGENT_TOKEN}` },
    });

    expect(response.statusCode).toBe(426);
    expect(agents.authCalls).toBe(0);
  });

  it('answers 426 for a version below the minimum', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/agent',
      headers: { ...AGENT_HEADERS, 'x-agent-version': '0.0.0' },
    });

    expect(response.statusCode).toBe(426);
    expect(agents.authCalls).toBe(0);
  });

  it.each(['1.0', 'banana', 'v1.0.0', ''])('answers 426 for the non-semver value %j', async (value) => {
    const response = await app.inject({
      method: 'GET',
      url: '/agent',
      headers: { ...AGENT_HEADERS, 'x-agent-version': value },
    });

    expect(response.statusCode).toBe(426);
  });

  it('lets a version equal to the minimum through', async () => {
    const response = await app.inject({ method: 'GET', url: '/agent', headers: AGENT_HEADERS });

    expect(response.statusCode).toBe(200);
  });

  it('lets a version above the minimum compare numerically through', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/agent',
      headers: { ...AGENT_HEADERS, 'x-agent-version': '0.10.0' },
    });

    expect(response.statusCode).toBe(200);
  });
});

describe('requireAgent', () => {
  it('yields the agentId for a bearer token and ignores a session cookie', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/agent',
      headers: { ...AGENT_HEADERS, cookie: SESSION_COOKIE },
    });

    expect(response.json()).toEqual({ agentId: 'agent-1' });
  });

  it('answers 401 to a session cookie alone on an agent route', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/agent',
      headers: { 'x-agent-version': '0.0.1', cookie: SESSION_COOKIE },
    });

    expect(response.statusCode).toBe(401);
  });

  it('answers 401 for an unknown agent token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/agent',
      headers: { 'x-agent-version': '0.0.1', authorization: 'Bearer d2rmm_a_unknown' },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('requireSession', () => {
  it('yields the accountId for a valid session cookie', async () => {
    const response = await app.inject({ method: 'GET', url: '/site', headers: { cookie: SESSION_COOKIE } });

    expect(response.json()).toEqual({ accountId: 'account-1' });
  });

  it('answers 401 without a session cookie', async () => {
    const response = await app.inject({ method: 'GET', url: '/site' });

    expect(response.statusCode).toBe(401);
  });

  it('answers 401 on a site route that carries an Authorization header', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/site',
      headers: { cookie: SESSION_COOKIE, authorization: `Bearer ${GOOD_AGENT_TOKEN}` },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('requireSameOrigin', () => {
  it('lets a same-origin JSON POST with a valid session through', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/site-write',
      headers: { cookie: SESSION_COOKIE, origin: SITE_ORIGIN, 'content-type': 'application/json' },
      payload: '{}',
    });

    expect(response.statusCode).toBe(200);
  });

  it('answers 403 to a cross-origin cookie POST', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/site-write',
      headers: { cookie: SESSION_COOKIE, origin: 'https://evil.example', 'content-type': 'application/json' },
      payload: '{}',
    });

    expect(response.statusCode).toBe(403);
  });

  it('answers 403 to a non-JSON cookie POST from the site origin', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/site-write',
      headers: { cookie: SESSION_COOKIE, origin: SITE_ORIGIN, 'content-type': 'text/plain' },
      payload: '{}',
    });

    expect(response.statusCode).toBe(403);
  });

  it('answers 403 to a POST without an Origin header', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/site-write',
      headers: { cookie: SESSION_COOKIE, 'content-type': 'application/json' },
      payload: '{}',
    });

    expect(response.statusCode).toBe(403);
  });
});
