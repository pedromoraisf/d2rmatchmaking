import { spawnSync } from 'node:child_process';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { emptyReport, type Layer, type LayerPlan, planLayer } from './mutation-plan.ts';

/** Runs Stryker for one layer under `apiRoot` and returns its exit code. */
export type StrykerRunner = (apiRoot: string, layer: Layer, args: readonly string[]) => number;

/** Lists the files changed between `ref` and HEAD, relative to `apiRoot`. */
export type ChangedFilesLister = (apiRoot: string, ref: string) => readonly string[];

export const NO_MUTABLE_FILE = 'No mutable file changed';

const LAYERS: readonly Layer[] = ['domain', 'application'];

export interface MutationArgs {
  /** The git ref given with `--changed-from`, when the run mutates only the files a change touches. */
  readonly changedFrom?: string | undefined;
  /** Every other argument, passed to Stryker unchanged. */
  readonly strykerArgs: readonly string[];
}

/** Splits the runner's arguments: `--changed-from <ref>` is the runner's own, the rest belongs to Stryker. */
export function parseMutationArgs(argv: readonly string[]): MutationArgs {
  let changedFrom: string | undefined;
  const strykerArgs: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined || arg === '--') {
      // A separator forwarded by `pnpm run <script> --` is not an argument of its own.
      continue;
    }
    if (arg === '--changed-from') {
      const ref = argv[index + 1];
      if (ref === undefined || ref.startsWith('--')) {
        throw new Error('--changed-from needs a git ref, for example --changed-from origin/main');
      }
      changedFrom = ref;
      index += 1;
      continue;
    }
    strykerArgs.push(arg);
  }
  return { changedFrom, strykerArgs };
}

/**
 * The default lister: `git diff --name-only --relative <ref>...HEAD` run in `apiRoot`, so the paths are relative to it
 * and changes outside the API are left out. The three-dot form compares against the merge base.
 */
export function gitChangedFiles(apiRoot: string, ref: string): readonly string[] {
  const result = spawnSync('git', ['diff', '--name-only', '--relative', `${ref}...HEAD`], {
    cwd: apiRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`git diff ${ref}...HEAD failed: ${result.stderr.trim()}`);
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function runStryker(apiRoot: string, layer: Layer, args: readonly string[]): number {
  const result = spawnSync('pnpm', ['exec', 'stryker', 'run', ...args], {
    cwd: apiRoot,
    env: { ...process.env, STRYKER_LAYER: layer },
    stdio: 'inherit',
  });
  return result.status ?? 1;
}

async function writeEmptyReport(plan: LayerPlan): Promise<void> {
  await mkdir(dirname(plan.reportPath), { recursive: true });
  await writeFile(plan.reportPath, `${JSON.stringify(emptyReport(), null, 2)}\n`);
}

/** Prints the no-file line and appends it to the job summary when GitHub Actions provides one. */
async function announceNoMutableFile(): Promise<void> {
  process.stdout.write(`${NO_MUTABLE_FILE}\n`);
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  if (summary !== undefined && summary !== '') {
    await appendFile(summary, `${NO_MUTABLE_FILE}\n`);
  }
}

/**
 * Runs every layer in order. A layer with no file to mutate gets an empty report and Stryker is not started; the other
 * layers run Stryker with `argv` minus `--changed-from`. With `--changed-from <ref>`, a layer mutates only the files the
 * change touches (passed to Stryker with `--mutate`), and when no layer has one the runner says so and exits 0.
 * Returns the first non-zero Stryker exit code, or 0.
 */
export async function runMutation(
  apiRoot: string,
  argv: readonly string[],
  stryker: StrykerRunner = runStryker,
  listChanged: ChangedFilesLister = gitChangedFiles,
): Promise<number> {
  const { changedFrom, strykerArgs } = parseMutationArgs(argv);
  const changed = changedFrom === undefined ? undefined : new Set(listChanged(apiRoot, changedFrom));
  const plans: { readonly layer: Layer; readonly plan: LayerPlan }[] = [];
  for (const layer of LAYERS) {
    plans.push({ layer, plan: await planLayer(apiRoot, layer, changed) });
  }
  if (changed !== undefined && plans.every(({ plan }) => plan.files.length === 0)) {
    await announceNoMutableFile();
  }

  let exitCode = 0;
  for (const { layer, plan } of plans) {
    if (plan.files.length === 0) {
      await writeEmptyReport(plan);
      continue;
    }
    const args = changed === undefined ? strykerArgs : [...strykerArgs, '--mutate', plan.files.join(',')];
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
