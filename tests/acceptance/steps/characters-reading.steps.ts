// The agent reads the character selection screen (characters-reading, CHR-04, CHR-06, CHR-18, CHR-20). The agent is the
// headless example: the real agent core, its screen loop and its screen reader, reading the drawn character fixtures
// (`apps/agent/fixtures/characters`, each a picture and a sidecar with the text of its regions). The steps change what the
// game shows (`show`) and the player's consent (`consent on|off`) on the agent's input, and read the result over HTTP, as
// the site does. The steps are black box: the API and the agent's standard output, never the agent's internals.
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MyCharactersResponse } from '@d2rmm/contracts';
import { expect } from '@playwright/test';
import { After, Given, Then, When, test } from '../fixtures.ts';
import { AGENT_VERSION, type Screen } from '../support/agent-client.ts';
import { HeadlessAgent, characterFixture, preparePartyFixture } from '../support/headless-agent.ts';
import { SESSION_COOKIE, submitPairingCode, type World } from '../support/world.ts';

/** What the headless agent of one scenario is: the example, its fixture directory, the frame it started with and its player. */
interface HeadlessState {
  agent?: HeadlessAgent;
  dir?: string;
  png?: string;
  /** The player whose agent the example is (the Background's "Alice"). */
  player?: string;
}

const headlessStates = new WeakMap<World, HeadlessState>();

/** The headless agent state of a scenario. Its own store: the Party steps (agent-game-name) keep theirs. */
function stateOf(world: World): HeadlessState {
  let state = headlessStates.get(world);
  if (state === undefined) {
    state = {};
    headlessStates.set(world, state);
  }
  return state;
}

/** The example builds on first use, which takes minutes on a cold cache, and pairs within the code's lifetime after it. */
const START_TIMEOUT_MS = 180_000;
/** The character cards a selection fixture may hold (the sidecar's slots `cardName0` to `cardName8`). */
const CARD_SLOTS = 9;
/** The screen labels the site shows after "Screen: ", as the scenarios name them. */
const SCREEN_OF_LABEL: Readonly<Record<string, Screen>> = {
  'Character selection': 'CHARACTER_SELECT',
  'In game': 'IN_GAME',
  'Automap open': 'AUTOMAP_OPEN',
  Unknown: 'UNKNOWN',
};

/** The last fixture shown to a scenario's agent, and the card whose level the scenario made unreadable (if any). */
const lastShown = new WeakMap<World, { fixture: string; unreadable?: string }>();

/** A card as a fixture's sidecar gives it: the name, the class (contract spelling) and the level. */
interface FixtureCard {
  readonly name: string;
  readonly class: string;
  readonly level: number;
}

function summary(card: { name: string; class: string; level: number }): string {
  return `${card.name}/${card.class}/${card.level}`;
}

/** The cards a selection fixture shows, read from its sidecar: every slot with a name and a "Level N Class" line. */
function cardsOf(fixture: string): FixtureCard[] {
  const sidecar = JSON.parse(readFileSync(characterFixture(fixture).sidecar, 'utf8')) as Record<
    string,
    string
  >;
  const cards: FixtureCard[] = [];
  for (let slot = 0; slot < CARD_SLOTS; slot += 1) {
    const name = sidecar[`cardName${slot}`];
    const level = sidecar[`cardLevel${slot}`];
    if (name === undefined || level === undefined) continue;
    const match = /^Level (\d+) (\w+)$/.exec(level);
    if (match === null) throw new Error(`the level line of ${name} is not "Level N Class": "${level}"`);
    cards.push({ name, class: (match[2] ?? '').toLowerCase(), level: Number(match[1]) });
  }
  return cards;
}

function agentOf(world: World): HeadlessAgent {
  const agent = stateOf(world).agent;
  if (agent === undefined) {
    throw new Error(
      'the headless agent is not running: "Alice\'s agent has capture consent and no room" or "has no capture consent" was not given',
    );
  }
  return agent;
}

/** The characters the API lists for the player, as the site's list reads them. */
async function listedCharacters(world: World, name: string) {
  const session = await world.sessionOf(name);
  const response = await fetch(`${world.site.api}/v1/me/characters`, {
    headers: { Cookie: `${SESSION_COOKIE}=${session}` },
    signal: AbortSignal.timeout(10_000),
  });
  expect(response.status, 'the character list answer').toBe(200);
  return MyCharactersResponse.parse(await response.json()).characters;
}

