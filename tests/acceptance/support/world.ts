// What the steps of one scenario share (design.md § Acceptance stack). A fresh World is made for every scenario, after the
// reset of both APIs, so nothing leaks between scenarios. Visitors are browser contexts: each one is a person with their
// own cookies (AWS-01). The World is black-box state only: URLs, answers and browser pages.
import type { Browser, BrowserContext, Cookie, Page } from '@playwright/test';
import type { Endpoint, Stack } from './stack.ts';

/** The session cookie name of the API (identity routes, `__Host-` prefix). */
export const SESSION_COOKIE = '__Host-d2rmm_session';

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

export class World {
  readonly stack: Stack;
  readonly #browser: Browser;
  readonly #visitors: Visitor[] = [];
  /** The site the scenario uses: staging unless it says test sign-in is disabled (AWS-03). */
  site: Endpoint;
  /** The browser language a visitor's context prefers (AWS-37); undefined keeps the default. */
  locale: string | undefined;
  /** Cookies a visitor's context starts with (AWS-04): applied when the visitor is created. */
  readonly pendingCookies: Cookie[] = [];
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

  /** Creates a visitor: a fresh browser context in the scenario's language, with the pending cookies applied. */
  async newVisitor(): Promise<Visitor> {
    const context = await this.#browser.newContext({
      ...(this.locale === undefined ? {} : { locale: this.locale }),
    });
    if (this.pendingCookies.length > 0) {
      await context.addCookies([...this.pendingCookies]);
    }
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

  /** Closes every visitor's browser context. Called once the scenario ends. */
  async dispose(): Promise<void> {
    for (const visitor of this.#visitors.splice(0)) {
      await visitor.context.close();
    }
  }
}
