// The structure of the nightly workflow. CRF-12 to CRF-17, CRF-25 and CFP-10 (the ratchet waits for the mutation jobs
// and receives their reports, which are uploaded even when a command fails) now hold for the matrix shape; NGT-01,
// NGT-02, NGT-03 and NGT-08 (nightly-report) add the parallel jobs, the `suites` input, the load and acceptance jobs
// and the always-running report job. Every action is pinned by its full commit SHA.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parse } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflow = parse(readFileSync(path.join(root, '.github', 'workflows', 'nightly.yml'), 'utf8'));
const jobs = workflow.jobs;
const { quality, report, load, acceptance } = jobs;
const agent = jobs['agent-mutation'];
const api = jobs['api-mutation'];
const DOWNLOAD = 'actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333';
const FULL_SHA = /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/u;

const stepNamed = (job, name) => job.steps.find((step) => step.name === name);
const indexNamed = (job, name) => job.steps.findIndex((step) => step.name === name);
const runs = (job) => job.steps.map((step) => String(step.run ?? ''));
const uploads = (job) =>
  job.steps.filter((step) => String(step.uses ?? '').startsWith('actions/upload-artifact@'));
const condition = (job) => String(job.if ?? '').replace(/\s+/gu, ' ');

// NGT-02: a manual run takes a `suites` input; the schedule has none and runs every suite.
test('workflow_dispatch takes a suites input of all, mutation, load or acceptance, defaulting to all', () => {
  const suites = workflow.on.workflow_dispatch.inputs.suites;
  assert.deepEqual(suites.options, ['all', 'mutation', 'load', 'acceptance']);
  assert.equal(suites.default, 'all');
  assert.equal(suites.type, 'choice');
  assert.ok(workflow.on.schedule.length > 0, 'the nightly is still scheduled');
});

test('each suite job runs on the schedule, on all, or on its own suite', () => {
  const expected = (suite) =>
    `(github.event_name == 'schedule' || inputs.suites == 'all' || inputs.suites == '${suite}')`;
  assert.ok(condition(agent).includes(expected('mutation')), 'agent-mutation');
  assert.ok(condition(api).includes(expected('mutation')), 'api-mutation');
  assert.ok(condition(load).includes(expected('load')), 'load');
  assert.ok(condition(acceptance).includes(expected('acceptance')), 'acceptance');
  assert.ok(condition(quality).includes(expected('mutation')), 'quality');
});

test('the report names the suites that ran: all on the schedule, the input otherwise', () => {
  assert.equal(report.env.SUITES, "${{ github.event_name == 'schedule' && 'all' || inputs.suites }}");
});

// NGT-01: parallel jobs, matrix per crate with shards, matrix per API layer.
test('agent mutation is a matrix per crate, with five round-robin shards for domain and two for adapters, and does not stop at one failure', () => {
  assert.equal(agent.strategy['fail-fast'], false);
  assert.deepEqual(
    agent.strategy.matrix.include.map((entry) => [entry.crate, entry.shard]),
    [
      ['core', ''],
      ['domain', '--shard 0/5 --sharding round-robin'],
      ['domain', '--shard 1/5 --sharding round-robin'],
      ['domain', '--shard 2/5 --sharding round-robin'],
      ['domain', '--shard 3/5 --sharding round-robin'],
      ['domain', '--shard 4/5 --sharding round-robin'],
      ['adapters', '--shard 0/2'],
      ['adapters', '--shard 1/2'],
    ],
  );
  assert.equal(agent['runs-on'], 'ubuntu-latest', 'the job runs on ubuntu-latest');
  assert.equal(agent.needs, 'detect');
});

