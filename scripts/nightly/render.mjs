// Pure rendering of nightly-report.json as Markdown (NGT-03 to NGT-07, NGT-10). No I/O.

const cell = (text) => String(text).replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ');
const num = (n, digits = 0) => (typeof n === 'number' ? n.toFixed(digits) : 'n/a');
const signed = (n, digits = 0) => (typeof n !== 'number' ? 'n/a' : `${n > 0 ? '+' : ''}${n.toFixed(digits)}`);

function table(head, rows) {
  const line = (cols) => `| ${cols.join(' | ')} |`;
  return [line(head), line(head.map(() => '---')), ...rows.map((r) => line(r.map(cell)))].join('\n');
}

function jobsSection(report) {
  if (!report.jobs?.length) return '_No job data._';
  return table(
    ['Job', 'Result', 'Minutes'],
    report.jobs.map((j) => [j.name, j.result, typeof j.minutes === 'number' ? j.minutes.toFixed(1) : 'n/a']),
  );
}

function survivorsOf(target) {
  return target.survivors
    .map((s) => {
      const mark = s.reading ? ' (reading module)' : '';
      const lines = s.mutants.map((m) => `- line ${m.line}: ${m.mutation}`).join('\n');
      return `**${s.file}**${mark} (${s.mutants.length})\n\n${lines}`;
    })
    .join('\n\n');
}

function mutationSection(report) {
  if (!report.mutation?.length) return '_Mutation did not run._';
  const rows = report.mutation.map((t) =>
    t.baseline === 'failed'
      ? [t.target, 'baseline failed', '', '', '', '']
      : [t.target, num(t.score, 2), t.counts.caught, t.counts.missed, t.counts.timeout, t.counts.unviable],
  );
  const parts = [table(['Target', 'Score %', 'Caught', 'Missed', 'Timeout', 'Unviable'], rows)];
  for (const t of report.mutation) {
    if (t.baseline === 'failed') {
      parts.push(`**${t.target}**: the baseline failed, so no mutant ran and there is no score.`);
    } else if (t.survivors.length > 0) {
      const reading = t.survivors.filter((s) => s.reading).reduce((n, s) => n + s.mutants.length, 0);
      const note = reading > 0 ? `, ${reading} in reading modules` : '';
      parts.push(
        `<details><summary>${t.target}: ${t.counts.missed} survivors${note}</summary>\n\n${survivorsOf(t)}\n\n</details>`,
      );
    }
  }
  return parts.join('\n\n');
}

function loadSection(report) {
  const load = report.load;
  if (!load || load.verdict === 'not-run') return '_Load did not run._';
  const head = `Verdict: **${load.verdict}**${load.check ? ` (summary check: ${load.check})` : ''}.`;
  const extra = [
    load.failure ? `The ladder stopped at ${load.failure.step} players (${load.failure.rule}).` : null,
    load.error ? `Error: ${load.error}` : null,
  ].filter(Boolean);
  const rows = load.steps.map((s) => [
    s.players,
    s.errors,
    typeof s.p95Ms === 'number' ? `${s.p95Ms} ms` : 'n/a',
    typeof s.bytesPerPlayerHour === 'number'
      ? `${s.bytesPerPlayerHour} / ${s.budget}${s.withinBudget ? '' : ' over'}`
      : 'n/a',
    s.rooms,
  ]);
  return [
    head,
    ...extra,
    table(['Players', 'Errors', 'p95', 'Bytes per player-hour / budget', 'Rooms'], rows),
  ].join('\n\n');
}

function acceptanceSection(report) {
  const a = report.acceptance;
  if (!a) return '_Acceptance did not run._';
  const head = `${a.passed} passed, ${a.failed} failed, ${a.flaky} flaky, ${a.skipped} skipped.`;
  if (a.scenarios.length === 0) return head;
  const rows = a.scenarios.map((s) => [s.status, s.feature, s.title, s.tags.join(' ')]);
  return `${head}\n\n${table(['Result', 'Feature', 'Scenario', 'Tags'], rows)}`;
}

function trendSection(report) {
  const t = report.trend;
  if (!t) return 'No previous report.';
  const lines = [`Compared with run ${t.previousRun ?? 'unknown'}.`];
  const rows = t.mutation.map((m) => [
    m.target,
    signed(m.score, 2),
    signed(m.caught),
    signed(m.missed),
    signed(m.timeout),
    signed(m.unviable),
  ]);
  if (rows.length > 0) {
    lines.push(table(['Target', 'Score', 'Caught', 'Missed', 'Timeout', 'Unviable'], rows));
  }
  if (t.acceptance) {
    const a = t.acceptance;
    lines.push(
      `Acceptance: passed ${signed(a.passed)}, failed ${signed(a.failed)}, flaky ${signed(a.flaky)}, skipped ${signed(a.skipped)}.`,
    );
  }
  if (t.load) {
    const l = t.load;
    lines.push(
      `Load: max players ${signed(l.maxConcurrentPlayers)}, p95 at 100 players ${signed(l.p95Ms, 2)} ms, bytes per player-hour ${signed(l.bytesPerPlayerHour)}.`,
    );
  }
  return lines.join('\n\n');
}

/** The Markdown of a nightly report: header, jobs, mutation, load, acceptance, trend. */
export function toMarkdown(report) {
  return (
    [
      '# Nightly report',
      `Commit \`${report.commit}\` on \`${report.branch}\`. Suites: ${report.suites.join(', ') || 'none'}.`,
      '## Jobs',
      jobsSection(report),
      '## Mutation',
      mutationSection(report),
      '## Load',
      loadSection(report),
      '## Acceptance',
      acceptanceSection(report),
      '## Trend',
      trendSection(report),
    ].join('\n\n') + '\n'
  );
}
