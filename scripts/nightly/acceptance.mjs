// Pure rules for the acceptance section of the nightly report (NGT-06, NGT-10). No I/O: the CLI reads the file.

const ORDER = { failed: 0, flaky: 1, skipped: 2, passed: 3 };
const FILE_TITLE = /\.(?:[cm]?[jt]s|feature)$/u;

/** One scenario's status from the statuses of its tests: Playwright's expected / unexpected / flaky / skipped. */
export function statusOf(tests) {
  const statuses = tests.map((t) => t.status);
  if (statuses.includes('unexpected')) return 'failed';
  if (statuses.includes('flaky')) return 'flaky';
  if (statuses.length > 0 && statuses.every((s) => s === 'skipped')) return 'skipped';
  return 'passed';
}

function tagsOf(spec) {
  const fromTitle = spec.title.match(/@[\w-]+/gu) ?? [];
  const declared = (spec.tags ?? []).map((t) => (t.startsWith('@') ? t : `@${t}`));
  return [...new Set([...declared, ...fromTitle])];
}

function walk(suite, trail, out) {
  const here = FILE_TITLE.test(suite.title ?? '') || !suite.title ? trail : [...trail, suite.title];
  for (const spec of suite.specs ?? []) {
    out.push({
      feature: here[0] ?? '',
      title: spec.title.replace(/(?:\s+@[\w-]+)+\s*$/u, '').trim(),
      tags: tagsOf(spec),
      status: statusOf(spec.tests ?? []),
    });
  }
  for (const child of suite.suites ?? []) walk(child, here, out);
}

/**
 * Playwright's JSON report -> every scenario with its feature, tags and status, failures first, then flaky, skipped
 * and passed; ties by feature and title.
 */
export function fromPlaywright(results) {
  const scenarios = [];
  for (const suite of results?.suites ?? []) walk(suite, [], scenarios);
  scenarios.sort(
    (a, b) =>
      ORDER[a.status] - ORDER[b.status] ||
      a.feature.localeCompare(b.feature) ||
      a.title.localeCompare(b.title),
  );
  const count = (status) => scenarios.filter((s) => s.status === status).length;
  return {
    passed: count('passed'),
    failed: count('failed'),
    flaky: count('flaky'),
    skipped: count('skipped'),
    scenarios,
  };
}
