// Identity steps of identity-bnet (IDB-01 to IDB-10): the sign-in with Battle.net through the fake provider
// (support/fake-battle-net.ts), the session it opens, sign-out, the revoke of a paired agent, and the refusals of the API.
// Black box: the browser, HTTP and the fake provider's own endpoints. The steps that test sign-in, pairing and presence
// are the ones of identity.steps.ts and agents.steps.ts, reused by their phrasing.
import { AgentView, MeResponse } from '@d2rmm/contracts';
import { expect, type Page } from '@playwright/test';
import { Given, Then, When } from '../fixtures.ts';
import type { GameState } from '../support/agent-client.ts';
import { BNET_CLIENT_ID, type BattleNetFailure } from '../support/fake-battle-net.ts';
import { SESSION_COOKIE, type Visitor, type World } from '../support/world.ts';

/** The link the site offers for the Battle.net sign-in (the en locale, `signIn.bnetLink`). */
const BNET_LINK = 'Sign in with Battle.net';
/** The text a page shows while it waits for the first answer of the API. */
const LOADING_TEXT = /^(Loading…|Carregando…)$/;
/** An origin that is not the site's: the cross-origin requests of IDB-10. */
const OTHER_ORIGIN = 'https://elsewhere.example';
/** The game is closed and the screen is unknown: the state of an agent that has nothing to show. */
const CLOSED_UNKNOWN: GameState = { running: false, screen: 'UNKNOWN' };
/** The failure of IDB-04 each Examples row names, as the fake provider answers it. */
const FAILURES: Readonly<Record<string, BattleNetFailure>> = {
  'the visitor refused access': 'access-denied',
  'a state that does not match': 'state-mismatch',
  'a code it does not accept': 'code-rejected',
  'a userinfo error': 'userinfo-error',
};

/** The name part of a BattleTag: the display name the site shows (`Alice#1234` → `Alice`). */
function displayNameOf(battletag: string): string {
  return battletag.split('#')[0] ?? battletag;
}

function visitorAt(world: World, index: number): Visitor {
  const visitor = world.visitors[index];
  if (visitor === undefined) {
    throw new Error(`visitor ${index + 1} has not opened the site in this scenario`);
  }
  return visitor;
}

/** The player a step names by display name ("Alice", "Bob"), created by the scenario's Given steps. */
function playerNamed(world: World, displayName: string) {
  const player = world.playerByDisplayName(displayName);
  if (player === undefined) {
    throw new Error(`"${displayName}" is not a player of this scenario`);
  }
  return player;
}

/** The player whose agent or session the steps act on: the last one that signed in with Battle.net. */
function ownerName(world: World): string {
  if (world.lastOwner === undefined) {
    throw new Error('no player has signed in with Battle.net in this scenario');
  }
  return world.lastOwner;
}

