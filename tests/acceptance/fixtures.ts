// Shared world for acceptance steps. Add fixtures here (API client for the agent's endpoints, seeded accounts,
// a fake agent that posts observations) — never import from apps/* internals: acceptance tests are black-box
// and talk to the system only through HTTP, SSE and the browser (dependency-cruiser enforces it).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, createBdd } from 'playwright-bdd';
import { startStack, type Stack } from './support/stack.ts';
import { World } from './support/world.ts';

// What the steps of one scenario share. Every scenario gets a fresh object, so nothing leaks between scenarios.
export interface Scenario {
  readonly apiBaseURL: string;
  // The repository root: steps read files and run repository commands relative to it.
  readonly repoRoot: string;
  readonly values: Map<string, unknown>;
}

export const test = base.extend<{ apiBaseURL: string; scenario: Scenario; world: World }, { stack: Stack }>({
  apiBaseURL: async ({ baseURL }, use) => {
    await use(process.env['ACCEPTANCE_API_URL'] ?? `${baseURL ?? 'http://localhost:5173'}/api`);
  },
  scenario: async ({ apiBaseURL }, use) => {
    const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
    await use({ apiBaseURL, repoRoot, values: new Map<string, unknown>() });
  },
  // One stack per worker, started by the first scenario that needs it (design.md § Acceptance stack).
  stack: [
    async ({ browser }, use, workerInfo) => {
      // The browser of the run is named in start-up errors, so a broken run says which build failed.
      const runtime = `${browser.browserType().name()} ${browser.version()}`;
      const stack = await startStack(workerInfo.workerIndex, runtime);
      try {
        await use(stack);
      } finally {
        await stack.close();
      }
    },
    { scope: 'worker', timeout: 180_000 },
  ],
  // The scenario's world. The APIs are reset before each scenario that uses it (AD-045).
  world: async ({ stack, browser }, use) => {
    await stack.reset();
    const world = new World(stack, browser);
    try {
      await use(world);
    } finally {
      await world.dispose();
    }
  },
});

export const { Given, When, Then } = createBdd(test);
