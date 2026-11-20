// Steps of server-name-match, the API half (SNM-01, SNM-02, SNM-03, SNM-04, SNM-07, SNM-08): a player's agent reports a name
// it read, the API matches it to the room's members or to the account's characters, and keeps only the match. Simulated
// agents only; no browser. The agent half (SNM-05, SNM-06) has its steps with the headless agent in batch 2.
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { Given, Then, When } from '../fixtures.ts';
import { SESSION_COOKIE, type World } from '../support/world.ts';
import { expectStage, roomViewOf } from './lobby-rooms.steps.ts';
import {
  HAMMER_OF_BOB,
  SORC_OF_ALICE,
  answerAs,
  joinAs,
  readyPlayer,
  rememberCheck,
  roomOf,
} from './queues.steps.ts';

const PLAYERS = ['Alice', 'Bob'] as const;
const API_WAIT_MS = 15_000;

/** What a scenario sent and was answered, for the steps that look back at it. */
interface Sightings {
  /** The last sighting an agent posted: what "the same sighting again" posts once more. */
  last?: { readonly agent: string; readonly type: string; readonly value: string; readonly key: string };
  /** Every body the API answered to a sighting or a card. */
  readonly answers: string[];
}

const states = new WeakMap<World, Sightings>();

function sightingsOf(world: World): Sightings {
  let state = states.get(world);
  if (state === undefined) {
    state = { answers: [] };
    states.set(world, state);
  }
  return state;
}

// --- Background: a room of Alice and Bob, with their simulated agents --------------------------------------------------

/** The duel group of the Background, its ready check and its room, with the site open on streams and no browser. */
async function formRoomWithoutBrowsers(world: World): Promise<void> {
  await readyPlayer(world, 'Alice', SORC_OF_ALICE, 'stream');
  await readyPlayer(world, 'Bob', HAMMER_OF_BOB, 'stream');
  // Alice joins first, so she is the oldest ticket and hosts (QUE-12).
  await joinAs(world, 'Alice', 'PvP', 'Sorc', 'Hell', 'Americas', { format: 'duel', rules: 'gm' });
  expect(world.last?.status, 'Alice joins').toBe(201);
  await joinAs(world, 'Bob', 'PvP', 'Hammer', 'Hell', 'Americas', { format: 'duel', rules: 'gm' });
  expect(world.last, 'Bob joins, and the group forms').toMatchObject({ status: 201 });
  const check = await rememberCheck(world, 'Alice');
  for (const name of PLAYERS) {
    await answerAs(world, name, check?.id ?? '', 'accept');
    expect(world.last?.status, `${name} accepts`).toBe(204);
  }
  await expect
    .poll(async () => (await roomOf(world, 'Bob'))?.roomId ?? null, {
      timeout: API_WAIT_MS,
      message: 'the room of the group',
    })
    .not.toBeNull();
  for (const name of PLAYERS) {
    const room = await roomViewOf(world, name);
    world.player(name).room = { roomId: room.roomId, gameName: room.expectedGameName };
  }
  world.matchOwner = 'Alice';
}

Given('Alice and Bob are in a room, with their agents paired', async ({ world }) => {
  await formRoomWithoutBrowsers(world);
  // The host's agent fetches the assignment: the room waits for the host (LBR-02).
  const fetched = await world.currentAgentOf('Alice').assignment();
  expect(fetched.status, "the host's fetch of the assignment").toBe(200);
  await expectStage(world, 'Alice', 'awaiting_host');
});

Given('Carol has a paired agent', async ({ world }) => {
  await world.pairAgent('Carol');
});

// --- A sighting of a name in the chat (SNM-01, SNM-02, SNM-03, SNM-04, SNM-08) ---------------------------------------------

const TYPE_OF_WORD: Readonly<Record<string, string>> = {
  joined: 'PLAYER_JOINED_SEEN',
  left: 'PLAYER_LEFT_SEEN',
};

async function report(
  world: World,
  agentOf: string,
  roomOf: string,
  value: string,
  word: string,
  key: string = randomUUID(),
): Promise<void> {
  const type = TYPE_OF_WORD[word];
  if (type === undefined) throw new Error(`no sighting is worded "${word}"`);
  const roomId = world.player(roomOf).room?.roomId;
  if (roomId === undefined) throw new Error(`${roomOf} has no room in this scenario`);
  const answer = await world
    .currentAgentOf(agentOf)
    .observe(roomId, { type, value, run: 1, idempotencyKey: key });
  world.last = { status: answer.status, body: answer.body };
  const state = sightingsOf(world);
  state.answers.push(JSON.stringify(answer.body ?? null));
  state.last = { agent: agentOf, type, value, key };
}

