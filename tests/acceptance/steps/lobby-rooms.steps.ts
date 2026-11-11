// Steps of lobby-rooms (LBR-01 to LBR-12): a duel group from the queue and the ready check opens a room, two agents confirm
// it from the Party panel, runs follow one another, and members who leave, drop or let the clock run out are released.
// Black box: HTTP with the session cookie, the headless agent (the real core, reading a drawn Party fixture) and the
// browser. The stack's clock moves only when a step passes time (the matcher and the sweeps tick then).
//
// Two kinds of agent serve the scenarios. A scenario tagged @agent runs the headless agent of each player, started the
// first time a step needs it (it fetches the assignment on start, which is the delivery of LBR-02). The other scenarios
// move the clock, and a headless agent heartbeats on the wall clock, not on the stack's, so those keep the simulated
// HTTP agents that the queue steps paired: they heartbeat whenever the clock moves.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RoomView } from '@d2rmm/contracts';
import { expect, type Locator, type Page } from '@playwright/test';
import { After, Given, Then, When, test } from '../fixtures.ts';
import { AGENT_VERSION } from '../support/agent-client.ts';
import { HeadlessAgent, preparePartyFixture, setPartyPanel } from '../support/headless-agent.ts';
import { submitPairingCode, type World } from '../support/world.ts';
import {
  HAMMER_OF_BOB,
  SORC_OF_ALICE,
  answerAs,
  joinAs,
  readyPlayer,
  rememberCheck,
  roomOf,
} from './queues.steps.ts';

const PLAYERS = ['Alice', 'Bob'] as const;
/** The field of a masked Party panel: nothing the agent reads as a game name. */
const MASKED = 'xxxxxxxxx';
/** The example builds on first use (minutes on a cold cache) and pairs within the code's lifetime after it. */
const START_TIMEOUT_MS = 480_000;
/** A page shows a change within this long of the observation or the action behind it (LBR-11, NFR-01). */
const SITE_LIMIT_MS = 2_000;
/** What a stage change may take beyond the sites: the API stores it from a request or a sweep. */
const API_WAIT_MS = 15_000;

/** The label the site shows for a character: its class and level, which is how a member row is told apart. */
const ROW_TEXT: Record<string, string> = { Alice: 'Sorceress, level 90', Bob: 'Warlock, level 90' };
const STAGE_BY_LABEL: Record<string, string> = {
  Formed: 'formed',
  'Awaiting host': 'awaiting_host',
  Created: 'created',
  Active: 'active',
  Expired: 'expired',
  Closed: 'closed',
};

interface HeadlessPlayer {
  readonly agent: HeadlessAgent;
  readonly png: string;
}

interface RoomsState {
  dir?: string;
  headless: Map<string, HeadlessPlayer>;
  /** The game name of run 1 and of run 2, as the API gave them. */
  runNames: Map<number, string>;
  /** How many observations the agent that just revealed the name had sent before the panel changed. */
  observedBefore: number;
}

const states = new WeakMap<World, RoomsState>();

function stateOf(world: World): RoomsState {
  let state = states.get(world);
  if (state === undefined) {
    state = { headless: new Map(), runNames: new Map(), observedBefore: 0 };
    states.set(world, state);
  }
  return state;
}

function pageOf(world: World, name: string): Page {
  const page = world.player(name).visitor?.page;
  if (page === undefined) {
    throw new Error(`${name} has no site open in this scenario`);
  }
  return page;
}

function stageLabelToStage(label: string): string {
  const stage = STAGE_BY_LABEL[label];
  if (stage === undefined) {
    throw new Error(`no stage is labelled "${label}"`);
  }
  return stage;
}

/** The room of the player as the API reads it, or a failure that says there is none. */
async function roomViewOf(world: World, name: string): Promise<RoomView> {
  const room = await roomOf(world, name);
  if (room === null) {
    throw new Error(`${name} has no room`);
  }
  return room;
}

/** Waits until the player's room is in the stage (and run, when given), as the API reads it. */
async function expectStage(world: World, name: string, stage: string, run?: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const room = await roomOf(world, name);
        return room === null ? 'no room' : `${room.stage} run ${room.run}`;
      },
      { timeout: API_WAIT_MS, message: `the room of ${name}` },
    )
    .toBe(`${stage} run ${run ?? (await roomViewOf(world, name)).run}`);
}

