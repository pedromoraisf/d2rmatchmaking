// Lobby Room and stream steps of api-web-skeleton (AWS-19 to AWS-25, AWS-27 to AWS-29): the test match, what the host's
// agent sees and reports, the streams that carry only their own events, the reconnect from the last event, and the origin
// of the site's requests. Black box: HTTP, SSE and the browser only.
import { Assignment, RoomView } from '@d2rmm/contracts';
import { expect, type Route } from '@playwright/test';
import { Given, Then, When, type Scenario } from '../fixtures.ts';
import { EventStream } from '../support/sse.ts';
import { SESSION_COOKIE, type Visitor, type World } from '../support/world.ts';

/** The stage each label of the site stands for (the site shows the label, the API the stage). */
const STAGE_BY_LABEL: Record<string, string> = { 'Awaiting host': 'awaiting_host', Created: 'created' };

/** The scenario value that remembers the game name of the room shown before a newer test match (AWS-21). */
const PREVIOUS_GAME_NAME = 'previous-game-name';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function roomOf(world: World, name: string): { roomId: string; gameName: string } {
  const room = world.player(name).room;
  if (room === undefined) {
    throw new Error(`"${name}" has no room in this scenario`);
  }
  return room;
}

/** The host of the last test match: the player whose agent reports on the room. */
function hostOf(world: World): string {
  if (world.matchOwner === undefined) {
    throw new Error('no test match was started in this scenario');
  }
  return world.matchOwner;
}

function visitorOf(world: World, name: string): Visitor {
  const visitor = world.player(name).visitor;
  if (visitor === undefined) {
    throw new Error(`"${name}" has not signed in on the site in this scenario`);
  }
  return visitor;
}

/** Has the host's agent report the game name it sees: the room's own name, or the given value, in the given run. */
async function reportGameName(
  world: World,
  reporter: string,
  roomOwner: string,
  options: { value?: string; run?: number },
): Promise<void> {
  const room = roomOf(world, roomOwner);
  await world.observe(world.currentAgentOf(reporter), room.roomId, {
    type: 'GAME_NAME_SEEN',
    value: options.value ?? room.gameName,
    run: options.run ?? 1,
  });
}

// AWS-19, AWS-21, AWS-23: the test match of a player, from the site or from the API.
Given(/^"(.+)" has started a test match with a paired agent$/, async ({ world }, name: string) => {
  await world.pairAgent(name);
  await world.startTestMatch(name, false);
});

Given(/^"(.+)" has started a test match$/, async ({ world }, name: string) => {
  await world.startTestMatch(name, false);
});

Given(/^a test match was formed for "(.+)"$/, async ({ world }, name: string) => {
  await world.startTestMatch(name, false);
});

When(/^"(.+)" starts a test match$/, async ({ world }, name: string) => {
  await world.startTestMatch(name, false);
});

When(
  /^"(.+)" uses "Start test match"( again)?$/,
  async ({ world, scenario }, name: string, again: string | null) => {
    if (again) {
      scenario.values.set(PREVIOUS_GAME_NAME, world.player(name).room?.gameName);
    }
    await world.startTestMatch(name, true);
  },
);

Then('the API answered "202" to the test match request', ({ world }) => {
  expect(world.matchStatus, 'the test match request').toBe(202);
});

// AWS-19, AWS-20: the room, its game name, and the agent's assignment.
Then(
  /^within 2 seconds the site shows a room named like "([^"]+)", "([^"]+)" and the stage "([^"]+)"$/,
  async ({ world }, prefix: string, noPassword: string, stage: string) => {
    const page = world.currentVisitor.page;
    await expect(
      page.getByText(new RegExp(`${escapeRegExp(prefix)}\\d+`)),
      `a room named like ${prefix}`,
    ).toBeVisible({
      timeout: 2_000,
    });
    await expect(page.getByText(noPassword, { exact: true })).toBeVisible();
    await expect(page.getByText(stage, { exact: true })).toBeVisible();
  },
);

