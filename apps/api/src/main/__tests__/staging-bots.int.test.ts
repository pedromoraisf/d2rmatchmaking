// The staging bots against the real app (staging-bots SBT-05, SBT-06, SBT-07, SBT-10): one human player and the bots form a
// group on a real clock, every member accepts, the room reaches `active`, and when the room closes the bots leave and
// their agents are gone. The script is the one the workflow runs; the "human" is a bot account that the test controls.
import { Writable } from 'node:stream';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  type MigratedTestDatabase,
} from '../../../test/support/migrated-database.ts';
import { buildApp, type AppDatabase, type BuiltApp } from '../app.ts';
import { ClockScheduler, NodeRandomSource, RandomUuidGenerator, SystemClock } from '../runtime.ts';

const SITE_ORIGIN = 'https://site.example';
const STAGING_SCRIPTS = new URL('../../../../../scripts/staging/', import.meta.url).href;

interface Bot {
  readonly name: string;
  readonly state: { cookie: string; roomId?: string; stages: string[]; ended: boolean };
  provision(): Promise<void>;
  start(): void;
  join(): Promise<void>;
  leaveSteps(): Array<[string, () => Promise<unknown>]>;
}
interface Scripts {
  run(input: {
    config: Record<string, unknown>;
    fetch: typeof fetch;
    write: (text: string) => void;
    random?: () => number;
    signal?: AbortSignal;
  }): Promise<number>;
  createBot(input: Record<string, unknown>): Bot;
  createClient(input: Record<string, unknown>): unknown;
  createLog(input: Record<string, unknown>): { line: (event: string, fields?: object) => void };
  buildPlan(input: Record<string, string>, tag: string): { queue: Record<string, unknown> };
}

let database: MigratedTestDatabase<AppDatabase>;
let built: BuiltApp;
let base: string;
let scripts: Scripts;

async function load(): Promise<Scripts> {
  const [bots, bot, http, log, plan] = await Promise.all([
    import(`${STAGING_SCRIPTS}bots.mjs`),
    import(`${STAGING_SCRIPTS}lib/bot.mjs`),
    import(`${STAGING_SCRIPTS}lib/http.mjs`),
    import(`${STAGING_SCRIPTS}lib/log.mjs`),
    import(`${STAGING_SCRIPTS}lib/plan.mjs`),
  ]);
  return { ...bots, ...bot, ...http, ...log, ...plan } as Scripts;
}

beforeAll(async () => {
  database = await createMigratedTestDatabase<AppDatabase>();
  scripts = await load();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  const clock = new SystemClock();
  built = await buildApp({
    db: database.db,
    config: { stagingEndpoints: true, minAgentVersion: '0.0.1', siteOrigin: SITE_ORIGIN, trustProxyHops: 1 },
    clock,
    scheduler: new ClockScheduler(clock),
    random: new NodeRandomSource(),
    ids: new RandomUuidGenerator(),
    logSink: new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
  });
  base = await built.app.listen({ host: '127.0.0.1', port: 0 });
});

afterEach(async () => {
  await built.app.close();
});

const quiet = (): { line: (event: string, fields?: object) => void; secret: () => void } => ({
  line: (event, fields) => {
    if (process.env['DEBUG_BOTS'] !== undefined) process.stderr.write(`${event} ${JSON.stringify(fields)}\n`);
  },
  secret: () => undefined,
});

/** The human of the test: the same account kind and agent a player has, queued first (the maintainer's side). */
async function human(
  inputs: Record<string, string>,
  queueOverride: Record<string, unknown> = {},
): Promise<Bot> {
  const plan = scripts.buildPlan({ ...inputs, bots: '1' }, 'hh');
  const member = { ...plan, ...{} };
  const botPlan = { ...plan, queue: { ...plan.queue, ...queueOverride }, hostPolicy: 'bot-reports' };
  const client = scripts.createClient({
    base,
    origin: SITE_ORIGIN,
    version: '0.5.0',
    fetch,
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 50))),
  });
  const bots = (member as unknown as { bots: Array<Record<string, unknown>> }).bots;
  const alice = scripts.createBot({
    member: { ...bots[0], name: 'alice-test' },
    plan: botPlan,
    client,
    base,
    fetch,
    log: quiet(),
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 50))),
    random: () => 0,
  });
  await alice.provision();
  alice.start();
  await alice.join();
  return alice;
}

async function roomIsClosedBy(alice: Bot): Promise<void> {
  const deadline = Date.now() + (process.env['DEBUG_BOTS'] === undefined ? 60_000 : 25_000);
  while (alice.state.roomId === undefined || !alice.state.stages.includes('active')) {
    if (Date.now() > deadline)
      throw new Error(`the room never became active: ${alice.state.stages.join(',')}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const closed = await fetch(`${base}/v1/lobby-rooms/${alice.state.roomId}/close`, {
    method: 'POST',
    headers: { Cookie: alice.state.cookie, Origin: SITE_ORIGIN, 'Content-Type': 'application/json' },
    body: '{}',
  });
  expect(closed.status).toBe(204);
}

function configFor(inputs: Record<string, string>): Record<string, unknown> {
  return {
    apiUrl: base,
    expectedUrl: base,
    siteOrigin: SITE_ORIGIN,
    environment: undefined,
    runId: '7777',
    inputs: { ...inputs, minutes: '2' },
  };
}

/** The agents whose token still works: a revoked agent keeps its row, but its token no longer opens a route (NFR-06). */
async function agentsLeft(): Promise<number> {
  const rows = await database.db
    .selectFrom('agents.agents')
    .select('id')
    .where('revoked_at', 'is', null)
    .execute();
  return rows.length;
}

describe('the staging bots fill a group on the real app', () => {
  it('a duel: one bot and one player form a group, accept, confirm, and the bot leaves when the room closes (SBT-05, SBT-06, SBT-07, SBT-10)', async () => {
    const inputs = { mode: 'pvp', difficulty: 'hell', ladder: 'ladder', era: 'rotw' };
    const alice = await human(inputs);
    const finished = scripts.run({
      config: configFor(inputs),
      fetch,
      write: (text) => {
        if (process.env['DEBUG_BOTS'] !== undefined) process.stderr.write(text);
      },
      random: () => 0,
    });
    try {
      await roomIsClosedBy(alice);
      expect(await finished).toBe(0);
      expect(alice.state.stages).toContain('active');
      // Only the human's agent still works: the bot revoked its own (NFR-06).
      expect(await agentsLeft()).toBe(1);
    } finally {
      for (const [, step] of alice.leaveSteps()) await step();
    }
  }, 120_000);

  it('Leveling: seven bots and one player form a group of eight, and every bot leaves (SBT-06, SBT-10)', async () => {
    const inputs = { mode: 'leveling', difficulty: 'hell', ladder: 'ladder', era: 'rotw', activity: 'baal' };
    // The player is the teleporter, so the match names them host and the bots (killers) never host.
    const alice = await human(inputs, { role: 'teleporter' });
    const finished = scripts.run({
      config: configFor(inputs),
      fetch,
      write: () => undefined,
      random: () => 0,
    });
    try {
      await roomIsClosedBy(alice);
      expect(await finished).toBe(0);
      expect(await agentsLeft()).toBe(1);
    } finally {
      for (const [, step] of alice.leaveSteps()) await step();
    }
  }, 180_000);
});
