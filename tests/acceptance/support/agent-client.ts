// The simulated agent (design.md § Acceptance stack, ADR 023): the desktop agent's public HTTP contract, typed with
// @d2rmm/contracts and recorded per scenario. The real agent reads pixels; the suite stands in for it with the payloads
// the contract defines. Every request carries `X-Agent-Version` (overridable, or omitted) and a per-scenario
// `X-Forwarded-For`, which the local API trusts as its one proxy hop (AD-045).
import { randomUUID } from 'node:crypto';
import { Assignment, ClaimResponse, PairingCodeResponse, type Heartbeat } from '@d2rmm/contracts';

/** The agent version the simulated agent reports: above the minimum the stack sets (AGENT_MIN_VERSION 0.0.1). */
export const AGENT_VERSION = '0.1.0';

/** The screens a heartbeat can report (contracts `Screen`). */
export type Screen = Heartbeat['game']['screen'];

/** What the game shows to the agent, as its heartbeat reports it. */
export interface GameState {
  readonly running: boolean;
  readonly screen: Screen;
}

/** One observation the agent reports about its room. `type` is free text: the API catches unknown types (AWS-25). */
export interface ObservationInput {
  readonly type: string;
  readonly value: string;
  readonly run: number;
  readonly idempotencyKey?: string;
}

/** The answer of one request: its status, its parsed JSON body (or undefined) and its headers. */
export interface HttpAnswer {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Headers;
}

export interface SendOptions {
  readonly method: 'GET' | 'POST';
  /** The JSON body, when there is one. */
  readonly body?: unknown;
  /** The `X-Agent-Version` value; `null` omits the header. Defaults to the agent's version. */
  readonly version?: string | null | undefined;
  /** The bearer token; `null` omits the Authorization header. Defaults to the agent's token. */
  readonly bearer?: string | null | undefined;
  /** Extra headers, such as a session cookie for a request the tests make on behalf of the site. */
  readonly headers?: Readonly<Record<string, string>>;
}

export interface SimulatedAgentOptions {
  /** The API process the agent talks to (`http://127.0.0.1:<port>`). */
  readonly api: string;
  /** The address the scenario uses for its agents; the rate limits key on it. */
  readonly forwardedFor: string;
}

/** A heartbeat body that satisfies the contract for the given game state (contracts `Heartbeat`). */
export function heartbeatBody(state: GameState): Heartbeat {
  return {
    agentVersion: AGENT_VERSION,
    pcState: 'IDLE',
    game: { running: state.running, window: 'Diablo II: Resurrected', screen: state.screen },
    capture: { method: 'acceptance', readRate: 1 },
  };
}

/** An observation body in the contract's shape, with a fresh idempotency key unless one is given. */
export function observationBody(input: ObservationInput): Record<string, unknown> {
  return {
    idempotencyKey: input.idempotencyKey ?? randomUUID(),
    type: input.type,
    run: input.run,
    value: input.value,
    confidence: 0.99,
    capturedAt: new Date().toISOString(),
  };
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export class SimulatedAgent {
  readonly #api: string;
  readonly #forwardedFor: string;
  #version: string = AGENT_VERSION;
  #token: string | undefined;
  #code: string | undefined;
  #claimSecret: string | undefined;

  constructor(options: SimulatedAgentOptions) {
    this.#api = options.api;
    this.#forwardedFor = options.forwardedFor;
  }

  /** The six-digit code the agent last received, if any. */
  get code(): string | undefined {
    return this.#code;
  }

  /** The claim secret of the last pairing code, if any. */
  get claimSecret(): string | undefined {
    return this.#claimSecret;
  }

  /** The bearer token the agent received when it claimed, if any. */
  get token(): string | undefined {
    return this.#token;
  }

  /** The API process this agent talks to. */
  get api(): string {
    return this.#api;
  }

  /** The address this agent's requests come from (`X-Forwarded-For`). */
  get forwardedFor(): string {
    return this.#forwardedFor;
  }

  /** Sends one request as this agent. Returns the answer; the caller decides what the status means. */
  async send(path: string, options: SendOptions): Promise<HttpAnswer> {
    const headers: Record<string, string> = {
      'X-Forwarded-For': this.#forwardedFor,
      ...(options.headers ?? {}),
    };
    const version = options.version === undefined ? this.#version : options.version;
    if (version !== null) {
      headers['X-Agent-Version'] = version;
    }
    const bearer = options.bearer === undefined ? this.#token : options.bearer;
    if (bearer !== null && bearer !== undefined) {
      headers['Authorization'] = `Bearer ${bearer}`;
    }
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(`${this.#api}${path}`, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(10_000),
    });
    return { status: response.status, body: await parseBody(response), headers: response.headers };
  }

  /** Changes the version this agent reports on every request. */
  setVersion(version: string): void {
    this.#version = version;
  }

  /** `POST /v1/agents/pairing-codes`: a new pairing code. Keeps the code and the claim secret when answered 201. */
  async requestPairingCode(options: { version?: string | null | undefined } = {}): Promise<HttpAnswer> {
    const answer = await this.send('/v1/agents/pairing-codes', {
      method: 'POST',
      version: options.version,
      bearer: null,
    });
    if (answer.status === 201) {
      const issued = PairingCodeResponse.parse(answer.body);
      this.#code = issued.code;
      this.#claimSecret = issued.claimSecret;
    }
    return answer;
  }

  /** `POST /v1/agents/pairing-codes/claim`: the one-time token. Keeps the token when answered 200. */
  async claim(secret: string | undefined = this.#claimSecret): Promise<HttpAnswer> {
    const answer = await this.send('/v1/agents/pairing-codes/claim', {
      method: 'POST',
      body: { claimSecret: secret ?? '' },
      bearer: null,
    });
    if (answer.status === 200) {
      this.#token = ClaimResponse.parse(answer.body).token;
    }
    return answer;
  }

  /** `POST /v1/agents/heartbeat`: the game state the agent reports. */
  async heartbeat(
    state: GameState,
    options: { version?: string | null | undefined; bearer?: string | null | undefined; body?: unknown } = {},
  ): Promise<HttpAnswer> {
    return this.send('/v1/agents/heartbeat', {
      method: 'POST',
      body: options.body ?? heartbeatBody(state),
      version: options.version,
      bearer: options.bearer,
    });
  }

  /** `POST /v1/lobby-rooms/:id/observations`: one observation of the agent's room. */
  async observe(roomId: string, input: ObservationInput): Promise<HttpAnswer> {
    return this.send(`/v1/lobby-rooms/${encodeURIComponent(roomId)}/observations`, {
      method: 'POST',
      body: observationBody(input),
    });
  }

  /** `GET /v1/agents/me/assignment`: the room the agent is assigned to. Parses the body when answered 200. */
  async assignment(): Promise<HttpAnswer> {
    const answer = await this.send('/v1/agents/me/assignment', { method: 'GET' });
    if (answer.status === 200) {
      Assignment.parse(answer.body);
    }
    return answer;
  }
}