Then(
  /^the agent's stream and assignment name that room, run 1, its game name and "(.+)" as host and only member$/,
  async ({ world }, name: string) => {
    const room = roomOf(world, name);
    const agent = world.currentAgentOf(name);
    const stream = await world.agentStreamOf(agent);
    const received = await stream.waitFor((event) => event.type === 'room.assigned');
    const assigned = Assignment.parse(received.data);
    expect(assigned.roomId, 'the assigned room').toBe(room.roomId);
    expect(assigned.run, 'the run').toBe(1);
    expect(assigned.expectedGameName, 'the game name').toBe(room.gameName);
    expect(assigned.members, 'the only member').toHaveLength(1);
    expect(assigned.members[0]?.role, 'the role').toBe('host');
    expect(assigned.members[0]?.accountId, 'the host').toBe(world.player(name).accountId);
    const answer = await agent.assignment();
    expect(answer.status, 'the assignment endpoint').toBe(200);
    expect(Assignment.parse(answer.body).roomId, 'the endpoint names the room').toBe(room.roomId);
  },
);

Then(/^within 2 seconds the site shows the room as "(.+)"$/, async ({ world }, stage: string) => {
  await expect(
    world.currentVisitor.page.getByText(stage, { exact: true }),
    `the room as ${stage}`,
  ).toBeVisible({
    timeout: 2_000,
  });
});

Then(/^the site shows the room as "(.+)"$/, async ({ world }, stage: string) => {
  await expect(
    world.currentVisitor.page.getByText(stage, { exact: true }),
    `the room as ${stage}`,
  ).toBeVisible();
});

Then(/^the site shows the room's game name and the stage "(.+)"$/, async ({ world }, stage: string) => {
  const page = world.currentVisitor.page;
  const room = roomOf(world, hostOf(world));
  await expect(page.getByText(room.gameName, { exact: true }), 'the game name').toBeVisible();
  await expect(page.getByText(stage, { exact: true }), `the stage ${stage}`).toBeVisible();
});

Then(
  "within 2 seconds the site shows a game name different from the first room's",
  async ({ world, scenario }) => {
    const previous = scenario.values.get(PREVIOUS_GAME_NAME);
    const current = roomOf(world, hostOf(world));
    expect(current.gameName, 'a newer room').not.toBe(previous);
    await expect(world.currentVisitor.page.getByText(current.gameName, { exact: true })).toBeVisible({
      timeout: 2_000,
    });
  },
);

// AWS-21, AWS-23: the room survives a reload; the agent reports the game name it sees.
When(/^"(.+)" reloads the site$/, async ({ world }, name: string) => {
  const visitor = visitorOf(world, name);
  await visitor.page.reload();
  await expect(visitor.page.getByText(/^(Loading…|Carregando…)$/)).toHaveCount(0, { timeout: 15_000 });
});

Given('the agent has reported seeing the game name of the room', async ({ world }) => {
  const host = hostOf(world);
  await reportGameName(world, host, host, {});
  await expect.poll(() => world.stageOf(host), { timeout: 5_000 }).toBe('created');
});

When('the agent reports seeing the game name of the room', async ({ world }) => {
  const host = hostOf(world);
  await reportGameName(world, host, host, {});
});

When('the agent reports seeing the game name of the room in upper case', async ({ world }) => {
  const host = hostOf(world);
  await reportGameName(world, host, host, { value: roomOf(world, host).gameName.toUpperCase() });
});

When('the agent reports seeing the game name of the room again with a new observation', async ({ world }) => {
  const host = hostOf(world);
  await reportGameName(world, host, host, {});
});

When('the agent sends the same observation again', async ({ world }) => {
  await world.resendLastObservation();
});

// AWS-24: a sighting that does not prove the game ("mmbaalh-999999", or the game name of run 2).
When(
  /^the host's agent reports seeing the game name (?:"([^"]+)"|of run (\d+))$/,
  async ({ world }, name: string | null, run: string | number | null) => {
    // An unmatched optional group arrives as null, not undefined: the test is on the type of the value.
    const host = hostOf(world);
    if (typeof name === 'string') {
      await reportGameName(world, host, host, { value: name });
    } else {
      await reportGameName(world, host, host, { run: Number(run) });
    }
  },
);

// AWS-25: an agent outside the room reports on it; an unknown observation type is discarded.
When(
  /^the agent of "(.+)" reports seeing the game name of the room of "(.+)"$/,
  async ({ world }, reporter: string, owner: string) => {
    await reportGameName(world, reporter, owner, {});
  },
);

When(
  /^the agent of "(.+)" reports seeing the game name of the room$/,
  async ({ world }, reporter: string) => {
    await reportGameName(world, reporter, reporter, {});
  },
);

When('the agent sends an observation of an unknown type', async ({ world }) => {
  const host = hostOf(world);
  const room = roomOf(world, host);
  await world.observe(world.currentAgentOf(host), room.roomId, {
    type: 'SOMETHING_NEW',
    value: room.gameName,
    run: 1,
  });
});

