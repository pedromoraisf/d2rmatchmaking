import { createHash } from 'node:crypto';
import cookie from '@fastify/cookie';
import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock, SequentialIdGenerator } from '../../../../shared-kernel/index.ts';
import { SeededRandomSource } from '../../../../shared-kernel/random-source.ts';
import { createIdentityUseCases } from '../../application/identity-use-cases.ts';
import { FakeBattleNetOAuth } from '../../application/testing/fake-battle-net-oauth.ts';
import { FakeSecretHasher } from '../../application/testing/fake-secret-hasher.ts';
import { InMemoryAccountRepository } from '../../application/testing/in-memory-account-repository.ts';
import { InMemorySessionRepository } from '../../application/testing/in-memory-session-repository.ts';
import { identityRoutes, OAUTH_COOKIE_NAME, SESSION_COOKIE_NAME } from './routes.ts';

const START = new Date('2026-11-01T12:00:00.000Z');
const SITE = 'https://site.example';
const CALLBACK_URI = `${SITE}/api/v1/auth/bnet/callback`;
const TEN_MINUTES_MS = 10 * 60 * 1000;

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
  );
});

beforeEach(() => {
  exporter.reset();
});

interface Fixture {
  readonly app: FastifyInstance;
  readonly clock: FakeClock;
  readonly battleNet: FakeBattleNetOAuth;
  readonly sessions: InMemorySessionRepository;
}

const apps: FastifyInstance[] = [];

/** The identity routes over in-memory ports, with Battle.net on or off. */
async function setup({ enabled = true }: { readonly enabled?: boolean } = {}): Promise<Fixture> {
  const clock = new FakeClock(START);
  const random = new SeededRandomSource(5);
  const sessions = new InMemorySessionRepository();
  const hasher = new FakeSecretHasher();
  const battleNet = new FakeBattleNetOAuth();
  const useCases = createIdentityUseCases({
    accounts: new InMemoryAccountRepository(),
    sessions,
    hasher,
    clock,
    random,
    ids: new SequentialIdGenerator('account'),
    battleNet,
  });
  // The guards the routes need, written here over the use cases: the platform's own guards live in platform/ and the
  // identity adapters may not import them. They follow the platform rules: a session cookie, and the site's origin with
  // a JSON body for every non-GET request.
  const guards = {
    requireSession: async (request: FastifyRequest, reply: FastifyReply) => {
      const token = request.cookies[SESSION_COOKIE_NAME];
      const session = token === undefined ? undefined : await useCases.authenticateSession(token);
      if (request.headers.authorization !== undefined || session === undefined || !session.ok) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      request.accountId = session.value.accountId;
      return undefined;
    },
    requireSameOrigin: async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.method === 'GET') {
        return undefined;
      }
      const json = (request.headers['content-type'] ?? '').startsWith('application/json');
      if (request.headers.origin !== SITE || !json) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      return undefined;
    },
  };
  const app = Fastify();
  apps.push(app);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cookie);
  identityRoutes(app, {
    useCases,
    guards,
    stagingEndpoints: false,
    bnet: { enabled, oauth: battleNet, siteOrigin: SITE },
    clock,
    random,
  });
  await app.ready();
  return { app, clock, battleNet, sessions };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

/** The `name=value` pair of the named cookie in a response's Set-Cookie headers, or undefined when not set. */
function setCookieNamed(headers: Record<string, unknown>, name: string): string | undefined {
  const raw = headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return list.find((value) => value.startsWith(`${name}=`));
}

/** The value of a Set-Cookie pair, without its attributes. */
function valueOf(setCookie: string): string {
  return setCookie.split(';')[0]?.slice(setCookie.indexOf('=') + 1) ?? '';
}

/** The `Cookie` request header for one cookie value. */
function cookieHeader(name: string, value: string): string {
  return `${name}=${value}`;
}

