// Steps of upkeep (UPK-02, UPK-03): the agent-status and ready-check routes limit one account to 60 requests a minute. Black
// box: plain HTTP with the player's session or the simulated agent's token, as the site and the agent send them.
import { expect } from '@playwright/test';
import { Given, Then, When } from '../fixtures.ts';
import type { QueueCharacter } from './queues.steps.ts';
import type { HttpAnswer } from '../support/agent-client.ts';
import type { World } from '../support/world.ts';
import {
  HAMMER_OF_BOB,
  SORC_OF_ALICE,
  answerAs,
  joinAs,
  readyPlayer,
  rememberCheck,
  sessionHeader,
} from './queues.steps.ts';

/** Requests one account may make to a route group in a minute (UPK-02, UPK-03). */
const LIMIT = 60;
const MINUTE_MS = 60_000;

interface Reads {
  /** The answers of the last run of reads, in order. */
  answers: HttpAnswer[];
}

const readsOf = new WeakMap<World, Reads>();

function reads(world: World): Reads {
  let state = readsOf.get(world);
  if (state === undefined) {
    state = { answers: [] };
    readsOf.set(world, state);
  }
  return state;
}

/** One read of a route as the player's site sends it: the session cookie, no body. */
async function siteRead(world: World, name: string, path: string): Promise<HttpAnswer> {
  const response = await fetch(`${world.site.api}${path}`, {
    headers: await sessionHeader(world, name),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text === '' ? undefined : (JSON.parse(text) as unknown),
    headers: response.headers,
  };
}

async function readTimes(world: World, name: string, path: string, times: number): Promise<void> {
  const answers: HttpAnswer[] = [];
  for (let i = 0; i < times; i += 1) {
    answers.push(await siteRead(world, name, path));
  }
  reads(world).answers = answers;
}

/** The last answer is a 429 `rate-limited` with whole seconds to wait, and every read before it was answered. */
function expectLimitedAfter(world: World, allowed: number): void {
  const { answers } = reads(world);
  expect(
    answers.slice(0, allowed).map((a) => a.status < 400),
    'the reads inside the limit',
  ).not.toContain(false);
  const refused = answers.at(allowed);
  expect(refused?.status, 'the read over the limit').toBe(429);
  expect(refused?.body).toEqual({ error: 'rate-limited' });
  const wait = Number(refused?.headers.get('retry-after'));
  expect(Number.isInteger(wait) && wait >= 1 && wait <= 60, `Retry-After ${wait} is whole seconds`).toBe(
    true,
  );
}

// --- UPK-02: the agent status ---------------------------------------------------------------------------------------

Given('Alice has a paired agent', async ({ world }) => {
  await world.pairAgent('Alice');
});

When("Alice's client reads her agent status 61 times within a minute", async ({ world }) => {
  await readTimes(world, 'Alice', '/v1/agents/me', LIMIT + 1);
});

Then('the 61st read is refused as rate-limited with the seconds to wait', ({ world }) => {
  expectLimitedAfter(world, LIMIT);
});

Then("Bob's read of his own agent status is still answered", async ({ world }) => {
  const answer = await siteRead(world, 'Bob', '/v1/agents/me');
  expect(answer.status, "Bob's read").toBe(200);
});

Given("Alice's client was refused as rate-limited reading her agent status", async ({ world }) => {
  await readTimes(world, 'Alice', '/v1/agents/me', LIMIT + 1);
  expectLimitedAfter(world, LIMIT);
});

When('a minute passes', async ({ world }) => {
  await world.stack.advanceClock(MINUTE_MS);
});

Then("Alice's client reads her agent status again", async ({ world }) => {
  const answer = await siteRead(world, 'Alice', '/v1/agents/me');
  expect(answer.status, "Alice's read after the minute").toBe(200);
});

// --- UPK-03: the ready check ----------------------------------------------------------------------------------------

Given('Alice and Bob have an open ready check', async ({ world }) => {
  await readyPlayer(world, 'Alice', SORC_OF_ALICE, 'stream');
  await readyPlayer(world, 'Bob', HAMMER_OF_BOB, 'stream');
  await joinAs(world, 'Alice', 'PvP', 'Sorc', 'Hell', 'Americas', { format: 'duel', rules: 'gm' });
  expect(world.last?.status, 'Alice joins').toBe(201);
  await joinAs(world, 'Bob', 'PvP', 'Hammer', 'Hell', 'Americas', { format: 'duel', rules: 'gm' });
  expect(world.last?.status, 'Bob joins, and the group forms').toBe(201);
  // Bob reads the check, not Alice: every read of Alice's counts in the window the scenarios fill.
  await rememberCheck(world, 'Bob');
});

When("Alice's client asks for her open ready check 61 times within a minute", async ({ world }) => {
  await readTimes(world, 'Alice', '/v1/ready-checks/me', LIMIT + 1);
});

Then('the 61st request is refused as rate-limited with the seconds to wait', ({ world }) => {
  expectLimitedAfter(world, LIMIT);
});

Then('Bob can still accept the ready check', async ({ world }) => {
  const { checkId } = await bobsCheck(world);
  await answerAs(world, 'Bob', checkId, 'accept');
  expect(world.last?.status, 'Bob accepts').toBe(204);
});

/** The check Bob is in, read through his own session. */
async function bobsCheck(world: World): Promise<{ checkId: string }> {
  const answer = await siteRead(world, 'Bob', '/v1/ready-checks/me');
  expect(answer.status, "Bob's open ready check").toBe(200);
  return { checkId: String((answer.body as { id: unknown }).id) };
}

Given("Alice's agent has asked for the open ready check 60 times within a minute", async ({ world }) => {
  const agent = world.player('Alice').agents.at(-1);
  if (agent === undefined) {
    throw new Error('Alice has no paired agent: the step that opens the ready check pairs one');
  }
  for (let i = 0; i < LIMIT; i += 1) {
    const answer = await agent.send('/v1/ready-checks/me', { method: 'GET' });
    expect(answer.status, `the agent's read ${i + 1}`).toBe(200);
  }
});

When("Alice's site asks for her open ready check", async ({ world }) => {
  reads(world).answers = [await siteRead(world, 'Alice', '/v1/ready-checks/me')];
});

Then('the request is refused as rate-limited with the seconds to wait', ({ world }) => {
  expectLimitedAfter(world, 0);
});

// --- UPK-07: the locked label sits below the difficulty name --------------------------------------------------------

/** Cara's Zon is level 45 and has played Normal and Nightmare only, so Hell is locked on her. */
const ZON_WITHOUT_HELL: QueueCharacter = {
  ...SORC_OF_ALICE,
  name: 'Zon',
  class: 'amazon',
  level: 45,
  unlockedDifficulties: ['normal', 'nightmare'],
};

Given('Cara has a Zon character that has not unlocked Hell', async ({ world }) => {
  await readyPlayer(world, 'Cara', ZON_WITHOUT_HELL, 'browser');
});

When('Cara opens the queue panel and chooses PvP and "Zon"', async ({ world }) => {
  const page = world.currentVisitor.page;
  await page.getByRole('button', { name: 'PvP', exact: true }).click();
  await page.getByRole('combobox', { name: 'Character' }).selectOption({ label: 'Zon, Amazon, level 45' });
});

Then(
  '"Locked on this character" is drawn below the name "Hell" and does not overlap it',
  async ({ world }) => {
    const card = world.currentVisitor.page
      .getByRole('radio', { name: /Hell/u })
      .locator('xpath=ancestor::label');
    const name = await card.getByText('Hell', { exact: true }).boundingBox();
    const lock = await card.getByText('Locked on this character', { exact: true }).boundingBox();
    expect(name, 'the difficulty name is drawn').not.toBeNull();
    expect(lock, 'the locked label is drawn').not.toBeNull();
    if (name === null || lock === null) {
      return;
    }
    expect(lock.y, "the label starts at or below the name's bottom edge").toBeGreaterThanOrEqual(
      name.y + name.height - 1,
    );
  },
);
