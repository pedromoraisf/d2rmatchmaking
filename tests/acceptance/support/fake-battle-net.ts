// The fake Battle.net OAuth provider of the acceptance suite (IDB-01, IDB-02, IDB-04). It runs in the test process on a loopback
// port, and the staging API reaches it through BNET_OAUTH_BASE_URL. `/authorize` redirects the browser back to the
// redirect_uri with a code (or an error), `/token` exchanges a code (checking the client secret and the PKCE verifier) and
// `/userinfo` answers the scripted identity. Each scenario scripts what the provider answers; the stack resets it with the
// APIs (support/stack.ts). Black box: plain HTTP, the same calls the API makes to Battle.net.
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MeResponse } from '@d2rmm/contracts';

/** The client id and secret the staging API is given. Test values: production credentials never leave GitHub/Render. */
export const BNET_CLIENT_ID = 'acceptance-battle-net-client';
export const BNET_CLIENT_SECRET = 'acceptance-battle-net-secret';

/** What the provider can answer instead of a sign-in: the failures of IDB-04. */
export type BattleNetFailure = 'access-denied' | 'state-mismatch' | 'code-rejected' | 'userinfo-error';

/** The identity the provider signs in: the stable `sub` and the BattleTag. */
export interface BattleNetIdentity {
  readonly sub: string;
  readonly battletag: string;
}

/** The authorize request the API sent through the browser (IDB-01). Every field is what the request carried. */
export interface AuthorizeRequest {
  readonly clientId: string | null;
  readonly redirectUri: string | null;
  readonly scope: string | null;
  readonly responseType: string | null;
  readonly state: string | null;
  readonly codeChallenge: string | null;
  readonly codeChallengeMethod: string | null;
}

/** The `sub` a BattleTag signs in with unless the scenario names one (the same account keeps its sub, IDB-03). */
export function subOf(battletag: string): string {
  return `sub-${battletag.replace(/[^A-Za-z0-9]/gu, '')}`;
}

const DEFAULT_IDENTITY: BattleNetIdentity = { sub: subOf('Visitor#0001'), battletag: 'Visitor#0001' };

/** A loopback fake of the three Battle.net OAuth endpoints the API uses. */
export class FakeBattleNet {
  #server: Server | undefined;
  #port = 0;
  #identity: BattleNetIdentity = DEFAULT_IDENTITY;
  #failure: BattleNetFailure | undefined;
  #lastAuthorize: AuthorizeRequest | undefined;
  #lastCallbackUrl: string | undefined;
  readonly #codes = new Map<
    string,
    { readonly identity: BattleNetIdentity; readonly challenge: string | null }
  >();
  readonly #tokens = new Map<string, BattleNetIdentity>();

  /** `http://127.0.0.1:<port>`: the value of BNET_OAUTH_BASE_URL. Valid after `start`. */
  get baseUrl(): string {
    return `http://127.0.0.1:${this.#port}`;
  }

  /** The identity the next sign-in answers with. */
  get identity(): BattleNetIdentity {
    return this.#identity;
  }

  /** The last authorize request the provider received, or undefined before the first one. */
  get lastAuthorize(): AuthorizeRequest | undefined {
    return this.#lastAuthorize;
  }

  /** The callback URL the provider last redirected the browser to (with its code or error and state). */
  get lastCallbackUrl(): string | undefined {
    return this.#lastCallbackUrl;
  }

  /** Scripts the next sign-in: this BattleTag, with the given `sub` or the one its BattleTag always has. */
  willSignIn(battletag: string, sub: string = subOf(battletag)): void {
    this.#identity = { sub, battletag };
    this.#failure = undefined;
  }

  /** Scripts the next sign-in to fail the way IDB-04 names. */
  willAnswer(failure: BattleNetFailure): void {
    this.#failure = failure;
  }

  /** Clears every script and every record: the state of a new scenario. */
  reset(): void {
    this.#identity = DEFAULT_IDENTITY;
    this.#failure = undefined;
    this.#lastAuthorize = undefined;
    this.#lastCallbackUrl = undefined;
    this.#codes.clear();
    this.#tokens.clear();
  }

