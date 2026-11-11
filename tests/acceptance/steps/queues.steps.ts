// Queues steps (QUE-01 … QUE-15): players join and leave the PvP and leveling queues with the characters their agents
// registered, wait on the stack's clock, and are grouped into rooms. Black box: HTTP with the session cookie, the agent's
// own contract, and the browser for the site. The generic answer "the API answers "<code>"" is the identity steps'.
import { MyCharactersResponse, MyQueueTicketResponse, RoomView } from '@d2rmm/contracts';
import { expect, type Locator, type Page } from '@playwright/test';
import type { DataTable } from 'playwright-bdd';
import { Given, Then, When } from '../fixtures.ts';
import type { GameState, SimulatedAgent } from '../support/agent-client.ts';
import { SESSION_COOKIE, type World } from '../support/world.ts';

/** The agents heartbeat this often while the clock moves (a real agent reports every 15 seconds, AWS-15). */
const HEARTBEAT_EVERY_MS = 15_000;
/** The state a queued player's agent reports: the game open, on the character selection screen. */
const ONLINE: GameState = { running: true, screen: 'CHARACTER_SELECT' };
/** Tab presses a keyboard walk may take before the control must hold the focus. */
const KEYBOARD_STOPS = 60;
/** The 9-player leveling scenario's players, in join order: the teleporter, the BO, then the killers. */
const TELEPORTER = 'Tele';
const BO = 'Bo';
const KILLERS = ['KillA', 'KillB', 'KillC', 'KillD', 'KillE', 'KillF', 'KillG'] as const;
/** The answer of the last request a queue step made, for the "API answers" and "API refuses" steps. */
function record(world: World, status: number, body: unknown): void {
  world.last = { status, body };
}

/** The session cookie header of the player, for a request the player makes. */
async function sessionHeader(world: World, name: string): Promise<Record<string, string>> {
  return { Cookie: `${SESSION_COOKIE}=${await world.sessionOf(name)}` };
}

/** The player's characters as the API lists them (`GET /v1/me/characters`). */
async function charactersOf(world: World, name: string) {
  const response = await fetch(`${world.site.api}/v1/me/characters`, {
    headers: await sessionHeader(world, name),
    signal: AbortSignal.timeout(10_000),
  });
  expect(response.status, `${name}'s character list`).toBe(200);
  return MyCharactersResponse.parse(await response.json()).characters;
}

/** The id of the player's character with this name, ignoring case. */
async function characterIdOf(world: World, name: string, characterName: string): Promise<string> {
  const found = (await charactersOf(world, name)).find(
    (character) => character.name.toLowerCase() === characterName.toLowerCase(),
  );
  if (found === undefined) {
    throw new Error(`${name} has no character named "${characterName}"`);
  }
  return found.id;
}

/** The player's waiting ticket, or null (`GET /v1/queue/tickets/me`). */
async function ticketOf(world: World, name: string) {
  const response = await fetch(`${world.site.api}/v1/queue/tickets/me`, {
    headers: await sessionHeader(world, name),
    signal: AbortSignal.timeout(10_000),
  });
  expect(response.status, `${name}'s ticket answer`).toBe(200);
  return MyQueueTicketResponse.parse(await response.json()).ticket;
}

