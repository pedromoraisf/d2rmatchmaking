// The integration job builds the headless agent example of the end-to-end run (OBS-24). The acceptance steps start the
// example with `cargo run`, so the job needs a Rust toolchain and a build cache before the acceptance step runs. Every
// action the job adds is pinned by a full commit SHA, as the agent job pins its toolchain (ADR 025, the supply chain).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parse } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflow = parse(readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8'));
const steps = workflow.jobs.integration.steps;
const SHA = /@[0-9a-f]{40}(?:\s|$)/u;

// CRF-01 (ci-and-review-fixes): the acceptance task builds the site it serves before it runs.
test('the acceptance task depends on the site build', () => {
  const turbo = JSON.parse(readFileSync(path.join(root, 'turbo.json'), 'utf8'));
  const task = turbo.tasks['test:acceptance'];
  assert.deepEqual(task.dependsOn, ['^build', '@d2rmm/web#build'], 'dependsOn names the site build');
  assert.equal(task.cache, false, 'cache is unchanged');
  assert.deepEqual(task.outputs, [], 'outputs are unchanged');
});

// CRF-03: CI runs acceptance through the same command, so the site build of turbo applies to it.
test('the integration job runs acceptance through the command', () => {
  const runs = steps.map((step) => step.run).filter((run) => typeof run === 'string');
  assert.ok(runs.includes('pnpm run test:acceptance'), 'the integration job runs pnpm run test:acceptance');
});

test('the integration job builds the headless example', () => {
  const build = steps.find((step) => typeof step.run === 'string' && step.run.includes('--example headless'));
  assert.ok(build, 'a step builds the headless example');
  assert.match(build.run, /cargo build --locked --manifest-path apps\/agent\/src-tauri\/Cargo\.toml/u);
  assert.match(build.run, /-p d2rmm-agent-adapters/u);
  assert.match(build.run, /--features fixture-read/u);

  const toolchain = steps.findIndex((step) => String(step.uses ?? '').startsWith('dtolnay/rust-toolchain@'));
  const cache = steps.findIndex((step) => String(step.uses ?? '').startsWith('Swatinem/rust-cache@'));
  const buildAt = steps.indexOf(build);
  assert.ok(toolchain >= 0 && toolchain < buildAt, 'the Rust toolchain is set up before the build');
  assert.ok(cache >= 0 && cache < buildAt, 'the target cache is set up before the build');
  assert.match(
    String(steps[cache].with?.workspaces),
    /apps\/agent\/src-tauri/u,
    'the cache covers the agent workspace',
  );
});

test('the integration job keeps its steps and pins the actions it adds by SHA', () => {
  const runs = steps.map((step) => step.run).filter((run) => typeof run === 'string');
  assert.ok(runs.includes('pnpm run test:integration'), 'the integration tests still run');
  assert.ok(runs.includes('pnpm run test:e2e'), 'the e2e tests still run');
  assert.ok(
    steps.some((step) => step.name === 'Acceptance (BDD scenarios from .specs)'),
    'the acceptance step is still there',
  );

  for (const prefix of ['dtolnay/rust-toolchain@', 'Swatinem/rust-cache@']) {
    const step = steps.find((candidate) => String(candidate.uses ?? '').startsWith(prefix));
    assert.ok(step, `${prefix} is in the job`);
    assert.match(step.uses, SHA, `${prefix} is pinned by a full commit SHA`);
  }
});

// CFP-01, CFP-02, CFP-05, CFP-07, CFP-24: mutation leaves `verify` and runs in its own job beside the required checks.
const jobs = workflow.jobs;
const verifySteps = jobs.verify.steps;
const commandLines = (run) =>
  String(run ?? '')
    .split('\n')
    .map((line) => line.trim());
const needsOf = (job) => [job.needs ?? []].flat().sort();

test('verify runs no mutation', () => {
  for (const step of verifySteps) {
    assert.doesNotMatch(
      String(step.run ?? ''),
      /test:mutation|stryker|cargo mutants/u,
      `${step.name ?? 'a step'} runs no mutation`,
    );
  }
});

test('verify keeps every other sensor', () => {
  const commands = [
    'pnpm run format:check',
    'pnpm run lint',
    'pnpm run typecheck',
    'pnpm run arch',
    'pnpm test',
    'pnpm run specs:check',
    'pnpm run contracts:check',
    'pnpm run quality:gate',
  ];
  const runLines = verifySteps.flatMap((step) => commandLines(step.run));
  for (const command of commands) {
    assert.ok(runLines.includes(command), `verify still runs ${command}`);
  }
});

// ADR 029: mutation runs in the nightly only. No pull request job mutates.
test('no job of the pull request runs mutation', () => {
  for (const [name, job] of Object.entries(jobs)) {
    for (const step of job.steps ?? []) {
      assert.doesNotMatch(
        String(step.run ?? ''),
        /test:mutation|stryker|cargo mutants/u,
        `${name} runs no mutation`,
      );
    }
  }
  assert.equal(jobs.mutation, undefined);
  assert.equal(jobs['agent-mutation'], undefined);
});

