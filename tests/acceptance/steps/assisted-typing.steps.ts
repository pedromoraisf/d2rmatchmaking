// Steps of assisted-typing (AST-08, AST-11, AST-12; FR-28, ADR 010). Black box: the headless agent is the real core with an
// in-memory clipboard, so nothing reaches an operating system. A step drives it with lines (`assign`, `room close`,
// `copy-again`, `clipboard replace`, `hotkey busy`) and reads the events it prints: `clipboard` for every write of the agent,
// `copy` for the outcome the window shows, `room-dropped` for the room ending, `hotkey-unavailable` for a hotkey the OS
// refused. The text the window shows for each outcome is proved by its component tests; here a step ties the outcome to the
// English line the window would show. The Windows clipboard adapter is proved by unit tests, the source rules and the
// maintainer's check (Ctrl+V in the Game Creator) on a preview installer.
import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import { Given, Then, When } from '../fixtures.ts';
import type { AgentEvent, HeadlessAgent } from '../support/headless-agent.ts';
import type { World } from '../support/world.ts';
import { agentOf, startHeadless } from './characters-reading.steps.ts';

const EVENT_WAIT_MS = 15_000;
const START_WAIT_MS = 30_000;
/** How long a step waits to be sure the agent printed nothing more. */
const QUIET_MS = 1_000;

const ENGLISH = JSON.parse(
  readFileSync(new URL('../../../apps/agent/src/shared/locales/en.json', import.meta.url), 'utf8'),
) as { copy: Record<string, string>; readyCheck: Record<string, string> };

/** Where in the agent's events the scenario's last action began: the checks look at what the agent printed after it. */
const marks = new WeakMap<World, number>();

function markNow(world: World, agent: HeadlessAgent): void {
  marks.set(world, agent.events.length);
}

function since(world: World, agent: HeadlessAgent): readonly AgentEvent[] {
  return agent.events.slice(marks.get(world) ?? 0);
}

/** A step cannot send a newline in one line: the example reads a backslash and an n as one. */
function encoded(name: string): string {
  return name.replace(/\r?\n/g, '\\n');
}

/** The agent fetches its assignment right after pairing and drops a room it holds when the API answers "none": a room is
 * assigned once that fetch is over, which is when the stream opens. */
async function assign(world: World, name: string): Promise<HeadlessAgent> {
  const agent = agentOf(world);
  await agent.waitFor('stream-open', START_WAIT_MS);
  markNow(world, agent);
  agent.send(`assign ${encoded(name)}`);
  return agent;
}

/** What the agent's clipboard holds: the last of its writes and of the replacements by "something else". */
function clipboardHolds(agent: HeadlessAgent): string | undefined {
  const last = [...agent.events]
    .reverse()
    .find((event) => event.event === 'clipboard' || event.event === 'clipboard-replaced');
  return last?.event === 'clipboard'
    ? String(last['text'])
    : last === undefined
      ? undefined
      : '<something else>';
}

Given(
  /^Alice's agent is the headless agent and holds her room "([^"]+)"$/,
  async ({ world }, name: string) => {
    await startHeadless(world, 'Alice', true);
    const agent = await assign(world, name);
    await agent.waitFor('copy', EVENT_WAIT_MS, (event) => event['outcome'] === 'copied');
  },
);

Given('something else replaced the clipboard', async ({ world }) => {
  const agent = agentOf(world);
  agent.send('clipboard replace');
  await agent.waitFor('clipboard-replaced', EVENT_WAIT_MS);
});

Given("another program holds the accept hotkey's combination", ({ world }) => {
  agentOf(world).send('hotkey busy');
});

When(/^Alice's room "([^"]+)" opens$/, async ({ world }, name: string) => {
  await assign(world, name);
});

When(/^the room's next run "([^"]+)" starts$/, async ({ world }, name: string) => {
  const agent = agentOf(world);
  markNow(world, agent);
  agent.send(`assign ${encoded(name)}`);
});

When(/^the API assigns Alice a room whose game name is "([^"]*)"$/, async ({ world }, name: string) => {
  await assign(world, name);
});

When('the room closes', async ({ world }) => {
  const agent = agentOf(world);
  markNow(world, agent);
  agent.send('room close');
  await agent.waitFor('room-dropped', EVENT_WAIT_MS);
});

When('Alice clicks "copy again" in the agent window', ({ world }) => {
  const agent = agentOf(world);
  markNow(world, agent);
  agent.send('copy-again');
});

When('the agent starts', async ({ world }) => {
  await agentOf(world).waitFor('stream-open', START_WAIT_MS);
});

Then(/^the agent's clipboard holds "([^"]+)"$/, async ({ world }, name: string) => {
  const agent = agentOf(world);
  await expect
    .poll(() => clipboardHolds(agent), {
      timeout: EVENT_WAIT_MS,
      message: "what the agent's clipboard holds",
    })
    .toBe(name);
});

Then("the agent's clipboard is untouched", async ({ world }) => {
  const agent = agentOf(world);
  await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
  expect(
    since(world, agent).filter((event) => event.event === 'clipboard'),
    'no write of the agent since the step began',
  ).toStrictEqual([]);
});

Then(/^the agent copied (\d+) times in all$/, async ({ world }, count: string) => {
  const agent = agentOf(world);
  const writes = () => agent.events.filter((event) => event.event === 'clipboard').length;
  await expect.poll(writes, { timeout: EVENT_WAIT_MS, message: 'the agent writes' }).toBe(Number(count));
  await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
  expect(writes(), 'a run is copied once').toBe(Number(count));
});

Then('the agent sent no key to any window', ({ world }) => {
  // The example has no input path: every event it prints is a report of the agent, never an input to a window (ADR 010).
  expect(
    agentOf(world).events.filter((event) => event.event === 'input'),
    'no input events',
  ).toStrictEqual([]);
});

Then('the agent window says the game name could not be copied', async ({ world }) => {
  const agent = agentOf(world);
  const shown = await agent.waitFor('copy', EVENT_WAIT_MS, (event) => event['outcome'] === 'refused-name');
  expect(shown['outcome'], 'the outcome the window says it with').toBe('refused-name');
  expect(ENGLISH.copy['refused-name'], 'the English line').toMatch(/could not be copied/);
});

Then(
  'the agent window says the game name was copied and that Alice pastes it with Ctrl+V and creates the game herself',
  async ({ world }) => {
    const agent = agentOf(world);
    await agent.waitFor('copy', EVENT_WAIT_MS, (event) => event['outcome'] === 'copied');
    expect(ENGLISH.copy['copied'], 'the English line').toMatch(/Ctrl\+V.*create the game yourself/);
  },
);

Then('the agent window offers no "copy again"', ({ world }) => {
  // The window offers the button exactly while the view holds a room (its component test); the room dropped, so none.
  const agent = agentOf(world);
  expect(
    since(world, agent).some((event) => event.event === 'room-dropped') ||
      agent.events.some((event) => event.event === 'room-dropped'),
    'the room dropped',
  ).toBe(true);
});

Then(
  'the agent window says the accept hotkey is unavailable and asks Alice to choose another combination',
  async ({ world }) => {
    const shown = await agentOf(world).waitFor(
      'hotkey-unavailable',
      EVENT_WAIT_MS,
      (event) => event['slot'] === 'accept',
    );
    expect(shown['reason'], 'a closed reason code, never the OS text').toBe('refused');
    expect(ENGLISH.readyCheck['unavailable'], 'the English line').toMatch(/Choose another combination/);
  },
);
