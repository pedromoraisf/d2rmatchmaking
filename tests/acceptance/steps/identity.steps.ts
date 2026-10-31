// Identity steps of api-web-skeleton (AWS-01 to AWS-04): test sign-in on the site, sessions and the cookie they set, and
// the refusals of the API. Black box: the browser and HTTP only (rule acceptance-is-black-box).
import { randomBytes } from 'node:crypto';
import { MeResponse } from '@d2rmm/contracts';
import { expect } from '@playwright/test';
import { Given, Then, When } from '../fixtures.ts';
import { SESSION_COOKIE, type Visitor, type World } from '../support/world.ts';

/** A session token in the contract's shape (`d2rmm_s_` + 43 base64url characters) that no account holds. */
function unknownSession(): string {
  return `d2rmm_s_${randomBytes(32).toString('base64url')}`;
}

/** Types the name into the sign-in form of the visitor's page and submits it. Returns the status of the answer. */
async function signInOnPage(visitor: Visitor, name: string): Promise<number> {
  const answer = visitor.page.waitForResponse((response) =>
    response.url().endsWith('/api/v1/auth/test-login'),
  );
  await visitor.page.getByLabel('Player name').fill(name);
  await visitor.page.getByRole('button', { name: 'Sign in', exact: true }).click();
  return (await answer).status();
}

/**
 * The account the visitor's session belongs to, read from the site's own /api/v1/me. The request is made by the page, so
 * it carries the browser's cookies exactly as the site does (a request context leaves Secure cookies out on http).
 */
async function accountOf(visitor: Visitor): Promise<string> {
  const answer = await visitor.page.evaluate(async () => {
    const response = await fetch('/api/v1/me');
    return {
      status: response.status,
      body: response.status === 200 ? ((await response.json()) as unknown) : null,
    };
  });
  expect(answer.status, 'the visitor is signed in').toBe(200);
  return MeResponse.parse(answer.body).accountId;
}

function visitorAt(world: World, index: number): Visitor {
  const visitor = world.visitors[index];
  if (visitor === undefined) {
    throw new Error(`visitor ${index + 1} has not opened the site in this scenario`);
  }
  return visitor;
}

// Which API the scenario talks to: staging endpoints on (AD-029) or off (AWS-03).
Given('test sign-in is enabled', ({ world }) => {
  world.site = world.stack.staging;
});

Given('test sign-in is disabled', ({ world }) => {
  world.site = world.stack.plain;
});

// AWS-01, AWS-02: a visitor signs in on the site with a player name. A new visitor each time: "another visitor" is a
// second browser with its own cookies.
When(
  /^(a|another) visitor signs in on the site as "(.*)"$/,
  async ({ world }, _article: string, name: string) => {
    const visitor = await world.newVisitor();
    await world.openSite(visitor);
    const status = await signInOnPage(visitor, name);
    world.last = { status, body: undefined };
  },
);

// AWS-01: the cookie the API sets for the browser (the session of seven days, AD-029).
Then(
  /^the session cookie is HttpOnly, Secure, SameSite Lax, for path "\/" and lasts 7 days$/,
  async ({ world }) => {
    const cookie = await world.sessionCookieOf(visitorAt(world, 0));
    if (cookie === undefined) {
      throw new Error(`the browser holds no ${SESSION_COOKIE} cookie`);
    }
    expect(cookie.httpOnly, 'HttpOnly').toBe(true);
    expect(cookie.secure, 'Secure').toBe(true);
    expect(cookie.sameSite, 'SameSite').toBe('Lax');
    expect(cookie.path, 'path').toBe('/');
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const remainingMs = cookie.expires * 1000 - Date.now();
    expect(remainingMs, 'lifetime in ms').toBeGreaterThan(sevenDaysMs - 60_000);
    expect(remainingMs, 'lifetime in ms').toBeLessThanOrEqual(sevenDaysMs + 60_000);
  },
);

When('the visitor reloads the site', async ({ world }) => {
  const visitor = visitorAt(world, 0);
  await visitor.page.reload();
  await expect(visitor.page.getByText(/^(Loading…|Carregando…)$/)).toHaveCount(0, { timeout: 15_000 });
});