test('core and adapters run --in-place, and every shard writes its own output and artifact', () => {
  const entries = agent.strategy.matrix.include;
  assert.deepEqual(
    entries.filter((entry) => entry.in_place === '--in-place').map((entry) => entry.crate),
    ['core', 'adapters', 'adapters'],
  );
  assert.equal(new Set(entries.map((entry) => entry.out)).size, entries.length, 'one output per shard');
  assert.equal(
    new Set(entries.map((entry) => entry.artifact)).size,
    entries.length,
    'one artifact per shard',
  );
  for (const entry of entries) {
    assert.match(entry.artifact, /^agent-mutation-(core|domain|adapters)(-\d)?$/u);
  }
});

test('the agent job runs cargo mutants on the unit tests of its crate only (ADR 026)', () => {
  const [command] = runs(agent).filter((run) => run.startsWith('cargo mutants'));
  assert.equal(
    command,
    'cargo mutants --manifest-path apps/agent/src-tauri/Cargo.toml --package d2rmm-agent-${{ matrix.crate }} ${{ matrix.in_place }} ${{ matrix.shard }} --output reports/mutation/${{ matrix.out }} -- --lib',
  );
});

// CRF-25: the agent job creates reports/mutation with bash, before its first cargo-mutants command.
test('the agent job creates the reports directory first', () => {
  const mkdir = agent.steps.findIndex(
    (step) => step.run === 'mkdir -p reports/mutation' && step.shell === 'bash',
  );
  const first = agent.steps.findIndex((step) => String(step.run ?? '').includes('cargo mutants'));
  assert.ok(mkdir >= 0, 'a bash step creates reports/mutation');
  assert.ok(first > mkdir, 'the directory exists before the first cargo mutants');
});

// AD-130: the upload keeps if: always(), so a non-zero cargo-mutants exit (a missed mutant) still uploads the score.
test('the agent and API jobs upload their reports even when a command fails', () => {
  for (const [job, label] of [
    [agent, 'agent'],
    [api, 'api'],
  ]) {
    const [upload] = uploads(job);
    assert.ok(upload, `the ${label} job uploads its reports`);
    assert.equal(upload.if, 'always()');
  }
  assert.equal(uploads(agent)[0].with.name, '${{ matrix.artifact }}');
  assert.equal(uploads(agent)[0].with.path, 'reports/mutation/${{ matrix.out }}');
});

test('API mutation is a matrix per layer, run through the one runner', () => {
  assert.deepEqual(api.strategy.matrix.layer, ['domain', 'application']);
  assert.equal(api.strategy['fail-fast'], false);
  assert.ok(
    runs(api).includes(
      'pnpm exec turbo run test:mutation --filter=@d2rmm/api -- --layer ${{ matrix.layer }}',
    ),
  );
  assert.equal(uploads(api)[0].with.name, 'api-mutation-${{ matrix.layer }}');
});

test('acceptance runs the BDD suite with a browser and uploads its JSON report', () => {
  assert.ok(runs(acceptance).includes('pnpm run test:acceptance'));
  assert.ok(runs(acceptance).some((run) => run.includes('playwright install chromium')));
  const [upload] = uploads(acceptance);
  assert.equal(upload.if, 'always()');
  assert.equal(upload.with.name, 'acceptance-report');
  assert.equal(upload.with.path, 'reports/acceptance/');
});

// NGT-08: the load run on a GitHub runner, against the harness's own containers.
test('load builds the two images with buildx and its cache, runs the full ladder and checks the summary', () => {
  const builds = load.steps.filter((step) => String(step.uses ?? '').startsWith('docker/build-push-action@'));
  assert.deepEqual(
    builds.map((step) => step.with.tags),
    ['d2rmm-load-api:f0', 'd2rmm-load-k6:f0'],
  );
  for (const build of builds) {
    assert.equal(build.with.load, true);
    assert.match(build.with['cache-from'], /^type=gha/u);
  }
  assert.ok(load.steps.some((step) => String(step.uses ?? '').startsWith('docker/setup-buildx-action@')));
  const run = runs(load).indexOf('pnpm test:load');
  const check = runs(load).indexOf('node --test scripts/load/check/full-summary.check.mjs');
  assert.ok(run >= 0 && check > run, 'the check follows the run');
  assert.equal(stepNamed(load, 'Check the full summary')['continue-on-error'], true);
});

