// Static checks of the deploy workflows and render.yaml (AWS-34). The workflows run only after the maintainer's push and
// with secrets, so their shape is checked here; their first runs are the phase review's proof (C61).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parse } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readText = (file) => readFileSync(path.join(root, file), 'utf8');
const workflow = (name) => parse(readText(`.github/workflows/${name}`));
const SHA_PINNED = /^[^@\s]+@[0-9a-f]{40}$/;

const stepsOf = (job) => job.steps ?? [];
const runsOf = (job) =>
  stepsOf(job)
    .filter((step) => typeof step.run === 'string')
    .map((step) => step.run);
const indexOfRun = (job, needle) =>
  stepsOf(job).findIndex((step) => typeof step.run === 'string' && step.run.includes(needle));

test('deploy-api runs on a successful ci push to main from this repository', () => {
  const wf = workflow('deploy-api.yml');
  assert.deepEqual(wf.on.workflow_run.workflows, ['ci']);
  assert.deepEqual(wf.on.workflow_run.types, ['completed']);
  assert.deepEqual(wf.permissions, { contents: 'read' });

  const job = wf.jobs.deploy;
  assert.equal(job.environment, 'production');
  for (const guard of [
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.event == 'push'",
    "github.event.workflow_run.head_branch == 'main'",
    'github.event.workflow_run.head_repository.full_name == github.repository',
  ]) {
    assert.ok(job.if.includes(guard), `missing guard: ${guard}`);
  }
  const checkout = stepsOf(job).find((step) => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout?.with.ref, '${{ github.event.workflow_run.head_sha }}');
});

test('deploy-api runs migrations before the deploy hook and polls healthz 5 minutes', () => {
  const job = workflow('deploy-api.yml').jobs.deploy;
  const migrate = indexOfRun(job, 'db:migrate');
  const hook = indexOfRun(job, 'RENDER_DEPLOY_HOOK');
  const health = indexOfRun(job, '/healthz');
  assert.ok(migrate >= 0 && hook >= 0 && health >= 0, 'migrate, deploy hook and healthz steps must exist');
  assert.ok(migrate < hook, 'migrations must run before the deploy hook');
  assert.ok(hook < health, 'the health loop must follow the deploy hook');

  const loop = stepsOf(job)[health].run;
  assert.match(loop, /\+ 300 \)\)/, 'the health loop must be bounded to 300 seconds');
  assert.match(loop, /sleep 10/);
  assert.match(loop, /exit 1/, 'the health loop must fail the job when it times out');
});

test('deploy-api skips the deploy unless the API or the shared packages changed', () => {
  const job = workflow('deploy-api.yml').jobs.deploy;
  const changes = stepsOf(job).find((step) => step.id === 'changes');
  assert.ok(changes?.run.includes('apps/api packages'));
  for (const step of stepsOf(job).filter(
    (s) => s.id !== 'changes' && !s.uses?.startsWith('actions/checkout@'),
  )) {
    assert.equal(step.if, "steps.changes.outputs.changed == 'true'", `step "${step.name}" must be gated`);
  }
});

test('secrets reach only the deploy job, through env', () => {
  const wf = workflow('deploy-api.yml');
  for (const job of Object.values(wf.jobs)) {
    for (const run of runsOf(job)) {
      assert.ok(!run.includes('secrets.'), 'a secret appears inside run:');
    }
  }
  const secretSteps = stepsOf(wf.jobs.deploy).filter((step) =>
    JSON.stringify(step.env ?? {}).includes('secrets.'),
  );
  assert.equal(secretSteps.length, 2, 'the migration and the deploy hook are the only secret steps');
});

test('no github expression inside run', () => {
  for (const job of Object.values(workflow('deploy-api.yml').jobs)) {
    for (const run of runsOf(job)) {
      assert.doesNotMatch(run, /\$\{\{/, 'run: must not interpolate expressions');
    }
  }
});

test('every third-party action is pinned to a full commit SHA', () => {
  const uses = Object.values(workflow('deploy-api.yml').jobs).flatMap((job) =>
    stepsOf(job)
      .filter((step) => step.uses)
      .map((step) => step.uses),
  );
  assert.ok(uses.length > 0);
  for (const reference of uses) {
    assert.match(reference, SHA_PINNED, `${reference} is not pinned by commit SHA`);
  }
});
