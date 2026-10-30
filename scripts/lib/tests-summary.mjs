// Turns a Vitest JSON report into the counts the quality ratchet reads (ADR 014, HF-07).
// tests.skipped counts pending and todo tests: a skipped test lowers the ceiling, it never passes silently.

function count(report, key) {
  const n = report[key];
  if (!Number.isInteger(n) || n < 0) throw new TypeError(`not a Vitest JSON report: ${key} is missing`);
  return n;
}

export function summarize(vitest) {
  return {
    total: count(vitest, 'numTotalTests'),
    passed: count(vitest, 'numPassedTests'),
    failed: count(vitest, 'numFailedTests'),
    skipped: count(vitest, 'numPendingTests') + count(vitest, 'numTodoTests'),
  };
}