test('the load run uses the images the job just built (UPK-06)', () => {
  const names = load.steps.map((step) => step.name ?? '');
  const lastBuild = Math.max(
    ...load.steps.map((step, i) =>
      String(step.uses ?? '').startsWith('docker/build-push-action@') ? i : -1,
    ),
  );
  const run = names.indexOf('Load test (full ladder)');
  assert.ok(run > lastBuild, 'the run follows both builds');
  assert.equal(load.steps[run].env.LOAD_IMAGES_PREBUILT, '1');
});

test('the load job sets no target, so the harness refuses nothing and starts its own containers', () => {
  const text = JSON.stringify(load);
  for (const name of ['LOAD_TARGET', 'DATABASE_URL', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'OTEL_']) {
    assert.ok(!text.includes(name), `${name} is not set in the load job`);
  }
  assert.ok(!('env' in load) && !('services' in load), 'no job-level env or service containers');
});

test('the load job uploads the summary and the check verdict, then fails if the check failed', () => {
  const [upload] = uploads(load);
  assert.equal(upload.if, 'always()');
  assert.equal(upload.with.name, 'load-report');
  assert.equal(upload.with.path, 'reports/load/');
  assert.ok(runs(load).some((run) => run.includes('reports/load/check.json')));
  const last = load.steps.at(-1);
  assert.equal(last.if, "steps.check.outcome == 'failure'");
  assert.ok(String(last.run).includes('exit 1'));
});

// CRF-12 and CRF-13: the ratchet waits for the mutation jobs and runs unless cancelled.
test('quality waits for both mutation jobs and runs unless cancelled', () => {
  assert.deepEqual([quality.needs].flat(), ['agent-mutation', 'api-mutation']);
  assert.ok(condition(quality).includes('!cancelled()'));
});

// CRF-14 and CRF-15: the shards land where the ratchet reads them, before it runs; none when the jobs were skipped.
test('the mutation reports are downloaded and merged before the ratchet', () => {
  const agentDownload = stepNamed(quality, "Download the agent's mutation reports");
  const apiDownload = stepNamed(quality, 'Download the API mutation reports');
  const merge = indexNamed(quality, 'Merge the agent shards');
  const ratchet = indexNamed(quality, 'Quality ratchet (nightly)');
  assert.deepEqual(agentDownload.with, { pattern: 'agent-mutation-*', path: 'reports/agent-shards' });
  assert.deepEqual(apiDownload.with, {
    pattern: 'api-mutation-*',
    path: 'reports/mutation',
    'merge-multiple': true,
  });
  assert.equal(agentDownload.if, "needs.agent-mutation.result != 'skipped'");
  assert.equal(apiDownload.if, "needs.api-mutation.result != 'skipped'");
  assert.ok(quality.steps.indexOf(agentDownload) < merge && quality.steps.indexOf(apiDownload) < merge);
  assert.ok(merge < ratchet, 'the merge comes before the ratchet');
  assert.equal(
    quality.steps[merge].run,
    'node scripts/nightly/merge-mutants.mjs --in reports/agent-shards --out reports/mutation',
  );
});

// CRF-16 and CRF-17: pinned downloads that do not fail quality when an artifact is missing.
test('the downloads are pinned and a failed download does not fail quality', () => {
  for (const name of ["Download the agent's mutation reports", 'Download the API mutation reports']) {
    const step = stepNamed(quality, name);
    assert.ok(
      step.uses.startsWith(`${DOWNLOAD} `) || step.uses === DOWNLOAD,
      `${name} uses the pinned action`,
    );
    assert.equal(step['continue-on-error'], true);
  }
});

// NGT-03: the report job runs last, always, and can read earlier runs.
test('the report job waits for every suite and the ratchet, and always runs', () => {
  assert.deepEqual([report.needs].flat().sort(), [
    'acceptance',
    'agent-mutation',
    'api-mutation',
    'detect',
    'load',
    'quality',
  ]);
  assert.equal(report.if, 'always()');
});

