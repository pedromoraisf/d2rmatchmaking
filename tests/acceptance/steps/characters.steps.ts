// Characters steps (CHR-05, CHR-09 to CHR-12): the agent reports the screen the game is on and the characters it reads,
// over HTTP with its token, as the real agent does; the site shows the screen, the characters and the presence. Black
// box: the browser and HTTP only. The screen reading of the agent itself is `characters-reading` (split).
import { MyCharactersResponse } from '@d2rmm/contracts';
import { expect } from '@playwright/test';
import { Given, Then, When } from '../fixtures.ts';
import type { HttpAnswer, Screen } from '../support/agent-client.ts';
import { SESSION_COOKIE, type World } from '../support/world.ts';

/** The screens the scenarios name: the heartbeat screen, and the label the site shows after "Screen: ". */
const SCREENS: Readonly<Record<string, { screen: Screen; label: string }>> = {
  'character selection': { screen: 'CHARACTER_SELECT', label: 'Character selection' },
  'in game': { screen: 'IN_GAME', label: 'In game' },
  automap: { screen: 'AUTOMAP_OPEN', label: 'Automap open' },
  unknown: { screen: 'UNKNOWN', label: 'Unknown' },
};

/** The mode, ladder and era words of the scenarios, as the site shows them and as the contract names them. */
const MODE_VALUE: Readonly<Record<string, string>> = { softcore: 'sc', hardcore: 'hc' };
const MODE_TEXT: Readonly<Record<string, string>> = { softcore: 'Softcore', hardcore: 'Hardcore' };
const LADDER_VALUE: Readonly<Record<string, string>> = { ladder: 'ladder', 'non-ladder': 'nonladder' };
const LADDER_TEXT: Readonly<Record<string, string>> = { ladder: 'Ladder', 'non-ladder': 'Non-ladder' };
const ERA_VALUE: Readonly<Record<string, string>> = {
  classic: 'classic',
  expansion: 'lod',
  'reign of the warlock': 'rotw',
};
const ERA_TEXT: Readonly<Record<string, string>> = {
  classic: 'Classic',
  expansion: 'Expansion',
  'reign of the warlock': 'Reign of the Warlock',
};

/** How many Tab presses the keyboard walk may take before the character list must hold the focus. */
const KEYBOARD_STOPS = 60;
/** Letters for the 25 names of the batch that is one too many (the contract allows 1 to 24). */
const LETTERS = 'abcdefghijklmnopqrstuvwxy';
/** The character the registration scenarios register unless a step changes one of its fields. */
const BASE_CHARACTER = {
  name: 'Sorc',
  class: 'sorceress',
  level: 85,
  ladder: 'sc-ladder',
  era: 'lod',
  unlockedDifficulties: ['normal', 'nightmare'],
} as const;

/** The value a scenario word stands for, or a loud failure when the scenarios use a word the suite does not know. */
function wordValue<T>(table: Readonly<Record<string, T>>, word: string, what: string): T {
  const value = table[word];
  if (value === undefined) {
    throw new Error(`the scenarios use no ${what} "${word}"`);
  }
  return value;
}

/** "Normal, Nightmare and Hell" or "Normal and Hell" as the difficulty values of the contract, in the order written. */
function difficultyList(text: string): string[] {
  return text
    .split(/,\s*|\s+and\s+/)
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word !== '');
}

/** The text of a value the scenario quotes: `"Necromancer2"` is `Necromancer2`. Unquoted text is returned as it is. */
function unquoted(text: string): string {
  return /^"(.*)"$/.exec(text)?.[1] ?? text;
}

/** A character of the scenario's batch: the base character with the fields the scenario names. */
function characterWith(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return { ...BASE_CHARACTER, unlockedDifficulties: [...BASE_CHARACTER.unlockedDifficulties], ...fields };
}

/** The batch a registration step sends: one character, as the scenario words it. */
function registrationOf(parts: {
  name: string;
  level: string;
  mode: string;
  ladder: string;
  era: string;
  characterClass: string;
  difficulties: string;
}): { characters: Record<string, unknown>[] } {
  return {
    characters: [
      characterWith({
        name: parts.name,
        class: parts.characterClass.toLowerCase(),
        level: Number(parts.level),
        ladder: `${wordValue(MODE_VALUE, parts.mode, 'mode')}-${wordValue(LADDER_VALUE, parts.ladder, 'ladder')}`,
        era: wordValue(ERA_VALUE, parts.era, 'era'),
        unlockedDifficulties: difficultyList(parts.difficulties),
      }),
    ],
  };
}