test('integration waits only for verify', () => {
  assert.deepEqual(needsOf(jobs.integration), ['detect', 'verify']);
});

// CFP-15, CFP-18, CFP-25: the smoke job boots the API with the install, migration and start commands of Render and of
// deploy-api.yml, against a Postgres service, and requests /healthz (AD-161).
const render = parse(readFileSync(path.join(root, 'render.yaml'), 'utf8')).services[0];
const smoke = () => jobs.smoke;
const runOf = (job, pattern) => job.steps.find((step) => String(step.run ?? '').includes(pattern));

test('the smoke job boots the API the way Render does', () => {
  const job = smoke();
  assert.deepEqual(needsOf(job), ['detect'], 'smoke needs only detect');
  assert.equal(
    job.if,
    "github.event_name == 'pull_request' && needs.detect.outputs.api == 'true'",
    'it runs only on pull requests with an API',
  );
  assert.match(job.services.postgres.image, /^postgres:/u, 'it has a Postgres service container');

  const install = runOf(job, 'pnpm install --frozen-lockfile --ignore-scripts');
  const migrate = runOf(job, 'pnpm --filter @d2rmm/api db:migrate');
  const start = runOf(job, render.startCommand);
  const probe = runOf(job, 'scripts/ci/smoke-healthz.mjs');
  assert.ok(install, 'the workspace is installed with the Render buildCommand install');
  assert.ok(migrate, 'the migrations run as deploy-api.yml runs them');
  assert.ok(start, 'the API starts with the startCommand of render.yaml');
  assert.ok(probe, 'the smoke script runs');
  assert.match(probe.run, /\/healthz/u, 'it requests /healthz');

  const at = (step) => job.steps.indexOf(step);
  assert.ok(
    at(install) < at(migrate) && at(migrate) < at(start) && at(start) < at(probe),
    'install, migrate, start and probe run in that order',
  );
  assert.equal(job.env.DATABASE_URL.startsWith('postgres://'), true, 'DATABASE_URL points at the service');
  assert.equal(job.env.D2RMM_ENV, 'staging', 'the smoke job runs with the staging environment of Render');
  assert.equal(job.env.ENABLE_STAGING_ENDPOINTS, 'true', 'as the Render service does');
  assert.equal(job.env.SITE_ORIGIN, render.envVars.find((v) => v.key === 'SITE_ORIGIN').value);
  assert.equal(
    job.env.D2RMM_ACCEPTANCE,
    undefined,
    'the test controls are never on in the smoke job (AD-045)',
  );
});

// CFP-18, CFP-19: the new jobs read no secret, and every action they use outside actions/ is pinned by a full SHA.
const NEW_JOBS = ['smoke', 'agent-build'];

test('the new jobs read no secret and pin their actions', () => {
  for (const name of NEW_JOBS) {
    const job = jobs[name];
    assert.doesNotMatch(JSON.stringify(job), /secrets\./u, `${name} reads no secret`);
    for (const step of job.steps) {
      if (step.uses !== undefined && !step.uses.startsWith('actions/')) {
        assert.match(step.uses, SHA, `${name} pins ${step.uses} by a full commit SHA`);
      }
    }
  }
});

// CFP-17: the agent's release compiles on Windows for a pull request that changes the agent, and no signing key is in
// reach: updater artifacts are switched off for this build by a command-line override.
test('the agent build job compiles the release without signing', () => {
  const job = jobs['agent-build'];
  assert.equal(job['runs-on'], 'windows-latest', 'agent-build runs on Windows');
  assert.deepEqual(needsOf(job), ['detect'], 'agent-build needs only detect');
  assert.equal(
    job.if,
    "github.event_name == 'pull_request' && needs.detect.outputs.agent == 'true'",
    'it runs only on pull requests with an agent',
  );
  assert.doesNotMatch(JSON.stringify(job), /TAURI_SIGNING/u, 'no signing key is in the job');
  assert.equal(job.env, undefined, 'the job sets no environment that could carry a key');

  const changed = job.steps.find((step) => step.id === 'changed');
  assert.match(
    changed.run,
    /git diff --name-only .*-- apps\/agent/u,
    'it looks for changes under apps/agent',
  );

  const build = runOf(job, 'tauri build');
  assert.ok(build, 'the release is compiled with tauri build');
  assert.equal(
    build.if,
    "steps.changed.outputs.changed == 'true'",
    'the build runs only when the agent changed',
  );
  assert.match(
    build.run,
    /--config '\{"bundle":\{"createUpdaterArtifacts":false\}\}'/u,
    'updater artifacts are off for this build',
  );
});