/** The player's room as the API reads it (`GET /v1/me/room`), or null when the player has none. */
async function roomOf(world: World, name: string) {
  const response = await fetch(`${world.site.api}/v1/me/room`, {
    headers: await sessionHeader(world, name),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) {
    return null;
  }
  expect(response.status, `${name}'s room answer`).toBe(200);
  return RoomView.parse(await response.json());
}

/** The options of a join, as the scenarios write them (`for a GM duel`, `for Chaos as a killer with minimum level 40`). */
function joinOptionsOf(mode: 'PvP' | 'leveling', words: string): Record<string, unknown> {
  if (mode === 'PvP') {
    const duel = /^for a (GM|BM) duel$/.exec(words);
    if (duel === null) {
      throw new Error(`the scenarios use no PvP option "${words}"`);
    }
    return { format: 'duel', rules: (duel[1] ?? 'GM').toLowerCase() };
  }
  const leveling = /^for (\w+) as a (\w+) with minimum level (\d+)$/.exec(words);
  if (leveling === null) {
    throw new Error(`the scenarios use no leveling option "${words}"`);
  }
  return {
    activity: (leveling[1] ?? '').toLowerCase(),
    role: (leveling[2] ?? '').toLowerCase(),
    minLevel: Number(leveling[3]),
  };
}

/** Sends a join as the player (`POST /v1/queue/tickets`) and keeps the answer for the "API answers" steps. */
async function joinAs(
  world: World,
  name: string,
  mode: 'PvP' | 'leveling',
  characterName: string,
  difficulty: string,
  region: string,
  options: Record<string, unknown>,
): Promise<void> {
  const body = {
    mode: mode === 'PvP' ? 'pvp' : 'leveling',
    characterId: await characterIdOf(world, name, characterName),
    difficulty: difficulty.toLowerCase(),
    region: region.toLowerCase(),
    ...options,
  };
  const response = await fetch(`${world.site.api}/v1/queue/tickets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: world.site.site,
      ...(await sessionHeader(world, name)),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const answer = { status: response.status, body: await response.json().catch(() => undefined) };
  record(world, answer.status, answer.body);
}

/**
 * Moves the stack's clock by `ms`, in steps that keep every paired agent reporting: an agent with no heartbeat for 45
 * seconds is offline (FR-31), and the scenario's clock is the one the players' waits are measured on.
 */
async function passTime(world: World, ms: number): Promise<void> {
  let left = ms;
  while (left > 0) {
    const step = Math.min(HEARTBEAT_EVERY_MS, left);
    await world.stack.advanceClock(step);
    left -= step;
    for (const agent of world.paired) {
      const answer = await agent.heartbeat(ONLINE);
      expect(answer.status, 'the heartbeat that keeps the agent online').toBe(204);
    }
  }
}

/** Opens the site in a new browser of the player, signed in with the player's session, and waits for the first view. */
async function openSiteFor(world: World, name: string): Promise<void> {
  const session = await world.sessionOf(name);
  const visitor = await world.newVisitor();
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

/** A character as a scenario states it: the reading the agent sends, and the ladder and era the player declares. */
interface QueueCharacter {
  readonly name: string;
  readonly class: string;
  readonly level: number;
  readonly hardcore: boolean;
  readonly unlockedDifficulties: readonly string[];
  readonly ladder: string;
  readonly era: string;
}

/** Registers the character as the player's agent reads it, then declares its ladder and era as the player (CHR-15). */
async function registerCharacter(world: World, name: string, character: QueueCharacter): Promise<void> {
  const { ladder, era, ...reading } = character;
  const registered = await world.currentAgentOf(name).send('/v1/me/characters', {
    method: 'POST',
    body: { characters: [reading] },
  });
  expect(registered.status, `the registration of ${character.name}`).toBe(204);
  const id = await characterIdOf(world, name, character.name);
  const declared = await fetch(`${world.site.api}/v1/me/characters/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Origin: world.site.site,
      ...(await sessionHeader(world, name)),
    },
    body: JSON.stringify({ ladder, era }),
    signal: AbortSignal.timeout(10_000),
  });
  expect(declared.status, `the declaration of ${character.name}`).toBe(204);
}

/** Pairs an agent for the player and has it report online, registers the character, and opens the player's site. */
async function readyPlayer(
  world: World,
  name: string,
  character: QueueCharacter,
  siteIn: 'browser' | 'stream',
): Promise<void> {
  const agent: SimulatedAgent = await world.pairAgent(name);
  const online = await agent.heartbeat(ONLINE);
  expect(online.status, 'the first heartbeat is accepted').toBe(204);
  await registerCharacter(world, name, character);
  if (siteIn === 'browser') {
    await openSiteFor(world, name);
  } else {
    await world.siteStreamOf(name);
  }
}

