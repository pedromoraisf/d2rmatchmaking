// What the steps of one scenario share (design.md § Acceptance stack). A fresh World is made for every scenario, after the
// reset of both APIs, so nothing leaks between scenarios. Visitors are browser contexts: each one is a person with their
// own cookies (AWS-01). The World is black-box state only: URLs, answers, sessions and browser pages.
import { randomInt } from 'node:crypto';
import { MeResponse, RoomView } from '@d2rmm/contracts';
import { expect, type Browser, type BrowserContext, type Cookie, type Page } from '@playwright/test';
import { observationBody, SimulatedAgent, type ObservationInput } from './agent-client.ts';
import { signInWithBattleNetThroughApi } from './fake-battle-net.ts';
import { EventStream } from './sse.ts';
import type { Endpoint, Stack } from './stack.ts';

/** The session cookie name of the API (identity routes, `__Host-` prefix). */
export const SESSION_COOKIE = '__Host-d2rmm_session';

/** The text a page shows while it waits for the first answer of the API. */
const LOADING_TEXT = /^(Loading…|Carregando…)$/;

/** A request the visitor's page made, recorded for the same-origin scenario (AWS-29). */
export interface RecordedRequest {
  readonly url: string;
  readonly resourceType: string;
}

/** A response the visitor's page received, with its Set-Cookie headers (AWS-29). */
export interface RecordedResponse {
  readonly url: string;
  readonly status: number;
  readonly setCookie: readonly string[];
}

/** One visitor: a browser context with one page, and what that page did on the network. */
export interface Visitor {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly requests: RecordedRequest[];
  readonly responses: RecordedResponse[];
}

/** The answer of the last HTTP request a step made (for the generic "the API answers" steps). */
export interface LastAnswer {
  readonly status: number;
  readonly body: unknown;
}

/** A player of the scenario: an account, reached through a browser visitor, an API session, or both. */
export interface Player {
  readonly name: string;
  accountId?: string;
  /** The session token value (`d2rmm_s_…`), from the API's Set-Cookie or from the visitor's cookie. */
  session?: string;
  /** The browser visitor, when the player signed in on the site. */
  visitor?: Visitor;
  /** The agents this player paired, oldest first. */
  readonly agents: SimulatedAgent[];
  /** The site stream of the player, while it is open. */
  stream?: EventStream;
  /** The id of the last event the player's stream received before it was closed (AWS-28). */
  closedStreamLastId?: string;
  /** The newest room of the player, as the API reads it. */
  room?: { roomId: string; gameName: string };
}

/** The last observation an agent sent: what "the same observation again" sends once more (AWS-24). */
export interface SentObservation {
  readonly agent: SimulatedAgent;
  readonly roomId: string;
  readonly body: Record<string, unknown>;
}

/** The pairing answer of `POST /v1/agents/pair` for a session and a code: the status and the parsed body. */
export interface PairSubmission {
  readonly status: number;
  readonly body: unknown;
}

/** Submits a pairing code with a session, as the site does (same origin, JSON, the session cookie). */
export async function submitPairingCode(
  endpoint: Endpoint,
  session: string,
  code: string,
): Promise<PairSubmission> {
  const response = await fetch(`${endpoint.api}/v1/agents/pair`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: endpoint.site,
      Cookie: `${SESSION_COOKIE}=${session}`,
    },
    body: JSON.stringify({ code }),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, body: await response.json().catch(() => undefined) };
}

