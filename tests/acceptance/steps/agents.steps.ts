// Agents steps of api-web-skeleton (AWS-05 to AWS-14, AWS-16, AWS-18): pairing codes, the one-time claim, pairing on the
// site, the rate limits, the revocation of an agent, the version gate and presence. Black box: the simulated agent speaks
// the agent endpoints over HTTP, the player acts in the browser or through the API with the session cookie.
import { PairingCodeResponse } from '@d2rmm/contracts';
import { expect } from '@playwright/test';
import type { GameState, HttpAnswer, SimulatedAgent } from '../support/agent-client.ts';
import { Given, Then, When } from '../fixtures.ts';
import { SESSION_COOKIE, submitPairingCode, type World } from '../support/world.ts';

const FIVE_MINUTES_MS = 5 * 60 * 1000;
/** A code no agent was issued in the scenarios that type a wrong one (AWS-08, AWS-09). */
const WRONG_CODE = '000000';
/** A code no agent is ever issued in this suite (AWS-08: an unknown code). */
const UNKNOWN_CODE = '999999';
/** The game is closed and the screen is unknown: the state of an agent that has nothing to show. */
const CLOSED_UNKNOWN: GameState = { running: false, screen: 'UNKNOWN' };

/** Keeps the answer as the one the generic "the API answers" steps check. */
function record(world: World, answer: HttpAnswer): void {
  world.last = { status: answer.status, body: answer.body };
}

/** The player's visitor page, which the player's UI steps act on. */
function visitorOf(world: World, name: string) {
  const visitor = world.player(name).visitor;
  if (visitor === undefined) {
    throw new Error(`"${name}" has not signed in on the site in this scenario`);
  }
  return visitor;
}

/** Types a pairing code on the site and submits it. Returns the status of the pairing answer. */
async function typeCodeOnSite(world: World, name: string, code: string): Promise<number> {
  const page = visitorOf(world, name).page;
  const answer = page.waitForResponse((response) => response.url().endsWith('/api/v1/agents/pair'));
  await page.getByLabel('Pairing code').fill(code);
  await page.getByRole('button', { name: 'Pair agent', exact: true }).click();
  return (await answer).status();
}

/** Sends one heartbeat of the agent and fails the step unless the API takes it. */
async function heartbeatAccepted(agent: SimulatedAgent, state: GameState): Promise<void> {
  const answer = await agent.heartbeat(state);
  expect(answer.status, 'the heartbeat is accepted').toBe(204);
}

// AWS-05: an agent asks for a pairing code and gets the code, its expiry and the claim secret.
When('an agent asks for a pairing code', async ({ world }) => {
  const agent = world.newAgent();
  record(world, await agent.requestPairingCode());
});

// The expiry is measured on the API's clock, which the stack estimates as its start plus every advance (AD-045).
Then('the agent receives a 6-digit code that expires 5 minutes later and a claim secret', ({ world }) => {
  expect(world.last?.status, 'the pairing code answer').toBe(201);
  const issued = PairingCodeResponse.parse(world.last?.body);
  expect(issued.code, 'six digits').toMatch(/^\d{6}$/);
  expect(issued.claimSecret.length, 'a claim secret').toBeGreaterThan(0);
  const expectedMs = world.stack.apiClockMs() + FIVE_MINUTES_MS;
  const driftMs = Date.parse(issued.expiresAt) - expectedMs;
  expect(driftMs, 'expires 5 minutes after the API issued it').toBeGreaterThanOrEqual(0);
  expect(driftMs, 'expires 5 minutes after the API issued it').toBeLessThan(120_000);
});

// AWS-06, AWS-07, AWS-08: the code the agent shows, typed on the site or claimed by the agent.
Given('an agent shows a pairing code', async ({ world }) => {
  const agent = world.newAgent();
  const answer = await agent.requestPairingCode();
  expect(answer.status, 'the pairing code').toBe(201);
  world.shownCode = agent.code;
});

Given('an agent showed a pairing code that expired unused', async ({ world }) => {
  const agent = world.newAgent();
  const answer = await agent.requestPairingCode();
  expect(answer.status, 'the pairing code').toBe(201);
  await world.stack.advanceClock(FIVE_MINUTES_MS + 1000);
});

When('the agent claims before anyone typed the code', async ({ world }) => {
  record(world, await world.lastAgent.claim());
});

When('the agent claims with its claim secret', async ({ world }) => {
  record(world, await world.lastAgent.claim());
});

