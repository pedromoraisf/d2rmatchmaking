// The capture cascade (capture-cascade, CAP-01 to CAP-07). The agent is the headless example: the real agent core with its
// capture cascade over two scripted capture methods (`capture print|graphics good|black|failed`, `minimize on|off`) and a
// drawn fixture screen. The steps are black box: the agent's input lines and its standard output (the `capture` event the
// agent window's capture lines print), and the API, as the site reads it. The Given, When and Then steps of the screen steps of
// characters-reading (consent, "the game shows the fixture", "the site shows the agent's screen as") are reused as they are.
import { expect } from '@playwright/test';
import { After, Given, Then, When } from '../fixtures.ts';
import { type AgentEvent } from '../support/headless-agent.ts';
import { agentOf, showFixture, stopHeadless } from './characters-reading.steps.ts';
import type { World } from '../support/world.ts';

/** The capture method names the agent window shows, and the fixed word of each in the example's `capture` event. */
const METHOD_OF_LABEL: Readonly<Record<string, string>> = {
  'Window print': 'print-window',
  'Graphics capture': 'graphics-capture',
  'Screen crop': 'screen-crop',
  None: 'none',
};

/** The window's last capture line, as the example printed it, or undefined before the first. */
function lastCapture(world: World): AgentEvent | undefined {
  return [...agentOf(world).events].reverse().find((event) => event.event === 'capture');
}

// CAP-01, CAP-02: the first method (window print) answers with black frames.
Given(/^the first capture method returns black frames$/, ({ world }) => {
  agentOf(world).send('capture print black');
});

// CAP-01: the first method is not offered by this PC: it answers with no frame, and the cascade moves on.
Given(/^the first capture method is not available on this PC$/, ({ world }) => {
  agentOf(world).send('capture print failed');
});

// CAP-02: every method answers with black frames, as an exclusive full-screen game can. Said before or after the game is shown (the keyword does not matter: one definition serves both).
const everyMethodBlack = ({ world }: { world: World }) => {
  agentOf(world).send('capture print black');
  agentOf(world).send('capture graphics black');
};
Given(/^every capture method returns black frames$/, everyMethodBlack);

// CAP-05: a minimized game has no client area to capture. The game is shown first, then minimized.
When(/^the game window is minimized$/, ({ world }) => {
  showFixture(world, 'in-game-window');
  agentOf(world).send('minimize on');
});

// CAP-05: the player withdraws capture consent in the agent's window.
When(/^\w+ withdraws capture consent in the agent's window$/, ({ world }) => {
  agentOf(world).consent(false);
});

// CAP-01, CAP-05, CAP-06, CAP-07: the method the agent window shows.
Then(/^the agent window shows the capture method "([^"]+)"$/, async ({ world }, label: string) => {
  const method = METHOD_OF_LABEL[label];
  if (method === undefined) throw new Error(`no capture method is named "${label}"`);
  await expect
    .poll(() => lastCapture(world)?.['method'], {
      timeout: 8_000,
      message: 'the capture method the agent window shows',
    })
    .toBe(method);
});

// CAP-01: a method that cannot be used is no error to the player.
Then(/^the agent window shows no capture error$/, async ({ world }) => {
  await expect
    .poll(() => lastCapture(world)?.['method'], { timeout: 8_000, message: 'a method that works' })
    .toBe('graphics-capture');
  expect(lastCapture(world)?.['reason'] ?? null, 'the reason the capture shows nothing').toBeNull();
});

// CAP-02: no method gave a usable frame: the window says so.
Then(/^the agent window says that the capture shows nothing$/, async ({ world }) => {
  await expect
    .poll(() => lastCapture(world)?.['reason'], {
      timeout: 8_000,
      message: 'the reason the agent window gives',
    })
    .toBe('nothing');
});

// Closes the example and removes its fixture directory after each capture scenario.
After({ tags: '@CAP-01 or @CAP-02 or @CAP-04 or @CAP-05 or @CAP-06 or @CAP-07' }, async ({ world }) => {
  await stopHeadless(world);
});
