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