// AWS-06: the agent receives its token the first time it claims after the code was typed.
Then('the agent receives its token when it claims', async ({ world }) => {
  const claimed = await world.lastAgent.claim();
  expect(claimed.status, 'the first claim after pairing').toBe(200);
  expect(world.lastAgent.token, 'the token').toMatch(/^d2rmm_a_[A-Za-z0-9_-]{43}$/);
});

Then(/^a second claim with the same secret is answered "(\d+)"$/, async ({ world }, code: string) => {
  const again = await world.lastAgent.claim();
  expect(again.status, 'a second claim').toBe(Number(code));
  record(world, again);
});

// AWS-06: the player types the code the agent shows, in the form of the site.
When(/^"(.+)" types that code on the site$/, async ({ world }, name: string) => {
  const code = world.shownCode;
  if (code === undefined) {
    throw new Error('no pairing code is shown in this scenario');
  }
  const status = await typeCodeOnSite(world, name, code);
  if (status === 200) {
    const agent = world.lastAgent;
    world.player(name).agents.push(agent);
    world.paired.push(agent);
    world.lastOwner = name;
  }
  world.last = { status, body: undefined };
});

// AWS-08: a code that cannot be used. "that code" is the one the next step types.
Given(/^there is (an unknown code|an expired code|a used code)$/, async ({ world }, kind: string) => {
  if (kind === 'an unknown code') {
    world.shownCode = UNKNOWN_CODE;
    return;
  }
  const agent = world.newAgent();
  const answer = await agent.requestPairingCode();
  expect(answer.status, 'the pairing code').toBe(201);
  if (kind === 'an expired code') {
    await world.stack.advanceClock(FIVE_MINUTES_MS + 1000);
  } else {
    // A code is used once: another player pairs it first, so the scenario's player finds it used.
    const code = agent.code ?? '';
    const other = await world.sessionOf('PlayerTwo');
    const paired = await submitPairingCode(world.site, other, code);
    expect(paired.status, 'the first use of the code').toBe(200);
  }
  world.shownCode = agent.code;
});

// AWS-09: the rate limit on pairing attempts of an account (10 in 5 minutes, AD-032).
Given(/^"(.+)" has typed 9 wrong codes in the last 5 minutes$/, async ({ world }, name: string) => {
  const session = await world.sessionOf(name);
  for (let attempt = 1; attempt <= 9; attempt += 1) {
    const submitted = await submitPairingCode(world.site, session, WRONG_CODE);
    expect(submitted.status, `wrong code ${attempt}`).toBe(400);
  }
});

// A step argument of digits can arrive as a number: the code is typed as the text the scenario wrote.
When(
  /^"(.+)" types the code "(\d+)" on the site$/,
  async ({ world }, name: string, code: string | number) => {
    const status = await typeCodeOnSite(world, name, String(code));
    world.last = { status, body: undefined };
  },
);

// AWS-09 (API): ten codes from one address in an hour; the eleventh is refused.
Given('10 pairing codes were requested from one address in the last hour', async ({ world }) => {
  for (let issued = 1; issued <= 10; issued += 1) {
    const answer = await world.newAgent().requestPairingCode();
    expect(answer.status, `pairing code ${issued} from one address`).toBe(201);
  }
});

When('an agent at that address asks for a pairing code', async ({ world }) => {
  record(world, await world.newAgent().requestPairingCode());
});

// AWS-10: a player who pairs a second agent revokes the first one.
Given(/^"(.+)" has a paired agent$/, async ({ world }, name: string) => {
  await world.pairAgent(name);
});

Given(/^"(.+)" has a paired agent that is online$/, async ({ world }, name: string) => {
  const agent = await world.pairAgent(name);
  await heartbeatAccepted(agent, CLOSED_UNKNOWN);
});

Given(
  /^"(.+)" has a paired agent that reports the game running on the automap$/,
  async ({ world }, name: string) => {
    const agent = await world.pairAgent(name);
    await heartbeatAccepted(agent, { running: true, screen: 'AUTOMAP_OPEN' });
  },
);

Given(/^"(.+)" has no paired agent$/, async ({ world }, name: string) => {
  const presence = await world.presenceOf(name);
  expect(presence.status, 'the presence answer').toBe(200);
  expect(presence.body, 'no agent is paired').toEqual({ status: 'none' });
});

