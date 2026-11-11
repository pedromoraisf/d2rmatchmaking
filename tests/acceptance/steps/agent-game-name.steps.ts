// The agent reads the game name in the Party panel (agent-game-name, AGN-01 to AGN-04). The agent is the headless example:
// the real agent core, its screen loop and its Party step, reading a Party fixture whose panel text these steps write. The
// steps are black box: the API over HTTP, and the example's stdout, which prints what the agent shows the player.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect } from '@playwright/test';
import { After, Given, Then, When, test } from '../fixtures.ts';
import { AGENT_VERSION } from '../support/agent-client.ts';
import { HeadlessAgent, preparePartyFixture, setPartyPanel } from '../support/headless-agent.ts';
import { submitPairingCode, type World } from '../support/world.ts';

/** The example builds on first use, which takes minutes on a cold cache, and pairs within the code's lifetime after it. */
const START_TIMEOUT_MS = 180_000;
/** The field of a masked Party panel (AGN-04). */
const MASKED = 'xxxxxxxxx';

/** What the headless agent of one scenario is: the example, its fixture directory and the frame it started with. */
export interface PartyState {
  agent?: HeadlessAgent;
  dir?: string;
  png?: string;
  /** The player whose agent the example is (its display name in the scenario). */
  player?: string;
}

const states = new WeakMap<World, PartyState>();

/** The headless agent state of a scenario. The character screen steps (characters-reading) share it. */
export function stateOf(world: World): PartyState {
  let state = states.get(world);
  if (state === undefined) {
    state = {};
    states.set(world, state);
  }
  return state;
}

function hostOf(world: World): string {
  if (world.matchOwner === undefined) {
    throw new Error('no test match was started in this scenario');
  }
  return world.matchOwner;
}

function roomOfHost(world: World): { roomId: string; gameName: string } {
  const room = world.player(hostOf(world)).room;
  if (room === undefined) {
    throw new Error('the host has no room in this scenario');
  }
  return room;
}

function requireAgent(world: World): HeadlessAgent {
  const agent = stateOf(world).agent;
  if (agent === undefined) {
    throw new Error(
      'the agent\'s Party step is not running: "Alice\'s agent has capture consent" was not given',
    );
  }
  return agent;
}

/** Shows the Party panel with `field` in its Game Name field: the agent reads it on its next capture. */
function showPanel(world: World, field: string): void {
  const png = stateOf(world).png;
  if (png === undefined) {
    throw new Error('the Party fixture is not prepared in this scenario');
  }
  setPartyPanel(png, { gameNameField: field });
}

// Scenario set: the agent gives the host's agent capture consent and pairs the example as that agent (AGN-01).
// The headless agent with the player's capture consent, paired as the player's agent (CHR-01, AGN-01). Its first frame is the
// Party fixture; the character screens are shown over it by the characters-reading steps.
Given(/^(.+)'s agent has capture consent$/, async ({ world }, name: string) => {
  test.setTimeout(START_TIMEOUT_MS);
  const room = world.player(name).room;
  const session = await world.sessionOf(name);
  const state = stateOf(world);
  state.player = name;
  state.dir = mkdtempSync(path.join(tmpdir(), 'd2rmm-party-'));
  const fixture = preparePartyFixture(state.dir, { gameNameField: MASKED });
  state.png = fixture.png;
  await HeadlessAgent.build();
  // The plain stack's minimum agent version is above the example's crate version, so the example declares the simulated
  // agent's version: the API answers 426 to anything below its minimum.
  state.agent = HeadlessAgent.start({
    apiBase: world.site.api,
    fixture: fixture.png,
    party: true,
    consent: true,
    agentVersion: AGENT_VERSION,
  });
  const shown = await state.agent.waitFor('code', START_TIMEOUT_MS);
  const paired = await submitPairingCode(world.site, session, String(shown['code']));
  expect(paired.status, 'pairing the headless agent').toBe(200);
  await state.agent.waitFor('paired');
  if (room !== undefined) {
    await state.agent.waitFor('assignment', 45_000, (item) => item['room'] === room.gameName);
  }
});

// AGN-01, AGN-03: the panel shows the room's name; the room becomes Created.
When("the game shows the Party panel with the room's game name revealed", ({ world }) => {
  showPanel(world, roomOfHost(world).gameName);
});

Then('the room becomes Created within 2 seconds', async ({ world }) => {
  const host = hostOf(world);
  await expect
    .poll(() => world.stageOf(host), { timeout: 2_000, message: 'the room stage of the host' })
    .toBe('created');
});

// AGN-03: another name is not reported; the room stays where it is.
When(/^the game shows the Party panel with the game name "(.+)" revealed$/, ({ world }, field: string) => {
  showPanel(world, field);
});

Then('the room is still Awaiting host', async ({ world }) => {
  // The agent reads once a second: two seconds are two reads.
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  expect(await world.stageOf(hostOf(world)), 'the room stage of the host').toBe('awaiting_host');
});

// AGN-04: the masked name is not reported, and the agent tells the player what to do.
When('the game shows the Party panel with the game name masked', ({ world }) => {
  showPanel(world, MASKED);
});

Then(/^the agent tells the player "(.+)"$/, async ({ world }, text: string) => {
  await requireAgent(world).waitFor('reveal', 10_000, (item) => item['text'] === text);
});

// Closes the example and removes its fixture directory after each agent-game-name scenario.
After({ tags: '@AGN-03 or @AGN-04' }, async ({ world }) => {
  const state = states.get(world);
  await state?.agent?.stop();
  if (state?.dir !== undefined) {
    rmSync(state.dir, { recursive: true, force: true });
  }
  states.delete(world);
});