/** The batch of a contract-breaking step: the named character with one field set to the scenario's value. */
function brokenBatch(characterName: string, field: string, value: string): unknown {
  if (field === 'count') {
    // Twenty-five characters with unique names: one more than one request may carry.
    return {
      characters: [...LETTERS].map((letter) => characterWith({ name: `${characterName}${letter}` })),
    };
  }
  if (field === 'difficulties') {
    return {
      characters: [
        characterWith({
          name: characterName,
          unlockedDifficulties: difficultyList(value.replace(/ only$/, '')),
        }),
      ],
    };
  }
  const parsed = field === 'level' ? Number(value) : unquoted(value);
  return { characters: [characterWith({ name: characterName, [field]: parsed })] };
}

/** Sends the batch as the named player's agent, and keeps the answer as the one the generic API steps check. */
async function registerAs(world: World, name: string, batch: unknown): Promise<HttpAnswer> {
  const answer = await world.currentAgentOf(name).send('/v1/me/characters', { method: 'POST', body: batch });
  world.last = { status: answer.status, body: answer.body };
  return answer;
}

/** The characters the API lists for the player's session (`GET /v1/me/characters`, the session guard). */
async function myCharacters(world: World, name: string): Promise<{ status: number; body: unknown }> {
  const session = await world.sessionOf(name);
  const response = await fetch(`${world.site.api}/v1/me/characters`, {
    headers: { Cookie: `${SESSION_COOKIE}=${session}` },
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, body: await response.json().catch(() => undefined) };
}

/** Opens the site in a new browser of the player, signed in with the player's session, and waits for the first view. */
async function openSiteSignedIn(world: World, name: string): Promise<void> {
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

// CHR-05: the site follows the screen the agent reports, with the game open.
Given(/^(\w+) has the site open$/, async ({ world }, name: string) => {
  await openSiteSignedIn(world, name);
});

When(
  /^(\w+)'s agent reports that the game is running on the (.+) screen$/,
  async ({ world }, name: string, word: string) => {
    const { screen } = wordValue(SCREENS, word, 'screen');
    const answer = await world.currentAgentOf(name).heartbeat({ running: true, screen });
    expect(answer.status, 'the heartbeat is accepted').toBe(204);
    world.last = { status: answer.status, body: answer.body };
  },
);

Then(
  /^the site shows the agent online, the game open and the screen "([^"]+)" within 2 seconds$/,
  async ({ world }, label: string) => {
    const page = world.currentVisitor.page;
    for (const text of ['Agent online', 'Game open', `Screen: ${label}`]) {
      await expect(page.getByText(text, { exact: true }), `"${text}" within 2 seconds`).toBeVisible({
        timeout: 2_000,
      });
    }
  },
);

// CHR-05: the agent's heartbeats stop; the API's sweep marks it offline once 45 s have passed on its clock.
When(/^the agent stops sending heartbeats for (\d+) seconds$/, async ({ world }, seconds: string) => {
  await world.stack.advanceClock(Number(seconds) * 1000);
});

Then('the site shows the agent offline', async ({ world }) => {
  await expect(
    world.currentVisitor.page.getByText('Agent offline', { exact: true }),
    'the presence',
  ).toBeVisible({
    timeout: 10_000,
  });
});

// CHR-09: a player's agent registers the characters of the character selection screen; a newer reading replaces the
// fields of the same character. "Given" and "When" share the registration wording.
When(
  /^(\w+)'s agent (?:has registered|registers) "([^"]+)" a level (\d+) (softcore|hardcore) (ladder|non-ladder) (classic|expansion|reign of the warlock) (\w+) with (.+) unlocked$/,
  async (
    { world },
    name: string,
    characterName: string,
    level: string,
    mode: string,
    ladder: string,
    era: string,
    characterClass: string,
    difficulties: string,
  ) => {
    const batch = registrationOf({
      name: characterName,
      level,
      mode,
      ladder,
      era,
      characterClass,
      difficulties,
    });
    const answer = await registerAs(world, name, batch);
    expect(answer.status, `the registration of "${characterName}" is accepted`).toBe(204);
  },
);

