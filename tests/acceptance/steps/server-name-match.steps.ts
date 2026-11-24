// Steps of server-name-match, the API half (SNM-01, SNM-02, SNM-03, SNM-04, SNM-07, SNM-08): a player's agent reports a name
// it read, the API matches it to the room's members or to the account's characters, and keeps only the match. Simulated
// agents only; no browser. The agent half (SNM-05, SNM-06) uses the headless agent, the drawn chat fixture of game-name-reading
// and the recording proxy (`support/agent-wire.ts`).
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect } from '@playwright/test';
import { After, Before, Given, Then, When, test } from '../fixtures.ts';
import { awaitRequest } from '../support/agent-proxy.ts';
import { closeWires, enableWire, wireOf } from '../support/agent-wire.ts';
import { HeadlessAgent } from '../support/headless-agent.ts';
import { SESSION_COOKIE, type World } from '../support/world.ts';
import { agentOf } from './characters-reading.steps.ts';
import { expectStage, headlessOf, roomViewOf, startHeadless } from './lobby-rooms.steps.ts';
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
  /** The observations the room held before and after the last sighting: what was kept is read from the table. */
  counts?: { readonly before: number; readonly after: number };
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
  const before = await world.stack.observationCount(roomId);
  const answer = await world
    .currentAgentOf(agentOf)
    .observe(roomId, { type, value, run: 1, idempotencyKey: key });
  world.last = { status: answer.status, body: answer.body };
  sightingsOf(world).counts = { before, after: await world.stack.observationCount(roomId) };
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
    // The answer is the same for a match and a miss (SNM-03): what was kept is read from the table.
    const counts = sightingsOf(world).counts;
    expect(counts, 'a sighting was reported').toBeDefined();
    expect((counts?.after ?? 0) - (counts?.before ?? 0), 'the observations the sighting added').toBe(
      kept === 'kept' ? 1 : 0,
    );
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

// --- SNM-05, SNM-06: the agent posts the chat's joined and left messages ----------------------------------------------------

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const CHAT_FIXTURES = path.join(REPO_ROOT, 'apps', 'agent', 'fixtures', 'chat');
const START_TIMEOUT_MS = 480_000;
const CHAT_WAIT_MS = 20_000;
const CHAT_KEYS = ['capturedAt', 'confidence', 'idempotencyKey', 'run', 'type', 'value'];

/** The chat picture the scenario's agent captures, and what the room held before the chat showed anything. */
interface Chat {
  readonly png: string;
  readonly roomId: string | undefined;
  readonly before: number;
}

const chats = new WeakMap<World, Chat>();

Before({ tags: '@SNM-05 or @SNM-06' }, ({ world }) => {
  enableWire(world);
});

After({ tags: '@SNM-05 or @SNM-06' }, async ({ world }) => {
  await closeWires(world);
});

/** Copies a drawn chat fixture into a directory of the scenario and shows it, with no line yet, to the player's agent. */
function prepareChat(fixture: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'd2rmm-chat-'));
  const png = path.join(dir, `${fixture}.png`);
  copyFileSync(path.join(CHAT_FIXTURES, `${fixture}.png`), png);
  const drawn = JSON.parse(readFileSync(path.join(CHAT_FIXTURES, `${fixture}.png.json`), 'utf8')) as {
    height: number;
  };
  writeFileSync(`${png}.json`, JSON.stringify({ height: drawn.height, lines: [] }));
  return png;
}

Given(
  /^(\w+)'s agent holds the room and sees the chat fixture "([^"]+)"$/,
  async ({ world }, name: string, fixture: string) => {
    test.setTimeout(START_TIMEOUT_MS);
    await HeadlessAgent.build();
    const roomId = world.player(name).room?.roomId;
    await startHeadless(world, name, (await roomViewOf(world, name)).expectedGameName);
    const png = prepareChat(fixture);
    headlessOf(world, name).agent.show(png);
    chats.set(world, {
      png,
      roomId,
      before: roomId === undefined ? 0 : await world.stack.observationCount(roomId),
    });
  },
);

/** The agent of Alice in this scenario: the one that holds the room, or the one with consent and no room. */
function aliceAgent(world: World): HeadlessAgent {
  try {
    return headlessOf(world, 'Alice').agent;
  } catch {
    return agentOf(world);
  }
}

When(/^the chat shows that "([^"]+)" joined the game$/, async ({ world }, name: string) => {
  let chat = chats.get(world);
  if (chat === undefined) {
    // An agent with no room: the chat is shown to it from now on, with the line already on it.
    chat = { png: prepareChat('chat-joined'), roomId: undefined, before: 0 };
    chats.set(world, chat);
  }
  const drawn = JSON.parse(readFileSync(path.join(CHAT_FIXTURES, 'chat-joined.png.json'), 'utf8')) as {
    height: number;
    lines: { text: string; x: number; y: number; width: number; height: number }[];
  };
  const [line] = drawn.lines;
  if (line === undefined) throw new Error('the chat fixture draws no line');
  writeFileSync(
    `${chat.png}.json`,
    JSON.stringify({ height: drawn.height, lines: [{ ...line, text: `${name} joined our world` }] }),
  );
  aliceAgent(world).show(chat.png);
});

Then("the API holds one joined sighting for Bob's character", async ({ world }) => {
  const chat = chats.get(world);
  if (chat?.roomId === undefined) throw new Error('no room holds the chat sighting in this scenario');
  const roomId = chat.roomId;
  await expect
    .poll(() => world.stack.observationCount(roomId), {
      timeout: CHAT_WAIT_MS,
      message: 'the sighting of the chat line',
    })
    .toBe(chat.before + 1);
  const rows = await world.stack.observationRows(roomId);
  const kept = rows.slice(chat.before);
  const bob = (await roomViewOf(world, 'Bob')).members.find((member) => member.role !== 'host');
  expect(kept, 'the observations the chat line added').toEqual([
    { type: 'PLAYER_JOINED_SEEN', value: String(bob?.joinOrder ?? 2) },
  ]);
});

Then('the agent sent no observation', async ({ world }) => {
  // The agent has no room, so it reads no chat; a chat line it would post would be posted within the wait.
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  const sent = aliceAgent(world).events.filter((event) =>
    ['observed', 'chat-observed'].includes(event.event),
  );
  expect(sent, "the observations Alice's agent sent").toEqual([]);
});

/** The chat sightings Alice's agent sent, as the recording proxy saw them. */
async function chatSightings(world: World) {
  const wire = wireOf(world, 'Alice');
  await awaitRequest(wire, 'the chat sighting', (record) => record.chat !== undefined, CHAT_WAIT_MS);
  // The body of the last request is read once it ends; a moment lets it finish.
  await new Promise((resolve) => setTimeout(resolve, 500));
  return wire.requests().filter((record) => record.chat !== undefined);
}

Then(
  "every chat observation Alice's agent sent holds only the keys of the observation contract",
  async ({ world }) => {
    const sightings = await chatSightings(world);
    expect(sightings.length, 'the chat observations the agent sent').toBeGreaterThan(0);
    for (const record of sightings) {
      expect(record.bodyKeys, `${record.method} ${record.path}`).toEqual(CHAT_KEYS);
      expect(record.contentType, 'the media type of a chat observation').toBe('application/json');
    }
  },
);

Then('its value is the name and nothing else', async ({ world }) => {
  const sightings = await chatSightings(world);
  expect(
    sightings.map((record) => record.chat),
    'the type and the value of each chat observation',
  ).toEqual([{ type: 'PLAYER_JOINED_SEEN', value: 'Hammer' }]);
});