  /** Listens on a free loopback port. */
  async start(): Promise<void> {
    const server = createServer((request, response) => {
      this.#route(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        this.#port = (server.address() as AddressInfo).port;
        resolve();
      });
    });
    this.#server = server;
  }

  /** Stops listening. */
  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = undefined;
    if (server === undefined) {
      return;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  #route(request: IncomingMessage, response: ServerResponse): void {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const url = new URL(request.url ?? '/', this.baseUrl);
      const body = Buffer.concat(chunks).toString('utf8');
      if (request.method === 'GET' && url.pathname === '/authorize') {
        this.#authorize(url, response);
      } else if (request.method === 'POST' && url.pathname === '/token') {
        this.#token(request, body, response);
      } else if (request.method === 'GET' && url.pathname === '/userinfo') {
        this.#userinfo(request, response);
      } else {
        respond(response, 404, { error: 'not_found' });
      }
    });
  }

  #authorize(url: URL, response: ServerResponse): void {
    const params = url.searchParams;
    this.#lastAuthorize = {
      clientId: params.get('client_id'),
      redirectUri: params.get('redirect_uri'),
      scope: params.get('scope'),
      responseType: params.get('response_type'),
      state: params.get('state'),
      codeChallenge: params.get('code_challenge'),
      codeChallengeMethod: params.get('code_challenge_method'),
    };
    let target: URL;
    try {
      target = new URL(params.get('redirect_uri') ?? '');
    } catch {
      respond(response, 400, { error: 'invalid_request' });
      return;
    }
    const state = params.get('state') ?? '';
    if (this.#failure === 'access-denied') {
      target.searchParams.set('error', 'access_denied');
      target.searchParams.set('state', state);
    } else {
      const code = randomBytes(24).toString('base64url');
      this.#codes.set(code, { identity: this.#identity, challenge: params.get('code_challenge') });
      target.searchParams.set('code', code);
      target.searchParams.set('state', this.#failure === 'state-mismatch' ? `${state}-tampered` : state);
    }
    this.#lastCallbackUrl = target.toString();
    response.statusCode = 302;
    response.setHeader('location', target.toString());
    response.end();
  }

  #token(request: IncomingMessage, body: string, response: ServerResponse): void {
    const expected = `Basic ${Buffer.from(`${BNET_CLIENT_ID}:${BNET_CLIENT_SECRET}`).toString('base64')}`;
    if (request.headers.authorization !== expected) {
      respond(response, 401, { error: 'invalid_client' });
      return;
    }
    const form = new URLSearchParams(body);
    const issued = this.#codes.get(form.get('code') ?? '');
    this.#codes.delete(form.get('code') ?? '');
    const verifier = form.get('code_verifier') ?? '';
    const proof = createHash('sha256').update(verifier).digest('base64url');
    if (
      form.get('grant_type') !== 'authorization_code' ||
      issued === undefined ||
      this.#failure === 'code-rejected' ||
      issued.challenge !== proof
    ) {
      respond(response, 400, { error: 'invalid_grant' });
      return;
    }
    const token = randomBytes(24).toString('base64url');
    this.#tokens.set(token, issued.identity);
    respond(response, 200, { access_token: token, token_type: 'Bearer', expires_in: 3600 });
  }

  #userinfo(request: IncomingMessage, response: ServerResponse): void {
    const bearer = /^Bearer (.+)$/u.exec(request.headers.authorization ?? '')?.[1];
    const identity = bearer === undefined ? undefined : this.#tokens.get(bearer);
    if (identity === undefined) {
      respond(response, 401, { error: 'invalid_token' });
      return;
    }
    if (this.#failure === 'userinfo-error') {
      respond(response, 500, { error: 'server_error' });
      return;
    }
    respond(response, 200, { sub: identity.sub, battletag: identity.battletag });
  }
}

function respond(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}

/**
 * Signs a BattleTag in through the API alone, without a browser: the login, the provider's authorize redirect, the callback
 * and `GET /v1/me` (the flow of the browser, as the API sees it). Used for the players a scenario names but does not sign in
 * on the site. Returns the account and the session token value.
 */
export async function signInWithBattleNetThroughApi(
  endpoint: { readonly api: string; readonly site: string },
  battleNet: FakeBattleNet,
  battletag: string,
): Promise<{ accountId: string; session: string }> {
  battleNet.willSignIn(battletag);
  const login = await fetch(`${endpoint.api}/v1/auth/bnet/login`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  const stateCookie = cookieValue(login.headers.getSetCookie(), '__Host-d2rmm_oauth');
  const authorizeUrl = login.headers.get('location');
  if (login.status !== 302 || stateCookie === undefined || authorizeUrl === null) {
    throw new Error(`the Battle.net login of "${battletag}" answered ${login.status}`);
  }
  const authorized = await fetch(authorizeUrl, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  const callbackUrl = authorized.headers.get('location');
  if (authorized.status !== 302 || callbackUrl === null) {
    throw new Error(`the Battle.net authorize of "${battletag}" answered ${authorized.status}`);
  }
  const callback = await fetch(callbackUrl, {
    redirect: 'manual',
    headers: { Cookie: `__Host-d2rmm_oauth=${stateCookie}` },
    signal: AbortSignal.timeout(10_000),
  });
  const session = cookieValue(callback.headers.getSetCookie(), '__Host-d2rmm_session');
  if (callback.status !== 302 || session === undefined) {
    throw new Error(`the Battle.net callback of "${battletag}" answered ${callback.status} with no session`);
  }
  const me = await fetch(`${endpoint.api}/v1/me`, {
    headers: { Cookie: `__Host-d2rmm_session=${session}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (me.status !== 200) {
    throw new Error(`/v1/me after the Battle.net sign-in of "${battletag}" answered ${me.status}`);
  }
  return { accountId: MeResponse.parse(await me.json()).accountId, session };
}

/** The value of a named cookie in a list of Set-Cookie headers, or undefined. */
function cookieValue(setCookies: readonly string[], name: string): string | undefined {
  const found = setCookies.find((value) => value.startsWith(`${name}=`));
  return found?.slice(name.length + 1).split(';')[0];
}
