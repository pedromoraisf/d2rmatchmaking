// Stryker configuration for the API (ADR 014). One config, one layer per run: scripts/mutation.ts sets
// STRYKER_LAYER to `domain` or `application` and the layer's globs, thresholds and report paths come from
// scripts/mutation-plan.ts.
import { layerConfig } from './scripts/mutation-plan.ts';

const layer = process.env.STRYKER_LAYER;
if (layer !== 'domain' && layer !== 'application') {
  throw new Error(
    `STRYKER_LAYER must be "domain" or "application", got "${layer ?? ''}". Run pnpm test:mutation.`,
  );
}

export default {
  // Named explicitly: Stryker's default `@stryker-mutator/*` glob scans the pnpm store next to @stryker-mutator/core,
  // where the checker is not installed, so the typescript checker would not load.
  plugins: ['@stryker-mutator/vitest-runner', '@stryker-mutator/typescript-checker'],
  testRunner: 'vitest',
  checkers: ['typescript'],
  reporters: ['json', 'html', 'clear-text', 'progress'],
  ...layerConfig(layer),
};
