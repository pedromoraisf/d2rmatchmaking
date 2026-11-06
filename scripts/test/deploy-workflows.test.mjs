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
const workflowText = (name) => readText(`.github/workflows/${name}`);
const workflow = (name) => parse(workflowText(name));
const WORKFLOWS = ['deploy-api.yml', 'deploy-web.yml'];
const SHA_PINNED = /^[^@\s]+@[0-9a-f]{40}$/;

const stepsOf = (job) => job.steps ?? [];
const runsOf = (job) =>
  stepsOf(job)
    .filter((step) => typeof step.run === 'string')
    .map((step) => step.run);
const indexOfRun = (job, needle) =>
  stepsOf(job).findIndex((step) => typeof step.run === 'string' && step.run.includes(needle));
const usesOf = (wf) =>
  Object.values(wf.jobs).flatMap((job) =>
    stepsOf(job)
      .filter((step) => step.uses)
      .map((step) => step.uses),
  );

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
    (s) => s.name !== changes?.name && s.name !== 'Check out the commit ci.yml verified',
  )) {
    assert.equal(step.if, "steps.changes.outputs.changed == 'true'", `step "${step.name}" must be gated`);
  }
});

test('secrets reach only the deploy job, through env', () => {
  for (const name of WORKFLOWS) {
    const wf = workflow(name);
    for (const [jobName, job] of Object.entries(wf.jobs)) {
      if (jobName === 'build' || jobName === 'comment') {
        assert.ok(
          !workflowTextOfJob(name, jobName).includes('secrets.'),
          `${name} ${jobName} must hold no secrets`,
        );
      }
      for (const run of runsOf(job)) {
        assert.ok(!run.includes('secrets.'), `${name} ${jobName}: a secret appears inside run:`);
      }
    }
  }
  assert.ok(workflowTextOfJob('deploy-api.yml', 'deploy').includes('secrets.NEON_DATABASE_URL'));
});

test('no github expression inside run in either workflow', () => {
  for (const name of WORKFLOWS) {
    for (const job of Object.values(workflow(name).jobs)) {
      for (const run of runsOf(job)) {
        assert.doesNotMatch(run, /\$\{\{/, `${name}: run: must not interpolate expressions`);
      }
    }
  }
});

test('every third-party action is pinned to a full commit SHA', () => {
  for (const name of WORKFLOWS) {
    const uses = usesOf(workflow(name));
    assert.ok(uses.length > 0, `${name} uses no actions`);
    for (const reference of uses) {
      assert.match(reference, SHA_PINNED, `${name}: ${reference} is not pinned by commit SHA`);
    }
  }
});

test('deploy-web publishes previews only for same-repo PRs', () => {
  const wf = workflow('deploy-web.yml');
  assert.ok(wf.on.pull_request, 'deploy-web must run on pull requests');
  const sameRepo = 'github.event.pull_request.head.repo.full_name == github.repository';
  assert.ok(wf.jobs.deploy.if.includes(sameRepo), 'the deploy job must refuse PRs from forks');
  assert.ok(wf.jobs.comment.if.includes(sameRepo), 'the comment job must refuse PRs from forks');
  assert.ok(
    !wf.jobs.deploy.if.includes("github.event_name == 'pull_request' ||"),
    'a bare PR path must not deploy',
  );
});

test('deploy-web deploys main on push and the build job holds no secrets', () => {
  const wf = workflow('deploy-web.yml');
  assert.deepEqual(wf.on.push.branches, ['main']);
  assert.ok(!workflowTextOfJob('deploy-web.yml', 'build').includes('secrets.'));
  assert.deepEqual(wf.permissions, { contents: 'read' });
});

test('deploy-web passes the branch name through env and quotes it in run', () => {
  const deploy = workflow('deploy-web.yml').jobs.deploy;
  const publish = stepsOf(deploy).find((step) => step.id === 'publish');
  assert.ok(publish.env.DEPLOY_BRANCH.includes('github.head_ref'));
  assert.ok(publish.run.includes('--branch "$DEPLOY_BRANCH"'));
  assert.doesNotMatch(publish.run, /github\.head_ref/);
});

test('deploy-web fails the publish step when wrangler fails', () => {
  const publish = stepsOf(workflow('deploy-web.yml').jobs.deploy).find((step) => step.id === 'publish');
  assert.match(publish.run, /wrangler pages deploy .*\| tee /);
  // Only an explicit `shell: bash` runs with pipefail; the default `bash -e` reports the exit code of tee.
  assert.equal(publish.shell, 'bash');
});

test('pull-requests write is granted only on the comment job', () => {
  const wf = workflow('deploy-web.yml');
  assert.equal(wf.permissions['pull-requests'], undefined);
  for (const [jobName, job] of Object.entries(wf.jobs)) {
    const granted = job.permissions?.['pull-requests'];
    if (jobName === 'comment') {
      assert.equal(granted, 'write');
    } else {
      assert.equal(granted, undefined, `${jobName} must not write pull requests`);
    }
  }
});

test('render.yaml checks /healthz, never auto-deploys and runs the staging build', () => {
  const service = parse(readText('render.yaml')).services[0];
  assert.equal(service.type, 'web');
  assert.equal(service.plan, 'free');
  assert.equal(service.healthCheckPath, '/healthz');
  assert.equal(service.autoDeploy, false);
  const env = Object.fromEntries(service.envVars.map((entry) => [entry.key, entry.value]));
  assert.equal(env.D2RMM_ENV, 'staging');
  assert.equal(env.ENABLE_STAGING_ENDPOINTS, 'true');
  assert.equal(env.SITE_ORIGIN, 'https://d2rmatchmaking.pages.dev');
  assert.match(service.buildCommand, /^npm install -g corepack@\d+\.\d+\.\d+ && corepack enable && /);
});

// The text of one job, from its key to the next job key, so a check can look at a single job's secrets and permissions.
function workflowTextOfJob(name, jobName) {
  const lines = workflowText(name).split('\n');
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  if (start < 0) {
    return '';
  }
  const next = lines.findIndex((line, index) => index > start && /^ {2}[a-z-]+:$/.test(line));
  return lines.slice(start, next < 0 ? undefined : next).join('\n');
}
