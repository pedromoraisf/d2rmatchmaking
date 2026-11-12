// Characters steps (CHR-05, CHR-09 to CHR-12, CHR-15, CHR-16): the agent reports the screen the game is on and the
// characters it reads, over HTTP with its token, as the real agent does; the player declares ladder and era on the site
// (CHR-15), by keyboard or over HTTP. The site shows the screen, the characters and the presence. Black box: the browser
// and HTTP only. The screen reading of the agent itself is `characters-reading` (split).
import { MyCharactersResponse } from '@d2rmm/contracts';
import { expect, type Locator, type Page } from '@playwright/test';
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
const MODE_TEXT: Readonly<Record<string, string>> = { softcore: 'Softcore', hardcore: 'Hardcore' };
const LADDER_VALUE: Readonly<Record<string, string>> = { ladder: 'ladder', 'non-ladder': 'non-ladder' };
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

/** The origin of a request the site does not own (CHR-16, the same origin the Battle.net scenarios use). */
const OTHER_ORIGIN = 'https://elsewhere.example';

/** How many Tab presses the keyboard walk may take before the character list must hold the focus. */
const KEYBOARD_STOPS = 60;
/** Letters for the 25 names of the batch that is one too many (the contract allows 1 to 24). */
const LETTERS = 'abcdefghijklmnopqrstuvwxy';
/** Presses an arrow key may take to reach the wanted option of a radio group or a select. */
const OPTION_STEPS = 4;
/** The character the registration scenarios register unless a step changes one of its fields (CHR-06, CHR-07). */
const BASE_CHARACTER = {
  name: 'Sorc',
  class: 'sorceress',
  level: 85,
  hardcore: false,
  unlockedDifficulties: ['normal', 'nightmare'],
} as const;

/** The characters this scenario registered, by lowercased name: who registered each and the id the API gave it. */
const registered = new WeakMap<World, Map<string, { owner: string; id: string }>>();

/** The value a scenario word stands for, or a loud failure when the scenarios use a word the suite does not know. */
function wordValue<T>(table: Readonly<Record<string, T>>, word: string, what: string): T {
  const value = table[word];
  if (value === undefined) {
    throw new Error(`the scenarios use no ${what} "${word}"`);
  }
  return value;
}

/** The contract's era for an era the scenarios write, in any case ("Expansion" or "expansion"). */
function eraValueOf(word: string): string {
  return wordValue(ERA_VALUE, word.toLowerCase(), 'era');
}

