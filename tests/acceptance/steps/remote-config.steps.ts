// Steps of remote-config (RCF-01, RCF-02, RCF-05, RCF-06, RCF-08): the configuration the API serves to an agent, and the
// agent that applies it. The API scenarios (`@api`) are black box over HTTP with the simulated agent, a session cookie and
// no credential. The agent scenarios (`@agent`) run the headless example (the real core and the real HTTP gateway) against
// the staging API, which serves the text a scenario names through the staging test control (`PUT /__test/agent-config`).
//
// The example's side of the agent scenarios is T14 (batch 2): it prints one `config` line per fetch,
//   {"event":"config","version":<n>,"outcome":"applied|unchanged|invalid|stale|unreachable","probeEvery":<n>,
//    "phrases":"built-in|configured"}
// takes `--config-dir <dir>` (where it keeps the last good body) and `--config-every-ms <n>` (the poll interval; six hours
// in the product). Until T14 lands, the `@agent` scenarios fail at their first `config` event.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect } from '@playwright/test';
import { After, Given, Then, When, test } from '../fixtures.ts';
import { AGENT_VERSION } from '../support/agent-client.ts';
import { HeadlessAgent, preparePartyFixture, type AgentEvent } from '../support/headless-agent.ts';
import { SESSION_COOKIE, submitPairingCode, type World } from '../support/world.ts';

const CONFIG_PATH = '/v1/agents/config';
/** The built-in probe cadence: the capture cascade's `PROBE_EVERY` (RCF-07). */
const BUILT_IN_PROBE_EVERY = 60;
/** The poll interval the example is given: scenarios cannot wait six hours (RCF-04 keeps six hours in the product). */
const POLL_MS = 500;
/** The example builds on first use, which takes minutes on a cold cache, and pairs within the code's lifetime after it. */
const START_TIMEOUT_MS = 180_000;
/** How long a scenario waits for the agent to fetch again and to print the result. */
const FETCH_TIMEOUT_MS = 45_000;
/** An address nothing listens on: the agent restarts "while the API does not answer". */
const UNREACHABLE_API = 'http://127.0.0.1:9';
/** The four sections of the document and no other (RCF-02). */
const SECTIONS = ['cadence', 'phrases', 'regions', 'thresholds'];

// --- the API scenarios: who reads the configuration (RCF-01, RCF-02) ---------------------------------------------------

/** The version tag of the last configuration answer of a scenario, for "naming the version it holds". */
const lastEtag = new WeakMap<World, string>();

function recordAnswer(world: World, answer: { status: number; body: unknown; headers: Headers }): void {
  world.last = { status: answer.status, body: answer.body };
  const etag = answer.headers.get('etag');
  if (etag !== null) lastEtag.set(world, etag);
}

When('the agent asks for the remote configuration with its token', async ({ world }) => {
  recordAnswer(world, await world.lastAgent.send(CONFIG_PATH, { method: 'GET' }));
});

When(
  /^(a browser session without an agent|a caller with no credential|a caller with an unknown token) asks for the remote configuration$/,
  async ({ world }, caller: string) => {
    if (caller === 'a browser session without an agent') {
      // The player's session cookie alone: no agent token (AGT-01).
      const owner = world.lastOwner;
      if (owner === undefined) throw new Error('no player is signed in in this scenario');
      const cookie = `${SESSION_COOKIE}=${await world.sessionOf(owner)}`;
      recordAnswer(
        world,
        await world.lastAgent.send(CONFIG_PATH, { method: 'GET', bearer: null, headers: { Cookie: cookie } }),
      );
      return;
    }
    const bearer = caller === 'a caller with no credential' ? null : `d2rmm_a_${'A'.repeat(43)}`;
    recordAnswer(world, await world.lastAgent.send(CONFIG_PATH, { method: 'GET', bearer }));
  },
);

When('the agent asks again, naming the version it holds', async ({ world }) => {
  const etag = lastEtag.get(world);
  expect(etag, 'the tag of the version the agent was served').toBeDefined();
  recordAnswer(
    world,
    await world.lastAgent.send(CONFIG_PATH, { method: 'GET', headers: { 'If-None-Match': etag ?? '' } }),
  );
});