// CHR-10: a batch that breaks the contract is refused (400) and stores nothing.
When(
  /^(\w+)'s agent registers "([^"]+)" together with a character whose (\w+) is (.+)$/,
  async ({ world }, name: string, characterName: string, field: string, value: string) => {
    await registerAs(world, name, brokenBatch(characterName, field, value));
  },
);

Then(
  /^(\w+) has one character named "([^"]+)", at level (\d+), with (.+) unlocked$/,
  async ({ world }, name: string, characterName: string, level: string, difficulties: string) => {
    const listed = await myCharacters(world, name);
    expect(listed.status, 'the character list answer').toBe(200);
    const { characters } = MyCharactersResponse.parse(listed.body);
    expect(
      characters.map((character) => character.name),
      'the only character',
    ).toEqual([characterName]);
    const character = characters[0];
    if (character === undefined) {
      throw new Error('the character list is empty');
    }
    expect(character.level, 'the level').toBe(Number(level));
    expect(character.unlockedDifficulties, 'the unlocked difficulties').toEqual(difficultyList(difficulties));
  },
);

Then(/^(\w+) has no characters$/, async ({ world }, name: string) => {
  const listed = await myCharacters(world, name);
  expect(listed.status, 'the character list answer').toBe(200);
  expect(MyCharactersResponse.parse(listed.body).characters, 'no characters').toEqual([]);
});

// CHR-11: the site lists the player's characters, reachable with the keyboard, and says how to add them when there are none.
When(/^(\w+) opens the site$/, async ({ world }, name: string) => {
  await openSiteSignedIn(world, name);
});

When(
  /^(\w+) opens the site and moves to the character list using only the keyboard$/,
  async ({ world }, name: string) => {
    await openSiteSignedIn(world, name);
    const page = world.currentVisitor.page;
    const list = page.getByRole('region', { name: 'Your characters', exact: true });
    for (let press = 0; press < KEYBOARD_STOPS; press += 1) {
      if (await list.evaluate((element) => element === document.activeElement)) {
        break;
      }
      await page.keyboard.press('Tab');
    }
    await expect(list, 'the character list has the keyboard focus').toBeFocused();
  },
);

Then(
  /^she sees "([^"]+)", (\w+), level (\d+), (softcore|hardcore), (ladder|non-ladder), (classic|expansion|reign of the warlock), with (.+) unlocked, and when it was read$/,
  async (
    { world },
    characterName: string,
    characterClass: string,
    level: string,
    mode: string,
    ladder: string,
    era: string,
    difficulties: string,
  ) => {
    const list = world.currentVisitor.page.getByRole('region', { name: 'Your characters', exact: true });
    const texts = [
      characterName,
      characterClass.charAt(0).toUpperCase() + characterClass.slice(1),
      `Level ${level}`,
      wordValue(MODE_TEXT, mode, 'mode'),
      wordValue(LADDER_TEXT, ladder, 'ladder'),
      wordValue(ERA_TEXT, era, 'era'),
      `Unlocked: ${difficulties}`,
    ];
    for (const text of texts) {
      await expect(list.getByText(text, { exact: true }), `"${text}" in the character list`).toBeVisible();
    }
    await expect(list.getByText(/^Last read /), 'the time it was read').toBeVisible();
  },
);

Then(/^she sees "([^"]+)"$/, async ({ world }, text: string) => {
  await expect(world.currentVisitor.page.getByText(text, { exact: true }), `"${text}"`).toBeVisible();
});

// CHR-12: a new reading reaches the open site without a reload.
Then(/^the site lists "([^"]+)" within 2 seconds$/, async ({ world }, characterName: string) => {
  const list = world.currentVisitor.page.getByRole('region', { name: 'Your characters', exact: true });
  await expect(list.getByText(characterName, { exact: true }), `"${characterName}" in the list`).toBeVisible({
    timeout: 2_000,
  });
});
