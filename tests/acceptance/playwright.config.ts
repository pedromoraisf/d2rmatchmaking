// Acceptance tests (ADR 023). The approved Gherkin scenarios in .specs/features/<feature>/acceptance.feature are
// executed directly — they are never copied. Changing this file is a harness change (the gate hook asks).
import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

const testDir = defineBddConfig({
  featuresRoot: '../../.specs/features',
  features: '../../.specs/features/*/acceptance.feature',
  steps: ['./fixtures.ts', './steps/**/*.steps.ts'],
  outputDir: '.features-gen',
  // A scenario whose steps are not implemented fails generation: no silent "pending" scenarios.
  missingSteps: 'fail-on-gen',
});

export default defineConfig({
  testDir,
  // Retries hide failures outside the retry budget (ADR 022): always 0 here. Focused tests fail the run.
  retries: 0,
  forbidOnly: true,
  fullyParallel: true,
  timeout: 60_000,
  reporter: [
    ['list'],
    ['json', { outputFile: '../../reports/acceptance/results.json' }],
    ['html', { open: 'never', outputFolder: '../../reports/acceptance/html' }],
  ],
  use: {
    baseURL: process.env['ACCEPTANCE_BASE_URL'] ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