// --- The pages ------------------------------------------------------------------------------------------------------

/** The step of the stepper the room is in. */
function currentStep(page: Page): Locator {
  return page.getByRole('list', { name: 'Room stages', exact: true }).locator('li[aria-current="step"]');
}

function memberRows(page: Page): Locator {
  return page.getByRole('list', { name: 'Members', exact: true }).getByRole('listitem');
}

/** The row of a player in the members list, found by the class and level of the player's character. */
function memberRow(page: Page, name: string): Locator {
  return memberRows(page).filter({ hasText: ROW_TEXT[name] ?? name });
}

async function expectSiteStage(page: Page, label: string): Promise<void> {
  await expect(currentStep(page), `the room as ${label}`).toHaveText(label, { timeout: SITE_LIMIT_MS });
}

async function expectConfirmed(page: Page, names: readonly string[]): Promise<void> {
  for (const name of names) {
    await expect(memberRow(page, name), `${name} confirmed`).toContainText('Confirmed by the agent', {
      timeout: SITE_LIMIT_MS,
    });
  }
}

/** Reloads the player's page and waits for the room panel, so the page starts from the room the API holds. */
async function showRoomOn(world: World, name: string): Promise<void> {
  const page = pageOf(world, name);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Your room', exact: true }),
    `${name}'s room panel`,
  ).toBeVisible({
    timeout: 15_000,
  });
}

// --- The headless agents (@agent) -----------------------------------------------------------------------------------

/** Starts the headless agent of the player: pairs it as the player's agent and waits for its assignment. */
async function startHeadless(world: World, name: string, gameName: string): Promise<void> {
  const state = stateOf(world);
  state.dir ??= mkdtempSync(path.join(tmpdir(), 'd2rmm-rooms-'));
  const playerDir = mkdtempSync(path.join(state.dir, `${name}-`));
  const fixture = preparePartyFixture(playerDir, { gameNameField: MASKED });
  const agent = HeadlessAgent.start({
    apiBase: world.site.api,
    fixture: fixture.png,
    party: true,
    agentVersion: AGENT_VERSION,
  });
  state.headless.set(name, { agent, png: fixture.png });
  const shown = await agent.waitFor('code', START_TIMEOUT_MS);
  const paired = await submitPairingCode(world.site, await world.sessionOf(name), String(shown['code']));
  expect(paired.status, `pairing the headless agent of ${name}`).toBe(200);
  await agent.waitFor('paired');
  // The pairing revokes the simulated agent the queue steps paired: it no longer heartbeats.
  const replaced = world.player(name).agents;
  world.paired.splice(0, world.paired.length, ...world.paired.filter((agent) => !replaced.includes(agent)));
  await agent.waitFor('assignment', 45_000, (item) => item['room'] === gameName);
}

/** Starts the headless agents of both players, once. The first start is the host's fetch of the assignment (LBR-02). */
async function ensureHeadless(world: World): Promise<void> {
  test.setTimeout(START_TIMEOUT_MS);
  const state = stateOf(world);
  const gameName = (await roomViewOf(world, 'Alice')).expectedGameName;
  await HeadlessAgent.build();
  for (const name of PLAYERS) {
    if (!state.headless.has(name)) {
      await startHeadless(world, name, gameName);
    }
  }
}

function headlessOf(world: World, name: string): HeadlessPlayer {
  const found = stateOf(world).headless.get(name);
  if (found === undefined) {
    throw new Error(`${name}'s headless agent is not running in this scenario`);
  }
  return found;
}

function observedCount(world: World, name: string): number {
  return headlessOf(world, name).agent.events.filter((event) => event.event === 'observed').length;
}

/** The player's game shows the Party panel with the field: the headless agent reads it on its next capture. */
function showPanel(world: World, name: string, field: string): void {
  setPartyPanel(headlessOf(world, name).png, { gameNameField: field });
}

/** Waits until the player's agent has sent a new observation since `before`, and returns when it was accepted. */
async function waitForObservation(world: World, name: string, before: number): Promise<void> {
  await expect
    .poll(() => observedCount(world, name), { timeout: 15_000, message: `an observation of ${name}'s agent` })
    .toBeGreaterThan(before);
}

