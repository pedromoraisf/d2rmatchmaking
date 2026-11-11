// Steps of site-shell (SHL-02 to SHL-05): the header's account and agent state, the page on a narrow screen, the character
// cards, and the keyboard walk over the whole page. Black box: the browser and HTTP only. The sign-in, the agent, the
// character and the visible-text steps are shared with the other site features and reused, not repeated here.
import { expect, type Page } from '@playwright/test';
import type { GameState } from '../support/agent-client.ts';
import { Given, Then, When } from '../fixtures.ts';
import type { World } from '../support/world.ts';

/** An agent that is online with its game closed on an unknown screen (SHL-02, SHL-03). */
const GAME_CLOSED: GameState = { running: false, screen: 'UNKNOWN' };

/** The most Tab presses the keyboard walk makes: enough for every control of the page, and no more (SHL-05). */
const MAX_TAB_PRESSES = 200;

/** The viewport height of the screens the scenarios open (SHL-03). */
const SCREEN_HEIGHT = 900;

/** The scenario value that keeps the keyboard walk for its Then step. */
const TAB_WALK = 'site-shell.tab-walk';

/** Opens the site in a new browser of the player, signed in with the player's session, at a screen of this width. */
async function openSignedIn(world: World, name: string, width?: number): Promise<void> {
  const session = await world.sessionOf(name);
  const visitor = await world.newVisitor();
  if (width !== undefined) {
    await visitor.page.setViewportSize({ width, height: SCREEN_HEIGHT });
  }
  const previous = world.pendingSessionCookie;
  world.pendingSessionCookie = session;
  try {
    await world.openSite(visitor);
  } finally {
    world.pendingSessionCookie = previous;
  }
  await expect(
    visitor.page.getByText(`Signed in as ${name}`, { exact: true }),
    `"${name}" is signed in`,
  ).toBeVisible();
  world.player(name).visitor = visitor;
}

/** The page's header (the banner landmark): the brand, the sections, the agent's state and the account. */
function header(page: Page) {
  return page.getByRole('banner');
}

/** The status column (the complementary landmark named "Status"): the agent panel and the agent download. */
function statusColumn(page: Page) {
  return page.getByRole('complementary', { name: 'Status', exact: true });
}

/** The card of one character in the site's list: the list item that holds the name (CHR-11, SHL-04). */
function characterCard(page: Page, characterName: string) {
  return page
    .getByRole('region', { name: 'Your characters', exact: true })
    .getByRole('listitem')
    .filter({ has: page.getByText(characterName, { exact: true }) });
}

/** A focused element of the keyboard walk: its place in the document, and the outline it shows. */
interface Focused {
  index: number;
  outlineStyle: string;
  outlineWidth: string;
}

// SHL-02: a player who is signed in with no agent, or with an agent that is online, sees the account and the state.
Given(/^"(.+)" is signed in and has no paired agent$/, async ({ world }, name: string) => {
  await world.sessionOf(name);
});

Given(/^"(.+)" is signed in and has a paired agent that is online$/, async ({ world }, name: string) => {
  const agent = await world.pairAgent(name);
  const answer = await agent.heartbeat(GAME_CLOSED);
  expect(answer.status, 'the heartbeat is accepted').toBe(204);
});

Then(
  /^the header shows "(.+)", a sign-out control and the agent state "(.+)"$/,
  async ({ world }, name: string, state: string) => {
    const page = world.currentVisitor.page;
    await expect(header(page).getByText(name), `"${name}" in the header`).toBeVisible();
    await expect(
      header(page).getByRole('button', { name: 'Sign out', exact: true }),
      'the sign-out control in the header',
    ).toBeVisible();
    await expect(header(page).getByText(state, { exact: true }), `the agent state "${state}"`).toBeVisible();
  },
);

Then('the header shows the sign-in controls and no account', async ({ world }) => {
  const page = world.currentVisitor.page;
  await expect(
    header(page).getByRole('button', { name: 'Sign in', exact: true }),
    'the sign-in control in the header',
  ).toBeVisible();
  await expect(
    header(page).getByRole('button', { name: 'Sign out', exact: true }),
    'no sign-out',
  ).toHaveCount(0);
  await expect(page.getByText('Signed in as'), 'no account').toHaveCount(0);
});