/** Starts a sign-in: the login redirect, its state cookie, and the state Battle.net will send back. */
async function startLogin(fixture: Fixture) {
  const response = await fixture.app.inject({ method: 'GET', url: '/v1/auth/bnet/login' });
  const oauthCookie = setCookieNamed(response.headers, OAUTH_COOKIE_NAME);
  const location = new URL(String(response.headers['location']));
  return {
    response,
    oauthCookie,
    stateCookieValue: oauthCookie === undefined ? undefined : valueOf(oauthCookie),
    state: location.searchParams.get('state') ?? '',
  };
}

/** A full sign-in with Battle.net as the given identity; returns the session cookie pair. */
async function signInAs(fixture: Fixture, sub: string, battletag: string): Promise<string> {
  fixture.battleNet.willSignIn(sub, battletag);
  const login = await startLogin(fixture);
  const callback = await fixture.app.inject({
    method: 'GET',
    url: `/v1/auth/bnet/callback?code=auth-code-${sub}&state=${login.state}`,
    headers: { cookie: cookieHeader(OAUTH_COOKIE_NAME, login.stateCookieValue ?? '') },
  });
  expect(callback.statusCode).toBe(302);
  const session = setCookieNamed(callback.headers, SESSION_COOKIE_NAME);
  expect(session).toBeDefined();
  return session?.split(';')[0] ?? '';
}

describe('GET /v1/auth/bnet/login', () => {
  it('answers 404 and sets no cookie when Battle.net is not configured', async () => {
    const fixture = await setup({ enabled: false });

    const response = await fixture.app.inject({ method: 'GET', url: '/v1/auth/bnet/login' });

    expect(response.statusCode).toBe(404);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers['location']).toBeUndefined();
  });

  it('redirects to Battle.net with the state and an S256 challenge, bound to the browser by a __Host- cookie', async () => {
    const fixture = await setup();

    const login = await startLogin(fixture);

    expect(login.response.statusCode).toBe(302);
    const location = new URL(String(login.response.headers['location']));
    expect(`${location.origin}${location.pathname}`).toBe('https://fake.battle.net/authorize');
    expect(location.searchParams.get('redirect_uri')).toBe(CALLBACK_URI);
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(login.oauthCookie).toMatch(/^__Host-d2rmm_oauth=/);
    expect(login.oauthCookie).toMatch(/HttpOnly/);
    expect(login.oauthCookie).toMatch(/Secure/);
    expect(login.oauthCookie).toMatch(/SameSite=Lax/i);
    expect(login.oauthCookie).toMatch(/Path=\//);
    expect(login.oauthCookie).toMatch(/Max-Age=600/);
    expect(login.oauthCookie).not.toMatch(/domain=/i);

    const [state, verifier, expiry] = (login.stateCookieValue ?? '').split('.');
    expect(state).toBe(login.state);
    expect(
      createHash('sha256')
        .update(verifier ?? '')
        .digest('base64url'),
    ).toBe(location.searchParams.get('code_challenge'));
    expect(Number(expiry)).toBe(START.getTime() + TEN_MINUTES_MS);
  });
});

