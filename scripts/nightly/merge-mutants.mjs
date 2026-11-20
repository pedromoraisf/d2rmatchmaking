// Merges the outcomes.json of cargo-mutants shards into one, so the quality ratchet reads one file per crate
// (NGT-01, NGT-10). `mergeOutcomes` is pure; `mergeDirectory` and the CLI at the bottom do the I/O.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `shards` are parsed outcomes.json files of the same crate. The baseline fails when any shard's baseline failed. */
export function mergeOutcomes(shards) {
  if (!Array.isArray(shards) || shards.length === 0)
    throw new Error('mergeOutcomes needs at least one shard');
  const baselines = shards
    .map((s) => (s.outcomes ?? []).find((o) => o.scenario === 'Baseline'))
    .filter(Boolean);
  const baseline = baselines.find((b) => b.summary !== 'Success') ?? baselines[0];
  const mutants = shards.flatMap((s) => (s.outcomes ?? []).filter((o) => o.scenario !== 'Baseline'));
  const sum = (key) => shards.reduce((n, s) => n + (s[key] ?? 0), 0);
  const times = (key) =>
    shards
      .map((s) => s[key])
      .filter(Boolean)
      .sort();
  const starts = times('start_time');
  const ends = times('end_time');
  return {
    outcomes: baseline ? [baseline, ...mutants] : mutants,
    total_mutants: sum('total_mutants'),
    missed: sum('missed'),
    caught: sum('caught'),
    timeout: sum('timeout'),
    unviable: sum('unviable'),
    success: sum('success'),
    start_time: starts[0],
    end_time: ends[ends.length - 1],
    cargo_mutants_version: shards[0].cargo_mutants_version,
  };
}

const findOutcomes = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return findOutcomes(full);
    return entry === 'outcomes.json' ? [full] : [];
  });

/**
 * Reads `<inDir>/agent-mutation-<crate>[-<shard>]/**\/outcomes.json` and writes one
 * `<outDir>/agent-<crate>/mutants.out/outcomes.json` per crate, the path the quality ratchet reads.
 * @returns {string[]} the files written
 */
export function mergeDirectory(inDir, outDir) {
  const shards = {};
  for (const name of existsSync(inDir) ? readdirSync(inDir).sort() : []) {
    const match = /^agent-mutation-(.+?)(?:-\d+)?$/u.exec(name);
    const root = path.join(inDir, name);
    if (!match || !statSync(root).isDirectory()) continue;
    for (const file of findOutcomes(root))
      (shards[match[1]] ??= []).push(JSON.parse(readFileSync(file, 'utf8')));
  }
  const written = [];
  for (const [crate, list] of Object.entries(shards)) {
    const target = path.join(outDir, `agent-${crate}`, 'mutants.out', 'outcomes.json');
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(mergeOutcomes(list), null, 2)}\n`);
    written.push(target);
  }
  return written;
}

// CLI: node scripts/nightly/merge-mutants.mjs --in <downloaded artifacts> --out reports/mutation
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag) => args[args.indexOf(flag) + 1];
  const written = mergeDirectory(value('--in'), value('--out'));
  console.log(written.length === 0 ? 'no agent mutation reports to merge' : written.join('\n'));
}
