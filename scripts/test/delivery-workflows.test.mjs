// Static checks of the delivery stages and their callers (ADR 033, DLP-02, DLP-03, DLP-10). The workflows run only with
// secrets and after a push, so their shape is checked here: triggers, secrets, expressions, pins, stage names and the
// order smoke → promote.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parse } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const text = (name) => readFileSync(path.join(root, '.github/workflows', name), 'utf8');
const workflow = (name) => parse(text(name));

const STAGES = ['stage-build.yml', 'stage-deploy.yml', 'stage-smoke.yml', 'stage-promote.yml'];
const CALLERS = ['site.yml'];
const ALL = [...STAGES, ...CALLERS];
const STAGE_NAMES = ['build', 'verify', 'deploy', 'smoke', 'promote'];
const SHA_PINNED = /^[^@\s]+@[0-9a-f]{40}$/;

const stepsOf = (job) => job.steps ?? [];
const runsOf = (job) =>
  stepsOf(job)
    .filter((step) => typeof step.run === 'string')
    .map((step) => step.run);
const indexOfStep = (job, predicate) => stepsOf(job).findIndex(predicate);
const runIncludes = (needle) => (step) => typeof step.run === 'string' && step.run.includes(needle);
/** The text of one job, to look for `secrets.` outside `run`. */
const jobText = (name, job) => JSON.stringify(workflow(name).jobs[job]);

test('the stages are reusable workflows (workflow_call) and every job is named after a stage', () => {
  for (const name of STAGES) {
    const wf = workflow(name);
    assert.ok(wf.on.workflow_call, `${name} must be a workflow_call`);
    assert.deepEqual(wf.permissions, { contents: 'read' }, `${name} must default to read-only`);
    for (const [id, job] of Object.entries(wf.jobs)) {
      assert.ok(STAGE_NAMES.includes(job.name ?? id), `${name}: job ${id} is not named after a stage`);
      assert.equal(job.name ?? id, id, `${name}: job id and name must agree`);
    }
  }
  assert.deepEqual(Object.keys(workflow('stage-build.yml').jobs), ['build']);
  assert.deepEqual(Object.keys(workflow('stage-deploy.yml').jobs), ['verify', 'deploy']);
  assert.deepEqual(Object.keys(workflow('stage-smoke.yml').jobs), ['smoke']);
  assert.deepEqual(Object.keys(workflow('stage-promote.yml').jobs), ['promote', 'smoke']);
});

test('site.yml is a thin caller: its jobs only call the stages, named after them', () => {
  const wf = workflow('site.yml');
  for (const [id, job] of Object.entries(wf.jobs)) {
    assert.ok(STAGE_NAMES.includes(id), `site.yml job ${id} is not a stage name`);
    assert.equal(job.name, id);
    assert.match(job.uses, /^\.\/\.github\/workflows\/stage-(build|deploy|smoke|promote)\.yml$/);
    assert.equal(job.steps, undefined, `site.yml ${id} must hold no steps`);
  }
  assert.deepEqual(Object.keys(wf.jobs), ['build', 'deploy', 'smoke', 'promote']);
});

test('site.yml triggers: main and same-repo pull requests deploy, a dispatch promotes a SHA', () => {
  const wf = workflow('site.yml');
  assert.deepEqual(wf.on.push.branches.slice(0, 1), ['main']);
  assert.ok(wf.on.pull_request, 'pull requests get a preview');
  assert.equal(wf.on.workflow_dispatch.inputs.sha.required, true);
  assert.deepEqual(wf.permissions, { contents: 'read', actions: 'read', 'pull-requests': 'read' });
  assert.ok(wf.jobs.deploy.if.includes('github.event.pull_request.head.repo.full_name == github.repository'));
  assert.equal(wf.jobs.promote.if, "github.event_name == 'workflow_dispatch'");
  assert.equal(wf.jobs.build.if, "github.event_name != 'workflow_dispatch'");
  assert.deepEqual(wf.jobs.deploy.needs, ['build']);
  assert.deepEqual(wf.jobs.smoke.needs, ['deploy']);
  // A preview is cancelled by the next push; a staging run on main is not.
  assert.match(wf.concurrency['cancel-in-progress'], /github\.ref != 'refs\/heads\/main'/);
});

test('verify comes before deploy, and the deploy stage downloads the artifact instead of building', () => {
  const deployWf = workflow('stage-deploy.yml');
  assert.deepEqual(deployWf.jobs.deploy.needs, ['verify']);
  assert.ok(runsOf(deployWf.jobs.verify).some((run) => run.includes('ci-verdict.mjs')));
  const download = indexOfStep(deployWf.jobs.deploy, (s) => s.uses?.startsWith('actions/download-artifact@'));
  const publish = indexOfStep(deployWf.jobs.deploy, runIncludes('wrangler pages deploy'));
  assert.ok(download >= 0 && publish > download, 'the artifact is downloaded before it is published');
});