test('the report job has actions: read and the others only contents: read', () => {
  assert.deepEqual(report.permissions, { contents: 'read', actions: 'read' });
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  for (const [name, job] of Object.entries(jobs)) {
    if (name !== 'report')
      assert.equal(job.permissions, undefined, `${name} uses the workflow's permissions`);
  }
});

test('the report is built from the downloaded artifacts, written to the summary and uploaded', () => {
  const build = indexNamed(report, 'Build the report');
  const summary = indexNamed(report, 'Publish the job summary');
  const download = report.steps.findIndex((step) => String(step.uses ?? '').startsWith(DOWNLOAD));
  assert.ok(download >= 0 && download < build && build < summary);
  assert.deepEqual(report.steps[download].with, { path: 'reports/artifacts' });
  assert.ok(
    report.steps[build].run.startsWith(
      'node scripts/nightly/report.mjs --in reports/artifacts --out reports/nightly',
    ),
  );
  assert.ok(report.steps[build].run.includes('--previous reports/previous/nightly-report.json'));
  assert.equal(report.steps[summary].run, 'cat reports/nightly/nightly-report.md >> "$GITHUB_STEP_SUMMARY"');
  const upload = report.steps.find((step) => String(step.uses ?? '').startsWith('actions/upload-artifact@'));
  assert.equal(upload.with.name, 'nightly-report');
  assert.equal(upload.with.path, 'reports/nightly/');
});

test('the previous report is optional: its download and the jobs listing do not fail the job', () => {
  assert.equal(stepNamed(report, 'Download the previous report')['continue-on-error'], true);
  assert.equal(stepNamed(report, "The run's jobs")['continue-on-error'], true);
  assert.ok(stepNamed(report, 'Download the previous report').run.includes('--event schedule'));
  assert.ok(stepNamed(report, 'Download the previous report').run.includes('--branch main'));
});

// The backup is not part of the report and stays as it was.
test('the backup job is unchanged: production environment, no needs', () => {
  assert.equal(jobs.backup.environment, 'production');
  assert.equal(jobs.backup.needs, undefined);
});

// The production environment rejects branch refs, so a branch dispatch must skip the backup, not fail it.
test('the backup runs only on main', () => {
  assert.equal(jobs.backup.if, "github.ref == 'refs/heads/main'");
});

// NGT-01 and the supply chain: every action is pinned by its full commit SHA.
test('every action in the nightly is pinned by its full commit SHA', () => {
  const uses = Object.values(jobs).flatMap((job) => job.steps.map((step) => step.uses).filter(Boolean));
  assert.ok(uses.length > 10);
  for (const action of uses) assert.match(action, FULL_SHA, `${action} is pinned`);
});

test('every job has a timeout', () => {
  for (const [name, job] of Object.entries(jobs)) {
    if (name !== 'backup' && name !== 'detect')
      assert.ok(job['timeout-minutes'] > 0, `${name} has a timeout`);
  }
});

// The cargo-mutants version is pinned, so a new release never changes the nightly's mutants or its score unannounced.
const installedTools = (job) =>
  job.steps
    .filter((step) => String(step.uses ?? '').startsWith('taiki-e/install-action@'))
    .flatMap((step) => String(step.with?.tool ?? '').split(','));
const unpinnedMutants = (tools) =>
  tools.filter((tool) => /^cargo-mutants(?!@\d+\.\d+\.\d+$)/u.test(tool.trim()));

test('the nightly installs an exact cargo-mutants version', () => {
  const tools = installedTools(agent);
  assert.ok(
    tools.some((tool) => tool.startsWith('cargo-mutants')),
    'the job installs cargo-mutants',
  );
  assert.deepEqual(unpinnedMutants(tools), []);
  assert.deepEqual(unpinnedMutants(['cargo-mutants']), ['cargo-mutants']);
  assert.deepEqual(unpinnedMutants(['cargo-mutants@27']), ['cargo-mutants@27']);
});
