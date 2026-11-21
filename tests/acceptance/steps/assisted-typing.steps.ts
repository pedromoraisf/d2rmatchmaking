// Steps of assisted-typing (AST-02 … AST-08; FR-28, ADR 010). Black box: the headless agent is the real core with a fake
// keyboard (the typer, the foreground window and the modifier keys are in-memory, so nothing reaches an operating system).
// A step drives it with lines (`assign`, `fill`, `focus`, `keys`) and reads the `fill` event it prints: the outcome, the text
// typed and how much of it went out while the hotkey's keys were held. The text the agent window shows for each outcome is
// proved by the window's component tests; here the outcome is what the window would say.
import { expect } from '@playwright/test';
import { Given, Then, When } from '../fixtures.ts';
import type { AgentEvent, HeadlessAgent } from '../support/headless-agent.ts';
import type { World } from '../support/world.ts';
import { headlessOf } from './lobby-rooms.steps.ts';
import { agentOf, reportedScreen, showFixture, startHeadless } from './characters-reading.steps.ts';

const EVENT_WAIT_MS = 15_000;
const SCREEN_WAIT_MS = 10_000;
const START_WAIT_MS = 30_000;
/** How long a step waits to be sure the agent printed nothing more. */
const QUIET_MS = 1_000;
/** The agent ignores a press within 2 seconds of the last fill (AST-07); a step waits this long for a fresh press. */
const COOL_DOWN_MS = 2_200;

/** What the agent window says for each outcome of a fill, in the words of the scenarios (the window's own text is unit-tested). */
const OUTCOME_OF_SAYING: Readonly<Record<string, string>> = {
  'there is no room to fill': 'refused-room',
  'the game does not have focus': 'refused-focus',
  'a game is running': 'refused-screen',
  'the keys are still held': 'refused-keys',
  'the fill stopped': 'stopped-focus',
};

/** Where in the agent's events a scenario's last press began: the next `fill` or `fill-ignored` after it is that press's. */
const pressed = new WeakMap<World, { agent: HeadlessAgent; from: number }>();

/** The agent of a player: the room scenarios start one per player, the reading scenarios start Alice's alone. */
function agentFor(world: World, name: string): HeadlessAgent {
  try {
    return headlessOf(world, name).agent;
  } catch {
    return agentOf(world);
  }
}

function press(world: World, agent: HeadlessAgent): void {
  pressed.set(world, { agent, from: agent.events.length });
  agent.send('fill');
}

function lastPress(world: World): { agent: HeadlessAgent; from: number } {
  const found = pressed.get(world);
  if (found === undefined) throw new Error('no press of the fill hotkey was made in this scenario');
  return found;
}

/** The `fill` event of the last press. */
async function fillOf(world: World): Promise<AgentEvent> {
  const { agent, from } = lastPress(world);
  return agent.waitFor('fill', EVENT_WAIT_MS, (event) => agent.events.indexOf(event) >= from);
}

async function holdingRoom(world: World, name: string): Promise<HeadlessAgent> {
  await startHeadless(world, 'Alice', true);
  const agent = agentOf(world);
  // The agent fetches its assignment right after pairing and drops a room it holds when the API answers "none": the room is
  // assigned once that fetch is over, which is when the stream opens (a slow runner answers the fetch after `paired`).
  await agent.waitFor('stream-open', START_WAIT_MS);
  if (name !== '') agent.send(`assign ${name}`);
  return agent;
}

Given(
  /^Alice's agent is the headless agent and holds her room "([^"]+)"$/,
  async ({ world }, name: string) => {
    await holdingRoom(world, name);
  },
);

Given("Alice's agent is the headless agent and holds no room", async ({ world }) => {
  await holdingRoom(world, '');
});

Given(
  /^Alice's agent is the headless agent and holds a room named "([^"]+)"$/,
  async ({ world }, name: string) => {
    await holdingRoom(world, name);
  },
);

/** The game shows a fixture and the agent reports the screen it reads from it, so the next press sees that screen. */
async function showScreen(world: World, fixture: string, reported: string): Promise<void> {
  agentOf(world).send('focus on');
  showFixture(world, fixture);
  await expect
    .poll(() => reportedScreen(world, 'Alice'), {
      timeout: SCREEN_WAIT_MS,
      message: 'the screen the agent reports',
    })
    .toBe(reported);
}

Given('D2R has focus and the game shows the lobby', async ({ world }) => {
  await showScreen(world, 'menu', 'UNKNOWN');
});

Given('D2R has focus and the agent does not recognise the screen', async ({ world }) => {
  await showScreen(world, 'menu', 'UNKNOWN');
});

Given(
  /^D2R has focus and the game shows (the in-game screen|the open automap)$/,
  async ({ world }, screen: string) => {
    await (screen === 'the in-game screen'
      ? showScreen(world, 'in-game', 'IN_GAME')
      : showScreen(world, 'automap', 'AUTOMAP_OPEN'));
  },
);