Then('the visitor is still signed out', async ({ world }) => {
  const page = world.currentVisitor.page;
  await expect(page.getByLabel('Player name'), 'the sign-in form stays').toBeVisible();
  await expect(page.getByText('Signed in as'), 'no "Signed in as" text').toHaveCount(0);
});

Then('both visitors are signed in to the same account', async ({ world }) => {
  const first = await accountOf(visitorAt(world, 0));
  const second = await accountOf(visitorAt(world, 1));
  expect(second, 'the same account').toBe(first);
});

Then(/^the other visitor's site shows "(.+)"$/, async ({ world }, text: string) => {
  await expect(visitorAt(world, 1).page.getByText(text, { exact: true }), `"${text}"`).toBeVisible();
});

// AWS-03: with staging endpoints off the site offers no test sign-in and no test match.
Then(/^the site offers neither "(.+)" nor "(.+)"$/, async ({ world }, first: string, second: string) => {
  const page = world.currentVisitor.page;
  await expect(page.getByText(first, { exact: true }), `no "${first}"`).toHaveCount(0);
  await expect(page.getByText(second, { exact: true }), `no "${second}"`).toHaveCount(0);
});

Then('a direct test sign-in request is answered as not found', async ({ world }) => {
  const response = await fetch(`${world.site.api}/v1/auth/test-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: world.site.site },
    body: JSON.stringify({ name: 'PlayerOne' }),
    signal: AbortSignal.timeout(10_000),
  });
  expect(response.status, 'test sign-in with staging off').toBe(404);
});

Then('a direct test match request is answered as not found', async ({ world }) => {
  const response = await fetch(`${world.site.api}/v1/staging/match-formed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: world.site.site },
    body: '{}',
    signal: AbortSignal.timeout(10_000),
  });
  expect(response.status, 'test match with staging off').toBe(404);
});

// AWS-04: a site endpoint refuses a request without a valid session.
When('a client calls a site endpoint without a session', async ({ world }) => {
  const response = await fetch(`${world.site.api}/v1/me`, { signal: AbortSignal.timeout(10_000) });
  world.last = { status: response.status, body: await response.json().catch(() => undefined) };
});

When('a client calls a site endpoint with an unknown session', async ({ world }) => {
  const response = await fetch(`${world.site.api}/v1/me`, {
    headers: { Cookie: `${SESSION_COOKIE}=${unknownSession()}` },
    signal: AbortSignal.timeout(10_000),
  });
  world.last = { status: response.status, body: await response.json().catch(() => undefined) };
});

// The generic answer of the API to the last request a step made.
Then(/^the API answers "(\d+)"$/, ({ world }, code: string) => {
  expect(world.last?.status, 'the API answer').toBe(Number(code));
});

Then(/^the API answers "(\d+)" with no token$/, ({ world }, code: string) => {
  expect(world.last?.status, 'the API answer').toBe(Number(code));
  expect(world.last?.body, 'the answer body holds no token').not.toHaveProperty('token');
});

// AWS-04 (web): the browser holds a session cookie that the API does not know.
Given('the browser holds a session cookie the API does not know', ({ world }) => {
  world.pendingSessionCookie = unknownSession();
});

// AWS-01, AWS-02 and later tasks: a player who signed in on the site. Its visitor's page stays open for later steps.
Given(/^"(.+)" is signed in on the site$/, async ({ world }, name: string) => {
  const player = world.player(name);
  const visitor = await world.newVisitor();
  await world.openSite(visitor);
  const status = await signInOnPage(visitor, name);
  expect(status, `test sign-in of "${name}"`).toBe(200);
  await expect(visitor.page.getByText(`Signed in as ${name}`, { exact: true })).toBeVisible();
  const cookie = await world.sessionCookieOf(visitor);
  player.visitor = visitor;
  if (cookie !== undefined) {
    player.session = cookie.value;
  }
  player.accountId = await accountOf(visitor);
});
