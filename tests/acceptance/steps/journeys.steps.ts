// Steps of journeys-e2e: the F1 screens scanned for accessibility and for Portuguese (JRN-05, JRN-07), J1 end to end with
// the real headless agents (JRN-01, JRN-03), and J1's site steps by keyboard alone (JRN-06). Black box: HTTP, the
// browser and the headless agents' own output. The fake Battle.net server signs the players in; their agents pair and
// register their characters before the queue, as in the earlier features' steps.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';
import { After, Given, Then, When, test } from '../fixtures.ts';
import { AGENT_VERSION } from '../support/agent-client.ts';
import { signInWithBattleNetThroughApi } from '../support/fake-battle-net.ts';
import { HeadlessAgent, preparePartyFixture, setPartyPanel } from '../support/headless-agent.ts';
import { shownEnglish, shownKeys, siteCatalogues } from '../support/journey-text.ts';
import { HEADLESS_START_TIMEOUT_MS } from '../support/scenario-state.ts';
import { submitPairingCode, type Visitor, type World } from '../support/world.ts';
import { accountOfVisitor, newVisitorSignedInWithBattleNet, sessionValueOf } from './identity-bnet.steps.ts';
import {
  ONLINE,
  SORC_OF_ALICE,
  answerAs,
  joinAs,
  readyPlayer,
  registerCharacter,
  rememberCheck,
  roomOf,
  type QueueCharacter,
} from './queues.steps.ts';

/** The two players of the journeys, with the BattleTag each signs in with. */
const BATTLETAG = { Alice: 'Alice#1234', Bob: 'Bob#5678' } as const;
type Who = keyof typeof BATTLETAG;
const WHO: readonly Who[] = ['Alice', 'Bob'];
/** The level 90 ladder softcore sorceress both players register (the scenarios' "level 90 sorceress"). */
const SORCERESS: QueueCharacter = { ...SORC_OF_ALICE, name: 'Sorc' };
/** The field of a masked Party panel: nothing the agent reads as a game name. */
const MASKED = 'xxxxxxxxx';
/** A page shows a room change within this long of the agent's observation (JRN-03, NFR-01). */
export const SITE_LIMIT_MS = 2_000;
/** What the headless agents take to appear online, and the room and ready check to appear on a page. */
export const API_WAIT_MS = 15_000;
/** Tab presses a keyboard walk may take before the control must hold the focus. */
const KEYBOARD_STOPS = 80;

// --- The screens (JRN-05, JRN-07) ------------------------------------------------------------------------------------

const SCREENS = [
  'signed out',
  'signed in home',
  'pairing',
  'characters',
  'queue panel',
  'searching',
  'ready-check overlay',
  'room panel',
  'revoke agent',
] as const;
type ScreenName = (typeof SCREENS)[number];

function screenNamed(name: string): ScreenName {
  const found = SCREENS.find((screen) => screen === name);
  if (found === undefined) {
    throw new Error(`the scenarios name no screen "${name}"`);
  }
  return found;
}

/** The element that shows each screen, by structure only: the same in English and in Portuguese. */
const SCREEN_MARK: Readonly<Record<ScreenName, string>> = {
  'signed out': '.sign-in',
  'signed in home': '.presence',
  pairing: '.pairing',
  characters: '.chars',
  'queue panel': '.queue-panel',
  searching: '.search-panel',
  'ready-check overlay': '.rc',
  'room panel': '.room-panel',
  'revoke agent': '.presence button.bad',
};

/** A second character the agent read and the player has not declared: it makes the characters screen show the form. */
const UNDECLARED: QueueCharacter = { ...SORC_OF_ALICE, name: 'Hammer', class: 'warlock' };

/** Pairs an agent for the player and has it report online. */
async function pairedOnline(world: World, name: string): Promise<void> {
  const agent = await world.pairAgent(name);
  const online = await agent.heartbeat(ONLINE);
  expect(online.status, 'the first heartbeat is accepted').toBe(204);
}