/** The screen the agent reported on its last heartbeat, or undefined when no agent is paired. */
async function reportedScreen(world: World, name: string): Promise<string | undefined> {
  const answer = await world.presenceOf(name);
  const body = answer.body as { status?: string; screen?: string } | undefined;
  return body?.status === 'paired' ? body.screen : undefined;
}

/** Starts the headless agent for the player, with or without consent, and pairs it as the player's agent (CHR-01). */
async function startHeadless(world: World, name: string, consent: boolean): Promise<void> {
  test.setTimeout(START_TIMEOUT_MS);
  const session = await world.sessionOf(name);
  const state = stateOf(world);
  state.dir = mkdtempSync(path.join(tmpdir(), 'd2rmm-chr-'));
  const fixture = preparePartyFixture(state.dir, { gameNameField: 'xxxxxxxxx' });
  state.png = fixture.png;
  state.player = name;
  await HeadlessAgent.build();
  // The API answers 426 to an agent below its minimum version, so the example declares the simulated agent's version.
  state.agent = HeadlessAgent.start({
    apiBase: world.site.api,
    fixture: fixture.png,
    party: true,
    consent,
    agentVersion: AGENT_VERSION,
  });
  const shown = await state.agent.waitFor('code', START_TIMEOUT_MS);
  const paired = await submitPairingCode(world.site, session, String(shown['code']));
  expect(paired.status, 'pairing the headless agent').toBe(200);
  await state.agent.waitFor('paired');
}

/** Shows a drawn fixture to the agent: its picture and sidecar are copied into the scenario's directory first. */
function showFixture(world: World, fixture: string, unreadable?: string): void {
  const state = stateOf(world);
  if (state.dir === undefined) {
    throw new Error('the headless agent has no fixture directory in this scenario');
  }
  const source = characterFixture(fixture);
  const suffix = unreadable === undefined ? '' : `-${unreadable.toLowerCase()}-unreadable`;
  const png = path.join(state.dir, `${fixture}${suffix}.png`);
  copyFileSync(source.png, png);
  if (unreadable === undefined) {
    copyFileSync(source.sidecar, `${png}.json`);
  } else {
    // The card's level line is left out of the sidecar, so the reader cannot read that card (CHR-06).
    const text = JSON.parse(readFileSync(source.sidecar, 'utf8')) as Record<string, string>;
    const nameKey = Object.keys(text).find((key) => key.startsWith('cardName') && text[key] === unreadable);
    if (nameKey === undefined) throw new Error(`the fixture ${fixture} has no card named ${unreadable}`);
    const levelKey = `cardLevel${nameKey.slice('cardName'.length)}`;
    const kept = Object.fromEntries(Object.entries(text).filter(([key]) => key !== levelKey));
    writeFileSync(`${png}.json`, `${JSON.stringify(kept, null, 2)}\n`);
  }
  agentOf(world).show(png);
  lastShown.set(world, unreadable === undefined ? { fixture } : { fixture, unreadable });
}

// The player has consent and no room: the agent reads the character screens of the scenario (CHR-04, CHR-06, CHR-18).
// Its own step, not agent-game-name's: that one expects the player to hold a room (AGN-01).
Given(/^(.+)'s agent has capture consent and no room$/, async ({ world }, name: string) => {
  expect(world.player(name).room, `the room of "${name}"`).toBeUndefined();
  await startHeadless(world, name, true);
});

// CHR-20: a player's agent reads nothing until the player gives consent in the agent's window.
Given(/^(.+)'s agent has no capture consent$/, async ({ world }, name: string) => {
  await startHeadless(world, name, false);
});

When(/^\w+ gives capture consent in the agent's window$/, ({ world }) => {
  agentOf(world).consent(true);
});

// CHR-04: the screen the game shows is reported as the heartbeat's screen (the site shows it as its label).
When(/^the game shows the fixture "([^"]+)"$/, ({ world }, fixture: string) => {
  showFixture(world, fixture);
});

Then(/^the site shows the agent's screen as "([^"]+)"$/, async ({ world }, label: string) => {
  const screen = SCREEN_OF_LABEL[label];
  if (screen === undefined) throw new Error(`no screen is named "${label}"`);
  await expect
    .poll(() => reportedScreen(world, playerOf(world)), {
      timeout: 5_000,
      message: `the screen the agent reports for ${playerOf(world)}`,
    })
    .toBe(screen);
});