// --- Background -----------------------------------------------------------------------------------------------------

Given(
  'Alice and Bob accepted a ready check for a GM duel on Hell in the Americas, Alice first',
  async ({ world }) => {
    await readyPlayer(world, 'Alice', SORC_OF_ALICE, 'browser');
    await readyPlayer(world, 'Bob', HAMMER_OF_BOB, 'browser');
    // Alice joins first, so she is the oldest ticket and hosts (QUE-12).
    await joinAs(world, 'Alice', 'PvP', 'Sorc', 'Hell', 'Americas', { format: 'duel', rules: 'gm' });
    expect(world.last?.status, 'Alice joins').toBe(201);
    await joinAs(world, 'Bob', 'PvP', 'Hammer', 'Hell', 'Americas', { format: 'duel', rules: 'gm' });
    expect(world.last, 'Bob joins, and the group forms').toMatchObject({ status: 201 });
    const check = await rememberCheck(world, 'Alice');
    for (const name of PLAYERS) {
      await answerAs(world, name, check?.id ?? '', 'accept');
      expect(world.last?.status, `${name} accepts`).toBe(204);
    }
    await expect
      .poll(async () => (await roomOf(world, 'Bob'))?.roomId ?? null, {
        timeout: API_WAIT_MS,
        message: 'the room of the group',
      })
      .not.toBeNull();
    for (const name of PLAYERS) {
      const room = await roomViewOf(world, name);
      world.player(name).room = { roomId: room.roomId, gameName: room.expectedGameName };
    }
    world.matchOwner = 'Alice';
    stateOf(world).runNames.set(1, (await roomViewOf(world, 'Alice')).expectedGameName);
    // No agent has the assignment yet, so the room is waiting to be delivered (LBR-01, LBR-02).
    expect((await roomViewOf(world, 'Alice')).stage, 'the room as it opens').toBe('formed');
    for (const name of PLAYERS) {
      await showRoomOn(world, name);
    }
  },
);

// Capture consent is what the agent's Party step needs to read the game window. The headless agents of an @agent
// scenario start when a step first needs them, so that the host's fetch of the assignment is a step of the scenario.
Given('each has a headless agent with capture consent', async ({ world, $tags }) => {
  if ($tags.includes('@agent')) {
    test.setTimeout(START_TIMEOUT_MS);
    await HeadlessAgent.build();
  }
  expect(world.player('Alice').accountId, 'Alice has an account').toBeDefined();
  expect(world.player('Bob').accountId, 'Bob has an account').toBeDefined();
});

// --- LBR-01: the room -----------------------------------------------------------------------------------------------

When('Alice and Bob read their room', async ({ world }) => {
  for (const name of PLAYERS) {
    world.last = { status: 200, body: await roomViewOf(world, name) };
  }
});

Then('Alice and Bob are in a room with Alice as host', async ({ world }) => {
  const alice = await roomViewOf(world, 'Alice');
  const bob = await roomViewOf(world, 'Bob');
  expect(bob.roomId, 'the same room').toBe(alice.roomId);
  expect(alice.members, 'two members').toHaveLength(2);
  const host = alice.members.find((member) => member.role === 'host');
  expect(host?.accountId, 'Alice hosts').toBe(world.player('Alice').accountId);
  expect(alice.members.map((member) => member.joinOrder).sort(), 'join order').toEqual([1, 2]);
});

Then(
  /^the room's game name matches "([^"]+)" and it has no password$/,
  async ({ world }, pattern: string) => {
    const room = await roomViewOf(world, 'Alice');
    const expected = new RegExp(`^${pattern.replace('<n>', '\\d+')}$`);
    expect(room.expectedGameName, 'the game name').toMatch(expected);
    expect(room.password, 'the password').toBe('');
  },
);

// --- LBR-02: the host's agent fetches the assignment ----------------------------------------------------------------

When("Alice's agent has fetched the room assignment", async ({ world }) => {
  await ensureHeadless(world);
});

// --- Rooms in a stage (Given) ---------------------------------------------------------------------------------------

/** Sends the observation of the player's simulated agent: the room's own game name in the run. */
async function observeAs(world: World, name: string, run: number): Promise<void> {
  const room = await roomViewOf(world, name);
  await world.observe(world.currentAgentOf(name), room.roomId, {
    type: 'GAME_NAME_SEEN',
    value: room.expectedGameName,
    run,
  });
  expect(world.last?.status, `the observation of ${name}'s agent`).toBe(202);
}

