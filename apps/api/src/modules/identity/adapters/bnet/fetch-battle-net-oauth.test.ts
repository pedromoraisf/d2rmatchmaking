import { describe, expect, it } from 'vitest';
import { FetchBattleNetOAuth, type FetchLike } from './fetch-battle-net-oauth.ts';

const BASE = 'https://oauth.battle.net';
const CLIENT_ID = 'client-id-public';
const SECRET = 'client-secret-SHOULD-NEVER-LEAK';
const CODE = 'auth-code-SHOULD-NEVER-LEAK';
const VERIFIER = 'pkce-verifier-SHOULD-NEVER-LEAK';
const ACCESS_TOKEN = 'access-token-SHOULD-NEVER-LEAK';
const REDIRECT = 'https://site.example/api/v1/auth/bnet/callback';
const SECRETS = [SECRET, CODE, VERIFIER, ACCESS_TOKEN];

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

/** A stub fetch that answers each call from a script, in order, and records what it was asked. */
function stubFetch(script: Array<Response | Error>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = script.shift();
    if (next === undefined) {
      throw new Error('no scripted answer left');
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  };
  return { fetch, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function adapterWith(fetch: FetchLike): FetchBattleNetOAuth {
  return new FetchBattleNetOAuth({ baseUrl: BASE, clientId: CLIENT_ID, clientSecret: SECRET, fetch });
}

const EXCHANGE = { code: CODE, verifier: VERIFIER, redirectUri: REDIRECT };

describe('FetchBattleNetOAuth.authorizeUrl', () => {
  it('builds the authorize URL with the client id, the redirect URI, scope openid, the state and the S256 challenge', () => {
    const adapter = adapterWith(stubFetch([]).fetch);

    const url = new URL(
      adapter.authorizeUrl({ state: 'state-1', codeChallenge: 'challenge-1', redirectUri: REDIRECT }),
    );

    expect(`${url.origin}${url.pathname}`).toBe(`${BASE}/authorize`);
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-1');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('never puts the client secret in the authorize URL', () => {
    const adapter = adapterWith(stubFetch([]).fetch);

    expect(adapter.authorizeUrl({ state: 's', codeChallenge: 'c', redirectUri: REDIRECT })).not.toContain(
      SECRET,
    );
  });

  it('drops a trailing slash from the base URL', () => {
    const adapter = new FetchBattleNetOAuth({
      baseUrl: `${BASE}/`,
      clientId: CLIENT_ID,
      clientSecret: SECRET,
      fetch: stubFetch([]).fetch,
    });

    expect(adapter.authorizeUrl({ state: 's', codeChallenge: 'c', redirectUri: REDIRECT })).toMatch(
      new RegExp(`^${BASE}/authorize\\?`),
    );
  });
});

describe('FetchBattleNetOAuth.exchange on success', () => {
  it('posts the code and the verifier with Basic client auth, then reads the sub and BattleTag with the Bearer token', async () => {
    const { fetch, calls } = stubFetch([
      json({ access_token: ACCESS_TOKEN, token_type: 'bearer' }),
      json({ sub: 'sub-alice', battletag: 'Alice#1234' }),
    ]);

    const result = await adapterWith(fetch).exchange(EXCHANGE);

    expect(result).toEqual({ ok: true, value: { sub: 'sub-alice', battletag: 'Alice#1234' } });
    expect(calls).toHaveLength(2);

    const [token, userinfo] = calls;
    expect(token?.url).toBe(`${BASE}/token`);
    expect(token?.init.method).toBe('POST');
    const headers = new Headers(token?.init.headers);
    expect(headers.get('authorization')).toBe(
      `Basic ${Buffer.from(`${CLIENT_ID}:${SECRET}`).toString('base64')}`,
    );
    const body = new URLSearchParams(String(token?.init.body));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe(CODE);
    expect(body.get('code_verifier')).toBe(VERIFIER);
    expect(body.get('redirect_uri')).toBe(REDIRECT);

    expect(userinfo?.url).toBe(`${BASE}/userinfo`);
    expect(userinfo?.init.method).toBe('GET');
    expect(new Headers(userinfo?.init.headers).get('authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  it('accepts a numeric sub and reads it as text', async () => {
    const { fetch } = stubFetch([
      json({ access_token: ACCESS_TOKEN }),
      json({ sub: 4242, battletag: 'Bob#4321' }),
    ]);

    const result = await adapterWith(fetch).exchange(EXCHANGE);

    expect(result).toEqual({ ok: true, value: { sub: '4242', battletag: 'Bob#4321' } });
  });
});

describe('FetchBattleNetOAuth.exchange when the token call fails', () => {
  it.each([
    ['a non-2xx status', () => json({ error: 'invalid_grant' }, 400)],
    ['a server error', () => json({ error: 'server_error' }, 500)],
    ['a body that is not JSON', () => new Response('<html>oops</html>', { status: 200 })],
    ['a body without an access token', () => json({ token_type: 'bearer' })],
    ['an empty access token', () => json({ access_token: '' })],
    ['a JSON array', () => json(['access_token'])],
  ])('is exchange-failed on %s, and makes no userinfo call', async (_label, answer) => {
    const { fetch, calls } = stubFetch([answer()]);

    const result = await adapterWith(fetch).exchange(EXCHANGE);

    expect(result).toEqual({ ok: false, error: 'exchange-failed' });
    expect(calls).toHaveLength(1);
  });

  it('is exchange-failed on a network error and leaks nothing of the request', async () => {
    const { fetch, calls } = stubFetch([
      new Error(`socket hang up while sending ${CODE} ${VERIFIER} ${SECRET}`),
    ]);

    const result = await adapterWith(fetch).exchange(EXCHANGE);

    expect(result).toEqual({ ok: false, error: 'exchange-failed' });
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});

describe('FetchBattleNetOAuth.exchange when the userinfo call fails', () => {
  it.each([
    ['a non-2xx status', () => json({ error: 'unauthorized' }, 401)],
    ['a body that is not JSON', () => new Response('nope', { status: 200 })],
    ['a body without a battletag', () => json({ sub: 'sub-alice' })],
    ['a body without a sub', () => json({ battletag: 'Alice#1234' })],
    ['an empty sub', () => json({ sub: '', battletag: 'Alice#1234' })],
  ])('is userinfo-failed on %s', async (_label, answer) => {
    const { fetch } = stubFetch([json({ access_token: ACCESS_TOKEN }), answer()]);

    const result = await adapterWith(fetch).exchange(EXCHANGE);

    expect(result).toEqual({ ok: false, error: 'userinfo-failed' });
  });

  it('is userinfo-failed on a network error and leaks no token', async () => {
    const { fetch } = stubFetch([
      json({ access_token: ACCESS_TOKEN }),
      new Error(`reset while reading with Bearer ${ACCESS_TOKEN}`),
    ]);

    const result = await adapterWith(fetch).exchange(EXCHANGE);

    expect(result).toEqual({ ok: false, error: 'userinfo-failed' });
    expect(JSON.stringify(result)).not.toContain(ACCESS_TOKEN);
  });
});

describe('FetchBattleNetOAuth never leaks its secrets (IDB-11)', () => {
  it('returns no secret, code, token or verifier on any failure path', async () => {
    const paths: Array<Array<Response | Error>> = [
      [json({ error: 'invalid_grant', detail: CODE }, 400)],
      [new Error(`boom ${SECRET} ${CODE}`)],
      [json({ access_token: ACCESS_TOKEN }), json({ error: 'nope', token: ACCESS_TOKEN }, 401)],
      [json({ access_token: ACCESS_TOKEN }), new Error(`boom ${VERIFIER}`)],
    ];
    for (const script of paths) {
      const result = await adapterWith(stubFetch(script).fetch).exchange(EXCHANGE);
      const serialized = JSON.stringify(result);
      for (const secret of SECRETS) {
        expect(serialized).not.toContain(secret);
      }
      expect(result.ok).toBe(false);
    }
  });

  it('never rejects, so no thrown message can reach a caller', async () => {
    const adapter = adapterWith(stubFetch([new Error(`${SECRET}`)]).fetch);

    await expect(adapter.exchange(EXCHANGE)).resolves.toEqual({ ok: false, error: 'exchange-failed' });
  });
});