When(
  /^(\w+)'s agent reports "([^"]*)" as a player who (joined|left)$/,
  async ({ world }, agent: string, value: string, word: string) => {
    await report(world, agent, agent, value, word);
  },
);

Given(
  /^(\w+)'s agent reported "([^"]*)" as a player who (joined|left)$/,
  async ({ world }, agent: string, value: string, word: string) => {
    await report(world, agent, agent, value, word);
    expect(world.last?.status, 'the first report').toBe(202);
  },
);

When("Bob's agent reports the same sighting again", async ({ world }) => {
  const previous = sightingsOf(world).last;
  if (previous === undefined) throw new Error('no sighting was reported in this scenario');
  const word = previous.type === 'PLAYER_JOINED_SEEN' ? 'joined' : 'left';
  await report(world, previous.agent, previous.agent, previous.value, word, previous.key);
});

When(
  /^(\w+)'s agent reports "([^"]*)" as a player who (joined|left) in (\w+)'s room$/,
  async ({ world }, agent: string, value: string, word: string, owner: string) => {
    await report(world, agent, owner, value, word);
  },
);

Then(
  /^the API answers "(\d+)" and the sighting is (kept|not kept)$/,
  ({ world }, code: string, kept: string) => {
    expect(world.last?.status, 'the status').toBe(Number(code));
    expect(world.last?.body, 'the answer').toEqual({ stored: kept === 'kept' });
  },
);

Then(
  /^no answer of the API and no room view of (\w+) or (\w+) holds "([^"]+)"$/,
  async ({ world }, first: string, second: string, name: string) => {
    const texts = [
      ...sightingsOf(world).answers,
      JSON.stringify(await roomViewOf(world, first)),
      JSON.stringify(await roomViewOf(world, second)),
    ];
    expect(
      texts.filter((text) => text.toLowerCase().includes(name.toLowerCase())),
      'places that hold the name',
    ).toEqual([]);
  },
);

Then('the room is still awaiting the host', async ({ world }) => {
  await expectStage(world, 'Alice', 'awaiting_host');
});

// --- A card the screen misread (SNM-07) -------------------------------------------------------------------------------------

function card(mode: string | undefined, className: string, name: string, level: string) {
  return {
    name,
    class: className,
    level: Number(level),
    // An unmatched optional group arrives as an empty string.
    hardcore: (mode ?? '').trim() === 'hardcore',
    unlockedDifficulties: ['normal', 'nightmare', 'hell'],
  };
}

async function postCard(world: World, body: ReturnType<typeof card>): Promise<void> {
  const answer = await world.currentAgentOf('Alice').send('/v1/me/characters', {
    method: 'POST',
    body: { characters: [body] },
  });
  expect(answer.status, 'the agent posts its card').toBe(204);
}

Given(
  /^Alice's agent posted her (hardcore )?(\w+) "([^"]+)" at level (\d+)$/,
  async ({ world }, mode: string | undefined, className: string, name: string, level: string) => {
    await postCard(world, card(mode, className, name, level));
  },
);

When(
  /^Alice's agent posts a (hardcore )?(\w+) "([^"]+)" at level (\d+)$/,
  async ({ world }, mode: string | undefined, className: string, name: string, level: string) => {
    await postCard(world, card(mode, className, name, level));
  },
);

async function listedCharacters(world: World): Promise<{ name: string; level: number }[]> {
  const session = await world.sessionOf('Alice');
  const response = await fetch(`${world.site.api}/v1/me/characters`, {
    headers: { Cookie: `${SESSION_COOKIE}=${session}` },
    signal: AbortSignal.timeout(10_000),
  });
  expect(response.status, 'the character list').toBe(200);
  const body = (await response.json()) as { characters: { name: string; level: number }[] };
  return body.characters;
}

Then(
  /^Alice's character list shows one character "([^"]+)" at level (\d+)$/,
  async ({ world }, name: string, level: string) => {
    const listed = await listedCharacters(world);
    expect(
      listed.map((character) => `${character.name}/${character.level}`),
      "Alice's characters",
    ).toEqual([`${name}/${level}`]);
  },
);

Then("Alice's character list shows two characters", async ({ world }) => {
  const listed = await listedCharacters(world);
  expect(
    listed.map((character) => `${character.name}/${character.level}`),
    "Alice's characters",
  ).toHaveLength(2);
});