/** The backend state of a screen: what the player has done before opening the site. */
async function prepareScreen(world: World, screen: ScreenName): Promise<void> {
  switch (screen) {
    case 'signed out':
      return;
    case 'pairing':
      await world.sessionOf('Alice');
      return;
    case 'signed in home':
    case 'revoke agent':
      await pairedOnline(world, 'Alice');
      return;
    case 'characters': {
      await readyPlayer(world, 'Alice', SORC_OF_ALICE, 'stream');
      // A second reading that the player has not declared yet.
      const reading = {
        name: UNDECLARED.name,
        class: UNDECLARED.class,
        level: UNDECLARED.level,
        hardcore: UNDECLARED.hardcore,
        unlockedDifficulties: UNDECLARED.unlockedDifficulties,
      };
      const sent = await world.currentAgentOf('Alice').send('/v1/me/characters', {
        method: 'POST',
        body: { characters: [reading] },
      });
      expect(sent.status, 'the second reading').toBe(204);
      return;
    }
    case 'queue panel':
      await readyPlayer(world, 'Alice', SORC_OF_ALICE, 'stream');
      return;
    case 'searching':
      await readyPlayer(world, 'Alice', SORC_OF_ALICE, 'stream');
      await joinDuel(world, 'Alice', 'Sorc');
      return;
    case 'ready-check overlay':
    case 'room panel': {
      await readyPlayer(world, 'Alice', SORC_OF_ALICE, 'stream');
      await readyPlayer(world, 'Bob', { ...SORC_OF_ALICE, name: 'Sorc' }, 'stream');
      await joinDuel(world, 'Alice', 'Sorc');
      await joinDuel(world, 'Bob', 'Sorc');
      const check = await rememberCheck(world, 'Alice');
      if (screen === 'room panel') {
        for (const name of ['Alice', 'Bob']) {
          await answerAs(world, name, check?.id ?? '', 'accept');
          expect(world.last?.status, `${name} accepts`).toBe(204);
        }
        await expect
          .poll(async () => (await roomOf(world, 'Alice'))?.roomId ?? null, { timeout: API_WAIT_MS })
          .not.toBeNull();
      }
      return;
    }
  }
}

/** A join for the GM duel on Hell in the Americas, which must be accepted. */
async function joinDuel(world: World, name: string, character: string): Promise<void> {
  await joinAs(world, name, 'PvP', character, 'Hell', 'Americas', { format: 'duel', rules: 'gm' });
  expect(world.last?.status, `${name} joins the duel queue`).toBe(201);
}

/** Opens the site as Alice (or signed out) and brings the screen up. */
async function openScreen(world: World, screen: ScreenName): Promise<Page> {
  const visitor = await world.newVisitor();
  if (screen !== 'signed out') {
    world.pendingSessionCookie = await world.sessionOf('Alice');
  }
  try {
    await world.openSite(visitor);
  } finally {
    world.pendingSessionCookie = undefined;
  }
  const page = visitor.page;
  if (screen === 'revoke agent') {
    // The confirmation is the screen: its button is the first mark; the revoke button opens it.
    await page.locator('.presence button.quiet').click();
  }
  await expect(page.locator(SCREEN_MARK[screen]).first(), `the "${screen}" screen`).toBeVisible({
    timeout: API_WAIT_MS,
  });
  return page;
}

Given(/^a player who can reach the "([^"]+)" screen$/, async ({ world, scenario }, name: string) => {
  const screen = screenNamed(name);
  scenario.values.set('screen', screen);
  await prepareScreen(world, screen);
});

Given(
  /^a player whose site language is Portuguese and who can reach the "([^"]+)" screen$/,
  async ({ world, scenario }, name: string) => {
    const screen = screenNamed(name);
    world.locale = 'pt-BR';
    scenario.values.set('screen', screen);
    await prepareScreen(world, screen);
  },
);

When(/^the player opens the "([^"]+)" screen$/, async ({ world }, name: string) => {
  await openScreen(world, screenNamed(name));
});