Given('another window has focus', async ({ world }) => {
  await showScreen(world, 'menu', 'UNKNOWN');
  agentOf(world).send('focus off');
});

Given(
  /^Alice still holds the hotkey's modifier keys for (\d+) milliseconds$/,
  ({ world }, millis: string) => {
    agentOf(world).send(`keys hold ${millis}`);
  },
);

Given(/^Alice holds the hotkey's modifier keys for (\d+) seconds$/, ({ world }, seconds: string) => {
  agentOf(world).send(`keys hold ${Number(seconds) * 1000}`);
});

Given("Alice's agent typed her room's name 1 second ago", async ({ world }) => {
  const agent = agentOf(world);
  press(world, agent);
  const first = await fillOf(world);
  expect(first['outcome'], 'the first fill').toBe('typed');
  await new Promise((resolve) => setTimeout(resolve, 1_000));
});

When(/^(\w+) presses the agent's fill hotkey$/, ({ world }, name: string) => {
  press(world, agentFor(world, name));
});

When(
  /^(\w+) presses the agent's fill hotkey and focus leaves the game after (\d+) characters$/,
  ({ world }, name: string, count: string) => {
    const agent = agentFor(world, name);
    agent.send(`focus lose-after ${count}`);
    press(world, agent);
  },
);

When(
  /^(\w+) presses the agent's fill hotkey and presses it again after (\d+) characters$/,
  ({ world }, name: string, count: string) => {
    const agent = agentFor(world, name);
    agent.send(`fill-again-after ${count}`);
    press(world, agent);
  },
);

Then(/^the agent typed exactly "([^"]*)"$/, async ({ world }, text: string) => {
  expect((await fillOf(world))['text'], 'what the agent typed').toBe(text);
});

Then('the agent typed nothing', async ({ world }) => {
  expect((await fillOf(world))['text'], 'what the agent typed').toBe('');
});

Then('the agent typed nothing more', async ({ world }) => {
  const { agent, from } = lastPress(world);
  await agent.waitFor('fill-ignored', EVENT_WAIT_MS, (event) => agent.events.indexOf(event) >= from);
  await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
  const fills = agent.events.slice(from).filter((event) => event.event === 'fill');
  expect(fills, 'no further fill after the ignored press').toStrictEqual([]);
});

Then('the agent typed nothing else', async ({ world }) => {
  const { agent, from } = lastPress(world);
  await fillOf(world);
  await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
  expect(
    agent.events.slice(from).filter((event) => event.event === 'fill'),
    'one fill for one press',
  ).toHaveLength(1);
});

Then('the agent typed nothing before the modifier keys were released', async ({ world }) => {
  expect((await fillOf(world))['typedWhileHeld'], 'characters typed while the keys were held').toBe(0);
});

// Only the phrases of the assisted-typing scenarios: another feature's own "the agent window says …" step must stay
// unambiguous (bddgen refuses two definitions for one step).
const SAYINGS = [...Object.keys(OUTCOME_OF_SAYING), 'the name was typed.*'].join('|');
Then(new RegExp(`^the agent window says (${SAYINGS})$`), async ({ world }, saying: string) => {
  const saying_ = saying.startsWith('the name was typed') ? 'typed' : undefined;
  const outcome = saying_ ?? OUTCOME_OF_SAYING[saying];
  if (outcome === undefined) throw new Error(`no outcome says "${saying}"`);
  expect((await fillOf(world))['outcome'], `the outcome behind "${saying}"`).toBe(outcome);
});

Then('every event the agent sent is a Unicode character keystroke', async ({ world }) => {
  // The typer port takes one character of a game name and nothing else, so the only thing a fill produces is its text.
  const fill = await fillOf(world);
  expect(String(fill['text']), 'the typed characters').toMatch(/^[a-z0-9-]+$/);
});

Then('the agent sent no Enter, Tab, Space, Escape or Backspace', async ({ world }) => {
  const { agent, from } = lastPress(world);
  expect(String((await fillOf(world))['text']), 'no control, space or other key in the text').not.toMatch(
    /[^a-z0-9-]/,
  );
  expect(
    agent.events.slice(from).filter((event) => event.event === 'input'),
    'no input events',
  ).toStrictEqual([]);
});

Then('the agent sent no modifier, mouse or clipboard event', async ({ world }) => {
  const { agent, from } = lastPress(world);
  await fillOf(world);
  expect(
    agent.events.slice(from).filter((event) => event.event === 'input'),
    'no input events',
  ).toStrictEqual([]);
});

Then('the agent sent no key after the last character', async ({ world }) => {
  const { agent, from } = lastPress(world);
  await fillOf(world);
  await new Promise((resolve) => setTimeout(resolve, COOL_DOWN_MS - 1_000));
  const after = agent.events.slice(from).filter((event) => event.event === 'input' || event.event === 'fill');
  expect(
    after.map((event) => event.event),
    'only the one fill, no input',
  ).toStrictEqual(['fill']);
});
