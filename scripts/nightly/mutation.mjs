// Pure rules for the mutation section of the nightly report (NGT-04, NGT-10). No I/O: the CLI reads the files.
import { cargoMutantsScore, strykerScore } from '../lib/collect.mjs';

const MUTANT_PREFIX = /^.*?:\d+:\d+: /;

/** Does `file` (a path as cargo-mutants prints it, relative to `apps/agent/src-tauri`) name a reading module? */
export function isReadingModule(file, readingModules = []) {
  return readingModules.some((m) => file === m || file.endsWith(`/${m}`) || m.endsWith(`/${file}`));
}

function group(entries, readingModules) {
  const byFile = new Map();
  for (const { file, line, mutation } of entries) {
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push({ line, mutation });
  }
  return [...byFile.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, mutants]) => ({
      file,
      reading: isReadingModule(file, readingModules),
      mutants: mutants.sort((a, b) => a.line - b.line || a.mutation.localeCompare(b.mutation)),
    }));
}

/**
 * cargo-mutants outcomes.json -> { baseline, score, counts, survivors }.
 * A failed baseline has no score: the crate's tests did not pass before any mutation.
 */
export function fromCargoMutants(outcomes, readingModules = []) {
  const list = outcomes?.outcomes ?? [];
  const baseline = list.find((o) => o.scenario === 'Baseline');
  const counts = { caught: 0, missed: 0, timeout: 0, unviable: 0 };
  const missed = [];
  for (const o of list) {
    if (o.scenario === 'Baseline') continue;
    const m = o.scenario?.Mutant;
    if (o.summary === 'CaughtMutant') counts.caught += 1;
    else if (o.summary === 'Timeout') counts.timeout += 1;
    else if (o.summary === 'Unviable') counts.unviable += 1;
    else if (o.summary === 'MissedMutant') {
      counts.missed += 1;
      if (m)
        missed.push({ file: m.file, line: m.span.start.line, mutation: m.name.replace(MUTANT_PREFIX, '') });
    }
  }
  if (baseline && baseline.summary !== 'Success') {
    return { baseline: 'failed', score: null, counts, survivors: [] };
  }
  return {
    baseline: 'ok',
    score: cargoMutantsScore(outcomes),
    counts,
    survivors: group(missed, readingModules),
  };
}

/** Stryker mutation-testing-report-schema -> { baseline, score, counts, survivors }. */
export function fromStryker(report) {
  const counts = { caught: 0, missed: 0, timeout: 0, unviable: 0 };
  const survivors = [];
  for (const [file, f] of Object.entries(report?.files ?? {})) {
    for (const m of f.mutants ?? []) {
      if (m.status === 'Killed') counts.caught += 1;
      else if (m.status === 'Timeout') counts.timeout += 1;
      else if (m.status === 'Survived' || m.status === 'NoCoverage') {
        counts.missed += 1;
        const text = m.replacement ? `${m.mutatorName}: ${m.replacement}` : m.mutatorName;
        survivors.push({ file, line: m.location?.start?.line ?? 0, mutation: text });
      } else if (['CompileError', 'RuntimeError', 'Ignored'].includes(m.status)) counts.unviable += 1;
    }
  }
  return { baseline: 'ok', score: strykerScore(report), counts, survivors: group(survivors, []) };
}
