import { glob } from 'node:fs/promises';
import { join } from 'node:path';

/** Mutation layers of the API (ADR 014): the pure domain and the application use cases. */
export type Layer = 'domain' | 'application';

export const MUTATION_LAYERS: readonly Layer[] = ['domain', 'application'];

export interface LayerConfig {
  readonly mutate: readonly string[];
  readonly thresholds: { readonly high: number; readonly low: number; readonly break: number };
  readonly jsonReporter: { readonly fileName: string };
  readonly htmlReporter: { readonly fileName: string };
  readonly incrementalFile: string;
}

export interface LayerPlan {
  /** Source files to mutate, relative to the API root, sorted. Empty when the layer has nothing to mutate. */
  readonly files: readonly string[];
  /** Absolute path of the JSON report the layer writes at the repository root. */
  readonly reportPath: string;
}

// The break values mirror the floors of mutation.api.domain and mutation.api.application in
// .quality-baseline.json. Changing one means changing the other (a maintainer decision, AGENTS.md rule 4).
const SOURCE_GLOBS: Readonly<Record<Layer, readonly string[]>> = {
  domain: ['src/modules/*/domain/**/*.ts', 'src/shared-kernel/**/*.ts'],
  application: ['src/modules/*/application/**/*.ts'],
};

const BREAK_THRESHOLDS: Readonly<Record<Layer, { high: number; low: number; break: number }>> = {
  domain: { high: 90, low: 80, break: 80 },
  application: { high: 85, low: 70, break: 70 },
};

/** Stryker options of one layer, merged into stryker.config.mjs. Paths are relative to apps/api, where Stryker runs. */
export function layerConfig(layer: Layer): LayerConfig {
  const reportDir = `../../reports/mutation/api-${layer}`;
  return {
    mutate: [...SOURCE_GLOBS[layer], '!src/**/*.test.ts'],
    thresholds: BREAK_THRESHOLDS[layer],
    jsonReporter: { fileName: `${reportDir}/mutation.json` },
    htmlReporter: { fileName: `${reportDir}/mutation.html` },
    incrementalFile: `reports/stryker-incremental-${layer}.json`,
  };
}

/** Absolute path of the JSON report a layer writes at the repository root (`apiRoot` is apps/api). */
export function layerReportPath(apiRoot: string, layer: Layer): string {
  return join(apiRoot, '..', '..', 'reports', 'mutation', `api-${layer}`, 'mutation.json');
}

/**
 * Lists the layer's source files under `apiRoot` and the repository-root report path for it. With `changed`, keeps only
 * the files that are in it (paths relative to `apiRoot`, as the glob returns them).
 */
export async function planLayer(
  apiRoot: string,
  layer: Layer,
  changed?: ReadonlySet<string>,
): Promise<LayerPlan> {
  const found = new Set<string>();
  for (const pattern of SOURCE_GLOBS[layer]) {
    for await (const file of glob(pattern, { cwd: apiRoot })) {
      if (!file.endsWith('.test.ts') && (changed === undefined || changed.has(file))) {
        found.add(file);
      }
    }
  }
  return {
    files: [...found].sort(),
    reportPath: layerReportPath(apiRoot, layer),
  };
}

/** The report of a layer with nothing to mutate: zero mutants, so the collector scores it as not measured. */
export function emptyReport() {
  return { schemaVersion: '2', thresholds: { high: 80, low: 60 }, files: {} };
}
