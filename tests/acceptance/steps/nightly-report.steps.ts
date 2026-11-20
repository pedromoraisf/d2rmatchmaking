// Acceptance steps for nightly-report (ADR 023), one step per line of acceptance.feature. Black box: the steps read the
// nightly workflow file and run the report command (`node scripts/nightly/report.mjs`) in a child process on a result
// file they write to a temporary directory. Nothing here imports scripts/ or apps/ (rule acceptance-is-black-box).
//
// Reused as written from harness-foundation.steps.ts: the Background and "the contributor reads the nightly workflow".
// That step keeps only the jobs, so the steps here read the file again for the triggers.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from '@playwright/test';
import { parse } from 'yaml';
import { Given, When, Then, type Scenario } from '../fixtures.ts';

const OWN_KEY = 'nightly-report';
// Jobs that run a suite: each starts on the schedule, and a manual run picks them with the `suites` input.
const SUITE_JOBS = ['agent-mutation', 'api-mutation', 'acceptance', 'load'];

interface Workflow {
  on: {
    schedule?: unknown[];
    workflow_dispatch?: { inputs?: Record<string, { options?: string[]; default?: string }> };
  };
  jobs: Record<string, { if?: string; env?: Record<string, string> }>;
}

interface World {
  workflow: Workflow | undefined;
  results: string | undefined;
  markdown: string | undefined;
}

function own(scenario: Scenario): World {
  let world = scenario.values.get(OWN_KEY) as World | undefined;
  if (world === undefined) {
    world = { workflow: undefined, results: undefined, markdown: undefined };
    scenario.values.set(OWN_KEY, world);
  }
  return world;
}

function nightly(scenario: Scenario): Workflow {
  const world = own(scenario);
  world.workflow ??= parse(
    readFileSync(path.join(scenario.repoRoot, '.github', 'workflows', 'nightly.yml'), 'utf8'),
  ) as Workflow;
  return world.workflow;
}

function condition(workflow: Workflow, job: string): string {
  return (workflow.jobs[job]?.if ?? '').replace(/\s+/gu, ' ');
}

// NGT-02: one `suites` input on the manual trigger, and every suite also starts on the schedule.
Then(
  /^it can be dispatched with a "suites" input of "(\w+)", "(\w+)", "(\w+)" or "(\w+)"$/,
  ({ scenario }, first: string, second: string, third: string, fourth: string) => {
    const suites = nightly(scenario).on.workflow_dispatch?.inputs?.['suites'];
    expect(suites?.options, 'options of the suites input').toEqual([first, second, third, fourth]);
    expect(suites?.default, 'default of the suites input').toBe(first);
  },
);

Then(/^the scheduled run uses "(\w+)"$/, ({ scenario }, value: string) => {
  const workflow = nightly(scenario);
  expect(workflow.on.schedule?.length ?? 0, 'the nightly is scheduled').toBeGreaterThan(0);
  for (const job of SUITE_JOBS) {
    expect(condition(workflow, job), `${job} starts on the schedule`).toContain(
      "github.event_name == 'schedule'",
    );
  }
  expect(workflow.jobs['report']?.env?.['SUITES'], 'the suites the report names on a schedule').toContain(
    `github.event_name == 'schedule' && '${value}'`,
  );
});

// NGT-06: the report lists every acceptance scenario, failures first.
const scenarioOf = (title: string, tag: string, status: 'expected' | 'unexpected') => ({
  title,
  ok: status === 'expected',
  tags: [tag],
  tests: [
    { projectName: 'chromium', status, results: [{ status: status === 'expected' ? 'passed' : 'failed' }] },
  ],
});

Given('an acceptance result with one failed and two passed scenarios', ({ scenario }) => {
  // The passed ones come first in the file, so "failures first" is the report's doing and not the file's order.
  own(scenario).results = JSON.stringify({
    suites: [
      {
        title: '.features-gen/example/acceptance.feature.spec.js',
        suites: [
          {
            title: 'Players queue for a match',
            specs: [
              scenarioOf('A player joins the queue', 'QUE-01', 'expected'),
              scenarioOf('A player waits for a match', 'QUE-03', 'expected'),
              scenarioOf('A player leaves the queue', 'QUE-02', 'unexpected'),
            ],
          },
        ],
      },
    ],
  });
});

When('the contributor builds the nightly report from it', ({ scenario }) => {
  const world = own(scenario);
  if (world.results === undefined) throw new Error('no acceptance result has been given in this scenario');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nightly-report-'));
  mkdirSync(path.join(dir, 'in', 'acceptance-report'), { recursive: true });
  writeFileSync(path.join(dir, 'in', 'acceptance-report', 'results.json'), world.results);
  const run = spawnSync(
    'node',
    [
      'scripts/nightly/report.mjs',
      '--in',
      path.join(dir, 'in'),
      '--out',
      path.join(dir, 'out'),
      '--commit',
      'abc1234',
      '--branch',
      'main',
      '--suites',
      'acceptance',
    ],
    { cwd: scenario.repoRoot, encoding: 'utf8' },
  );
  expect(run.status, `the report command exited with ${run.status}\n${run.stderr}`).toBe(0);
  world.markdown = readFileSync(path.join(dir, 'out', 'nightly-report.md'), 'utf8');
});

function scenarioRows(markdown: string | undefined): string[] {
  if (markdown === undefined) throw new Error('no report has been built in this scenario');
  return markdown.split('\n').filter((line) => /^\| (failed|flaky|skipped|passed) \|/u.test(line));
}

Then('the acceptance section lists the three scenarios with their tags', ({ scenario }) => {
  const rows = scenarioRows(own(scenario).markdown);
  expect(rows, 'one row per scenario').toHaveLength(3);
  for (const [title, tag] of [
    ['A player joins the queue', '@QUE-01'],
    ['A player waits for a match', '@QUE-03'],
    ['A player leaves the queue', '@QUE-02'],
  ] as const) {
    const row = rows.find((candidate) => candidate.includes(title));
    expect(row, `a row for "${title}"`).toBeDefined();
    expect(row, `the row of "${title}" names its tag`).toContain(tag);
  }
});

Then('the failed scenario comes first', ({ scenario }) => {
  const rows = scenarioRows(own(scenario).markdown);
  expect(rows[0], 'the first row').toMatch(/^\| failed \| .*A player leaves the queue/u);
  expect(
    rows.slice(1).every((row) => row.startsWith('| passed |')),
    'the other rows passed',
  ).toBe(true);
});