/** Brings the room to `awaiting_host`: the host's agent has the assignment. */
async function toAwaitingHost(world: World, tagged: boolean): Promise<void> {
  if (tagged) {
    await ensureHeadless(world);
  } else {
    const fetched = await world.currentAgentOf('Alice').assignment();
    expect(fetched.status, "the host's fetch of the assignment").toBe(200);
  }
  await expectStage(world, 'Alice', 'awaiting_host');
}

/** Brings the room to `created` (the host's game shows the name) and then `active` (the other member's too). */
async function toStage(world: World, tagged: boolean, stage: 'created' | 'active'): Promise<void> {
  await toAwaitingHost(world, tagged);
  const room = await roomViewOf(world, 'Alice');
  if (tagged) {
    showPanel(world, 'Alice', room.expectedGameName);
  } else {
    await observeAs(world, 'Alice', room.run);
  }
  await expectStage(world, 'Alice', 'created');
  if (stage === 'active') {
    if (tagged) {
      showPanel(world, 'Bob', room.expectedGameName);
    } else {
      await observeAs(world, 'Bob', room.run);
    }
    await expectStage(world, 'Alice', 'active');
  }
}

// One step serves the Given of LBR-03 and LBR-05 and the Then of LBR-02 (keywords do not tell steps apart): the host's
// agent has the assignment, and the API says the room is waiting for the host.
Given('the room is Awaiting host', async ({ world, $tags }) => {
  await toAwaitingHost(world, $tags.includes('@agent'));
});

Given('the room is Created', async ({ world, $tags }) => {
  await toStage(world, $tags.includes('@agent'), 'created');
});

Given('the room is Active', async ({ world, $tags }) => {
  await toStage(world, $tags.includes('@agent'), 'active');
});

Given('the room is Active on run 1', async ({ world, $tags }) => {
  await toStage(world, $tags.includes('@agent'), 'active');
  expect((await roomViewOf(world, 'Alice')).run, 'the run').toBe(1);
});

// --- LBR-03, LBR-04: the Party panel confirms -----------------------------------------------------------------------

/** The panel of the player shows the room's current game name; the agent's next capture reports it. */
async function revealRoomName(world: World, name: string): Promise<number> {
  const before = observedCount(world, name);
  showPanel(world, name, (await roomViewOf(world, name)).expectedGameName);
  return before;
}

/** The observation of `before`'s agent is accepted, and then both sites show the stage within 2 seconds. */
async function sitesShow(world: World, name: string, before: number, label: string, confirmed: string[]) {
  await waitForObservation(world, name, before);
  // LBR-11: measured on the real clock, from the agent's observation request (the agent prints "observed" when the API
  // accepts it) to the page showing it.
  await Promise.all(
    PLAYERS.map(async (player) => {
      const page = pageOf(world, player);
      await expectSiteStage(page, label);
      await expectConfirmed(page, confirmed);
    }),
  );
}

When("Alice's game shows the Party panel with the room's game name revealed", async ({ world }) => {
  stateOf(world).observedBefore = await revealRoomName(world, 'Alice');
});

Then('within 2 seconds both sites show the room Created and Alice confirmed', async ({ world }) => {
  await sitesShow(world, 'Alice', stateOf(world).observedBefore, 'Created', ['Alice']);
});

When("Bob's game shows the Party panel with the room's game name revealed", async ({ world }) => {
  stateOf(world).observedBefore = await revealRoomName(world, 'Bob');
});

Then('within 2 seconds both sites show the room Active and both members confirmed', async ({ world }) => {
  await sitesShow(world, 'Bob', stateOf(world).observedBefore, 'Active', ['Alice', 'Bob']);
});

// --- LBR-05: expiry -------------------------------------------------------------------------------------------------

Then(/^the room is (Expired|Closed)$/, async ({ world }, label: string) => {
  await expectStage(world, 'Alice', stageLabelToStage(label));
});

