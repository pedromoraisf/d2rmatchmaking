import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare } from '../nightly/trend.mjs';
import { toMarkdown } from '../nightly/render.mjs';
import { buildReport, discover, fromJobs, main, readingModulesFrom, suitesFrom } from '../nightly/report.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'nightly');
const load = (name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8'));

const jobs = [
  { name: 'agent-mutation (domain 1/2)', result: 'success', minutes: 11.24 },
  { name: 'acceptance', result: 'failure', minutes: null },
];

function build(extra = {}) {
  return buildReport({
    commit: 'abc1234',
    branch: 'main',
    run: '200',
    suites: ['mutation', 'load', 'acceptance'],
    jobs,
    agentOutcomes: {
      domain: [load('cargo-mutants-domain.json')],
      adapters: [load('cargo-mutants-adapters.json')],
      core: [load('cargo-mutants-core-baseline-failed.json')],
    },
    apiReports: { domain: load('stryker-report.json') },
    load: { summary: load('load-summary.json'), check: 'passed' },
    acceptance: load('playwright-results.json'),
    readingModules: ['domain/src/anchors.rs'],
    ...extra,
  });
}

test('the report carries commit, branch, suites, jobs, and every section (NGT-03)', () => {
  const r = build();
  assert.equal(r.commit, 'abc1234');
  assert.equal(r.branch, 'main');
  assert.deepEqual(r.suites, ['mutation', 'load', 'acceptance']);
  assert.deepEqual(r.jobs, jobs);
  assert.deepEqual(
    r.mutation.map((m) => m.target),
    ['agent-adapters', 'agent-core', 'agent-domain', 'api-domain'],
  );
  assert.equal(r.load.verdict, 'passed');
  assert.equal(r.acceptance.failed, 1);
});

test('no previous report: the trend is null and the markdown says so (NGT-07)', () => {
  const r = build();
  assert.equal(r.trend, null);
  assert.equal(compare(r, null), null);
  assert.equal(compare(r, undefined), null);
  assert.match(toMarkdown(r), /No previous report\./);
});

test('trend: score and count changes against the previous report (NGT-07)', () => {
  const previous = build();
  previous.run = '100';
  const domainBefore = previous.mutation.find((m) => m.target === 'agent-domain');
  domainBefore.score = 50;
  domainBefore.counts.missed = 5;
  previous.acceptance.passed = 1;
  previous.load.steps[0].p95Ms = 4.5;
  const t = compare(build(), previous);
  assert.equal(t.previousRun, '100');
  assert.deepEqual(
    t.mutation.find((m) => m.target === 'agent-domain'),
    { target: 'agent-domain', score: 7.14, caught: 0, missed: -2, timeout: 0, unviable: 0 },
  );
  assert.equal(t.acceptance.passed, 1);
  assert.equal(t.load.p95Ms, 1);
  assert.equal(t.load.maxConcurrentPlayers, 0);
});

test('trend: a target without a number on one side has a null delta, and a new target is skipped', () => {
  const previous = build();
  previous.mutation = previous.mutation.filter((m) => m.target !== 'api-domain');
  const core = previous.mutation.find((m) => m.target === 'agent-core');
  assert.equal(core.score, null);
  const t = compare(build(), previous);
  assert.equal(t.mutation.find((m) => m.target === 'agent-core').score, null);
  assert.equal(
    t.mutation.some((m) => m.target === 'api-domain'),
    false,
  );
  const noLoad = compare(build(), { ...previous, load: null, acceptance: null });
  assert.equal(noLoad.load, null);
  assert.equal(noLoad.acceptance, null);
});

test('markdown: mutation scores, survivors by file, reading modules and a failed baseline (NGT-04)', () => {
  const md = toMarkdown(build());
  assert.match(md, /\| agent-domain \| 57\.14 \| 3 \| 3 \| 1 \| 2 \|/);
  assert.match(md, /\*\*agent-core\*\*: the baseline failed/);
  assert.match(md, /\| agent-core \| baseline failed \|/);
  assert.match(md, /\*\*domain\/src\/anchors\.rs\*\* \(reading module\) \(2\)/);
  assert.match(md, /\*\*domain\/src\/name_diff\.rs\*\* \(1\)/);
  assert.match(md, /- line 60: replace ready_check_open_from_body/);
  assert.match(md, /agent-domain: 3 survivors, 2 in reading modules/);
});

test('markdown: header, jobs, load rows and acceptance list with failures first (NGT-03, 05, 06)', () => {
  const md = toMarkdown(build());
  assert.match(md, /Commit `abc1234` on `main`\. Suites: mutation, load, acceptance\./);
  assert.match(md, /\| agent-mutation \(domain 1\/2\) \| success \| 11\.2 \|/);
  assert.match(md, /\| acceptance \| failure \| n\/a \|/);
  assert.match(md, /Verdict: \*\*passed\*\* \(summary check: passed\)/);
  assert.match(md, /\| 100 \| 0 \| 5\.5 ms \| 210685 \/ 70000 over \| 12 \|/);
  assert.match(md, /\| 200 \| 3 \| 9\.25 ms \| 70000 \/ 70000 \| 25 \|/);
  const rows = md.split('\n').filter((l) => /^\| (failed|flaky|skipped|passed) \|/.test(l));
  assert.equal(rows.length, 5);
  assert.match(
    rows[0],
    /^\| failed \| Players queue for a match \| A player leaves the queue \| @QUE-02 @NFR-10 \|$/,
  );
});

test('markdown: a suite that did not run says so', () => {
  const md = toMarkdown(
    build({ suites: ['load'], agentOutcomes: {}, apiReports: {}, acceptance: null, load: null }),
  );
  assert.match(md, /_Mutation did not run\._/);
  assert.match(md, /_Load did not run\._/);
  assert.match(md, /_Acceptance did not run\._/);
});

test('markdown: a trend section lists the deltas', () => {
  const previous = build();
  previous.run = '100';
  const md = toMarkdown(build({ previous }));
  assert.match(md, /Compared with run 100\./);
  assert.match(md, /\| agent-domain \| 0\.00 \| 0 \| 0 \| 0 \| 0 \|/);
});

test('suitesFrom: all, one suite, a list, and the schedule default', () => {
  assert.deepEqual(suitesFrom('all'), ['mutation', 'load', 'acceptance']);
  assert.deepEqual(suitesFrom(undefined), ['mutation', 'load', 'acceptance']);
  assert.deepEqual(suitesFrom(''), ['mutation', 'load', 'acceptance']);
  assert.deepEqual(suitesFrom('load'), ['load']);
  assert.deepEqual(suitesFrom('load,mutation'), ['mutation', 'load']);
});

test('fromJobs: result and minutes from the GitHub API', () => {
  const r = fromJobs({
    jobs: [
      {
        name: 'a',
        conclusion: 'success',
        started_at: '2026-11-20T00:00:00Z',
        completed_at: '2026-11-20T00:12:30Z',
      },
      {
        name: 'b',
        conclusion: null,
        status: 'in_progress',
        started_at: '2026-11-20T00:00:00Z',
        completed_at: null,
      },
    ],
  });
  assert.deepEqual(r, [
    { name: 'a', result: 'success', minutes: 12.5 },
    { name: 'b', result: 'in_progress', minutes: null },
  ]);
  assert.deepEqual(fromJobs(null), []);
});

test('readingModulesFrom takes a list, or an object with a list', () => {
  assert.deepEqual(readingModulesFrom(['a.rs']), ['a.rs']);
  assert.deepEqual(readingModulesFrom({ modules: [{ path: 'a.rs' }, 'b.rs'] }), ['a.rs', 'b.rs']);
  assert.deepEqual(readingModulesFrom(null), []);
});

test('the CLI reads downloaded artifacts, merges shards and writes the .md and .json', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ngt-report-'));
  try {
    const put = (name, file, to) => {
      const target = path.join(root, 'in', to);
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(path.join(dir, file), target);
      return name;
    };
    put('s1', 'cargo-mutants-domain.json', 'agent-mutation-domain-1/mutants.out/outcomes.json');
    put('s2', 'cargo-mutants-adapters.json', 'agent-mutation-domain-2/mutants.out/outcomes.json');
    put('c', 'cargo-mutants-core-baseline-failed.json', 'agent-mutation-core/mutants.out/outcomes.json');
    put('a', 'stryker-report.json', 'api-mutation-application/mutation.json');
    put('p', 'playwright-results.json', 'acceptance-report/results.json');
    put('l', 'load-summary.json', 'load-report/summary.json');
    writeFileSync(path.join(root, 'in', 'load-report', 'check.json'), '{"verdict":"failed"}');
    writeFileSync(
      path.join(root, 'jobs.json'),
      JSON.stringify({
        jobs: [
          {
            name: 'x',
            conclusion: 'success',
            started_at: '2026-11-20T00:00:00Z',
            completed_at: '2026-11-20T00:01:00Z',
          },
        ],
      }),
    );
    const found = discover(path.join(root, 'in'));
    assert.deepEqual(Object.keys(found.agentOutcomes).sort(), ['core', 'domain']);
    assert.equal(found.agentOutcomes.domain.length, 2);
    assert.deepEqual(Object.keys(found.apiReports), ['application']);
    assert.equal(found.load.check, 'failed');

    const report = main([
      '--in',
      path.join(root, 'in'),
      '--out',
      path.join(root, 'out'),
      '--commit',
      'abc',
      '--branch',
      'feat/x',
      '--run',
      '7',
      '--suites',
      'all',
      '--jobs',
      path.join(root, 'jobs.json'),
      '--reading-modules',
      path.join(root, 'missing.json'),
    ]);
    assert.equal(report.mutation.find((m) => m.target === 'agent-domain').counts.missed, 4);
    assert.equal(report.trend, null);
    const written = JSON.parse(readFileSync(path.join(root, 'out', 'nightly-report.json'), 'utf8'));
    assert.deepEqual(written, report);
    assert.match(readFileSync(path.join(root, 'out', 'nightly-report.md'), 'utf8'), /^# Nightly report/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