// AGT-02 for this route (RCF-01): the player revokes the agent on the site; the agent's token is then refused. The quoted
// form of this step belongs to agent-trust and also waits for the agent's stream; this one is the plain revoke.
When(/^([A-Za-z]+) revokes the agent$/, async ({ world }, name: string) => {
  const cookie = `${SESSION_COOKIE}=${await world.sessionOf(name)}`;
  const mine = await fetch(`${world.site.api}/v1/agents/me`, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(10_000),
  });
  const agentId = ((await mine.json()) as { agentId?: string }).agentId;
  expect(agentId, 'the id of the paired agent').toBeDefined();
  const revoked = await fetch(`${world.site.api}/v1/agents/${agentId}`, {
    method: 'DELETE',
    headers: { Cookie: cookie, Origin: world.site.site, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(10_000),
  });
  expect(revoked.status, 'revoking the agent').toBe(204);
});

Then('the configuration has a version that is a whole number', ({ world }) => {
  const version = (world.last?.body as { version?: unknown } | undefined)?.version;
  expect(Number.isInteger(version), `the version ${String(version)} is a whole number`).toBe(true);
  expect(version as number, 'the version of a served document').toBeGreaterThanOrEqual(1);
});

Then('the configuration has the sections {string} and no other', ({ world }, sections: string) => {
  const wanted = sections.split(',').map((section) => section.trim());
  expect(wanted.slice().sort(), 'the sections the scenario names are the four of the schema').toEqual(
    SECTIONS,
  );
  const body = world.last?.body;
  expect(typeof body === 'object' && body !== null, 'the configuration is a JSON object').toBe(true);
  expect(
    Object.keys(body as object)
      .filter((key) => key !== 'version')
      .sort(),
    'the sections of the served configuration',
  ).toEqual(SECTIONS);
});

// --- the agent scenarios: the configuration the agent runs (RCF-05, RCF-06, RCF-08) ------------------------------------

interface ConfigAgentState {
  agent?: HeadlessAgent;
  dir?: string;
  fixture?: string;
  /** How many `config` lines the agent had printed when the scenario last changed what the API serves. */
  mark: number;
}

const agentStates = new WeakMap<World, ConfigAgentState>();

function stateOf(world: World): ConfigAgentState {
  let state = agentStates.get(world);
  if (state === undefined) {
    state = { mark: 0 };
    agentStates.set(world, state);
  }
  return state;
}

function configLines(agent: HeadlessAgent): AgentEvent[] {
  return agent.events.filter((event) => event.event === 'config');
}

/** Serves a document the scenario names, as text (so a value outside the range reaches the agent untouched). */
async function serve(world: World, document: Record<string, unknown>): Promise<void> {
  const version = document['version'];
  await world.stack.serveAgentConfig(
    JSON.stringify(document),
    typeof version === 'number' ? version : undefined,
  );
}

/** Starts the headless agent for the player: pairs it, keeps its last good configuration in the scenario's directory. */
async function startAgent(world: World, name: string, apiBase: string, pair: boolean): Promise<void> {
  test.setTimeout(START_TIMEOUT_MS);
  const state = stateOf(world);
  state.dir ??= mkdtempSync(path.join(tmpdir(), 'd2rmm-rcf-'));
  state.fixture ??= preparePartyFixture(state.dir, { gameNameField: 'xxxxxxxxx' }).png;
  await HeadlessAgent.build();
  state.agent = HeadlessAgent.start({
    apiBase,
    fixture: state.fixture,
    party: true,
    consent: true,
    agentVersion: AGENT_VERSION,
    extraArgs: ['--config-dir', path.join(state.dir, 'config'), '--config-every-ms', String(POLL_MS)],
  });
  if (pair) {
    const shown = await state.agent.waitFor('code', START_TIMEOUT_MS);
    const paired = await submitPairingCode(world.site, await world.sessionOf(name), String(shown['code']));
    expect(paired.status, 'pairing the headless agent').toBe(200);
    await state.agent.waitFor('paired');
  }
}

