import { configDefaults, defineConfig } from 'vitest/config';

// Integration tests (ADR 014): one Postgres container per run, started once by the global setup in
// test/support/postgres.ts, and a fresh database for every test file. One fork, one file at a time.
// Integration tests sit next to the code they exercise (src/**) or under test/ (support tests).
export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts', 'test/**/*.int.test.ts'],
    exclude: [...configDefaults.exclude],
    globalSetup: ['test/support/postgres.ts'],
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
