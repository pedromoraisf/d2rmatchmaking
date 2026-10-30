import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { layerConfig, planLayer, type Layer } from './mutation-plan.ts';
import { runMutation, type StrykerRunner } from './mutation.ts';

// A temporary repository mirroring the real layout: <repo>/apps/api is the API root, reports go to <repo>/reports.
let repo: string;
let apiRoot: string;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'd2rmm-mutation-'));
  apiRoot = join(repo, 'apps', 'api');
  await mkdir(apiRoot, { recursive: true });
});

afterEach(async () => {
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
function fakeStryker(exitByLayer: Partial<Record<Layer, number>>): { run: StrykerRunner; calls: Call[] } {
  const calls: Call[] = [];
  const run: StrykerRunner = (_root, layer, args) => {
    calls.push({ layer, args: [...args] });
    return exitByLayer[layer] ?? 0;
  };
  return { run, calls };
}

describe('mutation plan', () => {
  it('break threshold: domain is 80 and application is 70', () => {
    expect(layerConfig('domain').thresholds.break).toBe(80);
    expect(layerConfig('application').thresholds.break).toBe(70);
  });

  it('report paths are reports/mutation/api-<layer>/mutation.json at the repository root', async () => {
    expect((await planLayer(apiRoot, 'domain')).reportPath).toBe(
      join(repo, 'reports', 'mutation', 'api-domain', 'mutation.json'),
    );
    expect((await planLayer(apiRoot, 'application')).reportPath).toBe(
      join(repo, 'reports', 'mutation', 'api-application', 'mutation.json'),
    );
    expect(layerConfig('application').jsonReporter.fileName).toBe(
      '../../reports/mutation/api-application/mutation.json',
    );
  });

  it('planLayer lists the layer source files and never a test file', async () => {
    await writeSource('src/modules/identity/domain/account.ts');
    await writeSource('src/modules/identity/domain/account.test.ts');
    await writeSource('src/shared-kernel/result.ts');
    await writeSource('src/modules/identity/application/register.ts');

    expect((await planLayer(apiRoot, 'domain')).files).toEqual([
      'src/modules/identity/domain/account.ts',
      'src/shared-kernel/result.ts',
    ]);
    expect((await planLayer(apiRoot, 'application')).files).toEqual([
      'src/modules/identity/application/register.ts',
    ]);
  });

  it('empty layer: with no application source the runner writes a zero-mutant report and exits 0', async () => {
    const stryker = fakeStryker({});

    const exitCode = await runMutation(apiRoot, [], stryker.run);

    expect(exitCode).toBe(0);
    expect(stryker.calls).toEqual([]);
    const report = JSON.parse(
      await readFile(join(repo, 'reports', 'mutation', 'api-application', 'mutation.json'), 'utf8'),
    ) as { schemaVersion: string; files: Record<string, unknown> };
    expect(report.schemaVersion).toBe('2');
    expect(report.files).toEqual({});
  });

  it('starts Stryker only for a layer that has files to mutate', async () => {
    await writeSource('src/shared-kernel/clock.ts');
    const stryker = fakeStryker({ domain: 0 });

    const exitCode = await runMutation(apiRoot, ['--incremental'], stryker.run);

    expect(exitCode).toBe(0);
    expect(stryker.calls).toEqual([{ layer: 'domain', args: ['--incremental'] }]);
    const report = JSON.parse(
      await readFile(join(repo, 'reports', 'mutation', 'api-application', 'mutation.json'), 'utf8'),
    ) as { files: Record<string, unknown> };
    expect(report.files).toEqual({});
  });

  it('runs domain then application and exits with the first non-zero Stryker code', async () => {
    await writeSource('src/shared-kernel/clock.ts');
    await writeSource('src/modules/identity/application/register.ts');
    const stryker = fakeStryker({ domain: 2, application: 5 });

    const exitCode = await runMutation(apiRoot, [], stryker.run);

    expect(exitCode).toBe(2);
    expect(stryker.calls.map((call) => call.layer)).toEqual(['domain', 'application']);
  });
});
