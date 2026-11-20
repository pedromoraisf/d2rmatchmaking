// Pure comparison of a nightly report with the previous one (NGT-07, NGT-10). No I/O.

const diff = (now, before) =>
  typeof now === 'number' && typeof before === 'number' ? Math.round((now - before) * 100) / 100 : null;

function referenceStep(load) {
  return (load?.steps ?? []).find((s) => s.players === 100) ?? null;
}

/**
 * The change of each score and count since the previous report, or `null` when there is no previous report (the
 * report then says "no previous report"). A delta is `null` when either side has no number (a failed baseline, a suite
 * that did not run).
 * @param {object} current a nightly-report.json
 * @param {object | null | undefined} previous the earlier nightly-report.json
 */
export function compare(current, previous) {
  if (previous === null || previous === undefined) return null;
  const before = new Map((previous.mutation ?? []).map((m) => [m.target, m]));
  const mutation = [];
  for (const now of current.mutation ?? []) {
    const old = before.get(now.target);
    if (!old) continue;
    mutation.push({
      target: now.target,
      score: diff(now.score, old.score),
      caught: diff(now.counts?.caught, old.counts?.caught),
      missed: diff(now.counts?.missed, old.counts?.missed),
      timeout: diff(now.counts?.timeout, old.counts?.timeout),
      unviable: diff(now.counts?.unviable, old.counts?.unviable),
    });
  }
  const acceptance =
    current.acceptance && previous.acceptance
      ? {
          passed: diff(current.acceptance.passed, previous.acceptance.passed),
          failed: diff(current.acceptance.failed, previous.acceptance.failed),
          flaky: diff(current.acceptance.flaky, previous.acceptance.flaky),
          skipped: diff(current.acceptance.skipped, previous.acceptance.skipped),
        }
      : null;
  const a = referenceStep(current.load);
  const b = referenceStep(previous.load);
  const load =
    current.load && previous.load
      ? {
          maxConcurrentPlayers: diff(current.load.maxConcurrentPlayers, previous.load.maxConcurrentPlayers),
          p95Ms: diff(a?.p95Ms, b?.p95Ms),
          bytesPerPlayerHour: diff(a?.bytesPerPlayerHour, b?.bytesPerPlayerHour),
        }
      : null;
  return { previousRun: previous.run ?? null, mutation, acceptance, load };
}