Then(
  /^(\w+)(?: and (\w+))? can join a queue again$/,
  async ({ world }, first: string, second: string | null) => {
    const names = second === null ? [first] : [first, second];
    for (const name of names) {
      const mine = name === 'Alice' ? 'Sorc' : 'Hammer';
      await joinAs(world, name, 'PvP', mine, 'Hell', 'Americas', { format: 'duel', rules: 'gm' });
      expect(world.last?.status, `${name} joins a queue`).toBe(201);
    }
  },
);

// --- LBR-06: the next run -------------------------------------------------------------------------------------------

When('Alice opens the next run on the site', async ({ world }) => {
  await pageOf(world, 'Alice').getByRole('button', { name: 'Next run', exact: true }).click();
});

Then('both sites show run 2 with a new game name and the room Awaiting host', async ({ world }) => {
  await expect
    .poll(async () => (await roomViewOf(world, 'Alice')).run, { timeout: API_WAIT_MS, message: 'run 2' })
    .toBe(2);
  const room = await roomViewOf(world, 'Alice');
  const state = stateOf(world);
  expect(room.expectedGameName, 'a new game name').not.toBe(state.runNames.get(1));
  state.runNames.set(2, room.expectedGameName);
  for (const player of PLAYERS) {
    const page = pageOf(world, player);
    await expectSiteStage(page, 'Awaiting host');
    await expect(
      page
        .getByRole('list', { name: 'Runs', exact: true })
        .getByText(`Run 2: ${room.expectedGameName} (current)`),
      `${player} sees run 2`,
    ).toBeVisible({ timeout: SITE_LIMIT_MS });
  }
});

When("Alice's game shows the Party panel with the new run's game name revealed", async ({ world }) => {
  const second = stateOf(world).runNames.get(2);
  if (second === undefined) {
    throw new Error('run 2 was not opened in this scenario');
  }
  // The agent holds the new assignment before it reads the new name: its Party step reads for the current run.
  await headlessOf(world, 'Alice').agent.waitFor('assignment', 15_000, (item) => item['room'] === second);
  showPanel(world, 'Alice', second);
});

Then('the room is Created on run 2', async ({ world }) => {
  await expectStage(world, 'Alice', 'created', 2);
});

// --- LBR-07: the host leaves ----------------------------------------------------------------------------------------

Given('Cara joined the room third', async ({ world }) => {
  const room = await roomViewOf(world, 'Alice');
  const cara = await world.sessionOf('Cara');
  expect(cara, 'Cara signed in').not.toBe('');
  const accountId = world.player('Cara').accountId;
  expect(accountId, 'Cara has an account').toBeDefined();
  await world.stack.seedRoomMember(room.roomId, accountId ?? '');
  // Cara opens the site: it reads the room she is in.
  const visitor = await world.newVisitor();
  const previous = world.pendingSessionCookie;
  world.pendingSessionCookie = cara;
  try {
    await world.openSite(visitor);
  } finally {
    world.pendingSessionCookie = previous;
  }
  world.player('Cara').visitor = visitor;
  await expect(visitor.page.getByRole('heading', { name: 'Your room', exact: true })).toBeVisible();
  await expect(memberRows(visitor.page), 'the three members').toHaveCount(3);
});

When('Alice leaves the room on the site', async ({ world }) => {
  await pageOf(world, 'Alice').getByRole('button', { name: 'Leave room', exact: true }).click();
});

Then('Bob is the host', async ({ world }) => {
  await expect
    .poll(
      async () =>
        (await roomViewOf(world, 'Bob')).members.find((member) => member.role === 'host')?.accountId,
      { timeout: API_WAIT_MS, message: 'the host of the room' },
    )
    .toBe(world.player('Bob').accountId);
});

Then("Cara's site shows Bob as host", async ({ world }) => {
  const page = pageOf(world, 'Cara');
  await expect(memberRows(page), 'the two members left').toHaveCount(2, { timeout: SITE_LIMIT_MS });
  await expect(memberRow(page, 'Bob'), "Bob's row").toContainText('Host', { timeout: SITE_LIMIT_MS });
});

// --- LBR-08: a member who drops -------------------------------------------------------------------------------------

Then('Bob is no longer in the room', async ({ world }) => {
  await expect
    .poll(
      async () =>
        (await roomOf(world, 'Bob'))?.members.some(
          (member) => member.accountId === world.player('Bob').accountId,
        ),
      {
        timeout: API_WAIT_MS,
        message: 'Bob in his room',
      },
    )
    .not.toBe(true);
});