/** The character of a Background row: the words of the table, as the reading and the declaration need them. */
function characterOfRow(row: Record<string, string>): QueueCharacter {
  return {
    name: row['character'] ?? '',
    class: (row['class'] ?? '').toLowerCase(),
    level: Number(row['level']),
    hardcore: (row['mode'] ?? 'softcore').toLowerCase() === 'hardcore',
    unlockedDifficulties: (row['unlocked'] ?? '').split(/,\s*/).map((word) => word.trim().toLowerCase()),
    ladder: (row['ladder'] ?? 'ladder').toLowerCase(),
    era: (row['era'] ?? 'rotw').toLowerCase(),
  };
}

/** Presses Tab until the control holds the focus. Tab reaches a radio group only at its checked button; use `focus` for others. */
async function tabUntilFocused(page: Page, control: Locator): Promise<void> {
  for (let press = 0; press < KEYBOARD_STOPS; press += 1) {
    if (await control.evaluate((element) => element === document.activeElement)) {
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error('the keyboard walk never reached the control');
}

/** The page of the player's current browser visitor, which the site steps act on. */
function pageOf(world: World, name: string): Page {
  const page = world.player(name).visitor?.page;
  if (page === undefined) {
    throw new Error(`${name} has no site open`);
  }
  return page;
}

// --- Background ------------------------------------------------------------------------------------------------------

Given(
  'these players are ready to queue, each signed in with the site open and an online agent',
  async ({ world }, table: DataTable) => {
    for (const row of table.hashes()) {
      await readyPlayer(world, row['player'] ?? '', characterOfRow(row), 'browser');
    }
  },
);

// --- Entry (QUE-01 … QUE-06) -----------------------------------------------------------------------------------------

// One definition serves "joins" and "has joined", on the PvP and the leveling queue (the keyword does not match).
When(
  /^(\w+) (?:joins|has joined) the (PvP|leveling) queue with "([^"]+)" on (\w+) in (?:the )?(\w+) (for .+)$/,
  async (
    { world },
    name: string,
    mode: string,
    characterName: string,
    difficulty: string,
    region: string,
    options: string,
  ) => {
    const queueMode = mode as 'PvP' | 'leveling';
    await joinAs(
      world,
      name,
      queueMode,
      characterName,
      difficulty,
      region,
      joinOptionsOf(queueMode, options),
    );
  },
);

Then('the API answers 201 with a waiting ticket', ({ world }) => {
  expect(world.last?.status, 'the join answer').toBe(201);
  expect((world.last?.body as { status?: string } | undefined)?.status, 'the ticket').toBe('waiting');
});

Then(/^the API refuses with "([^"]+)"$/, ({ world }, reason: string) => {
  expect([409, 422], 'a refusal answers 409 or 422').toContain(world.last?.status);
  expect((world.last?.body as { error?: string } | undefined)?.error, 'the refusal reason').toBe(reason);
});

Then(/^(\w+) holds no ticket$/, async ({ world }, name: string) => {
  await expect.poll(async () => ticketOf(world, name), { message: `${name} holds no ticket` }).toBeNull();
});

// QUE-05: the agent has not reported for 45 seconds, so it is offline when the player joins.
Given(/^\w+ has her agent offline$/, async ({ world }) => {
  await world.stack.advanceClock(45_000);
});

// QUE-05: the player's browser and stream are gone, so the API sees no open site when the player joins.
Given(/^(\w+) has closed the site$/, async ({ world }, name: string) => {
  const player = world.player(name);
  player.stream?.close();
  // Closing the context ends every connection the browser holds, the site's stream included.
  await player.visitor?.context.close();
  // Chromium can keep the site's stream open after its context closed, so the API may still count it. The API's own
  // control closes the account's site streams the way a dropped connection does (test-controls.ts), and the step
  // checks the count: the site is closed at the API before the player joins.
  expect(player.accountId, `${name} has an account`).toBeDefined();
  await world.stack.closeSiteStreams(player.accountId ?? '');
  expect(await world.stack.siteStreamCount(player.accountId ?? ''), `${name}'s site is closed`).toBe(0);
});

