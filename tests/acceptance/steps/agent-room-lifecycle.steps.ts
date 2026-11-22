// Steps of agent-room-lifecycle (ARL-01, ARL-03, ARL-05, ARL-06): the agent drops a room that ended and shows presence
// confirmed, and the site keeps an ended room dismissed and never keeps a silent agent online. Black box: the headless
// agent (the real core, reading a drawn Party fixture) holds the rooms, the browser shows the site.
//
// A headless agent heartbeats on the wall clock, the stack's clock moves only when a step moves it. A step that passes
// stack time therefore moves it in short chunks and waits a heartbeat between them, so no agent goes offline on the way.
import { expect } from '@playwright/test';
import { After, Given, Then, When, test } from '../fixtures.ts';
import { closeWires, enableWire, wireOf } from '../support/agent-wire.ts';
import { HeadlessAgent } from '../support/headless-agent.ts';
import {
  ensureHeadless,
  expectStage,
  formRoom,
  expectSiteStage,
  headlessOf,
  memberRow,
  pageOf,
  roomViewOf,
  showPanel,
  startHeadless,
  toAwaitingHost,
  toStage,
} from './lobby-rooms.steps.ts';
import { HEARTBEAT_EVERY_MS, ONLINE, openSiteFor, roomOf } from './queues.steps.ts';
import type { World } from '../support/world.ts';

/** The stack's clock moves this far between two heartbeats of a headless agent (the API marks it offline at 45 s). */
const CHUNK_MS = 30_000;
/** The real time that lets a headless agent send a heartbeat (it sends one every 15 s). */
const HEARTBEAT_WAIT_MS = HEARTBEAT_EVERY_MS + 1_000;
const ROOM_EXPIRES_AFTER_MS = 3 * 60_000;
const SCENARIO_TIMEOUT_MS = 600_000;
const DROP_WAIT_MS = 30_000;

/** Moves the stack's clock by `ms`, keeping every agent online: the simulated ones heartbeat, the headless ones on their own. */
async function passTimeOnline(world: World, ms: number): Promise<void> {
  let left = ms;
  while (left > 0) {
    const step = Math.min(CHUNK_MS, left);
    await world.stack.advanceClock(step);
    left -= step;
    for (const agent of world.paired) {
      const answer = await agent.heartbeat(ONLINE);
      expect(answer.status, 'the heartbeat that keeps the agent online').toBe(204);
    }
    await new Promise((resolve) => setTimeout(resolve, HEARTBEAT_WAIT_MS));
  }
}

// --- ARL-01: a room that ended leaves the agent ---------------------------------------------------------------------

Given('Alice and Bob are in a room awaiting the host, with their agents online', async ({ world }) => {
  test.setTimeout(SCENARIO_TIMEOUT_MS);
  await formRoom(world);
  await ensureHeadless(world);
  await expectStage(world, 'Alice', 'awaiting_host');
});

Given('Alice and Bob are in an active room, with their agents online', async ({ world }) => {
  test.setTimeout(SCENARIO_TIMEOUT_MS);
  await formRoom(world);
  await toStage(world, true, 'active');
});

When('the host does not create the game in time and the room expires', async ({ world }) => {
  test.setTimeout(SCENARIO_TIMEOUT_MS);
  await passTimeOnline(world, ROOM_EXPIRES_AFTER_MS + CHUNK_MS);
  await expectStage(world, 'Alice', 'expired');
});

When('the host closes the room on the site', async ({ world }) => {
  await pageOf(world, 'Alice').getByRole('button', { name: 'Close room', exact: true }).click();
  await expectStage(world, 'Alice', 'closed');
});

Then("Bob's agent no longer holds a room", async ({ world }) => {
  const dropped = await headlessOf(world, 'Bob').agent.waitFor('room-dropped', DROP_WAIT_MS);
  expect(dropped.event, "Bob's agent dropped the room").toBe('room-dropped');
});

// --- ARL-03: presence confirmed -------------------------------------------------------------------------------------

