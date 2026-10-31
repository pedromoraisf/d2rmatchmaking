// The site's only way to call the API: same origin, through the /api/* Pages Function (ADR 012, AWS-29). Every POST
// carries a JSON body and the JSON content type. A 401 is `unauthenticated`, so the site shows its signed-out view.
import { AgentView, ConfigResponse, MeResponse, RoomView } from '@d2rmm/contracts';

export interface Parser<T> {
  parse(input: unknown): T;
}

export type ApiFailure = 'unauthenticated' | 'not-found' | 'invalid' | 'rate-limited' | 'failed';
export type ApiResult<T> = { ok: true; value: T } | { ok: false; failure: ApiFailure };
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

type Sent = { ok: true; response: Response } | { ok: false; failure: ApiFailure };

const API_PREFIX = '/api';

function failureFor(status: number): ApiFailure {
  switch (status) {
    case 400:
      return 'invalid';
    case 401:
      return 'unauthenticated';
    case 404:
      return 'not-found';
    case 429:
      return 'rate-limited';
    default:
      return 'failed';
  }
}

export interface ApiClient {
  config(): Promise<ApiResult<ConfigResponse>>;
  me(): Promise<ApiResult<MeResponse>>;
  testLogin(name: string): Promise<ApiResult<void>>;
  matchFormed(): Promise<ApiResult<void>>;
  myRoom(): Promise<ApiResult<RoomView>>;
  myAgent(): Promise<ApiResult<AgentView>>;
  pair(code: string): Promise<ApiResult<void>>;
}

export function createApiClient(fetcher: Fetcher = (url, init) => fetch(url, init)): ApiClient {
  async function send(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Sent> {
    const url = `${API_PREFIX}${path}`;
    let response: Response;
    try {
      response =
        method === 'POST'
          ? await fetcher(url, {
              method,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body ?? {}),
            })
          : await fetcher(url, { method });
    } catch {
      return { ok: false, failure: 'failed' };
    }
    return response.ok ? { ok: true, response } : { ok: false, failure: failureFor(response.status) };
  }

  async function read<T>(path: string, parser: Parser<T>): Promise<ApiResult<T>> {
    const sent = await send('GET', path);
    if (!sent.ok) {
      return sent;
    }
    try {
      return { ok: true, value: parser.parse(await sent.response.json()) };
    } catch {
      return { ok: false, failure: 'failed' };
    }
  }

  async function write(path: string, body: unknown): Promise<ApiResult<void>> {
    const sent = await send('POST', path, body);
    return sent.ok ? { ok: true, value: undefined } : sent;
  }

  return {
    config: () => read('/v1/config', ConfigResponse),
    me: () => read('/v1/me', MeResponse),
    testLogin: (name) => write('/v1/auth/test-login', { name }),
    matchFormed: () => write('/v1/staging/match-formed', {}),
    myRoom: () => read('/v1/me/room', RoomView),
    myAgent: () => read('/v1/agents/me', AgentView),
    pair: (code) => write('/v1/agents/pair', { code }),
  };
}