Then('the accessibility scan finds no WCAG 2.1 A or AA violation', async ({ world }) => {
  const page = world.currentVisitor.page;
  // No rule is disabled and nothing is excluded: a violation is fixed in the screen (the spec's decisions).
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const report = result.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? 'no impact'}): ${violation.help}\n` +
      violation.nodes.map((node) => `  ${node.target.join(' ')}: ${node.failureSummary ?? ''}`).join('\n'),
  );
  expect(report, 'accessibility violations').toStrictEqual([]);
});

/** Every string a page shows: its leaf elements' text and the attributes a screen reader reads. */
async function shownTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const texts = new Set<string>();
    for (const element of Array.from(document.body.querySelectorAll('*'))) {
      if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(element.tagName)) {
        continue;
      }
      if (element.children.length === 0) {
        const text = (element.textContent ?? '').replace(/\s+/gu, ' ').trim();
        if (text !== '') {
          texts.add(text);
        }
      }
      for (const attribute of ['aria-label', 'title', 'placeholder', 'alt']) {
        const value = element.getAttribute(attribute)?.trim();
        if (value) {
          texts.add(value);
        }
      }
    }
    return [...texts];
  });
}

Then('the screen shows no untranslated key and no English source string', async ({ world }) => {
  const page = world.currentVisitor.page;
  await expect(page.locator('html'), 'the page is in Portuguese').toHaveAttribute('lang', /^pt/u);
  const { en, ptBR } = siteCatalogues();
  const shown = await shownTexts(page);
  expect(shownKeys(shown, en), 'catalogue keys shown as they are').toStrictEqual([]);
  expect(shownEnglish(shown, en, ptBR), 'English source strings shown').toStrictEqual([]);
});

// --- J1 (JRN-01, JRN-03) ---------------------------------------------------------------------------------------------

export interface HeadlessPlayer {
  readonly agent: HeadlessAgent;
  readonly png: string;
}

interface JourneyState {
  dir?: string;
  headless: Map<string, HeadlessPlayer>;
  /** The reading under way: whose agent read, and how many observations it had sent before. */
  reader?: { readonly who: string; readonly before: number };
}

const states = new WeakMap<World, JourneyState>();

function stateOf(world: World): JourneyState {
  let state = states.get(world);
  if (state === undefined) {
    state = { headless: new Map() };
    states.set(world, state);
  }
  return state;
}

export function pageOf(world: World, who: string): Page {
  const page = world.player(who).visitor?.page;
  if (page === undefined) {
    throw new Error(`${who} has no site open in this scenario`);
  }
  return page;
}

export function headlessOf(world: World, who: string): HeadlessPlayer {
  const found = stateOf(world).headless.get(who);
  if (found === undefined) {
    throw new Error(`${who}'s headless agent is not running in this scenario`);
  }
  return found;
}

/** The members of the room, in the API's reading, with the name of the player each one is. */
async function hostAndMember(world: World): Promise<{ host: Who; member: Who; gameName: string }> {
  // The room opens once the last member accepted (the hotkey's accept lands asynchronously).
  await expect
    .poll(async () => (await roomOf(world, 'Alice'))?.roomId ?? null, {
      timeout: API_WAIT_MS,
      message: "Alice's room",
    })
    .not.toBeNull();
  const room = await roomOf(world, 'Alice');
  if (room === null) {
    throw new Error('Alice has no room');
  }
  const hostId = room.members.find((member) => member.role === 'host')?.accountId;
  const host = WHO.find((who) => world.player(who).accountId === hostId);
  if (host === undefined) {
    throw new Error('the host of the room is neither Alice nor Bob');
  }
  return { host, member: host === 'Alice' ? 'Bob' : 'Alice', gameName: room.expectedGameName };
}

Given('Alice and Bob sign in with Battle.net on the site', async ({ world }) => {
  for (const who of WHO) {
    world.stack.battleNet.willSignIn(BATTLETAG[who]);
    const visitor = await newVisitorSignedInWithBattleNet(world);
    const player = world.player(who);
    player.visitor = visitor;
    player.session = await sessionValueOf(world, visitor);
    player.accountId = await accountOfVisitor(visitor);
    world.lastOwner = who;
    await expect(visitor.page.getByText(`Signed in as ${who}`, { exact: true })).toBeVisible();
  }
});

Given(
  'each pairs a headless agent that registers a level 90 sorceress on ladder softcore Reign of the Warlock',
  async ({ world }) => {
    test.setTimeout(HEADLESS_START_TIMEOUT_MS);
    await HeadlessAgent.build();
    for (const who of WHO) {
      await pairHeadless(world, who, SORCERESS);
    }
  },
);

/**
 * Registers the player's character through the agent contract's simulated agent, then pairs a headless agent, which replaces
 * it as the player's paired agent (a second pairing revokes the first). The headless example reads the Party panel only, so
 * the character reading comes from the simulated agent.
 */
