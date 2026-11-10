// The Battle.net OAuth adapter (IDB-01, IDB-02, IDB-11): the only file that makes the Battle.net HTTP calls. It is
// built over an injected `fetch` and base URL, so CI points it at the fake provider. Failures come back as Result codes:
// the adapter never throws, and no returned value or error carries the code, a token, the verifier or the secret.
import type { BattleNetIdentity, BattleNetOAuth } from '../../application/ports.ts';
import { err, ok, type Result } from '../../../../shared-kernel/index.ts';

/** The subset of `fetch` the adapter uses; tests pass a stub. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** A Battle.net call that takes longer than this fails: a sign-in must not hang the callback. */
export const BNET_REQUEST_TIMEOUT_MS = 10_000;

export interface FetchBattleNetOAuthOptions {
  /** The Battle.net OAuth base URL, for example `https://oauth.battle.net` (`BNET_OAUTH_BASE_URL`). */
  readonly baseUrl: string;
  /** `BNET_CLIENT_ID`. */
  readonly clientId: string;
  /** `BNET_CLIENT_SECRET`: sent as HTTP Basic client auth on the token call, never anywhere else. */
  readonly clientSecret: string;
  readonly fetch: FetchLike;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A non-empty string, or a number written as text (Battle.net may send a numeric `sub`). */
function identifierOf(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return String(value);
  }
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export class FetchBattleNetOAuth implements BattleNetOAuth {
  readonly #base: string;
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #fetch: FetchLike;

  constructor(options: FetchBattleNetOAuthOptions) {
    this.#base = options.baseUrl.replace(/\/+$/, '');
    this.#clientId = options.clientId;
    this.#clientSecret = options.clientSecret;
    this.#fetch = options.fetch;
  }

  authorizeUrl(input: {
    readonly state: string;
    readonly codeChallenge: string;
    readonly redirectUri: string;
  }): string {
    const query = new URLSearchParams({
      client_id: this.#clientId,
      redirect_uri: input.redirectUri,
      response_type: 'code',
      scope: 'openid',
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
    });
    return `${this.#base}/authorize?${query.toString()}`;
  }

  async exchange(input: {
    readonly code: string;
    readonly verifier: string;
    readonly redirectUri: string;
  }): Promise<Result<BattleNetIdentity, 'exchange-failed' | 'userinfo-failed'>> {
    const accessToken = await this.#accessTokenOf(input);
    if (accessToken === undefined) {
      return err('exchange-failed');
    }
    const identity = await this.#userinfoOf(accessToken);
    if (identity === undefined) {
      return err('userinfo-failed');
    }
    return ok(identity);
  }

  /** The token call: HTTP Basic client auth, the code and the PKCE verifier. Undefined on any failure. */
  async #accessTokenOf(input: {
    readonly code: string;
    readonly verifier: string;
    readonly redirectUri: string;
  }): Promise<string | undefined> {
    const credentials = Buffer.from(`${this.#clientId}:${this.#clientSecret}`).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.verifier,
    });
    const json = await this.#call(`${this.#base}/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${credentials}`,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: body.toString(),
    });
    if (!isRecord(json) || typeof json['access_token'] !== 'string' || json['access_token'] === '') {
      return undefined;
    }
    return json['access_token'];
  }

  /** The userinfo call: the access token as a Bearer. Undefined unless it answers a `sub` and a BattleTag. */
  async #userinfoOf(accessToken: string): Promise<BattleNetIdentity | undefined> {
    const json = await this.#call(`${this.#base}/userinfo`, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    });
    if (!isRecord(json)) {
      return undefined;
    }
    const sub = identifierOf(json['sub']);
    const battletag = identifierOf(json['battletag']);
    if (sub === undefined || battletag === undefined) {
      return undefined;
    }
    return { sub, battletag };
  }

  /**
   * One call: the parsed JSON body of a 2xx answer, or undefined. A network error, a timeout, a non-2xx status and a body
   * that is not JSON all come back as undefined; the thrown value is dropped, since it can carry the request.
   */
  async #call(url: string, init: Omit<RequestInit, 'signal'>): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(url, { ...init, signal: AbortSignal.timeout(BNET_REQUEST_TIMEOUT_MS) });
    } catch {
      return undefined;
    }
    if (!response.ok) {
      return undefined;
    }
    try {
      const text = await response.text();
      const parsed: unknown = JSON.parse(text);
      return parsed;
    } catch {
      return undefined;
    }
  }
}
