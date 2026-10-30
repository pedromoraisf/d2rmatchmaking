import { defineConfig } from 'vitest/config';

// Root Vitest runs every workspace. Lefthook's `unit-related` hook and the quality reports both go through this file.
export default defineConfig({
  test: {
    projects: ['apps/*', 'packages/*'],
  },
});
