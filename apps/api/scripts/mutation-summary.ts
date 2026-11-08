import { appendFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { layerReportPath, type Layer, MUTATION_LAYERS } from './mutation-plan.ts';

export interface SurvivedMutant {
  readonly file: string;
  readonly line: number;
  readonly mutator: string;
}

/** The part of a Stryker JSON report (schema 2) this summary reads. */
export interface StrykerReport {
  readonly files?: Readonly<Record<string, { readonly mutants?: readonly StrykerMutant[] }>>;
}

interface StrykerMutant {
  readonly status: string;
  readonly mutatorName: string;
  readonly location: { readonly start: { readonly line: number } };
}

export interface LayerResult {
  readonly layer: Layer;
  /** The layer's survived mutants, or `undefined` when the layer wrote no report. */
  readonly survived: readonly SurvivedMutant[] | undefined;
}

export const NO_SURVIVED_MUTANT = 'No survived mutant';

/** The survived mutants of one Stryker report, in the order Stryker wrote them. Other statuses are not survivors. */
export function survivedMutants(report: StrykerReport): SurvivedMutant[] {
  const found: SurvivedMutant[] = [];
  for (const [file, { mutants = [] }] of Object.entries(report.files ?? {})) {
    for (const mutant of mutants) {
      if (mutant.status === 'Survived') {
        found.push({ file, line: mutant.location.start.line, mutator: mutant.mutatorName });
      }
    }
  }
  return found;
}

/** Escapes a Markdown table cell: a pipe inside a file name or mutator would split the row. */
function cell(text: string): string {
  return text.replaceAll('|', '\\|');
}

/** The job-summary Markdown: one table row per survived mutant, or the no-survivor line, then each missing report. */
export function markdownSummary(layers: readonly LayerResult[]): string {
  const rows = layers.flatMap(({ layer, survived }) =>
    (survived ?? []).map(
      (mutant) => `| ${layer} | ${cell(mutant.file)} | ${mutant.line} | ${cell(mutant.mutator)} |`,
    ),
  );
  const lines = ['### API mutation: survived mutants', ''];
  if (rows.length > 0) {
    lines.push('| Layer | File | Line | Mutator |', '| --- | --- | ---: | --- |', ...rows, '');
  } else {
    lines.push(NO_SURVIVED_MUTANT, '');
  }
  for (const { layer, survived } of layers) {
    if (survived === undefined) {
      lines.push(`- api-${layer}: no Stryker report, skipped`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Reads one layer's report; a missing report is `undefined`, any other read or parse error is a bug and is thrown. */
async function readLayer(apiRoot: string, layer: Layer): Promise<LayerResult> {
  let text: string;
  try {
    text = await readFile(layerReportPath(apiRoot, layer), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { layer, survived: undefined };
    }
    throw error;
  }
  return { layer, survived: survivedMutants(JSON.parse(text) as StrykerReport) };
}

/** The job-summary Markdown for every layer's Stryker report under the repository root of `apiRoot`. */
export async function summarise(apiRoot: string): Promise<string> {
  const layers = await Promise.all(MUTATION_LAYERS.map((layer) => readLayer(apiRoot, layer)));
  return markdownSummary(layers);
}

const isEntrypoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const markdown = await summarise(apiRoot);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary !== undefined && summary !== '') {
    await appendFile(summary, markdown);
  } else {
    process.stdout.write(markdown);
  }
}
