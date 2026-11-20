// Steps of agent-room-lifecycle (ARL-01, ARL-03, ARL-05, ARL-06): the agent drops a room that ended and shows presence
// confirmed, and the site keeps an ended room dismissed and never keeps a silent agent online. Black box: the headless
// agent (the real core, reading a drawn Party fixture) holds the rooms, the browser shows the site.
//
// A headless agent heartbeats on the wall clock, the stack's clock moves only when a step moves it. A step that passes
// stack time therefore moves it in short chunks and waits a heartbeat between them, so no agent goes offline on the way.
import { expect } from '@playwright/test';
import { Given, Then, When, test } from '../fixtures.ts';
import { HeadlessAgent } from '../support/headless-agent.ts';
import {
  ensureHeadless,
  expectStage,
  formRoom,
  headlessOf,
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
