// Merges the outcomes.json of cargo-mutants shards into one, so the quality ratchet reads one file per crate
// (NGT-01, NGT-10). Pure: no I/O.

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
