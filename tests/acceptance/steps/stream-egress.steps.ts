// Steps of stream-egress (SEG-01, SEG-04, SEG-05): the streams carry what each side reads, and the site learns that an agent
// went quiet from the server. Black box: simulated agents and the raw streams of the API; the browser for the site's reads.
import { expect } from '@playwright/test';
import { Given, Then, When, test } from '../fixtures.ts';
import type { StreamEvent } from '../support/sse.ts';
import type { World } from '../support/world.ts';
import { expectStage, formRoom } from './lobby-rooms.steps.ts';
import { ONLINE } from './queues.steps.ts';

/** A room waits 3 minutes for its host before it expires (LBR-05). */
const ROOM_EXPIRES_AFTER_MS = 3 * 60_000;
/** The stack's clock moves in chunks shorter than the API's offline limit, so the agent stays online on the way. */
const CHUNK_MS = 30_000;
const SCENARIO_TIMEOUT_MS = 300_000;
const STREAM_WAIT_MS = 15_000;

/** The stage change the host's agent and the host's site each received, kept for the steps that read them. */
interface Received {
  agent?: StreamEvent;
  site?: StreamEvent;
}
const received = new WeakMap<World, Received>();
const receivedOf = (world: World): Received => {
  const found = received.get(world) ?? {};
  received.set(world, found);
  return found;
};

const isExpired = (event: StreamEvent): boolean =>
  event.type === 'room.stage_changed' && (event.data as { stage?: string }).stage === 'expired';

// --- SEG-01: the agent's copy of a stage change carries no member list -----------------------------------------------

Given('a room of two players whose host has an agent online', async ({ world }) => {
  test.setTimeout(SCENARIO_TIMEOUT_MS);
  await formRoom(world);
  const agent = await world.pairAgent('Alice');
  expect((await agent.heartbeat(ONLINE)).status, "the host's agent is online").toBe(204);
  // Both streams are open before the room ends, so each holds what it is sent.
  await world.agentStreamOf(agent);
  await world.siteStreamOf('Alice');
});

When('the room expires', async ({ world }) => {
  test.setTimeout(SCENARIO_TIMEOUT_MS);
  const agent = world.currentAgentOf('Alice');
  for (let passed = 0; passed < ROOM_EXPIRES_AFTER_MS + CHUNK_MS; passed += CHUNK_MS) {
    await world.stack.advanceClock(CHUNK_MS);
    expect((await agent.heartbeat(ONLINE)).status, 'the heartbeat that keeps the agent online').toBe(204);
  }
  await expectStage(world, 'Alice', 'expired');
});

Then("the host's agent is told the room and that it expired", async ({ world }) => {
  const stream = await world.agentStreamOf(world.currentAgentOf('Alice'));
  const event = await stream.waitFor(isExpired, STREAM_WAIT_MS);
  receivedOf(world).agent = event;
  const data = event.data as { roomId?: string };
  expect(data.roomId, "the room of the host's assignment").toBe(world.player('Alice').room?.roomId);
});

Then('that message carries no member list', ({ world }) => {
  const event = receivedOf(world).agent;
  expect(event, "the agent's stage change").toBeDefined();
  expect(
    Object.keys(event?.data as object).sort(),
    "only the room and the stage are in the agent's copy",
  ).toEqual(['roomId', 'stage']);
});

Then("the host's site still gets the room's new stage with its members", async ({ world }) => {
  const stream = await world.siteStreamOf('Alice');
  const event = await stream.waitFor(isExpired, STREAM_WAIT_MS);
  const data = event.data as { stage?: string; members?: unknown[] };
  expect(data.stage).toBe('expired');
  expect(Array.isArray(data.members) ? data.members.length : 0, "the site's copy lists both players").toBe(2);
});

// --- SEG-04: the site is told once that an agent went quiet ----------------------------------------------------------

/** The offline presence events a stream received. */
const offlineEvents = (events: readonly StreamEvent[]): StreamEvent[] =>
  events.filter(
    (event) =>
      event.type === 'agent.presence_changed' && (event.data as { online?: boolean }).online === false,
  );

Given('a player whose agent is online and whose site is watching', async ({ world }) => {
  const agent = await world.pairAgent('Alice');
  expect((await agent.heartbeat(ONLINE)).status, "Alice's agent is online").toBe(204);
  await world.siteStreamOf('Alice');
  await world.agentStreamOf(agent);
});