describe('GET /v1/auth/bnet/callback on success', () => {
  it('opens a session, clears the state cookie and redirects to the site home page', async () => {
    const fixture = await setup();
    fixture.battleNet.willSignIn('sub-alice', 'Alice#1234');
    const login = await startLogin(fixture);

    const callback = await fixture.app.inject({
      method: 'GET',
      url: `/v1/auth/bnet/callback?code=auth-code-1&state=${login.state}`,
      headers: { cookie: cookieHeader(OAUTH_COOKIE_NAME, login.stateCookieValue ?? '') },
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers['location']).toBe(`${SITE}/`);
    const session = setCookieNamed(callback.headers, SESSION_COOKIE_NAME);
    expect(session).toMatch(/^__Host-d2rmm_session=d2rmm_s_/);
    expect(session).toMatch(/HttpOnly/);
    expect(session).toMatch(/Secure/);
    expect(session).toMatch(/Max-Age=604800/);
    const cleared = setCookieNamed(callback.headers, OAUTH_COOKIE_NAME);
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
  });

  it('exchanges the code with the verifier of the state cookie and the callback URI', async () => {
    const fixture = await setup();
    fixture.battleNet.willSignIn('sub-alice', 'Alice#1234');
    const login = await startLogin(fixture);
    const verifier = (login.stateCookieValue ?? '').split('.')[1];

    await fixture.app.inject({
      method: 'GET',
      url: `/v1/auth/bnet/callback?code=auth-code-1&state=${login.state}`,
      headers: { cookie: cookieHeader(OAUTH_COOKIE_NAME, login.stateCookieValue ?? '') },
    });

    expect(fixture.battleNet.exchanges).toEqual([
      { code: 'auth-code-1', verifier, redirectUri: CALLBACK_URI },
    ]);
  });

  it('lets the signed-in player read the account on /v1/me', async () => {
    const fixture = await setup();
    const session = await signInAs(fixture, 'sub-alice', 'Alice#1234');

    const me = await fixture.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: session } });

    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ displayName: 'Alice' });
  });
});