/** The ladder and era a declaration step sends (CHR-15). */
function declarationOf(ladder: string, era: string): { ladder: string; era: string } {
  return { ladder: wordValue(LADDER_VALUE, ladder, 'ladder'), era: eraValueOf(era) };
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

/** The batch a registration step sends: one character, as the scenario words it (CHR-06, CHR-09). */
function registrationOf(parts: {
  name: string;
  level: string;
  mode: string;
  characterClass: string;
  difficulties: string;
}): { characters: Record<string, unknown>[] } {
  return {
    characters: [
      characterWith({
        name: parts.name,
        class: parts.characterClass.toLowerCase(),
        level: Number(parts.level),
        hardcore: parts.mode === 'hardcore',
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

/** Remembers the ids the API gave the owner's characters, so a declaration can name a character by its name (CHR-16). */
async function rememberIdsOf(world: World, owner: string): Promise<void> {
  const listed = await myCharacters(world, owner);
  expect(listed.status, 'the character list answer').toBe(200);
  const ids = registered.get(world) ?? new Map<string, { owner: string; id: string }>();
  for (const character of MyCharactersResponse.parse(listed.body).characters) {
    ids.set(character.name.toLowerCase(), { owner, id: character.id });
  }
  registered.set(world, ids);
}

/** The owner and id of a character the scenario registered. Fails when no step registered it. */
function characterOf(world: World, characterName: string): { owner: string; id: string } {
  const found = registered.get(world)?.get(characterName.toLowerCase());
  if (found === undefined) {
    throw new Error(`the scenario registered no character named "${characterName}"`);
  }
  return found;
}

/**
 * Sends a declaration (`PATCH /v1/me/characters/:id`) as the named player, from the given origin, with or without the
 * player's session, and keeps the answer for the generic "the answer is" step (CHR-15, CHR-16).
 */
async function declareAs(
  world: World,
  actor: string,
  characterName: string,
  declaration: { readonly ladder: string; readonly era: string },
  { origin, withSession }: { readonly origin: string; readonly withSession: boolean },
): Promise<void> {
  const target = characterOf(world, characterName);
  const session = withSession ? await world.sessionOf(actor) : undefined;
  const response = await fetch(`${world.site.api}/v1/me/characters/${target.id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      ...(session === undefined ? {} : { Cookie: `${SESSION_COOKIE}=${session}` }),
    },
    body: JSON.stringify(declaration),
    signal: AbortSignal.timeout(10_000),
  });
  world.last = { status: response.status, body: await response.json().catch(() => undefined) };
}

/** The one character the player's list holds, which must be the named one; the list is read from the API. */
async function onlyCharacter(world: World, name: string, characterName: string) {
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
  return character;
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

/** The card of one character in the site's list: the list item that holds the name (CHR-11, CHR-15). */
function characterCard(page: Page, characterName: string) {
  return page
    .getByRole('region', { name: 'Your characters', exact: true })
    .getByRole('listitem')
    .filter({ has: page.getByText(characterName, { exact: true }) });
}

/** True when the keyboard focus is on a radio button (a declaration's ladder). */
/** True when the keyboard focus is on a radio inside `card` (the page holds other radios, such as the queue panel's). */
function focusIsOnRadioIn(card: Locator): Promise<boolean> {
  return card.evaluate(
    (element) =>
      document.activeElement instanceof HTMLInputElement &&
      document.activeElement.type === 'radio' &&
      element.contains(document.activeElement),
  );
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
// fields of the same character. The reading carries no ladder and no era: the player declares them (CHR-15).
// "Given" and "When" share the registration wording.
When(
  /^(\w+)'s agent (?:has registered|registers) "([^"]+)" a level (\d+) (softcore|hardcore) (\w+) with (.+) unlocked$/,
  async (
    { world },
    name: string,
    characterName: string,
    level: string,
    mode: string,
    characterClass: string,
    difficulties: string,
  ) => {
    const batch = registrationOf({ name: characterName, level, mode, characterClass, difficulties });
    const answer = await registerAs(world, name, batch);
    expect(answer.status, `the registration of "${characterName}" is accepted`).toBe(204);
    await rememberIdsOf(world, name);
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
    const character = await onlyCharacter(world, name, characterName);
    expect(character.level, 'the level').toBe(Number(level));
    expect(character.unlockedDifficulties, 'the unlocked difficulties').toEqual(difficultyList(difficulties));
  },
);

// CHR-09, CHR-15: the reading keeps the ladder and era the player declared; the declared values are what the list shows.
Then(
  /^(\w+) has one character named "([^"]+)", at level (\d+), (ladder|non-ladder), (.+)$/,
  async ({ world }, name: string, characterName: string, level: string, ladder: string, era: string) => {
    const character = await onlyCharacter(world, name, characterName);
    expect(character.level, 'the level').toBe(Number(level));
    expect(character.ladder, 'the declared ladder').toBe(wordValue(LADDER_VALUE, ladder, 'ladder'));
    expect(character.era, 'the declared era').toBe(eraValueOf(era));
  },
);

Then(/^(\w+) has no characters$/, async ({ world }, name: string) => {
  const listed = await myCharacters(world, name);
  expect(listed.status, 'the character list answer').toBe(200);
  expect(MyCharactersResponse.parse(listed.body).characters, 'no characters').toEqual([]);
});

// CHR-15: the player declares ladder and era for a character over HTTP, as the site does.
Given(
  /^(\w+) has declared "([^"]+)" as (ladder|non-ladder), (.+)$/,
  async ({ world }, name: string, characterName: string, ladder: string, era: string) => {
    await declareAs(world, name, characterName, declarationOf(ladder, era), {
      origin: world.site.site,
      withSession: true,
    });
    expect(world.last?.status, 'the declaration is saved').toBe(204);
  },
);

// CHR-16: a declaration that is not the player's, or that comes without a session or from another origin, changes nothing.
When(
  /^(\w+) declares "([^"]+)" as (ladder|non-ladder), (.+) (from the site|without a session|from another origin)$/,
  async ({ world }, actor: string, characterName: string, ladder: string, era: string, how: string) => {
    const origin = how === 'from another origin' ? OTHER_ORIGIN : world.site.site;
    await declareAs(world, actor, characterName, declarationOf(ladder, era), {
      origin,
      withSession: how !== 'without a session',
    });
  },
);

Then(/^"([^"]+)" has no ladder or era declared$/, async ({ world }, characterName: string) => {
  const owner = characterOf(world, characterName).owner;
  const listed = await myCharacters(world, owner);
  expect(listed.status, 'the character list answer').toBe(200);
  const character = MyCharactersResponse.parse(listed.body).characters.find(
    (listedCharacter) => listedCharacter.name.toLowerCase() === characterName.toLowerCase(),
  );
  expect(character?.ladder, 'the declared ladder').toBeNull();
  expect(character?.era, 'the declared era').toBeNull();
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

// CHR-15: the player declares ladder and era on the site with the keyboard alone: Tab into the card's form, arrow to the
// ladder, Tab to the era group, arrow to it, Tab to the save button and press Enter.
When(
  /^(\w+) opens the site and, using only the keyboard, declares "([^"]+)" as (ladder|non-ladder), (.+)$/,
  async ({ world }, name: string, characterName: string, ladder: string, era: string) => {
    await openSiteSignedIn(world, name);
    const page = world.currentVisitor.page;
    const card = characterCard(page, characterName);
    const ladderRadio = card.getByRole('radio', {
      name: wordValue(LADDER_TEXT, ladder, 'ladder'),
      exact: true,
    });
    for (let press = 0; press < KEYBOARD_STOPS; press += 1) {
      if (await focusIsOnRadioIn(card)) {
        break;
      }
      await page.keyboard.press('Tab');
    }
    for (let press = 0; press < OPTION_STEPS && !(await ladderRadio.isChecked()); press += 1) {
      await page.keyboard.press('ArrowDown');
    }
    await expect(ladderRadio, 'the ladder is chosen').toBeChecked();

    await page.keyboard.press('Tab');
    const eraRadio = card.getByRole('radio', {
      name: wordValue(ERA_TEXT, era.toLowerCase(), 'era'),
      exact: true,
    });
    for (let press = 0; press < OPTION_STEPS && !(await eraRadio.isChecked()); press += 1) {
      await page.keyboard.press('ArrowDown');
    }
    await expect(eraRadio, 'the era is chosen').toBeChecked();

    await page.keyboard.press('Tab');
    const save = card.getByRole('button', { name: 'Save ladder and era', exact: true });
    await expect(save, 'the save button has the keyboard focus').toBeFocused();
    await page.keyboard.press('Enter');
  },
);

Then(
  /^she sees "([^"]+)" as (ladder|non-ladder), (.+)$/,
  async ({ world }, characterName: string, ladder: string, era: string) => {
    const card = characterCard(world.currentVisitor.page, characterName);
    await expect(
      card.getByText(wordValue(LADDER_TEXT, ladder, 'ladder'), { exact: true }),
      'the ladder',
    ).toBeVisible();
    await expect(
      card.getByText(wordValue(ERA_TEXT, era.toLowerCase(), 'era'), { exact: true }),
      'the era',
    ).toBeVisible();
  },
);

Then(/^she sees "([^"]+)" on "([^"]+)"$/, async ({ world }, text: string, characterName: string) => {
  const card = characterCard(world.currentVisitor.page, characterName);
  await expect(card.getByText(text, { exact: true }), `"${text}" on "${characterName}"`).toBeVisible();
});

Then(
  /^she no longer sees "([^"]+)" on "([^"]+)"$/,
  async ({ world }, text: string, characterName: string) => {
    const card = characterCard(world.currentVisitor.page, characterName);
    await expect(
      card.getByText(text, { exact: true }),
      `"${text}" is gone from "${characterName}"`,
    ).toHaveCount(0);
  },
);

Then(
  /^she sees "([^"]+)", (\w+), level (\d+), (softcore|hardcore), with (.+) unlocked, and when it was read$/,
  async (
    { world },
    characterName: string,
    characterClass: string,
    level: string,
    mode: string,
    difficulties: string,
  ) => {
    const list = world.currentVisitor.page.getByRole('region', { name: 'Your characters', exact: true });
    const texts = [
      characterName,
      characterClass.charAt(0).toUpperCase() + characterClass.slice(1),
      `Level ${level}`,
      wordValue(MODE_TEXT, mode, 'mode'),
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
