// What the steps of one scenario share (design.md § Acceptance stack). A fresh World is made for every scenario, after the
// reset of both APIs, so nothing leaks between scenarios. Visitors are browser contexts: each one is a person with their
// own cookies (AWS-01). The World is black-box state only: URLs, answers, sessions and browser pages.
import { MeResponse } from '@d2rmm/contracts';
import { expect, type Browser, type BrowserContext, type Cookie, type Page } from '@playwright/test';
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
    const created: Player = { name };
    this.#players.set(name, created);
    return created;
  }

  /** The player's session token, signing in through the API when the player has none yet. */
  async sessionOf(name: string): Promise<string> {
    const player = this.player(name);
    if (player.session === undefined) {
      const signedIn = await signInThroughApi(this.site, name);
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
      void response.headersArray().then((headers) => {
        responses.push({
          url: response.url(),
          status: response.status(),
          setCookie: headers
            .filter((header) => header.name.toLowerCase() === 'set-cookie')
            .map((header) => header.value),
        });
      });
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

  /** Closes every visitor's browser context. Called once the scenario ends. */
  async dispose(): Promise<void> {
    for (const visitor of this.#visitors.splice(0)) {
      await visitor.context.close();
    }
  }
}