describe('GET /v1/auth/bnet/callback on failure', () => {
  async function failedCallback(
    fixture: Fixture,
    options: { readonly state?: string; readonly query?: string; readonly cookie?: string | undefined },
  ) {
    const login = await startLogin(fixture);
    const state = options.state ?? login.state;
    const cookieValue = 'cookie' in options ? options.cookie : login.stateCookieValue;
    // `STATE` in a scripted query stands for the state Battle.net would send back for this sign-in.
    const query = (options.query ?? `code=auth-code-1&state=${state}`).replaceAll('STATE', login.state);
    return fixture.app.inject({
      method: 'GET',
      url: `/v1/auth/bnet/callback?${query}`,
      ...(cookieValue === undefined
        ? {}
        : { headers: { cookie: cookieHeader(OAUTH_COOKIE_NAME, cookieValue) } }),
    });
  }

  it.each([
    ['a state that does not match', { state: 'not-the-state' }],
    ['a missing state cookie', { cookie: undefined }],
    ['an error from Battle.net', { query: 'error=access_denied&state=STATE' }],
    ['no code', { query: 'state=STATE' }],
  ])('redirects to the failure page and opens no session on %s', async (_label, options) => {
    const fixture = await setup();
    fixture.battleNet.willSignIn('sub-alice', 'Alice#1234');

    const callback = await failedCallback(fixture, options);

    expect(callback.statusCode).toBe(302);
    expect(callback.headers['location']).toBe(`${SITE}/?signin=failed`);
    expect(setCookieNamed(callback.headers, SESSION_COOKIE_NAME)).toBeUndefined();
    expect(setCookieNamed(callback.headers, OAUTH_COOKIE_NAME)).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
    expect(fixture.sessions.storedHashes()).toEqual([]);
  });

  it('redirects to the failure page when the state is more than ten minutes old', async () => {
    const fixture = await setup();
    fixture.battleNet.willSignIn('sub-alice', 'Alice#1234');
    const login = await startLogin(fixture);
    fixture.clock.advance(TEN_MINUTES_MS);

    const callback = await fixture.app.inject({
      method: 'GET',
      url: `/v1/auth/bnet/callback?code=auth-code-1&state=${login.state}`,
      headers: { cookie: cookieHeader(OAUTH_COOKIE_NAME, login.stateCookieValue ?? '') },
    });

    expect(callback.headers['location']).toBe(`${SITE}/?signin=failed`);
    expect(setCookieNamed(callback.headers, SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it.each([
    ['the code exchange fails', 'exchange-failed'],
    ['the userinfo call fails', 'userinfo-failed'],
  ] as const)('redirects to the failure page when %s', async (_label, reason) => {
    const fixture = await setup();
    fixture.battleNet.willFail(reason);

    const callback = await failedCallback(fixture, {});

    expect(callback.headers['location']).toBe(`${SITE}/?signin=failed`);
    expect(setCookieNamed(callback.headers, SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it('answers 404 on the callback when Battle.net is not configured', async () => {
    const fixture = await setup({ enabled: false });

    const callback = await fixture.app.inject({
      method: 'GET',
      url: '/v1/auth/bnet/callback?code=auth-code-1&state=s',
      headers: { cookie: cookieHeader(OAUTH_COOKIE_NAME, 's.v.1') },
    });

    expect(callback.statusCode).toBe(404);
    expect(callback.headers['location']).toBeUndefined();
  });
});

describe('POST /v1/auth/logout', () => {
  const json = { 'content-type': 'application/json' };

  it('answers 401 without a session cookie', async () => {
    const fixture = await setup();

    const response = await fixture.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { origin: SITE, ...json },
      payload: {},
    });

    expect(response.statusCode).toBe(401);
  });

  it('answers 403 from another origin, even with a session', async () => {
    const fixture = await setup();
    const session = await signInAs(fixture, 'sub-alice', 'Alice#1234');

    const response = await fixture.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { origin: 'https://evil.example', cookie: session, ...json },
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    expect(fixture.sessions.storedHashes()).toHaveLength(1);
  });

  it('deletes the session, expires the cookie and answers 204; the old token is then 401', async () => {
    const fixture = await setup();
    const session = await signInAs(fixture, 'sub-alice', 'Alice#1234');

    const response = await fixture.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { origin: SITE, cookie: session, ...json },
      payload: {},
    });

    expect(response.statusCode).toBe(204);
    const cleared = setCookieNamed(response.headers, SESSION_COOKIE_NAME);
    expect(cleared).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
    expect(fixture.sessions.storedHashes()).toEqual([]);

    const me = await fixture.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: session } });
    expect(me.statusCode).toBe(401);
  });
});

describe('identity spans (IDB-12)', () => {
  const SECRET_LIKE = ['auth-code-sub-alice', 'Alice#1234', 'sub-alice', 'pkce', 'd2rmm_s_'];

  it('record the outcome only, with no code, state, verifier, token or BattleTag', async () => {
    const fixture = await setup();
    const session = await signInAs(fixture, 'sub-alice', 'Alice#1234');
    await fixture.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { origin: SITE, cookie: session, 'content-type': 'application/json' },
      payload: {},
    });
    const disabled = await setup({ enabled: false });
    await disabled.app.inject({ method: 'GET', url: '/v1/auth/bnet/login' });

    const finished: ReadableSpan[] = exporter.getFinishedSpans();
    const names = finished.map((span) => span.name);
    expect(names).toEqual(
      expect.arrayContaining(['identity.bnet-login', 'identity.bnet-callback', 'identity.sign-out']),
    );
    for (const span of finished.filter(
      (candidate) => candidate.name.startsWith('identity.bnet-') || candidate.name === 'identity.sign-out',
    )) {
      expect(Object.keys(span.attributes)).toEqual(['outcome']);
      const outcome = span.attributes['outcome'];
      expect(typeof outcome).toBe('string');
      for (const secret of SECRET_LIKE) {
        expect(JSON.stringify(span.attributes)).not.toContain(secret);
      }
    }
  });

  it('record the failure reason as the outcome of a refused callback', async () => {
    const fixture = await setup();
    const login = await startLogin(fixture);
    exporter.reset();

    await fixture.app.inject({
      method: 'GET',
      url: `/v1/auth/bnet/callback?code=auth-code-1&state=not-the-state`,
      headers: { cookie: cookieHeader(OAUTH_COOKIE_NAME, login.stateCookieValue ?? '') },
    });

    const callbackSpan = exporter.getFinishedSpans().find((span) => span.name === 'identity.bnet-callback');
    expect(callbackSpan?.attributes['outcome']).toBe('state-mismatch');
  });
});