Then(/^the room of "(.+)" is still "(.+)"$/, async ({ world }, name: string, label: string) => {
  const stage = STAGE_BY_LABEL[label];
  if (stage === undefined) {
    throw new Error(`no stage is labelled "${label}"`);
  }
  expect(await world.stageOf(name), `the room of "${name}"`).toBe(stage);
});

// AWS-20: no HTTP route delivers an existing MatchFormed again: every match-formed call mints a new matchId (AD-033).
// AWS-20: the relay's at-least-once redelivery of the same match, through the test control (AD-062). The consumers
// have run when the control answers, so the room is read straight after it.
When('the same match is delivered to the Lobby Room again', async ({ world }) => {
  await world.stack.redeliverMatchFormed();
});

// AWS-20: a second room for the match would be newer (the game name sequence only grows), so the newest room the API
// reads must still be the room the match opened.
Then(/^"(.+)" has exactly one room for that match$/, async ({ world }, name: string) => {
  const opened = roomOf(world, name);
  const session = await world.sessionOf(name);
  const response = await fetch(`${world.site.api}/v1/me/room`, {
    headers: { Cookie: `${SESSION_COOKIE}=${session}` },
    signal: AbortSignal.timeout(10_000),
  });
  expect(response.status, `the room of "${name}"`).toBe(200);
  const newest = RoomView.parse(await response.json());
  expect(newest.roomId, 'the newest room is the room the match opened').toBe(opened.roomId);
  expect(newest.expectedGameName, 'the game name of that room').toBe(opened.gameName);
});

Then('the room changed stage only once', async ({ world }) => {
  const host = hostOf(world);
  const stream = world.player(host).stream;
  if (stream === undefined) {
    throw new Error(`"${host}" has no open site stream in this scenario`);
  }
  // Settle: a second stage change would arrive within the time the spec allows (NFR-01).
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const created = stream.events.filter(
    (event) => event.type === 'room.stage_changed' && (event.data as { stage?: string }).stage === 'created',
  );
  expect(created, 'the stage changes to created').toHaveLength(1);
});

// AWS-27: each stream carries only its own events.
Given(/^"(.+)" and "(.+)" each have an open stream$/, async ({ world }, first: string, second: string) => {
  await world.siteStreamOf(first);
  await world.siteStreamOf(second);
});

Given(
  /^"(.+)" and "(.+)" each have a paired agent with an open stream$/,
  async ({ world }, first: string, second: string) => {
    for (const name of [first, second]) {
      const agent = await world.pairAgent(name);
      await world.agentStreamOf(agent);
    }
  },
);

Then(/^the stream of "(.+)" receives the room's stage change$/, async ({ world }, name: string) => {
  const stream = await world.siteStreamOf(name);
  await stream.waitFor(
    (event) => event.type === 'room.stage_changed' && (event.data as { stage?: string }).stage === 'created',
  );
});

Then(/^the stream of "(.+)" receives no room event$/, async ({ world }, name: string) => {
  const stream = await world.siteStreamOf(name);
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  expect(
    stream.events.filter((event) => event.type.startsWith('room.')),
    `room events of "${name}"`,
  ).toEqual([]);
});

Then(/^the stream of the agent of "(.+)" receives the room assignment$/, async ({ world }, name: string) => {
  const stream = await world.agentStreamOf(world.currentAgentOf(name));
  await stream.waitFor((event) => event.type === 'room.assigned');
});

Then(/^the stream of the agent of "(.+)" receives no room event$/, async ({ world }, name: string) => {
  const stream = await world.agentStreamOf(world.currentAgentOf(name));
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  expect(
    stream.events.filter((event) => event.type.startsWith('room.')),
    `room events of "${name}"'s agent`,
  ).toEqual([]);
});

When('a client opens the stream without signing in', async ({ world }) => {
  const stream = await EventStream.open(`${world.site.api}/v1/stream`);
  stream.close();
  world.last = { status: stream.status, body: undefined };
});

// AWS-28: a reconnecting stream receives the events it missed, from the last id it received.
Given(/^"(.+)" has an open stream that received the room assignment$/, async ({ world }, name: string) => {
  const stream = await world.siteStreamOf(name);
  await stream.waitFor((event) => event.type === 'room.assigned');
  // The same transaction also writes the stage change to awaiting_host: the stream is caught up when it arrives.
  await stream.waitFor(
    (event) =>
      event.type === 'room.stage_changed' && (event.data as { stage?: string }).stage === 'awaiting_host',
  );
});