/** Signs in through the API (`POST /v1/auth/test-login`) as the given endpoint's site. Returns the account and session. */
export async function signInThroughApi(
  endpoint: Endpoint,
  name: string,
): Promise<{ accountId: string; session: string }> {
  const response = await fetch(`${endpoint.api}/v1/auth/test-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: endpoint.site },
    body: JSON.stringify({ name }),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== 200) {
    throw new Error(`test sign-in of "${name}" answered ${response.status}`);
  }
  const prefix = `${SESSION_COOKIE}=`;
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith(prefix));
  if (cookie === undefined) {
    throw new Error(`test sign-in of "${name}" set no session cookie`);
  }
  const me = MeResponse.parse(await response.json());
  return { accountId: me.accountId, session: cookie.slice(prefix.length).split(';')[0] ?? '' };
}

export class World {
  readonly stack: Stack;
  readonly #browser: Browser;
  readonly #visitors: Visitor[] = [];
  readonly #players = new Map<string, Player>();
  /**
   * The address this scenario's agents come from (`X-Forwarded-For`). The rate limits of pairing codes key on it, so each
   * scenario gets its own address and nothing carries over from another scenario.
   */
  readonly forwardedFor = `10.${randomInt(0, 256)}.${randomInt(0, 256)}.${randomInt(1, 255)}`;
  /** Every agent the scenario paired, in pairing order (AWS-10 names the first and the second). */
  readonly paired: SimulatedAgent[] = [];
  /** The agent the last step created or used: "the agent" of a step. */
  #lastAgent: SimulatedAgent | undefined;
  /** The name of the player the last paired agent belongs to: "the site" of a step that acts for that agent. */
  lastOwner: string | undefined;
  /** The six-digit code the agent last showed, which "types that code" enters on the site. */
  shownCode: string | undefined;
  /** The presence the site reads for the owner, taken before a step that must not change it (AWS-18). */
  presenceSnapshot: unknown;
  /** The name of the player who started the last test match: the host of its room. */
  matchOwner: string | undefined;
  /** The answer status of the last test-match request (AWS-19 and the test-match scenarios). */
  matchStatus: number | undefined;
  /** The last observation sent, for "the same observation again" (AWS-24). */
  lastObservation: SentObservation | undefined;
  /** Every EventStream the scenario opened: closed when the scenario ends. */
  readonly #streams: EventStream[] = [];
  readonly #agentStreams = new Map<SimulatedAgent, EventStream>();
  /** The site the scenario uses: staging unless it says test sign-in is disabled (AWS-03). */
  site: Endpoint;
  /** The browser language a visitor's context prefers (AWS-37); undefined keeps the default. */
  locale: string | undefined;
  /** A session cookie value the visitors' browsers hold before the site loads (AWS-04); undefined when none. */
  pendingSessionCookie: string | undefined;
  /** The last HTTP answer a step recorded. */
  last: LastAnswer | undefined;

  constructor(stack: Stack, browser: Browser) {
    this.stack = stack;
    this.#browser = browser;
    this.site = stack.staging;
  }

  /** All visitors of this scenario, in the order they were created. */
  get visitors(): readonly Visitor[] {
    return this.#visitors;
  }

  /** The visitor a step acts on by default: the most recently created one. */
  get currentVisitor(): Visitor {
    const visitor = this.#visitors.at(-1);
    if (visitor === undefined) {
      throw new Error('no visitor has opened the site in this scenario');
    }
    return visitor;
  }

  /** The player of that name, created on first use. Names are the ones the scenario writes ("PlayerOne"). */
  player(name: string): Player {
    const existing = this.#players.get(name);
    if (existing !== undefined) {
      return existing;
    }
    const created: Player = { name, agents: [] };
    this.#players.set(name, created);
    return created;
  }

  /** A new simulated agent of this scenario, which becomes "the agent" of the following steps. */
  newAgent(): SimulatedAgent {
    const agent = new SimulatedAgent({ api: this.site.api, forwardedFor: this.forwardedFor });
    this.#lastAgent = agent;
    return agent;
  }

  /** The agent the last step created or used. Fails when no agent exists yet in the scenario. */
  get lastAgent(): SimulatedAgent {
    if (this.#lastAgent === undefined) {
      throw new Error('no agent exists in this scenario');
    }
    return this.#lastAgent;
  }

  /** Uses an existing agent as "the agent" of the following steps. */
  useAgent(agent: SimulatedAgent): void {
    this.#lastAgent = agent;
  }

  /**
   * Pairs a new agent of the player, through the API: a pairing code, the code typed with the player's session, and the
   * claim of the token. The agent becomes "the agent" of the following steps.
   */
  async pairAgent(name: string): Promise<SimulatedAgent> {
    const session = await this.sessionOf(name);
    const agent = this.newAgent();
    const shown = await agent.requestPairingCode();
    expect(shown.status, 'the pairing code').toBe(201);
    const paired = await submitPairingCode(this.site, session, agent.code ?? '');
    expect(paired.status, `pairing an agent of "${name}"`).toBe(200);
    const claimed = await agent.claim();
    expect(claimed.status, 'the claim after pairing').toBe(200);
    this.player(name).agents.push(agent);
    this.paired.push(agent);
    this.lastOwner = name;
    return agent;
  }

  /** The presence the site reads for the player's paired agent: `GET /v1/agents/me` with the player's session. */
  async presenceOf(name: string): Promise<{ status: number; body: unknown }> {
    const session = await this.sessionOf(name);
    const response = await fetch(`${this.site.api}/v1/agents/me`, {
      headers: { Cookie: `${SESSION_COOKIE}=${session}` },
      signal: AbortSignal.timeout(10_000),
    });
    return { status: response.status, body: await response.json().catch(() => undefined) };
  }

  /** The player of this display name (the name part of a BattleTag, or a test name), or undefined. */
  playerByDisplayName(displayName: string): Player | undefined {
    for (const player of this.#players.values()) {
      if (player.name.split('#')[0] === displayName) {
        return player;
      }
    }
    return undefined;
  }

  /**
   * The player's session token, signing in when the player has none yet. A name with a BattleTag (`Name#1234`) is a
   * Battle.net account, signed in through the fake provider (IDB-02); any other name is a test account (AD-029).
   */
  async sessionOf(name: string): Promise<string> {
    const player = this.player(name);
    if (player.session === undefined) {
      const signedIn = name.includes('#')
        ? await signInWithBattleNetThroughApi(this.site, this.stack.battleNet, name)
        : await signInThroughApi(this.site, name);
      player.accountId = signedIn.accountId;
      player.session = signedIn.session;
    }
    return player.session;
  }

  /** Creates a visitor: a fresh browser context in the scenario's language, with the pending cookies applied. */
  async newVisitor(): Promise<Visitor> {
    const context = await this.#browser.newContext({
      ...(this.locale === undefined ? {} : { locale: this.locale }),
    });
    const page = await context.newPage();
    const requests: RecordedRequest[] = [];
    const responses: RecordedResponse[] = [];
    page.on('request', (request) => {
      requests.push({ url: request.url(), resourceType: request.resourceType() });
    });
    page.on('response', (response) => {
      // headersArray() is asynchronous: the record is appended once the headers are read.
      // A page closed before the headers are read (a redirect the scenario ends on) rejects: nothing is recorded then.
      response
        .headersArray()
        .then((headers) => {
          responses.push({
            url: response.url(),
            status: response.status(),
            setCookie: headers
              .filter((header) => header.name.toLowerCase() === 'set-cookie')
              .map((header) => header.value),
          });
        })
        .catch(() => undefined);
    });
    const visitor: Visitor = { context, page, requests, responses };
    this.#visitors.push(visitor);
    return visitor;
  }

  /** Opens the site in the visitor's page and waits until the site has left its loading state. */
  async openSite(visitor: Visitor): Promise<void> {
    await visitor.page.goto(`${this.site.site}/`);
    if (this.pendingSessionCookie !== undefined) {
      // A `__Host-` cookie cannot carry a Domain attribute, which Playwright's addCookies always sets; the page sets
      // it instead. 127.0.0.1 is a secure context, so a Secure cookie is accepted.
      // The page runs this function, so it gets its values as arguments: no Node-side name is in scope there.
      await visitor.page.evaluate(
        ([name, value]: [string, string]) => {
          document.cookie = `${name}=${value}; Path=/; Secure; SameSite=Lax`;
        },
        [SESSION_COOKIE, this.pendingSessionCookie] as [string, string],
      );
      await visitor.page.reload();
    }
    await expect(visitor.page.getByText(LOADING_TEXT)).toHaveCount(0, { timeout: 15_000 });
  }

  /**
   * The session cookie a visitor's browser holds for the site, or undefined. Read from all the context's cookies and
   * matched on the host: a Secure cookie on an http origin is left out of a URL-filtered list.
   */
  async sessionCookieOf(visitor: Visitor): Promise<Cookie | undefined> {
    const host = new URL(this.site.site).hostname;
    const cookies = await visitor.context.cookies();
    return cookies.find((cookie) => cookie.name === SESSION_COOKIE && cookie.domain === host);
  }

  /** The agent a player paired last: "the agent" of that player's steps. */
  currentAgentOf(name: string): SimulatedAgent {
    const agent = this.player(name).agents.at(-1);
    if (agent === undefined) {
      throw new Error(`"${name}" has no paired agent in this scenario`);
    }
    return agent;
  }

  /** The player's site stream: opened with the session cookie on first use, or after a close. */
  async siteStreamOf(name: string): Promise<EventStream> {
    const player = this.player(name);
    if (player.stream !== undefined && !player.stream.closed) {
      return player.stream;
    }
    const session = await this.sessionOf(name);
    const stream = await this.openSiteStream(session);
    player.stream = stream;
    return stream;
  }

  /** Opens a site stream with the given session (after a close, with the id the stream stopped at). */
  async openSiteStream(session: string, lastEventId?: string): Promise<EventStream> {
    const headers: Record<string, string> = { Cookie: `${SESSION_COOKIE}=${session}` };
    if (lastEventId !== undefined) {
      headers['Last-Event-ID'] = lastEventId;
    }
    const stream = await EventStream.open(`${this.site.api}/v1/stream`, headers);
    this.#streams.push(stream);
    return stream;
  }

  /** The agent's stream, opened on first use with the agent's token. */
  async agentStreamOf(agent: SimulatedAgent): Promise<EventStream> {
    const existing = this.#agentStreams.get(agent);
    if (existing !== undefined && !existing.closed) {
      return existing;
    }
    const stream = await agent.openStream();
    this.#streams.push(stream);
    this.#agentStreams.set(agent, stream);
    return stream;
  }

  /**
   * Starts a test match for the player: opens the streams that must see the room first (the site's and the current
   * agent's), requests the match (the button of the site or the API), and waits for the newest room to be readable.
   */
  async startTestMatch(name: string, viaSite: boolean): Promise<void> {
    const session = await this.sessionOf(name);
    await this.siteStreamOf(name);
    const agent = this.player(name).agents.at(-1);
    if (agent !== undefined) {
      await this.agentStreamOf(agent);
    }
    const previous = this.player(name).room?.roomId;
    this.matchOwner = name;
    if (viaSite) {
      const visitor = this.player(name).visitor;
      if (visitor === undefined) {
        throw new Error(`"${name}" has not signed in on the site in this scenario`);
      }
      const answered = visitor.page.waitForResponse((response) =>
        response.url().endsWith('/api/v1/staging/match-formed'),
      );
      await visitor.page.getByRole('button', { name: 'Start test match', exact: true }).click();
      this.matchStatus = (await answered).status();
    } else {
      const response = await fetch(`${this.site.api}/v1/staging/match-formed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: this.site.site,
          Cookie: `${SESSION_COOKIE}=${session}`,
        },
        body: '{}',
        signal: AbortSignal.timeout(10_000),
      });
      this.matchStatus = response.status;
    }
    await this.refreshRoom(name, previous);
    // The site learns the room from its stream or from its next read; a page that opened before the relay wrote the room
    // can miss the event. Reloading reads the room the API now holds, so the page shows it deterministically.
    const visitor = this.player(name).visitor;
    if (!viaSite && visitor !== undefined) {
      await visitor.page.reload();
      await expect(visitor.page.getByText(LOADING_TEXT)).toHaveCount(0, { timeout: 15_000 });
    }
  }

  /** Reads the player's newest room through `GET /v1/me/room`, once it differs from `previousRoomId`. */
  async refreshRoom(name: string, previousRoomId?: string): Promise<void> {
    const session = await this.sessionOf(name);
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const response = await fetch(`${this.site.api}/v1/me/room`, {
        headers: { Cookie: `${SESSION_COOKIE}=${session}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 200) {
        const view = RoomView.parse(await response.json());
        if (view.roomId !== previousRoomId) {
          this.player(name).room = { roomId: view.roomId, gameName: view.expectedGameName };
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`"${name}" has no new room within 5 s`);
  }

  /** The stage the API reports for the player's newest room. */
  async stageOf(name: string): Promise<string> {
    const session = await this.sessionOf(name);
    const response = await fetch(`${this.site.api}/v1/me/room`, {
      headers: { Cookie: `${SESSION_COOKIE}=${session}` },
      signal: AbortSignal.timeout(10_000),
    });
    expect(response.status, `the room of "${name}"`).toBe(200);
    return RoomView.parse(await response.json()).stage;
  }

  /** Sends one observation as the agent, to the room, and records it as the last observation. */
  async observe(agent: SimulatedAgent, roomId: string, input: ObservationInput): Promise<void> {
    const body = observationBody(input);
    const answer = await agent.send(`/v1/lobby-rooms/${encodeURIComponent(roomId)}/observations`, {
      method: 'POST',
      body,
    });
    this.last = { status: answer.status, body: answer.body };
    this.lastObservation = { agent, roomId, body };
  }

  /** Sends the last observation once more, unchanged (same idempotency key). */
  async resendLastObservation(): Promise<void> {
    const sent = this.lastObservation;
    if (sent === undefined) {
      throw new Error('no observation was sent in this scenario');
    }
    const answer = await sent.agent.send(`/v1/lobby-rooms/${encodeURIComponent(sent.roomId)}/observations`, {
      method: 'POST',
      body: sent.body,
    });
    this.last = { status: answer.status, body: answer.body };
  }

  /** Closes every visitor's browser context and every stream. Called once the scenario ends. */
  async dispose(): Promise<void> {
    for (const stream of this.#streams.splice(0)) {
      stream.close();
    }
    for (const visitor of this.#visitors.splice(0)) {
      await visitor.context.close();
    }
  }
}