export async function pairHeadless(world: World, who: string, character: QueueCharacter): Promise<void> {
  const state = stateOf(world);
  state.dir ??= mkdtempSync(path.join(tmpdir(), 'd2rmm-journey-'));
  const simulated = await world.pairAgent(who);
  expect((await simulated.heartbeat(ONLINE)).status, 'the first heartbeat is accepted').toBe(204);
  await registerCharacter(world, who, character);
  const fixture = preparePartyFixture(mkdtempSync(path.join(state.dir, `${who}-`)), {
    gameNameField: MASKED,
  });
  const agent = HeadlessAgent.start({
    apiBase: world.site.api,
    fixture: fixture.png,
    party: true,
    agentVersion: AGENT_VERSION,
  });
  state.headless.set(who, { agent, png: fixture.png });
  const shown = await agent.waitFor('code', HEADLESS_START_TIMEOUT_MS);
  const paired = await submitPairingCode(world.site, await world.sessionOf(who), String(shown['code']));
  expect(paired.status, `pairing the headless agent of ${who}`).toBe(200);
  await agent.waitFor('paired');
  const replaced = world.player(who).agents;
  world.paired.splice(0, world.paired.length, ...world.paired.filter((item) => !replaced.includes(item)));
  // The queue needs the agent online: the headless agent heartbeats from its first seconds.
  await expect
    .poll(async () => (await world.presenceOf(who)).body, {
      timeout: API_WAIT_MS,
      message: `the headless agent of ${who} is online`,
    })
    .toMatchObject({ status: 'paired', online: true });
}

When('Alice and Bob join the PvP queue for a GM duel on Hell in the Americas', async ({ world }) => {
  // Alice joins first, so she is the oldest ticket and hosts (QUE-12).
  await joinDuel(world, 'Alice', 'Sorc');
  await joinDuel(world, 'Bob', 'Sorc');
});

/** The ready check overlay of a player's page. */
function overlayOf(world: World, who: Who): Locator {
  return pageOf(world, who).getByRole('dialog', { name: 'Ready check', exact: true });
}

When('the ready check opens for both', async ({ world }) => {
  for (const who of WHO) {
    await expect(overlayOf(world, who), `${who}'s site shows the ready check`).toBeVisible({
      timeout: API_WAIT_MS,
    });
  }
  await rememberCheck(world, 'Alice');
});

When("Bob accepts with the agent's hotkey", ({ world }) => {
  headlessOf(world, 'Bob').agent.hotkey();
});

