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