Given('Alice is the host of a room awaiting the host, with her agent online', async ({ world }) => {
  test.setTimeout(SCENARIO_TIMEOUT_MS);
  await formRoom(world);
  await HeadlessAgent.build();
  await startHeadless(world, 'Alice', (await roomViewOf(world, 'Alice')).expectedGameName);
  await expectStage(world, 'Alice', 'awaiting_host');
});

When("Alice's agent sees the game name of the current run", async ({ world }) => {
  showPanel(world, 'Alice', (await roomViewOf(world, 'Alice')).expectedGameName);
});

Then("Alice's agent shows the room as presence confirmed", async ({ world }) => {
  const confirmed = await headlessOf(world, 'Alice').agent.waitFor('presence-confirmed', DROP_WAIT_MS);
  expect(confirmed.event, "Alice's window says presence confirmed").toBe('presence-confirmed');
});

// --- ARL-05: a dismissed ended room stays dismissed -----------------------------------------------------------------

Given("Alice's room expired and the site shows it as ended", async ({ world }) => {
  test.setTimeout(SCENARIO_TIMEOUT_MS);
  await formRoom(world);
  await toAwaitingHost(world, false);
  // The simulated agents keep heartbeating while the clock moves: they use the stack's clock.
  let left = ROOM_EXPIRES_AFTER_MS + HEARTBEAT_EVERY_MS;
  while (left > 0) {
    const step = Math.min(HEARTBEAT_EVERY_MS, left);
    await world.stack.advanceClock(step);
    left -= step;
    for (const agent of world.paired) {
      expect((await agent.heartbeat(ONLINE)).status, 'the heartbeat that keeps the agent online').toBe(204);
    }
  }
  await expectStage(world, 'Alice', 'expired');
  const page = pageOf(world, 'Alice');
  await page.reload();
  await expect(
    page.getByText(/The room expired because the game was not created in time/),
    'the ended room on the site',
  ).toBeVisible({ timeout: 15_000 });
});

When('Alice dismisses the room and reloads the site', async ({ world }) => {
  const page = pageOf(world, 'Alice');
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.reload();
  await expect(page.getByText('Signed in as Alice', { exact: true })).toBeVisible({ timeout: 15_000 });
});

Then('the site does not show the ended room', async ({ world }) => {
  const page = pageOf(world, 'Alice');
  // The API still holds the ended room: the site hides it because Alice put it away, not because it is gone.
  expect((await roomOf(world, 'Alice'))?.stage, 'the room the API still reads').toBe('expired');
  await expect(page.getByRole('heading', { name: 'Your room', exact: true })).toHaveCount(0);
  await expect(page.getByText(/The room expired because the game was not created in time/)).toHaveCount(0);
});

// --- ARL-06: presence after a reconnect -----------------------------------------------------------------------------

Given('Alice has the site open and her agent online', async ({ world }) => {
  const agent = await world.pairAgent('Alice');
  expect((await agent.heartbeat(ONLINE)).status, 'the first heartbeat is accepted').toBe(204);
  await openSiteFor(world, 'Alice');
  await expect(world.currentVisitor.page.getByText('Agent online', { exact: true })).toBeVisible({
    timeout: 10_000,
  });
});

When("the site's stream reconnects and the agent stops sending heartbeats", async ({ world }) => {
  const context = world.currentVisitor.page.context();
  // The stream is down while the API marks the agent offline: that event is never replayed, so only the read on the
  // reconnect can tell the site.
  await context.setOffline(true);
  await world.stack.advanceClock(60_000);
  await context.setOffline(false);
});

Then('the site shows the agent offline within 60 seconds', async ({ world }) => {
  await expect(
    world.currentVisitor.page.getByText('Agent offline', { exact: true }),
    'the presence after the reconnect',
  ).toBeVisible({ timeout: 60_000 });
});

// --- ARL-08 to ARL-11: the host in another game --------------------------------------------------------------------
// The headless agent reads the Party panel the scenario draws. The scenario texts name the room "mmbaalh-28", but the API
// numbers the rooms of a stack, so a name in the text stands for the room's own: "mmbaalh-28" is the held name and
// "mmbaa1h-28" is that name with the l read as a 1 (one edit, a misread). Any other text ("duels") is used as written.