When('Alice leaves the queue', async ({ world }) => {
  const ticket = await ticketOf(world, 'Alice');
  expect(ticket, 'Alice holds a ticket to leave').not.toBeNull();
  const response = await fetch(`${world.site.api}/v1/queue/tickets/${ticket?.id ?? ''}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Origin: world.site.site,
      ...(await sessionHeader(world, 'Alice')),
    },
    body: '{}',
    signal: AbortSignal.timeout(10_000),
  });
  record(world, response.status, undefined);
});

// --- Matching (QUE-07 … QUE-12) --------------------------------------------------------------------------------------

When(/^(\d+) (seconds|minutes) pass$/, async ({ world }, amount: string, unit: string) => {
  await passTime(world, Number(amount) * (unit === 'minutes' ? 60_000 : 1_000));
});

Then(/^(\w+) and (\w+) are still waiting$/, async ({ world }, first: string, second: string) => {
  for (const name of [first, second]) {
    expect((await ticketOf(world, name))?.status, `${name} still waits`).toBe('waiting');
  }
});

Then(
  /^(\w+)'s ticket shows a band of (\d+) to (\d+)$/,
  async ({ world }, name: string, low: string, high: string) => {
    expect((await ticketOf(world, name))?.band, `${name}'s band`).toStrictEqual({
      low: Number(low),
      high: Number(high),
    });
  },
);

Then(
  /^within 2 seconds (\w+) and (\w+) are no longer queued$/,
  async ({ world }, first: string, second: string) => {
    for (const name of [first, second]) {
      await expect
        .poll(async () => ticketOf(world, name), { timeout: 2_000, message: `${name} is grouped` })
        .toBeNull();
    }
  },
);

Then(
  /^(\w+) and (\w+) are members of the same room, with (\w+) as host$/,
  async ({ world }, first: string, second: string, host: string) => {
    await expect
      .poll(async () => (await roomOf(world, first)) !== null, {
        timeout: 5_000,
        message: 'a room for the group',
      })
      .toBe(true);
    const firstRoom = await roomOf(world, first);
    const secondRoom = await roomOf(world, second);
    expect(secondRoom?.roomId, 'the same room').toBe(firstRoom?.roomId);
    expect(firstRoom?.members.find((member) => member.role === 'host')?.accountId, 'the host').toBe(
      world.player(host).accountId,
    );
  },
);

// QUE-10: nine more players pair, so the pairing hour passes once first (AWS-09 limits codes per address per hour).
Given(
  /^(\d+) players with Hell characters at level (\d+) have joined the leveling queue for (\w+) in the Americas, one as teleporter, one as BO and the rest as killers$/,
  async ({ world }, _count: string, level: string, activity: string) => {
    await passTime(world, 60 * 60 * 1_000);
    const players = [
      { name: TELEPORTER, role: 'teleporter' },
      { name: BO, role: 'bo' },
      ...KILLERS.map((name) => ({ name, role: 'killer' })),
    ];
    for (const player of players) {
      await readyPlayer(
        world,
        player.name,
        {
          name: player.name,
          class: 'sorceress',
          level: Number(level),
          hardcore: false,
          unlockedDifficulties: ['normal', 'nightmare', 'hell'],
          ladder: 'ladder',
          era: 'rotw',
        },
        'stream',
      );
    }
    for (const player of players) {
      await joinAs(world, player.name, 'leveling', player.name, 'hell', 'americas', {
        activity: activity.toLowerCase(),
        role: player.role,
        minLevel: 70,
      });
      expect(world.last?.status, `${player.name} joins the leveling queue`).toBe(201);
    }
  },
);