When(/^the stream of "(.+)" is closed$/, ({ world }, name: string) => {
  const player = world.player(name);
  const stream = player.stream;
  if (stream !== undefined) {
    const lastId = stream.lastId();
    if (lastId !== undefined) {
      player.closedStreamLastId = lastId;
    }
    stream.close();
  }
  delete player.stream;
});

When(/^"(.+)" reopens the stream from the last event received$/, async ({ world }, name: string) => {
  const player = world.player(name);
  const session = await world.sessionOf(name);
  player.stream = await world.openSiteStream(session, player.closedStreamLastId);
});

Then(
  /^the stream of "(.+)" first receives the room's stage change to "(.+)"$/,
  async ({ world }, name: string, stage: string) => {
    const stream = world.player(name).stream;
    if (stream === undefined) {
      throw new Error(`"${name}" has no reopened stream in this scenario`);
    }
    await expect.poll(() => stream.events.length, { timeout: 2_000 }).toBeGreaterThan(0);
    const first = stream.events[0];
    expect(first?.type, 'the first event after the reconnect').toBe('room.stage_changed');
    expect((first?.data as { stage?: string } | undefined)?.stage, 'the stage of that event').toBe(stage);
  },
);

// AWS-29: the site talks to the API only through its own origin, and the session cookie comes from that origin.
Then(
  /^every request the site made to the API went to the site's own origin under "(.+)"$/,
  ({ world }, prefix: string) => {
    const visitor = world.currentVisitor;
    const calls = visitor.requests.filter((request) =>
      ['fetch', 'xhr', 'eventsource'].includes(request.resourceType),
    );
    expect(calls.length, 'the site made calls to the API').toBeGreaterThan(0);
    for (const call of calls) {
      expect(
        call.url.startsWith(`${world.site.site}${prefix}`),
        `${call.url} is under the site's origin`,
      ).toBe(true);
    }
    expect(
      visitor.requests.some((request) => request.url.startsWith(world.site.api)),
      'no request went straight to the API',
    ).toBe(false);
  },
);