Then(
  /^both sites show a room with a host, a game name starting with "([^"]+)" and "([^"]+)"$/,
  async ({ world }, prefix: string, noPassword: string) => {
    const { gameName } = await hostAndMember(world);
    for (const who of WHO) {
      const page = pageOf(world, who);
      await expect(page.locator('.room-panel'), `${who}'s room panel`).toBeVisible({ timeout: API_WAIT_MS });
      await expect(page.locator('.room-panel code.credential'), `${who}'s game name`).toHaveText(gameName);
      expect(gameName.startsWith(prefix), `the game name ${gameName} starts with ${prefix}`).toBe(true);
      await expect(page.locator('.room-panel').getByText(noPassword, { exact: true })).toBeVisible();
      await expect(
        page.getByRole('list', { name: 'Members', exact: true }).getByText('Host', { exact: true }),
        `${who} sees a host`,
      ).toBeVisible();
    }
    const room = await roomOf(world, 'Alice');
    expect(room?.password, 'the room has no password').toBe('');
  },
);

/** A reader's agent shows the room's name in its Party panel; the agent reads it on its next capture. */
async function reveal(world: World, who: string): Promise<void> {
  const { gameName } = await hostAndMember(world);
  const { agent, png } = headlessOf(world, who);
  // The agent holds the assignment before its Party step reads for the room.
  await agent.waitFor('assignment', 45_000, (item) => item['room'] === gameName);
  const before = agent.observedTimes().length;
  setPartyPanel(png, { gameNameField: gameName });
  stateOf(world).reader = { who, before };
}

When("the host's agent reads the game name in the Party panel", async ({ world }) => {
  await reveal(world, (await hostAndMember(world)).host);
});

When("the other member's agent reads the game name in the Party panel", async ({ world }) => {
  await reveal(world, (await hostAndMember(world)).member);
});

/** The step of the stepper the room is in. */
export function currentStep(page: Page): Locator {
  return page.getByRole('list', { name: 'Room stages', exact: true }).locator('li[aria-current="step"]');
}

Then(
  /^both sites show the room as (Created|Active) within 2 seconds(, with both members confirmed by their agents)?$/,
  async ({ world }, label: string, both: string | null | undefined) => {
    const reading = stateOf(world).reader;
    if (reading === undefined) {
      throw new Error('no agent has read the Party panel in this scenario');
    }
    const agent = headlessOf(world, reading.who).agent;
    await expect
      .poll(() => agent.observedTimes().length, {
        timeout: API_WAIT_MS,
        message: `an observation of ${reading.who}'s agent`,
      })
      .toBeGreaterThan(reading.before);
    // NFR-01 on the real clock: from the moment the API accepted the agent's observation to the page showing it.
    const requestedAt = agent.observedTimes()[reading.before] ?? Date.now();
    const confirmed = both ? 2 : 1;
    await Promise.all(
      WHO.map(async (who) => {
        const page = pageOf(world, who);
        const left = () => Math.max(1, requestedAt + SITE_LIMIT_MS - Date.now());
        await expect(currentStep(page), `${who}'s room as ${label}`).toHaveText(label, { timeout: left() });
        await expect(
          page
            .getByRole('list', { name: 'Members', exact: true })
            .getByRole('listitem')
            .filter({ hasText: 'Confirmed by the agent' }),
          `${who} sees ${confirmed} member(s) confirmed`,
        ).toHaveCount(confirmed, { timeout: left() });
      }),
    );
  },
);

After({ tags: '@JRN-01 or @JRN-02' }, async ({ world }) => {
  const state = states.get(world);
  for (const player of state?.headless.values() ?? []) {
    await player.agent.stop();
  }
  if (state?.dir !== undefined) {
    rmSync(state.dir, { recursive: true, force: true });
  }
  states.delete(world);
});

// --- J1 by keyboard alone (JRN-06) -----------------------------------------------------------------------------------

/** What the keyboard walk met: every control the focus stopped on, and whether it showed a focus. */
interface FocusStop {
  readonly control: string;
  readonly visible: boolean;
}

interface KeyboardState {
  readonly stops: FocusStop[];
  copied?: string;
  roomName?: string;
}

const keyboards = new WeakMap<World, KeyboardState>();

function keyboardOf(world: World): KeyboardState {
  let state = keyboards.get(world);
  if (state === undefined) {
    state = { stops: [] };
    keyboards.set(world, state);
  }
  return state;
}

/** Describes the focused element and tells whether a focus ring shows on it (or, for a hidden radio, on its label). */
function readFocus(page: Page): Promise<FocusStop> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (element === null || element === document.body) {
      return { control: 'nothing', visible: false };
    }
    const rings = (node: Element): boolean => {
      const style = getComputedStyle(node);
      return (
        style.outlineStyle !== 'none' &&
        parseFloat(style.outlineWidth) > 0 &&
        Number(style.opacity) > 0 &&
        style.visibility !== 'hidden'
      );
    };
    const label = element.closest('label');
    const visible = element.matches(':focus-visible') && (rings(element) || (label !== null && rings(label)));
    const name =
      element.getAttribute('aria-label') ?? (element.textContent ?? '').replace(/\s+/gu, ' ').trim();
    return { control: `${element.tagName.toLowerCase()} "${name.slice(0, 40)}"`, visible };
  });
}

/** Presses Tab until the control holds the focus; every stop on the way is recorded, the control's included. */
async function tabTo(world: World, page: Page, control: Locator): Promise<void> {
  const log = keyboardOf(world).stops;
  for (let press = 0; press < KEYBOARD_STOPS; press += 1) {
    if (await control.evaluate((element) => element === document.activeElement)) {
      log.push(await readFocus(page));
      return;
    }
    await page.keyboard.press('Tab');
    log.push(await readFocus(page));
  }
  throw new Error('the keyboard walk never reached the control');
}

