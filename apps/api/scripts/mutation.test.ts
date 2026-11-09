import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Layer } from './mutation-plan.ts';
import { type ChangedFilesLister, parseMutationArgs, runMutation, type StrykerRunner } from './mutation.ts';

// A temporary repository mirroring the real layout: <repo>/apps/api is the API root, reports go to <repo>/reports.
let repo: string;
let apiRoot: string;
let summaryFile: string;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'd2rmm-mutation-run-'));
  apiRoot = join(repo, 'apps', 'api');
  summaryFile = join(repo, 'summary.md');
  await mkdir(apiRoot, { recursive: true });
  await writeFile(summaryFile, '');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(repo, { recursive: true, force: true });
});

async function writeSource(relative: string, content = 'export {};\n'): Promise<void> {
  const file = join(apiRoot, relative);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

interface Call {
  readonly layer: Layer;
  readonly args: readonly string[];
}

/** A Stryker stand-in that records each layer it is asked to run and returns the exit code given for that layer. */
function fakeStryker(exitByLayer: Partial<Record<Layer, number>> = {}): {
  run: StrykerRunner;
  calls: Call[];
} {
  const calls: Call[] = [];
  const run: StrykerRunner = (_root, layer, args) => {
    calls.push({ layer, args: [...args] });
    return exitByLayer[layer] ?? 0;
  };
  return { run, calls };
}

/** A changed-files stand-in: the list is fixed and the ref it was asked for is recorded. */
function fakeChanged(files: readonly string[]): { list: ChangedFilesLister; refs: string[] } {
  const refs: string[] = [];
  const list: ChangedFilesLister = (_root, ref) => {
    refs.push(ref);
    return files;
  };
  return { list, refs };
}

async function readReport(layer: Layer): Promise<{ files: Record<string, unknown> }> {
  return JSON.parse(
    await readFile(join(repo, 'reports', 'mutation', `api-${layer}`, 'mutation.json'), 'utf8'),
  ) as { files: Record<string, unknown> };
}

describe('mutation runner arguments', () => {
  it('takes --changed-from and passes every other argument to Stryker', () => {
    expect(parseMutationArgs(['--changed-from', 'origin/main', '--incremental'])).toEqual({
      changedFrom: 'origin/main',
      strykerArgs: ['--incremental'],
    });
  });

  it('ignores a separator forwarded by pnpm and rejects a missing ref', () => {
    expect(parseMutationArgs(['--', '--incremental']).strykerArgs).toEqual(['--incremental']);
    expect(() => parseMutationArgs(['--changed-from'])).toThrow('--changed-from needs a git ref');
  });
});

describe('mutation runner with --changed-from', () => {
  it('keeps only the files the PR changes in each layer', async () => {
    await writeSource('src/shared-kernel/result.ts');
    await writeSource('src/shared-kernel/clock.ts');
    await writeSource('src/modules/identity/application/register.ts');
    await writeSource('src/modules/identity/application/login.ts');
    const stryker = fakeStryker();
    const changed = fakeChanged([
      'src/shared-kernel/result.ts',
      'src/modules/identity/application/register.ts',
      'src/modules/identity/adapters/http.ts',
    ]);

    const exitCode = await runMutation(apiRoot, ['--changed-from', 'origin/main'], stryker.run, changed.list);

    expect(exitCode).toBe(0);
    expect(changed.refs).toEqual(['origin/main']);
    expect(stryker.calls).toEqual([
      { layer: 'domain', args: ['--mutate', 'src/shared-kernel/result.ts'] },
      { layer: 'application', args: ['--mutate', 'src/modules/identity/application/register.ts'] },
    ]);
  });

  it('starts no Stryker run for a layer with no changed file and writes its empty report', async () => {
    await writeSource('src/shared-kernel/result.ts');
    await writeSource('src/modules/identity/application/register.ts');
    const stryker = fakeStryker();
    const changed = fakeChanged(['src/shared-kernel/result.ts']);

    await runMutation(apiRoot, ['--changed-from', 'origin/main', '--incremental'], stryker.run, changed.list);

    expect(stryker.calls.map((call) => call.layer)).toEqual(['domain']);
    const report = await readReport('application');
    expect(report.files).toEqual({});
  });

  it('says no mutable file changed when the PR touches none', async () => {
    await writeSource('src/shared-kernel/result.ts');
    await writeSource('src/modules/identity/application/register.ts');
    const stryker = fakeStryker();
    const changed = fakeChanged(['README.md', 'src/modules/identity/adapters/http.ts']);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.stubEnv('GITHUB_STEP_SUMMARY', summaryFile);

    const exitCode = await runMutation(apiRoot, ['--changed-from', 'origin/main'], stryker.run, changed.list);

    expect(exitCode).toBe(0);
    expect(stryker.calls).toEqual([]);
    expect(stdout).toHaveBeenCalledWith('No mutable file changed\n');
    expect(await readFile(summaryFile, 'utf8')).toBe('No mutable file changed\n');
    expect((await readReport('domain')).files).toEqual({});
    expect((await readReport('application')).files).toEqual({});
  });

  it('reports a Stryker failure of a changed layer as the exit code', async () => {
    await writeSource('src/shared-kernel/result.ts');
    const stryker = fakeStryker({ domain: 3 });
    const changed = fakeChanged(['src/shared-kernel/result.ts']);

    const exitCode = await runMutation(apiRoot, ['--changed-from', 'origin/main'], stryker.run, changed.list);

    expect(exitCode).toBe(3);
  });
});

describe('mutation runner without --changed-from', () => {
  it('runs every file without --changed-from', async () => {
    await writeSource('src/shared-kernel/result.ts');
    await writeSource('src/modules/identity/application/register.ts');
    const stryker = fakeStryker();
    const changed = fakeChanged(['README.md']);

    const exitCode = await runMutation(apiRoot, ['--incremental'], stryker.run, changed.list);

    expect(exitCode).toBe(0);
    expect(changed.refs).toEqual([]);
    expect(stryker.calls).toEqual([
      { layer: 'domain', args: ['--incremental'] },
      { layer: 'application', args: ['--incremental'] },
    ]);
  });
});
