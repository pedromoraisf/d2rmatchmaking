// Steps of J2 (JRN-02, JRN-03): a leveling group of eight with a teleporter and a BO, from the queue to run 2. All eight
// have a headless agent; the host (the teleporter) and the BO hold their site in a browser, the six killers as a stream
// client (the site's presence rule only needs an open site stream). Each stage must show on the pages within 2 seconds of
// the agent's observation, on the real clock (NFR-01).
import { expect, type Page } from '@playwright/test';
import { After, Given, Then, When, test } from '../fixtures.ts';
import { HeadlessAgent, setPartyPanel } from '../support/headless-agent.ts';
import { HEADLESS_START_TIMEOUT_MS } from '../support/scenario-state.ts';
import type { World } from '../support/world.ts';
import {
  API_WAIT_MS,
  SITE_LIMIT_MS,
  currentStep,
  headlessOf,
  pageOf,
  pairHeadless,
} from './journeys.steps.ts';
import {
  SORC_OF_ALICE,
  answerAs,
  joinAs,
  readyCheckOf,
  rememberCheck,
  roomOf,
  type QueueCharacter,
} from './queues.steps.ts';

/** The eight players, in join order: the teleporter, the BO, then six killers. */
const TELEPORTER = 'Tele';
const BO = 'Bo';
const PLAYERS: readonly { readonly name: string; readonly role: 'teleporter' | 'bo' | 'killer' }[] = [
  { name: TELEPORTER, role: 'teleporter' },
  { name: BO, role: 'bo' },
  ...['KillA', 'KillB', 'KillC', 'KillD', 'KillE', 'KillF'].map((name) => ({
    name,
    role: 'killer' as const,
  })),
];

interface J2State {
  oldName?: string;
  nextName?: string;
  /** When the last thing the pages must show was caused, on the real clock. */
  since?: number;
}

const states = new WeakMap<World, J2State>();

function stateOf(world: World): J2State {
  let state = states.get(world);
  if (state === undefined) {
    state = {};
    states.set(world, state);
  }
  return state;
}

/** Opens the site of a player in the browser, signed in with the player's session. */
async function openBrowserFor(world: World, name: string): Promise<void> {
  const session = await world.sessionOf(name);
  const visitor = await world.newVisitor();
  world.pendingSessionCookie = session;
  try {
    await world.openSite(visitor);
  } finally {
    world.pendingSessionCookie = undefined;
  }
  world.player(name).visitor = visitor;
}

Given(
  /^eight players are signed in with paired headless agents, one a teleporter and one a BO, all level (\d+) or more$/,
  async ({ world }, level: string) => {
    test.setTimeout(HEADLESS_START_TIMEOUT_MS);
    await HeadlessAgent.build();
    const character: QueueCharacter = { ...SORC_OF_ALICE, name: 'Sorc', level: Number(level) };
    for (const { name } of PLAYERS) {
      await world.sessionOf(name);
      await pairHeadless(world, name, character);
      if (name === TELEPORTER || name === BO) {
        await openBrowserFor(world, name);
      } else {
        await world.siteStreamOf(name);
      }
    }
  },
);

When('all eight join the leveling queue for Baal on Hell in Europe', async ({ world }) => {
  for (const { name, role } of PLAYERS) {
    await joinAs(world, name, 'leveling', 'Sorc', 'hell', 'europe', { activity: 'baal', role, minLevel: 70 });
    expect(world.last?.status, `${name} joins the leveling queue`).toBe(201);
  }
});

Then('one group of eight forms with the teleporter and the BO', async ({ world }) => {
  // The matcher runs on every join and every second of the stack's clock.
  await world.stack.advanceClock(1_000);
  await expect
    .poll(async () => (await readyCheckOf(world, TELEPORTER))?.members.length ?? 0, {
      timeout: API_WAIT_MS,
      message: 'the group of eight',
    })
    .toBe(8);
  const check = await rememberCheck(world, TELEPORTER);
  expect((await readyCheckOf(world, BO))?.id, 'the BO is in the same check').toBe(check?.id);
});

When('every member accepts the ready check', async ({ world }) => {
  const check = await rememberCheck(world, TELEPORTER);
  for (const { name } of PLAYERS) {
    await answerAs(world, name, check?.id ?? '', 'accept');
    expect(world.last?.status, `${name} accepts`).toBe(204);
  }
});

/** The teleporter's room, once the group of eight is in it. */
async function groupRoom(world: World) {
  await expect
    .poll(async () => (await roomOf(world, TELEPORTER))?.members.length ?? 0, {
      timeout: API_WAIT_MS,
      message: 'the room of the group',
    })
    .toBe(8);
  const room = await roomOf(world, TELEPORTER);
  if (room === null) {
    throw new Error('the teleporter has no room');
  }
  return room;
}