Given('Alice and Bob have paired agents with registered characters', async ({ world }) => {
  for (const who of WHO) {
    const signedIn = await signInWithBattleNetThroughApi(world.site, world.stack.battleNet, BATTLETAG[who]);
    const player = world.player(who);
    player.accountId = signedIn.accountId;
    player.session = signedIn.session;
    await pairedOnline(world, who);
    await registerCharacter(world, who, SORCERESS);
  }
  // Bob keeps his site open as a stream; Alice opens hers in the browser, by keyboard.
  await world.siteStreamOf('Bob');
});

When(
  'Alice signs in, joins the PvP queue, accepts the ready check and copies the game name using only the keyboard',
  async ({ world }) => {
    const keyboard = keyboardOf(world);
    const visitor: Visitor = await world.newVisitor();
    await visitor.context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: world.site.site,
    });
    await world.openSite(visitor);
    world.player('Alice').visitor = visitor;
    const page = visitor.page;

    // Sign in with Battle.net.
    world.stack.battleNet.willSignIn(BATTLETAG.Alice);
    const signedIn = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/me');
    await tabTo(world, page, page.getByRole('link', { name: 'Sign in with Battle.net', exact: true }));
    await page.keyboard.press('Enter');
    await signedIn;
    await expect(page.getByText('Signed in as Alice', { exact: true })).toBeVisible();

    // Choose the duel: PvP, the character, Hell, the region, the format and the rules, then Find match.
    await tabTo(world, page, page.getByRole('button', { name: 'PvP', exact: true }));
    await page.keyboard.press('Enter');
    await tabTo(world, page, page.getByRole('combobox', { name: 'Character' }));
    await tabTo(world, page, page.getByRole('radio', { name: /Normal/u }));
    // Arrow keys move the choice inside a radio group: Normal, Nightmare, Hell.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    keyboard.stops.push(await readFocus(page));
    await expect(page.getByRole('radio', { name: /Hell/u }), 'Hell is chosen').toBeChecked();
    for (const choice of ['Americas', 'Duel', 'GM']) {
      await tabTo(world, page, page.getByRole('radio', { name: choice, exact: true }));
    }
    await tabTo(world, page, page.getByRole('button', { name: 'Find match', exact: true }));
    await page.keyboard.press('Enter');
    await expect(page.locator('.search-panel'), 'Alice is searching').toBeVisible({ timeout: API_WAIT_MS });

    // Bob joins behind her and accepts through the API; the ready check opens for both.
    await joinDuel(world, 'Bob', 'Sorc');
    const dialog = page.getByRole('dialog', { name: 'Ready check', exact: true });
    await expect(dialog, "Alice's ready check").toBeVisible({ timeout: API_WAIT_MS });
    const check = await rememberCheck(world, 'Bob');
    await answerAs(world, 'Bob', check?.id ?? '', 'accept');
    expect(world.last?.status, 'Bob accepts').toBe(204);

    // The focus is on Accept as the check opens (RDY-08): Enter accepts.
    const accept = dialog.getByRole('button', { name: 'Accept', exact: true });
    await expect(accept).toBeFocused();
    keyboard.stops.push(await readFocus(page));
    await page.keyboard.press('Enter');

    // The room: Tab to "Copy game name" and press Enter.
    await expect(page.locator('.room-panel'), "Alice's room").toBeVisible({ timeout: API_WAIT_MS });
    await tabTo(world, page, page.getByRole('button', { name: 'Copy game name', exact: true }));
    await page.keyboard.press('Enter');
    await expect(page.getByText('Game name copied.', { exact: true })).toBeVisible();
    keyboard.copied = await page.evaluate(() => navigator.clipboard.readText());
    keyboard.roomName = (await roomOf(world, 'Alice'))?.expectedGameName ?? '';
  },
);

Then('every control she reached showed a visible focus', ({ world }) => {
  const stops = keyboardOf(world).stops;
  expect(stops.length, 'the walk reached controls').toBeGreaterThan(0);
  expect(
    stops.filter((stop) => !stop.visible).map((stop) => stop.control),
    'controls reached with no visible focus',
  ).toStrictEqual([]);
});

Then("the copied game name is the room's name", ({ world }) => {
  const keyboard = keyboardOf(world);
  expect(keyboard.roomName, "the room's name").toMatch(/^mmpvph-\d+$/u);
  expect(keyboard.copied, 'the clipboard').toBe(keyboard.roomName);
});

After({ tags: '@JRN-06' }, ({ world }) => {
  keyboards.delete(world);
});