When('the matcher runs', async ({ world }) => {
  // The matcher runs on every join and every second: a second of the clock is the tick that forms the group.
  await passTime(world, 1_000);
});

Then(
  /^a group of (\d+) forms with the teleporter as host and the BO in it$/,
  async ({ world }, size: string) => {
    await expect
      .poll(async () => (await roomOf(world, TELEPORTER))?.members.length ?? 0, {
        timeout: 5_000,
        message: 'the group',
      })
      .toBe(Number(size));
    const room = await roomOf(world, TELEPORTER);
    expect(room?.members.find((member) => member.role === 'host')?.accountId, 'the teleporter hosts').toBe(
      world.player(TELEPORTER).accountId,
    );
    expect(
      room?.members.map((member) => member.accountId),
      'the BO is in the group',
    ).toContain(world.player(BO).accountId);
  },
);

// --- Leaving (QUE-14) ------------------------------------------------------------------------------------------------

// Nothing reports while the clock moves: the presence goes offline, and the ticket leaves the queue (QUE-14).
When(/^\w+'s agent stops sending heartbeats for (\d+) seconds$/, async ({ world }, seconds: string) => {
  await world.stack.advanceClock(Number(seconds) * 1_000);
});

Then(/^(\w+)'s site shows "([^"]+)"$/, async ({ world }, name: string, text: string) => {
  await expect(pageOf(world, name).getByText(text, { exact: true }), `"${text}" on the site`).toBeVisible({
    timeout: 5_000,
  });
});

// --- Site (QUE-15) ---------------------------------------------------------------------------------------------------

When(
  /^(\w+) opens the site and, using only the keyboard, chooses (PvP|leveling), "([^"]+)" and the (\w+)$/,
  async ({ world }, name: string, mode: string, characterName: string, region: string) => {
    await openSiteFor(world, name);
    const page = pageOf(world, name);
    await tabUntilFocused(page, page.getByRole('button', { name: mode, exact: true }));
    await page.keyboard.press('Enter');
    await tabUntilFocused(page, page.getByRole('combobox', { name: 'Character' }));
    for (const letter of characterName) {
      await page.keyboard.press(letter);
    }
    await tabUntilFocused(page, page.getByRole('radio', { name: region, exact: true }));
    await page.keyboard.press('Space');
  },
);

Then(
  /^(Normal|Nightmare|Hell) is disabled with "([^"]+)"$/,
  async ({ world }, difficulty: string, text: string) => {
    const page = world.currentVisitor.page;
    await expect(
      page.getByRole('radio', { name: new RegExp(difficulty, 'u') }),
      `${difficulty} is disabled`,
    ).toBeDisabled();
    await expect(page.getByText(text, { exact: true }), `"${text}" beside ${difficulty}`).toBeVisible();
  },
);

When(
  /^(\w+) chooses (Normal|Nightmare|Hell), a (GM|BM) duel and "Find match"$/,
  async ({ world }, name: string, difficulty: string, rules: string) => {
    const page = pageOf(world, name);
    await page.getByRole('radio', { name: new RegExp(difficulty, 'u') }).focus();
    await page.keyboard.press('Space');
    await page.getByRole('radio', { name: rules, exact: true }).focus();
    await page.keyboard.press('Space');
    await tabUntilFocused(page, page.getByRole('button', { name: 'Find match', exact: true }));
    await page.keyboard.press('Enter');
  },
);

Then('within 2 seconds the site shows the time waited, the band and "Leave queue"', async ({ world }) => {
  const page = world.currentVisitor.page;
  await expect(page.getByText(/^Waited \d+:\d{2}$/u)).toBeVisible({ timeout: 2_000 });
  await expect(page.getByText(/^Rating band \d+ to \d+$/u)).toBeVisible({ timeout: 2_000 });
  await expect(page.getByRole('button', { name: 'Leave queue', exact: true })).toBeVisible({
    timeout: 2_000,
  });
});