// SHL-03: the page fits the screen, and the agent panel shows the agent, the game and the screen.
When(
  /^(\w+) opens the site on a screen (\d+) pixels wide$/,
  async ({ world }, name: string, width: string) => {
    await openSignedIn(world, name, Number(width));
  },
);

Then('the page does not scroll sideways', async ({ world }) => {
  const overflow = await world.currentVisitor.page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'the sideways overflow of the page in pixels').toBeLessThanOrEqual(0);
});

Then('the agent panel shows the agent online, the game state and the current screen', async ({ world }) => {
  const panel = statusColumn(world.currentVisitor.page);
  await expect(panel.getByText('Agent online', { exact: true }), 'the agent online').toBeVisible();
  await expect(panel.getByText(/^Game (open|closed)$/), 'the game state').toBeVisible();
  await expect(panel.getByText(/^Screen: /), 'the current screen').toBeVisible();
});

// SHL-04: a character is a card with its class, level, mode, ladder, era and the difficulties as tags.
Then(
  /^the card of "([^"]+)" shows (\w+), level (\d+), (softcore|hardcore), (.+?), (.+?) and the tags (.+)$/,
  async (
    { world },
    characterName: string,
    characterClass: string,
    level: string,
    mode: string,
    ladder: string,
    era: string,
    tags: string,
  ) => {
    const page = world.currentVisitor.page;
    const card = characterCard(page, characterName);
    const texts = [
      characterClass.charAt(0).toUpperCase() + characterClass.slice(1),
      `Level ${level}`,
      mode.charAt(0).toUpperCase() + mode.slice(1),
      ladder.charAt(0).toUpperCase() + ladder.slice(1),
      era,
      ...tags.split(' and '),
    ];
    for (const text of texts) {
      await expect(
        card.getByText(text, { exact: true }),
        `"${text}" on the card of "${characterName}"`,
      ).toBeVisible();
    }
  },
);

// SHL-05: every link and button is reached by Tab, in reading order, and shows a visible outline.
When(
  /^(\w+) opens the site and presses Tab through the whole page$/,
  async ({ world, scenario }, name: string) => {
    await openSignedIn(world, name);
    const page = world.currentVisitor.page;
    const visited: Focused[] = [];
    for (let press = 0; press < MAX_TAB_PRESSES; press += 1) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate((): Focused | null => {
        const element = document.activeElement;
        if (element === null || element === document.body) {
          return null;
        }
        const style = getComputedStyle(element);
        return {
          index: Array.from(document.querySelectorAll('*')).indexOf(element),
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
        };
      });
      // The focus left the page, or came back to an element the walk already reached.
      if (focused === null || visited.some((seen) => seen.index === focused.index)) {
        break;
      }
      visited.push(focused);
    }
    // The walk is kept for the Then step of this scenario.
    scenario.values.set(TAB_WALK, visited);
  },
);

Then(
  'every link and button receives focus in reading order with a visible outline',
  async ({ world, scenario }) => {
    const page = world.currentVisitor.page;
    const visited = (scenario.values.get(TAB_WALK) ?? []) as Focused[];
    const interactive = await page.evaluate(() =>
      Array.from(document.querySelectorAll('*'))
        .map((element, index) => ({ element, index }))
        .filter(
          ({ element }) => element.matches('a[href], button') && !(element as HTMLButtonElement).disabled,
        )
        .map(({ index }) => index),
    );
    const reached = new Set(visited.map((focused) => focused.index));
    expect(
      interactive.filter((index) => !reached.has(index)),
      'the links and buttons the Tab walk did not reach',
    ).toEqual([]);
    const order = visited.map((focused) => focused.index);
    expect(order, 'the focus order is the reading order').toEqual([...order].sort((a, b) => a - b));
    const unseen = visited.filter(
      (focused) => focused.outlineStyle !== 'solid' || parseFloat(focused.outlineWidth) < 1,
    );
    expect(unseen, 'the focused elements without a visible outline').toEqual([]);
  },
);
