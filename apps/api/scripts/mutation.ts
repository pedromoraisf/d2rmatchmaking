import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { emptyReport, type Layer, planLayer } from './mutation-plan.ts';

/** Runs Stryker for one layer under `apiRoot` and returns its exit code. */
export type StrykerRunner = (apiRoot: string, layer: Layer, args: readonly string[]) => number;

const LAYERS: readonly Layer[] = ['domain', 'application'];

export function runStryker(apiRoot: string, layer: Layer, args: readonly string[]): number {
  const result = spawnSync('pnpm', ['exec', 'stryker', 'run', ...args], {
    cwd: apiRoot,
    env: { ...process.env, STRYKER_LAYER: layer },
    stdio: 'inherit',
  });
  return result.status ?? 1;
}

/**
 * Runs every layer in order. A layer with no file to mutate gets an empty report and Stryker is not started;
 * the other layers run Stryker with `args`. Returns the first non-zero Stryker exit code, or 0.
 */
export async function runMutation(
  apiRoot: string,
  args: readonly string[],
  stryker: StrykerRunner = runStryker,
): Promise<number> {
  let exitCode = 0;
  for (const layer of LAYERS) {
    const plan = await planLayer(apiRoot, layer);
    if (plan.files.length === 0) {
      await mkdir(dirname(plan.reportPath), { recursive: true });
      await writeFile(plan.reportPath, `${JSON.stringify(emptyReport(), null, 2)}\n`);
      continue;
    }
    const code = stryker(apiRoot, layer, args);
    if (exitCode === 0) {
      exitCode = code;
    }
  }
  return exitCode;
}

const isEntrypoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  process.exitCode = await runMutation(apiRoot, process.argv.slice(2));
}