Then("the session cookie was set by the site's own origin", async ({ world }) => {
  const visitor = world.currentVisitor;
  await expect
    .poll(() =>
      visitor.responses.some(
        (response) =>
          response.url.startsWith(`${world.site.site}/api/`) &&
          response.setCookie.some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`)),
      ),
    )
    .toBe(true);
  expect(
    visitor.responses.some((response) => response.url.startsWith(world.site.api)),
    'no response came straight from the API',
  ).toBe(false);
});

// SSR-01 to SSR-05: the browser's read of the room is held, so the order of a stream event and a slow answer is fixed.
// Reads are numbered from 1 in the order the page makes them since the route was installed. A reload makes two: the
// loading read (1), and the read its stream opening starts (2). Every read the plan does not name goes to the API.
const ROOM_READ_ROUTE = '**/api/v1/me/room';
const ROOM_READS = 'room-reads';

type RoomReadAction =
  { readonly kind: 'api' } | { readonly kind: 'hold' } | { readonly kind: 'status'; readonly status: number };

interface RoomReads {
  readonly plan: Map<number, RoomReadAction>;
  readonly handler: (route: Route) => Promise<void>;
  /** Reads the page has started. */
  started: number;
  /** Reads the route has answered: with the API's answer or with a status. */
  answered: number;
  /** The read the route holds: its stage as the API answered it, and the function that releases it. */
  held?: { readonly stage: string; readonly release: () => void } | undefined;
  /** The number of the read the slow answer belonged to, from the moment the scenario released it. */
  releasedAt?: number;
}

async function answerRoomRead(reads: RoomReads, route: Route): Promise<void> {
  reads.started += 1;
  const action = reads.plan.get(reads.started) ?? { kind: 'api' };
  if (action.kind === 'status') {
    await route.fulfill({ status: action.status });
  } else if (action.kind === 'hold') {
    // The answer is the API's, taken now, before the scenario changes the room; the page gets it only on release.
    const response = await route.fetch();
    const { stage } = RoomView.parse(await response.json());
    await new Promise<void>((release) => {
      reads.held = {
        stage,
        release: () => {
          reads.held = undefined;
          release();
        },
      };
    });
    await route.fulfill({ response });
  } else {
    await route.fulfill({ response: await route.fetch() });
  }
  reads.answered += 1;
}

/** Installs the route on the current visitor's page, once per scenario. */
async function installRoomReads(world: World, scenario: Scenario): Promise<RoomReads> {
  const installed = scenario.values.get(ROOM_READS) as RoomReads | undefined;
  if (installed !== undefined) {
    return installed;
  }
  const reads: RoomReads = {
    plan: new Map(),
    started: 0,
    answered: 0,
    handler: (route) => answerRoomRead(reads, route),
  };
  scenario.values.set(ROOM_READS, reads);
  await world.currentVisitor.page.route(ROOM_READ_ROUTE, reads.handler);
  return reads;
}

function existingRoomReads(scenario: Scenario): RoomReads {
  const reads = scenario.values.get(ROOM_READS) as RoomReads | undefined;
  if (reads === undefined) {
    throw new Error("the site's room reads are not held in this scenario");
  }
  return reads;
}

/** Unroutes the room reads, so a later read reaches the API. */
async function stopRoomReads(world: World, scenario: Scenario): Promise<void> {
  const reads = scenario.values.get(ROOM_READS) as RoomReads | undefined;
  if (reads === undefined) {
    return;
  }
  scenario.values.delete(ROOM_READS);
  await world.currentVisitor.page.unroute(ROOM_READ_ROUTE, reads.handler);
}

async function heldRoomRead(
  reads: RoomReads,
): Promise<{ readonly stage: string; readonly release: () => void }> {
  await expect.poll(() => reads.held !== undefined, { timeout: 5_000 }).toBe(true);
  const held = reads.held;
  if (held === undefined) {
    throw new Error('the site holds no room read');
  }
  return held;
}

Given(
  'the site is waiting for a slow answer that says the room is awaiting the host',
  async ({ world, scenario }) => {
    const reads = await installRoomReads(world, scenario);
    reads.plan.set(2, { kind: 'hold' });
    await world.currentVisitor.page.reload();
    const held = await heldRoomRead(reads);
    expect(held.stage, 'the stage of the held answer').toBe('awaiting_host');
  },
);

Given(
  "the site's read before its stream opens has a slow answer that says the room is awaiting the host",
  async ({ world, scenario }) => {
    const reads = await installRoomReads(world, scenario);
    reads.plan.set(1, { kind: 'hold' });
    await world.currentVisitor.page.reload();
    const held = await heldRoomRead(reads);
    expect(held.stage, 'the stage of the held answer').toBe('awaiting_host');
  },
);

Given('the read after the slow answer will fail with a server error', async ({ world, scenario }) => {
  const reads = await installRoomReads(world, scenario);
  reads.plan.set(reads.started + 1, { kind: 'status', status: 500 });
});

Given('the read on the next stream open will answer that there is no room', async ({ world, scenario }) => {
  const reads = await installRoomReads(world, scenario);
  reads.plan.set(2, { kind: 'status', status: 404 });
});

When('the slow answer about the room arrives', async ({ scenario }) => {
  const reads = existingRoomReads(scenario);
  const held = reads.held;
  if (held === undefined) {
    throw new Error('the site holds no room read in this scenario');
  }
  // The held read is the last one started: the site's next read is the one after it.
  reads.releasedAt = reads.started;
  held.release();
});

Then('the site reads the room again', async ({ world, scenario }) => {
  const reads = existingRoomReads(scenario);
  const released = reads.releasedAt;
  if (released === undefined) {
    throw new Error('the slow answer was not released in this scenario');
  }
  await expect.poll(() => reads.answered, { timeout: 5_000 }).toBeGreaterThan(released);
  await stopRoomReads(world, scenario);
});

Then('the site read the room exactly once after its stream opened', async ({ world, scenario }) => {
  const reads = existingRoomReads(scenario);
  // Read 1 is the loading read, held and released; the stream-open read is the one after it.
  expect(reads.started - 1, 'the reads after the loading read').toBe(1);
  await stopRoomReads(world, scenario);
});

Then('the site shows no room', async ({ world, scenario }) => {
  const reads = existingRoomReads(scenario);
  // The loading read and the stream-open read have both answered before the room can be gone.
  await expect.poll(() => reads.answered, { timeout: 5_000 }).toBeGreaterThanOrEqual(2);
  await expect(world.currentVisitor.page.getByText('Game name', { exact: true })).toBeHidden();
  await stopRoomReads(world, scenario);
});