Then("the teleporter is the room's host", async ({ world }) => {
  const room = await groupRoom(world);
  expect(room.members.find((member) => member.role === 'host')?.accountId, 'the teleporter hosts').toBe(
    world.player(TELEPORTER).accountId,
  );
  stateOf(world).oldName = room.expectedGameName;
});

/** The player's agent shows `gameName` in its Party panel and the API accepts its observation; returns when. */
async function readAs(world: World, player: string, gameName: string): Promise<number> {
  const { agent, png } = headlessOf(world, player);
  await agent.waitFor('assignment', 45_000, (item) => item['room'] === gameName);
  const before = agent.observedTimes().length;
  setPartyPanel(png, { gameNameField: gameName });
  await expect
    .poll(() => agent.observedTimes().length, { timeout: API_WAIT_MS, message: `${player}'s observation` })
    .toBeGreaterThan(before);
  return agent.observedTimes()[before] ?? Date.now();
}

When(
  "the host's agent and then every member's agent read the game name in the Party panel",
  async ({ world }) => {
    const room = await groupRoom(world);
    for (const { name } of PLAYERS) {
      stateOf(world).since = await readAs(world, name, room.expectedGameName);
    }
  },
);

/** The stage on a page, and how many members it shows as confirmed. */
async function pageShows(page: Page, who: string, label: string, since: number, confirmed: number) {
  const left = () => Math.max(1, since + SITE_LIMIT_MS - Date.now());
  await expect(currentStep(page), `${who}'s room as ${label}`).toHaveText(label, { timeout: left() });
  await expect(
    page
      .getByRole('list', { name: 'Members', exact: true })
      .getByRole('listitem')
      .filter({ hasText: 'Confirmed by the agent' }),
    `${who} sees ${confirmed} members confirmed`,
  ).toHaveCount(confirmed, { timeout: left() });
}

Then(
  /^the host's and a member's sites show the room as Active within (\d+) seconds of the last reading$/,
  async ({ world }, seconds: string) => {
    expect(Number(seconds) * 1_000, 'the limit the scenario states').toBe(SITE_LIMIT_MS);
    const since = stateOf(world).since;
    if (since === undefined) {
      throw new Error('no agent has read the Party panel in this scenario');
    }
    await Promise.all(
      [TELEPORTER, BO].map((name) => pageShows(pageOf(world, name), name, 'Active', since, 8)),
    );
  },
);

When('the host opens the next run on the site', async ({ world }) => {
  stateOf(world).since = Date.now();
  await pageOf(world, TELEPORTER).getByRole('button', { name: 'Next run', exact: true }).click();
});

Then(
  /^every member's site and agent get the next game name of the room within (\d+) seconds$/,
  async ({ world }, seconds: string) => {
    expect(Number(seconds) * 1_000, 'the limit the scenario states').toBe(SITE_LIMIT_MS);
    const state = stateOf(world);
    const since = state.since ?? Date.now();
    await expect
      .poll(async () => (await roomOf(world, TELEPORTER))?.run ?? 0, {
        timeout: API_WAIT_MS,
        message: 'run 2',
      })
      .toBe(2);
    const next = (await roomOf(world, TELEPORTER))?.expectedGameName ?? '';
    // The game name's number is the room's sequence, not the run's: the next name is another name of the same room kind.
    expect(next, 'a new game name').not.toBe(state.oldName);
    expect(next.replace(/\d+$/u, ''), 'the same activity and difficulty').toBe(
      (state.oldName ?? '').replace(/\d+$/u, ''),
    );
    state.nextName = next;
    const left = () => Math.max(1, since + SITE_LIMIT_MS - Date.now());
    for (const name of [TELEPORTER, BO]) {
      await expect(
        pageOf(world, name)
          .getByRole('list', { name: 'Runs', exact: true })
          .getByText(`Run 2: ${next} (current)`),
        `${name} sees run 2`,
      ).toBeVisible({ timeout: left() });
    }
    for (const { name } of PLAYERS) {
      await headlessOf(world, name).agent.waitFor('assignment', left(), (item) => item['room'] === next);
    }
  },
);

When('every agent reads the new game name in the Party panel', async ({ world }) => {
  const next = stateOf(world).nextName;
  if (next === undefined) {
    throw new Error('run 2 was not opened in this scenario');
  }
  for (const { name } of PLAYERS) {
    stateOf(world).since = await readAs(world, name, next);
  }
});

Then('the room is Active again for run 2', async ({ world }) => {
  const since = stateOf(world).since ?? Date.now();
  await Promise.all([TELEPORTER, BO].map((name) => pageShows(pageOf(world, name), name, 'Active', since, 8)));
  const room = await roomOf(world, TELEPORTER);
  expect(`${room?.stage} run ${room?.run}`, 'the room').toBe('active run 2');
});

After({ tags: '@JRN-02' }, ({ world }) => {
  states.delete(world);
});
