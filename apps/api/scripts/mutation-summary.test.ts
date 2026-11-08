import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { layerReportPath, type Layer } from './mutation-plan.ts';
import { NO_SURVIVED_MUTANT, summarise } from './mutation-summary.ts';

// A temporary repository mirroring the real layout: <repo>/apps/api is the API root, reports go to <repo>/reports.
let repo: string;
let apiRoot: string;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'd2rmm-mutation-summary-'));
  apiRoot = join(repo, 'apps', 'api');
  await mkdir(apiRoot, { recursive: true });
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

interface MutantFixture {
  readonly status: string;
  readonly mutatorName: string;
  readonly line: number;
}

/** Writes a Stryker JSON report for one layer, with the given mutants in one file. */
async function writeReport(layer: Layer, file: string, mutants: readonly MutantFixture[]): Promise<void> {
  const report = {
    schemaVersion: '2',
    files: {
      [file]: {
        language: 'typescript',
        source: 'export {};\n',
        mutants: mutants.map((mutant, index) => ({
          id: `${index}`,
          mutatorName: mutant.mutatorName,
          status: mutant.status,
          location: { start: { line: mutant.line, column: 1 }, end: { line: mutant.line, column: 9 } },
        })),
      },
    },
  };
  const path = layerReportPath(apiRoot, layer);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(report));
}

/** The table rows of the summary, one per listed mutant. */
function tableRows(markdown: string): string[] {
  return markdown
    .split('\n')
    .filter((line) => line.startsWith('| domain ') || line.startsWith('| application '));
}

describe('mutation summary', () => {
  it('lists every survived mutant with file, line and mutator', async () => {
    await writeReport('domain', 'src/shared-kernel/result.ts', [
      { status: 'Survived', mutatorName: 'ArithmeticOperator', line: 12 },
    ]);
    await writeReport('application', 'src/modules/identity/application/register.ts', [
      { status: 'Survived', mutatorName: 'ConditionalExpression', line: 40 },
    ]);

    const markdown = await summarise(apiRoot);

    expect(tableRows(markdown)).toEqual([
      '| domain | src/shared-kernel/result.ts | 12 | ArithmeticOperator |',
      '| application | src/modules/identity/application/register.ts | 40 | ConditionalExpression |',
    ]);
  });

  it('lists only survived mutants', async () => {
    await writeReport('domain', 'src/shared-kernel/result.ts', [
      { status: 'Killed', mutatorName: 'BlockStatement', line: 1 },
      { status: 'Timeout', mutatorName: 'BooleanLiteral', line: 2 },
      { status: 'NoCoverage', mutatorName: 'StringLiteral', line: 3 },
      { status: 'Survived', mutatorName: 'EqualityOperator', line: 4 },
      { status: 'CompileError', mutatorName: 'UpdateOperator', line: 5 },
      { status: 'RuntimeError', mutatorName: 'LogicalOperator', line: 6 },
      { status: 'Ignored', mutatorName: 'ArrayDeclaration', line: 7 },
    ]);

    const markdown = await summarise(apiRoot);

    expect(tableRows(markdown)).toEqual(['| domain | src/shared-kernel/result.ts | 4 | EqualityOperator |']);
    expect(markdown).not.toContain(NO_SURVIVED_MUTANT);
  });

  it('reports no survivor and a missing report', async () => {
    await writeReport('domain', 'src/shared-kernel/result.ts', [
      { status: 'Killed', mutatorName: 'BlockStatement', line: 1 },
    ]);

    const markdown = await summarise(apiRoot);

    expect(tableRows(markdown)).toEqual([]);
    expect(markdown).toContain(NO_SURVIVED_MUTANT);
    expect(markdown).toContain('- api-application: no Stryker report, skipped');
    expect(markdown).not.toContain('- api-domain');
  });
});