When('the agent sends no heartbeat for 60 seconds', async ({ world }) => {
  await world.stack.advanceClock(60_000);
});

Then('the site is told once that the agent is offline', async ({ world }) => {
  const stream = await world.siteStreamOf('Alice');
  await stream.waitFor((event) => offlineEvents([event]).length === 1, STREAM_WAIT_MS);
  // The sweep runs every second of the stack's clock: give it more time than one tick to tell again, if it would.
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  expect(offlineEvents(stream.events), 'the offline change, told once').toHaveLength(1);
});

Then('the agent is not told anything', async ({ world }) => {
  const stream = await world.agentStreamOf(world.currentAgentOf('Alice'));
  expect(
    stream.events.map((event) => event.type),
    "nothing reaches the agent's own stream",
  ).toEqual([]);
});

// --- SEG-05: the site reads an online agent a few times an hour, and never while the page is hidden -------------------

/** The reads of the agent's presence the page has made, and how many it had made when the player's site finished loading. */
const presenceReadsAtLoad = new WeakMap<World, number>();
const presenceReads = (world: World): number =>
  world.currentVisitor.requests.filter((request) => request.url.includes('/agents/me')).length;
const TEN_MINUTES = '10:00';
const SETTLE_MS = 1_000;

/**
 * Waits until the page's own load is over as far as the agent's presence goes: the site's stream has been requested, the read
 * that every stream open makes (`onOpen` re-reads the site, shared/stream.ts) has been asked after it, and no further read
 * came in the next poll. The page reads the agent while it boots and again when the stream opens, and the stream may open
 * after "Agent online" shows, so a count taken at that moment would put the open's read inside the ten minutes (SEG-05's
 * budget is for the safety-net rereads only). The order of the requests is what tells the open's read from the boot's:
 * a response log would do worse, since the page may drop a read's answer when it supersedes it.
 */
async function waitForStreamOpenRead(world: World): Promise<void> {
  const visitor = world.currentVisitor;
  let lastSeen = -1;
  await expect
    .poll(
      () => {
        const urls = visitor.requests.map((request) => request.url);
        const streamAt = urls.findIndex((url) => url.includes('/api/v1/stream'));
        const readAfterOpen =
          streamAt >= 0 && urls.slice(streamAt + 1).some((url) => url.includes('/agents/me'));
        const asked = presenceReads(world);
        const quiet = readAfterOpen && asked === lastSeen;
        lastSeen = readAfterOpen ? asked : -1;
        return quiet;
      },
      { message: "the stream's open and its read of the agent", timeout: 10_000, intervals: [250] },
    )
    .toBe(true);
}

Given('a signed-in player whose site shows the agent online', async ({ world }) => {
  const agent = await world.pairAgent('Alice');
  expect((await agent.heartbeat(ONLINE)).status, "Alice's agent is online").toBe(204);
  const session = await world.sessionOf('Alice');
  const visitor = await world.newVisitor();
  // The browser's clock is the page's own: ten minutes pass in a moment, and nothing of the API moves.
  await visitor.page.clock.install();
  const previous = world.pendingSessionCookie;
  world.pendingSessionCookie = session;
  try {
    await world.openSite(visitor);
  } finally {
    world.pendingSessionCookie = previous;
  }
  world.player('Alice').visitor = visitor;
  await expect(visitor.page.getByText('Agent online', { exact: true })).toBeVisible({ timeout: 10_000 });
  await waitForStreamOpenRead(world);
  presenceReadsAtLoad.set(world, presenceReads(world));
});

When('ten minutes pass with the page in view', async ({ world }) => {
  await world.currentVisitor.page.clock.runFor(TEN_MINUTES);
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
});

When('ten minutes pass with the page hidden', async ({ world }) => {
  const page = world.currentVisitor.page;
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(TEN_MINUTES);
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
});

Then('the site has asked about the agent at most two times', ({ world }) => {
  const asked = presenceReads(world) - (presenceReadsAtLoad.get(world) ?? 0);
  expect(asked, 'reads of the agent in ten minutes').toBeLessThanOrEqual(2);
});

Then('the site has not asked about the agent', ({ world }) => {
  const asked = presenceReads(world) - (presenceReadsAtLoad.get(world) ?? 0);
  expect(asked, 'reads of the agent while the page is hidden').toBe(0);
});
