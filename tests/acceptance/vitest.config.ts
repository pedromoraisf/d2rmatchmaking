// Unit tests of the acceptance support code. Playwright runs the scenarios (playwright.config.ts); this config runs only the
// `support/**/*.test.ts` files, so no scenario is run twice and no test file is run by Playwright.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['support/**/*.test.ts'],
  },
});