/** The account a visitor's session belongs to, read from the site's own /api/v1/me (as identity.steps.ts reads it). */
async function accountOfVisitor(visitor: Visitor): Promise<string> {
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

/** The session cookie value a visitor's browser holds for the site. Fails the step when there is none. */
async function sessionValueOf(world: World, visitor: Visitor): Promise<string> {
  const cookie = await world.sessionCookieOf(visitor);
  if (cookie === undefined) {
    throw new Error(`the browser holds no ${SESSION_COOKIE} cookie`);
  }
  return cookie.value;
}

/** Moves the keyboard focus to the control with this text, by Tab, as a player using only the keyboard does. */
async function tabTo(page: Page, text: string): Promise<void> {
  for (let press = 0; press < 80; press += 1) {
    const focused = await page.evaluate(() => (document.activeElement?.textContent ?? '').trim());
    if (focused === text) {
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error(`keyboard focus never reached "${text}"`);
}

/**
 * Starts the Battle.net sign-in from the visitor's page, by keyboard or by pointer, and waits for the site's answer. The
 * answer is the first `/api/v1/me` of the page the callback opened: the site reads the session there (failed or not).
 */
async function signInWithBattleNet(visitor: Visitor, keyboard: boolean): Promise<void> {
  const page = visitor.page;
  const link = page.getByRole('link', { name: BNET_LINK, exact: true });
  await expect(link, 'the Battle.net link').toBeVisible();
  const answered = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/me');
  if (keyboard) {
    await tabTo(page, BNET_LINK);
    await page.keyboard.press('Enter');
  } else {
    await link.click();
  }
  await answered;
}

/** Opens a new visitor's page on the site and signs it in with Battle.net (the identity the provider is scripted with). */
async function newVisitorSignedInWithBattleNet(world: World): Promise<Visitor> {
  const visitor = await world.newVisitor();
  await world.openSite(visitor);
  await signInWithBattleNet(visitor, false);
  return visitor;
}

/** A player who signed in with Battle.net on the site: the visitor, the session and the account are kept for later steps. */
async function signedInPlayer(world: World, battletag: string): Promise<void> {
  world.stack.battleNet.willSignIn(battletag);
  const visitor = await newVisitorSignedInWithBattleNet(world);
  const player = world.player(battletag);
  player.visitor = visitor;
  player.session = await sessionValueOf(world, visitor);
  player.accountId = await accountOfVisitor(visitor);
  world.lastOwner = battletag;
  await expect(
    visitor.page.getByText(`Signed in as ${displayNameOf(battletag)}`, { exact: true }),
  ).toBeVisible();
}

/** Reloads a visitor's page and waits until the site has left its loading state. */
async function reloadVisitor(visitor: Visitor): Promise<void> {
  await visitor.page.reload();
  await expect(visitor.page.getByText(LOADING_TEXT)).toHaveCount(0, { timeout: 15_000 });
}

/** The API's configuration (`GET /v1/config`) of one API endpoint. */
async function configOf(api: string): Promise<{ bnetSignIn?: unknown }> {
  const response = await fetch(`${api}/v1/config`, { signal: AbortSignal.timeout(10_000) });
  return (await response.json()) as { bnetSignIn?: unknown };
}

/** The id of the agent a presence answer names; fails when no agent is paired. */
function pairedAgentIdOf(body: unknown): string {
  const view = AgentView.parse(body);
  if (view.status !== 'paired') {
    throw new Error('no agent is paired');
  }
  return view.agentId;
}

/** `DELETE /v1/agents/:id` as a client sends it: with the session cookie when given, and with the given Origin. */
async function revokeRequest(
  api: string,
  agentId: string,
  options: { readonly session?: string | undefined; readonly origin: string },
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${api}/v1/agents/${encodeURIComponent(agentId)}`, {
    method: 'DELETE',
    headers: {
      Origin: options.origin,
      // The same-origin guard answers 403 to a mutating request without a JSON content type (as the site sends it).
      'Content-Type': 'application/json',
      ...(options.session === undefined ? {} : { Cookie: `${SESSION_COOKIE}=${options.session}` }),
    },
    // A JSON content type with an empty body is a 400 in Fastify, so the body is an empty JSON object.
    body: '{}',
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, body: await response.json().catch(() => undefined) };
}

// Background: the staging API has the Battle.net credentials; the site is the staging site (IDB-06 is the other case).
Given('Battle.net sign-in is configured', async ({ world }) => {
  world.site = world.stack.staging;
  expect((await configOf(world.site.api)).bnetSignIn, 'Battle.net sign-in is offered').toBe(true);
});

// IDB-06: the plain API has no Battle.net credentials: the site offers no Battle.net sign-in.
Given('Battle.net sign-in is not configured', async ({ world }) => {
  world.site = world.stack.plain;
  expect((await configOf(world.site.api)).bnetSignIn, 'Battle.net sign-in is not offered').toBe(false);
});

// IDB-01: the visitor chooses the link; the browser goes to the provider, which records the authorize request.
When(/^the visitor chooses "Sign in with Battle\.net"$/, async ({ world }) => {
  await world.currentVisitor.page.getByRole('link', { name: BNET_LINK, exact: true }).click();
  await expect.poll(() => world.stack.battleNet.lastAuthorize, { timeout: 10_000 }).toBeDefined();
});

Then(
  /^Battle\.net receives an authorize request for the site's callback with a state and an S256 code challenge$/,
  ({ world }) => {
    const request = world.stack.battleNet.lastAuthorize;
    expect(request?.clientId, 'the client id').toBe(BNET_CLIENT_ID);
    expect(request?.redirectUri, "the site's callback").toBe(`${world.site.site}/api/v1/auth/bnet/callback`);
    expect(request?.scope, 'the scope').toBe('openid');
    expect(request?.responseType, 'the response type').toBe('code');
    expect(request?.state ?? '', 'a state').toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(request?.codeChallengeMethod, 'the challenge method').toBe('S256');
    expect(request?.codeChallenge ?? '', 'an S256 code challenge').toMatch(/^[A-Za-z0-9_-]{43}$/);
  },
);

// The provider's script for the next sign-in (IDB-02, IDB-03, IDB-04, IDB-07).
Given(/^Battle\.net will sign in "(.+)"$/, ({ world }, battletag: string) => {
  world.stack.battleNet.willSignIn(battletag);
});

Given(/^Battle\.net will sign in the same Battle\.net account as "(.+)"$/, ({ world }, battletag: string) => {
  // The same `sub` as the account signed in before: the BattleTag changed, the account did not (IDB-03).
  world.stack.battleNet.willSignIn(battletag, world.stack.battleNet.identity.sub);
});

Given(/^Battle\.net will answer the sign-in with "(.+)"$/, ({ world }, text: string) => {
  const failure = FAILURES[text];
  if (failure === undefined) {
    throw new Error(`no Battle.net failure is named "${text}"`);
  }
  world.stack.battleNet.willAnswer(failure);
});

// IDB-02, IDB-03: the visitor signs in with Battle.net, by pointer or by keyboard.
When('the visitor signs in with Battle.net', async ({ world }) => {
  await signInWithBattleNet(world.currentVisitor, false);
});

When('the visitor signs in with Battle.net using only the keyboard', async ({ world }) => {
  await signInWithBattleNet(world.currentVisitor, true);
});

// IDB-02: the session cookie of the browser (HttpOnly and Secure, IDB-02 and AD-029).
Then('the visitor holds an HttpOnly, Secure session cookie', async ({ world }) => {
  const cookie = await world.sessionCookieOf(world.currentVisitor);
  if (cookie === undefined) {
    throw new Error(`the browser holds no ${SESSION_COOKIE} cookie`);
  }
  expect(cookie.httpOnly, 'HttpOnly').toBe(true);
  expect(cookie.secure, 'Secure').toBe(true);
});

// IDB-03: the same Battle.net account that signed in before, found by its `sub` (the account id is the same).
Given(/^"(.+)" has signed in with Battle\.net before$/, async ({ world, scenario }, battletag: string) => {
  world.stack.battleNet.willSignIn(battletag);
  const visitor = await newVisitorSignedInWithBattleNet(world);
  scenario.values.set('battleNetAccount', await accountOfVisitor(visitor));
});

Then('the visitor is signed in to the same account as before', async ({ world, scenario }) => {
  const before = scenario.values.get('battleNetAccount');
  expect(await accountOfVisitor(world.currentVisitor), 'the account of the first sign-in').toBe(before);
});

// IDB-04: a callback opened twice; the second opens no session, and the first session stays.
Given(/^a visitor has signed in with Battle\.net$/, async ({ world }) => {
  await newVisitorSignedInWithBattleNet(world);
});

When('the visitor opens the same Battle.net callback again', async ({ world }) => {
  const callback = world.stack.battleNet.lastCallbackUrl;
  if (callback === undefined) {
    throw new Error('Battle.net has redirected no visitor to the callback in this scenario');
  }
  await world.currentVisitor.page.goto(callback);
});

// IDB-05: sign-out ends the session; the old cookie is answered as unauthenticated.
Given(/^"(.+)" is signed in with Battle\.net$/, async ({ world }, battletag: string) => {
  await signedInPlayer(world, battletag);
});

When('the player signs out', async ({ world, scenario }) => {
  const player = world.player(ownerName(world));
  const visitor = player.visitor;
  if (visitor === undefined) {
    throw new Error(`"${player.name}" has not signed in on the site in this scenario`);
  }
  scenario.values.set('oldSession', await sessionValueOf(world, visitor));
  const answered = visitor.page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/v1/auth/logout',
  );
  await visitor.page.getByRole('button', { name: 'Sign out', exact: true }).click();
  expect((await answered).status(), 'the sign-out answer').toBe(204);
});

Then('a request with the old session cookie is answered as unauthenticated', async ({ world, scenario }) => {
  const oldSession = scenario.values.get('oldSession');
  if (typeof oldSession !== 'string') {
    throw new Error('no session of the player was kept before the sign-out');
  }
  const response = await fetch(`${world.site.api}/v1/me`, {
    headers: { Cookie: `${SESSION_COOKIE}=${oldSession}` },
    signal: AbortSignal.timeout(10_000),
  });
  expect(response.status, 'the old session').toBe(401);
});

// IDB-06: without the credentials the site offers no Battle.net sign-in, and the login route is not found.
Then(/^the site does not offer "(.+)"$/, async ({ world }, text: string) => {
  await expect(
    world.currentVisitor.page.getByRole('link', { name: text, exact: true }),
    `no "${text}"`,
  ).toHaveCount(0);
});

Then('a direct Battle.net login request is answered as not found', async ({ world }) => {
  const response = await fetch(`${world.site.api}/v1/auth/bnet/login`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  expect(response.status, 'the Battle.net login with no credentials').toBe(404);
});

// IDB-07: a test account and a Battle.net account are two accounts, even on staging.
When(/^another visitor signs in with Battle\.net$/, async ({ world }) => {
  await newVisitorSignedInWithBattleNet(world);
});

Then('the two visitors are signed in to different accounts', async ({ world }) => {
  const first = await accountOfVisitor(visitorAt(world, 0));
  const second = await accountOfVisitor(visitorAt(world, 1));
  expect(second, 'the Battle.net account is not the test account').not.toBe(first);
});

// IDB-08: a player revokes the paired agent on the site, by keyboard, after a confirmation.
Given(
  /^"(.+)" is signed in with Battle\.net and has a paired agent that is online$/,
  async ({ world }, name: string) => {
    await signedInPlayer(world, name);
    const agent = await world.pairAgent(name);
    const heartbeat = await agent.heartbeat(CLOSED_UNKNOWN);
    expect(heartbeat.status, 'the heartbeat is accepted').toBe(204);
    // The agent's stream is open before the revoke: the revoke must close it (IDB-08).
    await world.agentStreamOf(agent);
    const visitor = world.player(name).visitor;
    if (visitor === undefined) {
      throw new Error(`"${name}" has no page in this scenario`);
    }
    await reloadVisitor(visitor);
  },
);

When('the player revokes the agent on the site using only the keyboard', async ({ world }) => {
  const page = world.player(ownerName(world)).visitor?.page;
  if (page === undefined) {
    throw new Error('the player has no page in this scenario');
  }
  await expect(
    page.getByRole('button', { name: 'Revoke agent', exact: true }),
    'the revoke button',
  ).toBeVisible();
  await tabTo(page, 'Revoke agent');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Revoke', exact: true }), 'the confirmation').toBeVisible();
  const revoked = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' &&
      new URL(response.url()).pathname.startsWith('/api/v1/agents/'),
  );
  await tabTo(page, 'Revoke');
  await page.keyboard.press('Enter');
  const answer = await revoked;
  expect(answer.status(), 'the revoke answer').toBe(204);
  world.last = { status: answer.status(), body: undefined };
});

Then("the agent's next heartbeat is answered as unauthenticated", async ({ world }) => {
  const agent = world.currentAgentOf(ownerName(world));
  const answer = await agent.heartbeat(CLOSED_UNKNOWN);
  expect(answer.status, 'the heartbeat after the revoke').toBe(401);
  world.last = { status: answer.status, body: answer.body };
});

Then("the agent's stream is closed", async ({ world }) => {
  const stream = await world.agentStreamOf(world.currentAgentOf(ownerName(world)));
  await expect.poll(() => stream.ended, { timeout: 5_000, message: 'the agent stream ends' }).toBe(true);
});

Then('the site shows that no agent is paired and offers the pairing form', async ({ world }) => {
  const page = world.currentVisitor.page;
  await expect(page.getByLabel('Pairing code'), 'the pairing form').toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Pair agent', exact: true }),
    'the pairing action',
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revoke agent', exact: true }), 'no revoke').toHaveCount(0);
  await expect(page.getByText('Agent online', { exact: true }), 'no presence').toHaveCount(0);
  await expect(page.getByText('Agent offline', { exact: true }), 'no presence').toHaveCount(0);
});

// IDB-09: a player cannot revoke another player's agent.
When(/^(\w+) asks to revoke (\w+)'s agent$/, async ({ world }, asker: string, owner: string) => {
  const asking = playerNamed(world, asker);
  const agentId = pairedAgentIdOf((await world.presenceOf(playerNamed(world, owner).name)).body);
  const session = await world.sessionOf(asking.name);
  world.last = await revokeRequest(world.site.api, agentId, { session, origin: world.site.site });
});

Then('the answer is not found', ({ world }) => {
  expect(world.last?.status, 'the answer').toBe(404);
});

Then(/^(\w+)'s agent still sends heartbeats that are accepted$/, async ({ world }, owner: string) => {
  const answer = await world.currentAgentOf(playerNamed(world, owner).name).heartbeat(CLOSED_UNKNOWN);
  expect(answer.status, "the other player's agent heartbeat").toBe(204);
});

// IDB-10: sign-out and revoke refuse a request without a session (401) or from another origin (403).
When(
  /^a client asks to (sign out|revoke Alice's agent) (without a session|from another origin)$/,
  async ({ world }, action: string, how: string) => {
    const alice = playerNamed(world, 'Alice');
    const origin = how === 'from another origin' ? OTHER_ORIGIN : world.site.site;
    const session = how === 'from another origin' ? await world.sessionOf(alice.name) : undefined;
    if (action === 'sign out') {
      const response = await fetch(`${world.site.api}/v1/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: origin,
          ...(session === undefined ? {} : { Cookie: `${SESSION_COOKIE}=${session}` }),
        },
        body: '{}',
        signal: AbortSignal.timeout(10_000),
      });
      world.last = { status: response.status, body: await response.json().catch(() => undefined) };
      return;
    }
    const agentId = pairedAgentIdOf((await world.presenceOf(alice.name)).body);
    world.last = await revokeRequest(world.site.api, agentId, { session, origin });
  },
);

Then(/^the answer is "(\d+)"$/, ({ world }, code: string) => {
  expect(world.last?.status, 'the answer').toBe(Number(code));
});