Then("Alice's site shows that Bob left", async ({ world }) => {
  const page = pageOf(world, 'Alice');
  await expect(memberRows(page), 'one member left').toHaveCount(1, { timeout: API_WAIT_MS });
  await expect(memberRow(page, 'Bob'), "Bob's row").toHaveCount(0);
});

// --- LBR-09: the host closes the room -------------------------------------------------------------------------------

When('Alice closes the room on the site', async ({ world }) => {
  await pageOf(world, 'Alice').getByRole('button', { name: 'Close room', exact: true }).click();
});

// --- LBR-10: a member of an open room cannot queue ------------------------------------------------------------------

When(
  'Bob joins the PvP queue with his character on Hell in the Americas for a GM duel',
  async ({ world }) => {
    await joinAs(world, 'Bob', 'PvP', 'Hammer', 'Hell', 'Americas', { format: 'duel', rules: 'gm' });
  },
);

// --- LBR-12: the panel, by keyboard ---------------------------------------------------------------------------------

Then(
  'he sees the stages Formed, Awaiting host, Created and Active, the game name with a copy button and "No password"',
  async ({ world }) => {
    const page = pageOf(world, 'Bob');
    const room = await roomViewOf(world, 'Bob');
    const stages = page.getByRole('list', { name: 'Room stages', exact: true }).getByRole('listitem');
    await expect(stages, 'the four stages').toHaveText(['Formed', 'Awaiting host', 'Created', 'Active']);
    await expect(page.getByText(room.expectedGameName, { exact: true }), 'the game name').toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Copy game name', exact: true }),
      'the copy button',
    ).toBeVisible();
    await expect(page.getByText('No password', { exact: true }), 'no password').toBeVisible();
  },
);

Then(
  'he sees that Alice creates a public game and that he opens the Party panel and clicks the eye after joining',
  async ({ world }) => {
    const page = pageOf(world, 'Bob');
    const room = await roomViewOf(world, 'Bob');
    const steps = page.getByRole('list', { name: 'What to do', exact: true });
    await expect(steps).toContainText(
      `The host creates a public game named ${room.expectedGameName} with no password.`,
    );
    await expect(steps).toContainText(
      'After joining, open the Party panel and click the eye so the agent can read the name.',
    );
    await expect(memberRow(page, 'Alice'), 'Alice is marked as the host').toContainText('Host');
  },
);

Then('using only the keyboard he can copy the game name and reach "Leave room"', async ({ world }) => {
  const visitor = world.player('Bob').visitor;
  if (visitor === undefined) {
    throw new Error('Bob has no site open in this scenario');
  }
  const page = visitor.page;
  const room = await roomViewOf(world, 'Bob');
  await visitor.context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(page.url()).origin,
  });
  const copy = page.getByRole('button', { name: 'Copy game name', exact: true });
  await tabUntilFocused(page, copy);
  await page.keyboard.press('Enter');
  await expect(page.getByText('Game name copied.', { exact: true }), 'the copy is confirmed').toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText()), 'the clipboard').toBe(
    room.expectedGameName,
  );
  await tabUntilFocused(page, page.getByRole('button', { name: 'Leave room', exact: true }));
});

/** Tab presses a keyboard walk may take before the control must hold the focus. */
const KEYBOARD_STOPS = 60;

async function tabUntilFocused(page: Page, control: Locator): Promise<void> {
  for (let press = 0; press < KEYBOARD_STOPS; press += 1) {
    if (await control.evaluate((element) => element === document.activeElement)) {
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error('the keyboard walk never reached the control');
}

// Stops the headless agents and removes their fixtures after each scenario that started them.
After(
  {
    tags: '@LBR-01 or @LBR-02 or @LBR-03 or @LBR-04 or @LBR-05 or @LBR-06 or @LBR-07 or @LBR-08 or @LBR-09 or @LBR-10 or @LBR-12',
  },
  async ({ world }) => {
    const state = states.get(world);
    if (state === undefined) {
      return;
    }
    await Promise.all([...state.headless.values()].map((player) => player.agent.stop()));
    if (state.dir !== undefined) {
      rmSync(state.dir, { recursive: true, force: true });
    }
    states.delete(world);
  },
);
