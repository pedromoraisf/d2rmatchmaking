// The site's only way to call the API: same origin, through the /api/* Pages Function (ADR 012, AWS-29). Every POST
// carries a JSON body and the JSON content type. A 401 is `unauthenticated`, so the site shows its signed-out view.
import {
  AgentView,
  ConfigResponse,
  MeResponse,
  MyCharactersResponse,
  MyQueueTicketResponse,
  QueueTicketView,
  RoomView,
} from '@d2rmm/contracts';
import { QueueRefusal } from '@d2rmm/contracts';
import type { DeclareCharacterRequest, JoinQueueRequest, QueueRefusalCode } from '@d2rmm/contracts';

export interface Parser<T> {
  parse(input: unknown): T;
}

/** `refused`: the queue answered 409 or 422 with the reason in `refusal` (QUE-03 … QUE-06). */
export type ApiFailure = 'unauthenticated' | 'not-found' | 'invalid' | 'rate-limited' | 'refused' | 'failed';
export type ApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: ApiFailure; refusal?: QueueRefusalCode; secondsLeft?: number };
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
  signOut(): Promise<ApiResult<void>>;
  matchFormed(): Promise<ApiResult<void>>;
  myRoom(): Promise<ApiResult<RoomView>>;
  myAgent(): Promise<ApiResult<AgentView>>;
  myCharacters(): Promise<ApiResult<MyCharactersResponse>>;
  pair(code: string): Promise<ApiResult<void>>;
  revokeAgent(agentId: string): Promise<ApiResult<void>>;
  declareCharacter(characterId: string, body: DeclareCharacterRequest): Promise<ApiResult<void>>;
  myQueueTicket(): Promise<ApiResult<MyQueueTicketResponse>>;
  joinQueue(body: JoinQueueRequest): Promise<ApiResult<QueueTicketView>>;
  leaveQueue(ticketId: string): Promise<ApiResult<void>>;
  acceptReadyCheck(checkId: string): Promise<ApiResult<void>>;
  declineReadyCheck(checkId: string): Promise<ApiResult<void>>;
}

export function createApiClient(fetcher: Fetcher = (url, init) => fetch(url, init)): ApiClient {
  /** The raw answer of a request, or null when the request never reached the API. */
  async function transmit(
    method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
    path: string,
    body?: unknown,
  ): Promise<Response | null> {
    const url = `${API_PREFIX}${path}`;
    let response: Response;
    try {
      // Every write carries a JSON body (an empty object when there is nothing to send): the API's same-origin guard
      // needs the JSON content type on every non-GET request.
      response =
        method === 'GET'
          ? await fetcher(url, { method })
          : await fetcher(url, {
              method,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body ?? {}),
            });
    } catch {
      return null;
    }
    return response;
  }

  async function send(
    method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
    path: string,
    body?: unknown,
  ): Promise<Sent> {
    const response = await transmit(method, path, body);
    if (response === null) {
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

  async function write(
    path: string,
    body: unknown,
    method: 'POST' | 'DELETE' | 'PATCH' = 'POST',
  ): Promise<ApiResult<void>> {
    const sent = await send(method, path, body);
    return sent.ok ? { ok: true, value: undefined } : sent;
  }

  // A refusal (409 or 422) is not a failure of the request: its reason is the code the site translates (QUE-15).
  async function joinQueue(body: JoinQueueRequest): Promise<ApiResult<QueueTicketView>> {
    const response = await transmit('POST', '/v1/queue/tickets', body);
    if (response === null) {
      return { ok: false, failure: 'failed' };
    }
    if (response.ok) {
      try {
        return { ok: true, value: QueueTicketView.parse(await response.json()) };
      } catch {
        return { ok: false, failure: 'failed' };
      }
    }
    if (response.status === 409 || response.status === 422) {
      try {
        const reason = QueueRefusal.safeParse(await response.json());
        if (reason.success) {
          // A ready-check penalty carries the whole seconds left (RDY-05); the other refusals have none.
          return {
            ok: false,
            failure: 'refused',
            refusal: reason.data.error,
            ...(reason.data.secondsLeft === undefined ? {} : { secondsLeft: reason.data.secondsLeft }),
          };
        }
      } catch {
        return { ok: false, failure: 'failed' };
      }
    }
    return { ok: false, failure: failureFor(response.status) };
  }

  return {
    config: () => read('/v1/config', ConfigResponse),
    me: () => read('/v1/me', MeResponse),
    testLogin: (name) => write('/v1/auth/test-login', { name }),
    signOut: () => write('/v1/auth/logout', {}),
    matchFormed: () => write('/v1/staging/match-formed', {}),
    myRoom: () => read('/v1/me/room', RoomView),
    myAgent: () => read('/v1/agents/me', AgentView),
    myCharacters: () => read('/v1/me/characters', MyCharactersResponse),
    pair: (code) => write('/v1/agents/pair', { code }),
    revokeAgent: (agentId) => write(`/v1/agents/${encodeURIComponent(agentId)}`, {}, 'DELETE'),
    declareCharacter: (characterId, body) =>
      write(`/v1/me/characters/${encodeURIComponent(characterId)}`, body, 'PATCH'),
    myQueueTicket: () => read('/v1/queue/tickets/me', MyQueueTicketResponse),
    joinQueue: (body) => joinQueue(body),
    leaveQueue: (ticketId) => write(`/v1/queue/tickets/${encodeURIComponent(ticketId)}`, {}, 'DELETE'),
    acceptReadyCheck: (checkId) => write(`/v1/ready-checks/${encodeURIComponent(checkId)}/accept`, {}),
    declineReadyCheck: (checkId) => write(`/v1/ready-checks/${encodeURIComponent(checkId)}/decline`, {}),
  };
}