// CHR-20: nothing is listed while the agent reads nothing.
Then(/^the site shows no characters for (\w+)$/, async ({ world }, name: string) => {
  // Two seconds are two reads of the agent: a list that fills would have filled by now.
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  expect(await listedCharacters(world, name), `the characters of ${name}`).toEqual([]);
});

// CHR-06: every complete card on the screen is registered with its fields.
When(/^the game shows the character selection screen fixture "([^"]+)"$/, ({ world }, fixture: string) => {
  showFixture(world, fixture);
});

When(
  /^the game shows the character selection screen fixture "([^"]+)" with one card's level unreadable$/,
  ({ world }, fixture: string) => {
    showFixture(world, fixture, 'Orrin');
  },
);

Then('the site lists every character of that fixture with its fields', async ({ world }) => {
  const shown = lastShown.get(world);
  if (shown === undefined) throw new Error('the scenario showed no fixture');
  const expected = cardsOf(shown.fixture).map(summary).sort();
  await expect
    .poll(async () => (await listedCharacters(world, playerOf(world))).map(summary).sort(), {
      timeout: 5_000,
      message: 'the characters the API lists',
    })
    .toEqual(expected);
});

Then('the site lists every other character of that fixture', async ({ world }) => {
  const shown = lastShown.get(world);
  if (shown === undefined) throw new Error('the scenario showed no fixture');
  const expected = cardsOf(shown.fixture)
    .filter((card) => card.name !== shown.unreadable)
    .map(summary)
    .sort();
  await expect
    .poll(async () => (await listedCharacters(world, playerOf(world))).map(summary).sort(), {
      timeout: 5_000,
    })
    .toEqual(expected);
});

Then('the site does not list the character whose level was unreadable', async ({ world }) => {
  const shown = lastShown.get(world);
  const names = (await listedCharacters(world, playerOf(world))).map((character) => character.name);
  expect(names, 'the list').not.toContain(shown?.unreadable);
});

// CHR-12: the reading reaches the list within two seconds of the screen.
Then(
  /^the site lists the characters of the fixture "([^"]+)" within 2 seconds$/,
  async ({ world }, fixture: string) => {
    const expected = cardsOf(fixture).map((card) => card.name);
    await expect
      .poll(
        async () => {
          const names = (await listedCharacters(world, playerOf(world))).map((character) => character.name);
          return expected.every((name) => names.includes(name));
        },
        { timeout: 2_000, message: `the characters of "${fixture}" in the list` },
      )
      .toBe(true);
  },
);

// CHR-18: the popup's enabled difficulties are the selected character's, and they take precedence over the title's.
When(
  /^the game shows the difficulty popup fixture "([^"]+)" for the selected character$/,
  ({ world }, fixture: string) => {
    showFixture(world, fixture);
  },
);

Given(/^the game showed the character selection screen fixture "([^"]+)"$/, ({ world }, fixture: string) => {
  showFixture(world, fixture);
});

Then('the site shows that character with the difficulties of that fixture unlocked', async ({ world }) => {
  const shown = lastShown.get(world);
  if (shown === undefined) throw new Error('the scenario showed no fixture');
  // The selected card of the popup fixture is the first one, vukVuka; its popup shows the three difficulties.
  const selected = cardsOf(shown.fixture)[0]?.name;
  await expect
    .poll(
      async () => {
        const character = (await listedCharacters(world, playerOf(world))).find(
          (item) => item.name === selected,
        );
        return character?.unlockedDifficulties;
      },
      { timeout: 5_000, message: `the difficulties of ${selected ?? 'the selected character'}` },
    )
    .toEqual(['normal', 'nightmare', 'hell']);
});

/** The player whose agent the scenario's headless example is (the Background's "Alice"). */
function playerOf(world: World): string {
  const player = stateOf(world).player;
  if (player === undefined) {
    throw new Error('no agent of a player is running in this scenario');
  }
  return player;
}

// Closes the example and removes its fixture directory after each character screen scenario.
After({ tags: '@CHR-04 or @CHR-06 or @CHR-18 or @CHR-20' }, async ({ world }) => {
  const state = headlessStates.get(world);
  await state?.agent?.stop();
  if (state?.dir !== undefined) {
    rmSync(state.dir, { recursive: true, force: true });
  }
  headlessStates.delete(world);
  lastShown.delete(world);
});
