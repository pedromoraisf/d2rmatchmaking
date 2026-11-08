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
    'pnpm run tlc:selftest',
    'pnpm run specs:check',
    'pnpm run contracts:check',
    'pnpm run harness:json',
    'pnpm run harness:gate',
    'pnpm run quality:gate',
  ];
  const runLines = verifySteps.flatMap((step) => commandLines(step.run));
  for (const command of commands) {
    assert.ok(runLines.includes(command), `verify still runs ${command}`);
  }
});

test('detect reports a Stryker configuration', () => {
  assert.equal(
    jobs.detect.outputs.stryker,
    '${{ steps.d.outputs.stryker }}',
    'detect exposes the stryker output',
  );
  const detect = jobs.detect.steps.find((step) => step.id === 'd');
  assert.match(
    detect.run,
    /compgen -G "apps\/api\/stryker\.config\.\*"/u,
    'it looks for the Stryker configuration',
  );
  assert.match(
    detect.run,
    /echo "stryker=true" >> "\$GITHUB_OUTPUT"/u,
    'it reports stryker=true when present',
  );
});

test('the mutation job runs beside the required checks', () => {
  const mutation = jobs.mutation;
  assert.deepEqual(needsOf(mutation), ['detect'], 'mutation needs only detect');
  assert.equal(
    mutation.if,
    "github.event_name == 'pull_request' && needs.detect.outputs.stryker == 'true'",
    'it runs only on pull requests with a Stryker configuration',
  );

  const cache = mutation.steps.find((step) => String(step.uses ?? '').startsWith('actions/cache@'));
  assert.ok(cache, 'the incremental files are restored and saved with actions/cache');
  assert.equal(cache.with.path, 'apps/api/reports/stryker-incremental-*.json');
  assert.ok(
    cache.with.key.startsWith('stryker-incremental-${{ github.base_ref }}-'),
    'the key starts with the base branch prefix',
  );
  assert.equal(
    cache.with['restore-keys'],
    'stryker-incremental-${{ github.base_ref }}-',
    'the restore key is that prefix',
  );

  const runner = mutation.steps.find((step) => String(step.run ?? '').includes('test:mutation'));
  assert.ok(runner, 'the API runner runs in the job');
  assert.match(
    runner.run,
    /--changed-from origin\/\$\{\{ github\.base_ref \}\} --incremental/u,
    'it mutates the files changed against the base branch, incrementally',
  );

  const summary = mutation.steps.find((step) => String(step.run ?? '').includes('mutation-summary.ts'));
  assert.equal(summary.if, 'always()', 'the summary is written even when mutation fails');
});

test('integration waits only for verify', () => {
  assert.deepEqual(needsOf(jobs.integration), ['detect', 'verify']);
});