Given(/^"(.+)" is signed in and has a paired agent$/, async ({ world }, name: string) => {
  await world.pairAgent(name);
});

When(/^"(.+)" pairs a second agent$/, async ({ world }, name: string) => {
  await world.pairAgent(name);
});

Then(
  /^a heartbeat from the (first|second) agent is answered "(\d+)"$/,
  async ({ world }, order: string, code: string) => {
    const index = order === 'first' ? 0 : 1;
    const agent = world.paired[index];
    if (agent === undefined) {
      throw new Error(`the ${order} agent was not paired in this scenario`);
    }
    const answer = await agent.heartbeat(CLOSED_UNKNOWN);
    expect(answer.status, `the ${order} agent's heartbeat`).toBe(Number(code));
    record(world, answer);
  },
);

// AWS-11: the agent token opens only the agent routes, and the session cookie opens only the site routes.
When('the agent calls a site endpoint with its token', async ({ world }) => {
  record(world, await world.lastAgent.send('/v1/me', { method: 'GET' }));
});

When('the site calls the heartbeat endpoint with the session cookie', async ({ world }) => {
  const owner = world.lastOwner;
  if (owner === undefined) {
    throw new Error('no agent is paired in this scenario');
  }
  const session = await world.sessionOf(owner);
  const answer = await world.lastAgent.heartbeat(CLOSED_UNKNOWN, {
    bearer: null,
    headers: { Cookie: `${SESSION_COOKIE}=${session}` },
  });
  record(world, answer);
});

// AWS-12: an outdated agent is told to upgrade, before any authentication runs (426).
Given(/^the minimum agent version is "(.+)"$/, async ({ world }, version: string) => {
  const response = await fetch(`${world.site.api}/v1/config`, { signal: AbortSignal.timeout(10_000) });
  const config = (await response.json()) as { minAgentVersion?: unknown };
  expect(config.minAgentVersion, 'the minimum agent version of the stack').toBe(version);
});

When(
  /^the agent sends a (heartbeat|pairing code request) with (version "[^"]*"|no version)$/,
  async ({ world }, request: string, sent: string) => {
    const version = /^version "(.*)"$/.exec(sent)?.[1] ?? null;
    const agent = world.lastAgent;
    if (request === 'heartbeat') {
      record(world, await agent.heartbeat(CLOSED_UNKNOWN, { version }));
    } else {
      record(world, await agent.requestPairingCode({ version }));
    }
  },
);

// AWS-13, AWS-14: the agent reports what the game shows; the site follows the presence.
When('the agent reports that the game is running on the automap', async ({ world }) => {
  record(world, await world.lastAgent.heartbeat({ running: true, screen: 'AUTOMAP_OPEN' }));
});

When('the agent reports that the game is closed on an unknown screen', async ({ world }) => {
  record(world, await world.lastAgent.heartbeat(CLOSED_UNKNOWN));
});

// AWS-16: a player without an agent is offered pairing.
When(/^"(.+)" opens the site$/, async ({ world }, name: string) => {
  await world.openSite(visitorOf(world, name));
});

Then(
  /^the site shows the field "(.+)" and the action "(.+)"$/,
  async ({ world }, field: string, action: string) => {
    const page = world.currentVisitor.page;
    await expect(page.getByLabel(field), `the field "${field}"`).toBeVisible();
    const button = page.getByRole('button', { name: action, exact: true });
    await expect(button, `the action "${action}"`).toBeVisible();
  },
);

// AWS-18: a heartbeat that breaks the contract is refused and changes nothing.
When('the agent sends a heartbeat whose body breaks the contract', async ({ world }) => {
  const owner = world.lastOwner;
  if (owner === undefined) {
    throw new Error('no agent is paired in this scenario');
  }
  const before = await world.presenceOf(owner);
  expect(before.status, 'the presence before the bad heartbeat').toBe(200);
  world.presenceSnapshot = before.body;
  record(world, await world.lastAgent.heartbeat(CLOSED_UNKNOWN, { body: { game: 'not-a-game' } }));
});

Then("the agent's presence does not change", async ({ world }) => {
  const owner = world.lastOwner;
  if (owner === undefined) {
    throw new Error('no agent is paired in this scenario');
  }
  const after = await world.presenceOf(owner);
  expect(after.status, 'the presence after the bad heartbeat').toBe(200);
  expect(after.body, 'the presence is unchanged').toEqual(world.presenceSnapshot);
});