/** The last `config` line the agent printed after the mark, waiting for one to appear. */
async function configAfterMark(world: World): Promise<AgentEvent> {
  const state = stateOf(world);
  const agent = state.agent;
  if (agent === undefined)
    throw new Error("no agent was started in this scenario: 'Alice's agent starts' comes first");
  await expect
    .poll(() => configLines(agent).length, {
      message: 'the agent prints a config line after the API changed',
      timeout: FETCH_TIMEOUT_MS,
    })
    .toBeGreaterThan(state.mark);
  const last = configLines(agent).at(-1);
  if (last === undefined) throw new Error('the agent printed no config line');
  return last;
}

Given(
  /^the API serves the configuration version (\d+) with a probe cadence of (-?\d+)$/,
  async ({ world }, version: string, probeEvery: string) => {
    await serve(world, { version: Number(version), cadence: { probeEvery: Number(probeEvery) } });
    const agent = stateOf(world).agent;
    stateOf(world).mark = agent === undefined ? 0 : configLines(agent).length;
  },
);

Given(
  /^the API serves the configuration version (\d+) with an unknown field "(.+)"$/,
  async ({ world }, version: string, field: string) => {
    await serve(world, { version: Number(version), [field]: true });
  },
);

Given(
  /^the API serves the configuration version (\d+) with a chat phrase "(.+)" in English$/,
  async ({ world }, version: string, phrase: string) => {
    // The chat phrase fields join the schema with game-name-reading (decision 5); until then the one literal English word a
    // scenario can name is the Party word. A pattern is refused by the agent's rule whichever word it is sent as.
    await serve(world, { version: Number(version), phrases: { en: { party: phrase } } });
  },
);

Given('the API serves no configuration', async ({ world }) => {
  await world.stack.serveAgentConfig(null);
});

When('the API serves a configuration that is not valid JSON', async ({ world }) => {
  const agent = stateOf(world).agent;
  await world.stack.serveAgentConfig('{"version": 6, "cadence": {', 6);
  stateOf(world).mark = agent === undefined ? 0 : configLines(agent).length;
});

When(/^(.+)'s agent starts$/, async ({ world }, name: string) => {
  stateOf(world).mark = 0;
  await startAgent(world, name, world.site.api, true);
});

Given(/^(.+)'s agent has started$/, async ({ world }, name: string) => {
  stateOf(world).mark = 0;
  await startAgent(world, name, world.site.api, true);
  await configAfterMark(world);
  const agent = stateOf(world).agent;
  stateOf(world).mark = agent === undefined ? 0 : configLines(agent).length;
});

When('the agent restarts while the API does not answer', async ({ world }) => {
  const state = stateOf(world);
  await state.agent?.stop();
  state.mark = 0;
  const player = world.lastOwner ?? 'Alice';
  await startAgent(world, player, UNREACHABLE_API, false);
});

Then('the agent runs the configuration version {int}', async ({ world }, version: number) => {
  const line = await configAfterMark(world);
  expect(line['version'], 'the version the agent runs').toBe(version);
});

Then("the agent's probe cadence is {int}", async ({ world }, probeEvery: number) => {
  const line = await configAfterMark(world);
  expect(line['probeEvery'], "the agent's probe cadence").toBe(probeEvery);
});

Then("the agent's probe cadence is the built-in one", async ({ world }) => {
  const line = await configAfterMark(world);
  expect(line['probeEvery'], "the agent's probe cadence").toBe(BUILT_IN_PROBE_EVERY);
});

Then('the agent keeps its built-in chat phrases', async ({ world }) => {
  const line = await configAfterMark(world);
  expect(line['phrases'], "the agent's phrases").toBe('built-in');
});

After({ tags: '@RCF-05 or @RCF-06 or @RCF-08' }, async ({ world }) => {
  const state = agentStates.get(world);
  await state?.agent?.stop();
  if (state?.dir !== undefined) {
    rmSync(state.dir, { recursive: true, force: true });
  }
  agentStates.delete(world);
  lastEtag.delete(world);
});
