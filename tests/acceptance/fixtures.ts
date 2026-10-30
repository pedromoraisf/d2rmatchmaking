// Shared world for acceptance steps. Add fixtures here (API client for the agent's endpoints, seeded accounts,
// a fake agent that posts observations) — never import from apps/* internals: acceptance tests are black-box
// and talk to the system only through HTTP, SSE and the browser (dependency-cruiser enforces it).
import { test as base, createBdd } from 'playwright-bdd';

export const test = base.extend<{ apiBaseURL: string }>({
  apiBaseURL: async ({ baseURL }, use) => {
    await use(process.env['ACCEPTANCE_API_URL'] ?? `${baseURL ?? 'http://localhost:5173'}/api`);
  },
});

export const { Given, When, Then } = createBdd(test);