test('no deploy or promote job builds anything (build once, DLP-03)', () => {
  for (const [name, job] of [
    ['stage-deploy.yml', 'deploy'],
    ['stage-promote.yml', 'promote'],
  ]) {
    for (const run of runsOf(workflow(name).jobs[job])) {
      assert.doesNotMatch(
        run,
        /\b(pnpm|npm|turbo|vite|cargo|tauri)\b[^\n]*\bbuild\b/,
        `${name} ${job} builds: ${run}`,
      );
    }
  }
  assert.ok(runsOf(workflow('stage-build.yml').jobs.build).some((run) => run.includes('build')));
});

test('the artifact is named by the commit SHA in build, deploy and promote', () => {
  const name = 'name: ${{ inputs.app }}-${{ inputs.sha }}';
  for (const [file, job] of [
    ['stage-build.yml', 'build'],
    ['stage-deploy.yml', 'deploy'],
    ['stage-promote.yml', 'promote'],
  ]) {
    const step = stepsOf(workflow(file).jobs[job]).find((s) => s.uses?.includes('-artifact@'));
    assert.equal(`name: ${step?.with.name}`, name, `${file} must use the SHA-named artifact`);
  }
});

test('stage-promote verifies the staging smoke of the SHA before it downloads or publishes (ADR 033 § 7)', () => {
  const job = workflow('stage-promote.yml').jobs.promote;
  const gate = indexOfStep(job, runIncludes('scripts/delivery/promotable.mjs'));
  const download = indexOfStep(job, (s) => s.uses?.startsWith('actions/download-artifact@'));
  const publish = indexOfStep(job, runIncludes('wrangler pages deploy'));
  assert.ok(gate >= 0, 'the promotion gate step must exist');
  assert.ok(gate < download && download < publish, 'gate, then artifact, then publish');
  assert.equal(job.permissions.actions, 'read', 'the gate reads workflow runs through the REST API');
  const downloadStep = stepsOf(job)[download];
  assert.equal(
    downloadStep.with['run-id'],
    '${{ steps.staging.outputs.run_id }}',
    'the artifact comes from the staging run',
  );
  assert.equal(stepsOf(job)[gate].id, 'staging');
});

test('smoke comes after the deploy it checks, and production smoke follows the promote', () => {
  const promoteWf = workflow('stage-promote.yml');
  assert.deepEqual(promoteWf.jobs.smoke.needs, ['promote']);
  assert.equal(promoteWf.jobs.smoke.uses, './.github/workflows/stage-smoke.yml');
  assert.equal(promoteWf.jobs.smoke.with.environment, 'production');
  const smoke = workflow('stage-smoke.yml').jobs.smoke;
  assert.ok(runsOf(smoke).some((run) => run.includes('scripts/delivery/smoke.mjs')));
});

test('secrets reach only the deploy and promote jobs, and only through env', () => {
  for (const name of ALL) {
    const wf = workflow(name);
    for (const [id, job] of Object.entries(wf.jobs)) {
      for (const run of runsOf(job)) {
        assert.ok(!run.includes('secrets.'), `${name} ${id}: a secret appears inside run:`);
      }
      const holdsSecret = /secrets\.(?!GITHUB_TOKEN)/.test(jobText(name, id));
      if (holdsSecret) {
        assert.ok(['deploy', 'promote'].includes(id), `${name}: job ${id} must hold no secrets`);
        for (const step of stepsOf(job).filter((s) => /secrets\./.test(JSON.stringify(s)))) {
          assert.ok(
            Object.values(step.env ?? {}).some((value) => /secrets\./.test(value)) && !step.with,
            `${name} ${id}: secrets must reach a step through env only`,
          );
        }
      }
    }
  }
  assert.doesNotMatch(text('stage-build.yml'), /secrets\./);
  assert.doesNotMatch(text('stage-smoke.yml'), /secrets\./);
  assert.match(text('stage-deploy.yml'), /secrets\.CLOUDFLARE_API_TOKEN/);
});

test('no github expression inside run in any stage or caller', () => {
  for (const name of ALL) {
    for (const job of Object.values(workflow(name).jobs)) {
      for (const run of runsOf(job)) {
        assert.doesNotMatch(run, /\$\{\{/, `${name}: run: must not interpolate expressions`);
      }
    }
  }
});

test('every action is pinned by a full commit SHA and every job has a timeout', () => {
  for (const name of ALL) {
    for (const [id, job] of Object.entries(workflow(name).jobs)) {
      if (!job.uses) assert.ok(Number.isInteger(job['timeout-minutes']), `${name} ${id} has no timeout`);
      for (const step of stepsOf(job).filter((s) => s.uses)) {
        assert.match(step.uses, SHA_PINNED, `${name}: ${step.uses} is not pinned by commit SHA`);
      }
    }
  }
});

test('the frozen workflows are not mentioned as edited: callers never reference ci, nightly or ocr-real as stages', () => {
  for (const name of ALL) {
    assert.doesNotMatch(text(name), /uses: \.\/\.github\/workflows\/(ci|nightly|ocr-real)\.yml/);
  }
});