/** How long the agent has to take its looks and the API and the site to show the change. */
const ELSEWHERE_WAIT_MS = 45_000;
/** Enough looks (one a second) to have taken the two the scenario draws. */
const LOOKS_MS = 6_000;

/** The watch on Alice's requests for the name a scenario draws. */
const watches = new WeakMap<World, { carried(): boolean }>();

function panelTextFor(held: string, text: string): string {
  if (text === 'mmbaalh-28') return held;
  if (text === 'mmbaa1h-28') return held.replace(/^(mm[a-z]*?)l/, '$11');
  return text;
}

After({ tags: '@ARL-08' }, async ({ world }) => {
  await closeWires(world);
});

async function hostWithConfirmedPresence(world: World): Promise<void> {
  test.setTimeout(SCENARIO_TIMEOUT_MS);
  enableWire(world);
  await formRoom(world);
  await toStage(world, true, 'created');
  const confirmed = await headlessOf(world, 'Alice').agent.waitFor('presence-confirmed', DROP_WAIT_MS);
  expect(confirmed.event, "Alice's window says presence confirmed").toBe('presence-confirmed');
}

function lineOf(world: World, name: string): string | undefined {
  return headlessOf(world, name)
    .agent.events.filter((event) => event.event === 'room-line')
    .at(-1)?.['line'] as string | undefined;
}

Given(
  'Alice hosts a room {string} with Bob, and her headless agent confirmed her presence',
  async ({ world }) => {
    await hostWithConfirmedPresence(world);
  },
);

Given("Alice's headless agent shows her in another game for her room {string}", async ({ world }) => {
  await hostWithConfirmedPresence(world);
  showPanel(world, 'Alice', 'duels');
  await headlessOf(world, 'Alice').agent.waitFor(
    'room-line',
    ELSEWHERE_WAIT_MS,
    (event) => event['line'] === 'elsewhere',
  );
});

When(
  "Alice's agent reads the game name {string} in the Party panel on two looks in a row",
  async ({ world }, text: string) => {
    // Watching starts before the name is on screen: no later request may carry it.
    watches.set(world, wireOf(world, 'Alice').watch(text));
    showPanel(world, 'Alice', panelTextFor((await roomViewOf(world, 'Alice')).expectedGameName, text));
    if (text === 'duels') {
      // The agent looks about once a second: its second look is the one that posts.
      await headlessOf(world, 'Alice').agent.waitFor('elsewhere-observed', ELSEWHERE_WAIT_MS);
    } else {
      await new Promise((resolve) => setTimeout(resolve, LOOKS_MS));
    }
  },
);

When("Alice's agent reads the game name {string} in the Party panel", async ({ world }, text: string) => {
  showPanel(world, 'Alice', panelTextFor((await roomViewOf(world, 'Alice')).expectedGameName, text));
});

Then("Alice's agent window says she is in another game", async ({ world }) => {
  const away = await headlessOf(world, 'Alice').agent.waitFor(
    'room-line',
    ELSEWHERE_WAIT_MS,
    (event) => event['line'] === 'elsewhere',
  );
  expect(away['line'], "Alice's window line").toBe('elsewhere');
});

Then("Alice's agent window still says presence confirmed", ({ world }) => {
  const agent = headlessOf(world, 'Alice').agent;
  expect(lineOf(world, 'Alice'), "Alice's window line after the looks").toBe('confirmed');
  expect(
    agent.events.some((event) => event.event === 'elsewhere-observed'),
    'an OTHER_GAME_SEEN was posted for a misread of the room name',
  ).toBe(false);
});

Then("Bob's site shows Alice {string}", async ({ world }, text: string) => {
  await expect(memberRow(pageOf(world, 'Bob'), 'Alice'), `Alice's presence on Bob's site`).toContainText(
    text,
    { timeout: ELSEWHERE_WAIT_MS },
  );
});

Then('the room is still {string}', async ({ world }, label: string) => {
  await expectSiteStage(pageOf(world, 'Bob'), label);
  await expectStage(world, 'Alice', 'created');
});

Then('no observation carried the name {string}', ({ world }, text: string) => {
  expect(watches.get(world)?.carried(), `an observation of Alice's agent carried "${text}"`).toBe(false);
});
