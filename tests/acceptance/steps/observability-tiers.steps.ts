// Steps of observability-tiers (OBT-01, OBT-03, OBT-04, OBT-12; ADR 037). "The API runs as <environment>" (re)starts the
// traced stack with that D2RMM_ENV, so the same scenarios run against a staging API (the full tier) and a production API
// (the production tier). The trace steps read the trace of the site's own action by its trace id (lessons: Tempo's search
// index lags). "the telemetry backend is running locally" and "starts a test match on the site" are the steps of
// observability.steps.ts; the last one signs the player in on the site when the scenario has not.
import { expect } from '@playwright/test';
import { After, Given, Then, When, test } from '../fixtures.ts';
import { FakeTelemetryBackend, startTracedStack } from '../support/stack.ts';
import { stateOf, existingStateOf, TRACED_START_TIMEOUT_MS } from '../support/scenario-state.ts';
import { isDroppedKey, STAGING_ONLY_KEYS } from '../support/forbidden-keys.ts';
import { leaksIn, readTrace, type SpanRecord, type Trace } from '../support/trace-reader.ts';
import { startedBackend } from './observability.steps.ts';

/** The values `D2RMM_ENV` takes in the traced stack. */
type Environment = 'staging' | 'production';

function environmentOf(name: string): Environment {
  if (name !== 'staging' && name !== 'production') {
    throw new Error(`the API runs as "staging" or "production", not "${name}"`);
  }
  return name;
}

// The scenarios of the recording notice carry no @NFR-09 tag, so the cleanup of observability.steps.ts does not close their stack.
After({ tags: '@OBT-12' }, async ({ world }) => {
  const state = existingStateOf(world);
  await state?.traced?.close();
  await state?.fake?.stop();
});

Given(/^the API runs as "(.+)"$/, async ({ world }, name: string) => {
  test.setTimeout(TRACED_START_TIMEOUT_MS);
  const environment = environmentOf(name);
  const state = stateOf(world);
  const running = startedBackend();
  let otlpEndpoint: string;
  if (running === undefined) {
    // No trace is read in this scenario: the API exports to a backend that only records.
    const fake = new FakeTelemetryBackend();
    await fake.start();
    state.fake = fake;
    otlpEndpoint = fake.url;
  } else {
    otlpEndpoint = (await running).otlpUrl;
  }
  // The stack the telemetry-backend step started runs as production; this scenario's environment replaces it.
  await state.traced?.close();
  state.traced = await startTracedStack({ otlpEndpoint, environment });
  world.site = state.traced.staging;
});

When('the site loads its start configuration', async ({ world }) => {
  const answer = await fetch(`${world.site.api}/v1/config`, { signal: AbortSignal.timeout(10_000) });
  world.last = { status: answer.status, body: (await answer.json()) as unknown };
});

Then('the site is told the telemetry tier {string}', ({ world }, tier: string) => {
  expect(world.last?.status, 'the status of the start configuration').toBe(200);
  expect(world.last?.body, 'the start configuration').toMatchObject({ telemetryTier: tier });
});

/** The trace of the site action of the scenario, once it holds a span carrying `key`. */
async function journeyTrace(world: Parameters<typeof stateOf>[0], key: string): Promise<Trace> {
  const traceparent = stateOf(world).siteTraceparent;
  expect(traceparent, 'the site traceparent').toBeDefined();
  const traceId = String(traceparent).split('-')[1] ?? '';
  const running = await startedBackend();
  expect(running, 'the telemetry backend runs in this scenario').toBeDefined();
  return readTrace(running?.queryUrl ?? '', traceId, (trace) =>
    trace.spans.some((span) => span.attributes[key] !== undefined),
  );
}

function carrying(trace: Trace, key: string): SpanRecord[] {
  return trace.spans.filter((span) => span.attributes[key] !== undefined);
}

Then("the API's spans of that journey carry the account, ticket and room ids", async ({ world }) => {
  const trace = await journeyTrace(world, 'd2r.room.id');
  expect(carrying(trace, 'd2r.account.id').length, 'spans with the account id').toBeGreaterThan(0);
  expect(carrying(trace, 'd2r.room.id').length, 'spans with the room id').toBeGreaterThan(0);
  // A test match forms no queue ticket, so `d2r.ticket.id` is proven on the queue spans by the API unit tests
  // (matchmaking/application/journey-spans.test.ts); here the ids the test-match journey has are checked.
});

Then('none of those spans carries a BattleTag or a character name', async ({ world }) => {
  const trace = await journeyTrace(world, 'd2r.room.id');
  const player = String(world.matchOwner);
  const tierKeys = trace.spans.flatMap((span) =>
    Object.keys(span.attributes).filter((key) => STAGING_ONLY_KEYS.includes(key) || isDroppedKey(key)),
  );
  expect(tierKeys, 'keys only the full tier carries').toStrictEqual([]);
  expect(leaksIn(trace.spans, player), 'the player name in the exported spans').toStrictEqual([]);
});

Then("the spans of that journey carry the player's BattleTag", async ({ world }) => {
  const trace = await journeyTrace(world, 'd2r.account.battletag');
  const names = carrying(trace, 'd2r.account.battletag').map(
    (span) => span.attributes['d2r.account.battletag'],
  );
  expect(names, 'the BattleTag of the signed-in player').toContain(String(world.matchOwner));
});

Then('the site says that everything done here is recorded for debugging', async ({ world }) => {
  const notice = world.currentVisitor.page.getByRole('note');
  await expect(notice, 'the recording notice').toContainText(/recorded for debugging/u, { timeout: 30_000 });
});

Then('the site shows no recording notice', async ({ world }) => {
  const page = world.currentVisitor.page;
  // The tier arrives with a request of its own (the site reads the configuration twice: the page and the telemetry start).
  // Wait for both answers before looking for the notice, or an absent notice could mean "not yet".
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/v1/config'))
              .length,
        ),
      { message: 'the configuration reads of the site', timeout: 30_000 },
    )
    .toBeGreaterThanOrEqual(2);
  await expect(page.getByRole('note'), 'the recording notice').toHaveCount(0);
});
