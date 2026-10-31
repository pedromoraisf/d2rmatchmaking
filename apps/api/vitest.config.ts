import { configDefaults, defineConfig } from 'vitest/config';

// Unit tests. Integration tests (*.int.test.ts) need Testcontainers and run only under vitest.integration.config.ts,
// so Stryker, which runs this config, never starts a container.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/*.int.test.ts'],
  },
});
