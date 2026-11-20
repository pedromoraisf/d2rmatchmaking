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
const CALLERS = ['site.yml', 'api.yml', 'agent.yml'];
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
  assert.equal(
    wf.jobs.promote.if,
    "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'",
  );
  assert.equal(wf.jobs.build.if, "github.event_name != 'workflow_dispatch'");
  assert.deepEqual(wf.jobs.deploy.needs, ['build']);
  assert.deepEqual(wf.jobs.smoke.needs, ['deploy']);
  // A preview is cancelled by the next push; a staging run on main is not.
  const cancel = wf.concurrency['cancel-in-progress'];
  assert.match(cancel, /github\.event_name == 'pull_request'/);
  assert.match(cancel, /github\.event_name == 'push' && github\.ref != 'refs\/heads\/main'/);
  assert.doesNotMatch(cancel, /workflow_dispatch/, 'a dispatch is never cancelled');
  assert.doesNotMatch(cancel, /!=\s*'push'/, 'cancel must be an allow-list of events, not a deny-list');
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
    const step = stepsOf(workflow(file).jobs[job]).find(
      (s) => s.uses?.includes('-artifact@') && s.name !== 'Upload the agent installers',
    );
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

test('promote runs in the production environment, only from main, with the gate from the dispatching ref', () => {
  const caller = workflow('site.yml').jobs.promote;
  assert.match(caller.if, /github\.event_name == 'workflow_dispatch'/);
  assert.match(
    caller.if,
    /github\.ref == 'refs\/heads\/main'/,
    'a dispatch from another ref must not promote',
  );

  const job = workflow('stage-promote.yml').jobs.promote;
  assert.equal(job.environment, 'production');
  const steps = stepsOf(job);
  const gate = indexOfStep(job, runIncludes('scripts/delivery/promotable.mjs'));
  const firstCheckout = indexOfStep(job, (s) => s.uses?.startsWith('actions/checkout@'));
  assert.ok(firstCheckout >= 0 && firstCheckout < gate, 'the gate runs from a checkout');
  assert.equal(
    steps[firstCheckout].with.ref,
    '${{ github.sha }}',
    'the gate code is the dispatching ref, not inputs.sha',
  );
  // Nothing before the gate may take its code from the commit being promoted.
  for (const step of steps.slice(0, gate + 1)) {
    assert.ok(
      !JSON.stringify(step).includes('inputs.sha') || step.id === 'staging',
      `${step.name} uses inputs.sha before the gate`,
    );
  }
  // The promoted commit is checked out only after the gate, apart from the code that runs, and only for its Functions.
  const promoted = indexOfStep(
    job,
    (s) => s.uses?.startsWith('actions/checkout@') && s.with?.ref === '${{ inputs.sha }}',
  );
  assert.ok(promoted > gate, 'the promoted commit is checked out after the gate');
  assert.equal(steps[promoted].with.path, 'promoted');
  assert.equal(steps[promoted].with['sparse-checkout'], 'apps/web/functions');
  const download = indexOfStep(job, (s) => s.uses?.startsWith('actions/download-artifact@'));
  const publish = indexOfStep(job, runIncludes('wrangler pages deploy'));
  assert.ok(gate < download && download < publish);
  for (const preview of ['stage-deploy.yml']) {
    assert.equal(
      workflow(preview).jobs.deploy.environment,
      undefined,
      "preview and staging environments are the maintainer's",
    );
  }
});

test('the deployment URL comes from the strict parser, not from the last https:// of the log', () => {
  for (const [file, job] of [
    ['stage-deploy.yml', 'deploy'],
    ['stage-promote.yml', 'promote'],
  ]) {
    const publish = stepsOf(workflow(file).jobs[job]).find((s) => s.id === 'publish');
    assert.match(
      publish.run,
      /scripts\/delivery\/deployment-url\.mjs deploy\.log "\$CLOUDFLARE_PAGES_PROJECT"/,
    );
    assert.doesNotMatch(publish.run, /grep -Eo/);
  }
});

test('api.yml is a thin caller; it deploys staging only when the maintainer turns the stages on', () => {
  const wf = workflow('api.yml');
  assert.deepEqual(Object.keys(wf.jobs), ['build', 'deploy', 'smoke', 'promote']);
  for (const [id, job] of Object.entries(wf.jobs)) {
    assert.equal(job.name, id);
    assert.equal(job.with.app, 'api');
    assert.equal(job.steps, undefined);
  }
  assert.deepEqual(wf.on.push.branches, ['main']);
  assert.equal(wf.on.pull_request, undefined, "API previews stay preview-api.yml's (ADR 030)");
  assert.equal(wf.on.workflow_dispatch.inputs.sha.required, true);
  assert.equal(wf.concurrency['cancel-in-progress'], false, 'a migration or a deploy is never cancelled');
  assert.equal(wf.jobs.deploy.if, "github.event_name == 'push' && vars.API_STAGES_LIVE == 'true'");
  assert.equal(wf.jobs.deploy.with.environment, 'staging');
  assert.equal(
    wf.jobs.promote.if,
    "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'",
  );
  assert.deepEqual(wf.jobs.smoke.needs, ['deploy']);
});

test('the API deploy migrates its database before it calls Render, then waits for the commit to answer', () => {
  for (const [file, job] of [
    ['stage-deploy.yml', 'deploy'],
    ['stage-promote.yml', 'promote'],
  ]) {
    const j = workflow(file).jobs[job];
    const migrate = indexOfStep(j, runIncludes('db:migrate'));
    const hook = indexOfStep(j, runIncludes('RENDER_DEPLOY_HOOK}&ref=${SHA}'));
    assert.ok(migrate >= 0 && hook > migrate, `${file}: migrations run before the deploy hook`);
    for (const index of [migrate, hook]) {
      assert.equal(stepsOf(j)[index].if, "inputs.app == 'api'", `${file}: API steps run only for the API`);
    }
    assert.match(
      stepsOf(j)[hook].run,
      /smoke\.mjs api "\$API_BASE_URL" "\$SHA"/,
      'waits for the SHA to answer',
    );
    assert.equal(stepsOf(j)[hook].env.SMOKE_BUDGET_SECONDS, '600');
    assert.match(stepsOf(j)[migrate].env.DATABASE_URL, /^\$\{\{ secrets\.[A-Z_]+ \}\}$/);
    assert.equal(stepsOf(j)[hook].env.RENDER_DEPLOY_HOOK, '${{ secrets.RENDER_DEPLOY_HOOK }}');
  }
});

test('promoting the API uses the migrations of the promoted commit, taken after the gate', () => {
  const job = workflow('stage-promote.yml').jobs.promote;
  const gate = indexOfStep(job, runIncludes('scripts/delivery/promotable.mjs'));
  const taken = indexOfStep(job, (s) => s.with?.['sparse-checkout'] === 'apps/api/migrations');
  const migrate = indexOfStep(job, runIncludes('db:migrate'));
  assert.ok(gate < taken && taken < migrate);
  assert.equal(stepsOf(job)[taken].with.ref, '${{ inputs.sha }}');
  assert.equal(stepsOf(job)[taken].with.path, 'promoted-api');
  // Site-only steps never run for the API.
  for (const step of stepsOf(job).filter((s) =>
    /wrangler|download-artifact|deployment-url/.test(JSON.stringify(s)),
  )) {
    assert.equal(step.if, "inputs.app == 'site'", `${step.name} is a site step`);
  }
});

test('the API build compiles the API and uploads the commit pin; the site deploy steps are site-only', () => {
  const build = workflow('stage-build.yml').jobs.build;
  const pin = stepsOf(build).find((s) => s.run?.includes('api-commit.txt'));
  assert.equal(pin.if, "inputs.app == 'api'");
  assert.match(pin.run, /@d2rmm\/api build/);
  for (const step of stepsOf(workflow('stage-deploy.yml').jobs.deploy).filter((s) =>
    /wrangler|download-artifact|pages\.mjs|preview\.mjs/.test(JSON.stringify(s)),
  )) {
    assert.match(step.if, /inputs\.app == 'site'/, `${step.name} is a site step`);
  }
});

test('a promotion fails unless the environment-only marker says production, before any migration or deploy', () => {
  const job = workflow('stage-promote.yml').jobs.promote;
  const steps = stepsOf(job);
  const gate = indexOfStep(job, runIncludes('scripts/delivery/promotable.mjs'));
  const marker = indexOfStep(job, (s) => s.env?.ENVIRONMENT_MARKER === '${{ vars.D2RMM_ENV }}');
  assert.ok(marker > gate, 'the marker is checked right after the gate');
  assert.equal(steps[marker].if, undefined, 'the marker is checked for every app, not skipped');
  assert.match(steps[marker].run, /\[ "\$ENVIRONMENT_MARKER" != "production" \]/);
  assert.match(steps[marker].run, /exit 1/);
  // Nothing that holds a secret or changes anything comes before it.
  for (const step of steps.slice(0, marker)) {
    assert.doesNotMatch(JSON.stringify(step), /secrets\.|db:migrate|wrangler|RENDER_DEPLOY_HOOK/, step.name);
  }
  for (const needle of ['db:migrate', 'RENDER_DEPLOY_HOOK}&ref=', 'wrangler pages deploy']) {
    assert.ok(indexOfStep(job, runIncludes(needle)) > marker, `${needle} comes after the marker`);
  }
  assert.equal(job.environment, 'production');
});

test('the promoted migrations are refused when they hold a symlink, before they are copied', () => {
  const job = workflow('stage-promote.yml').jobs.promote;
  const use = stepsOf(job).find((s) => s.name === 'Use the promoted migrations');
  const check = use.run.indexOf('scripts/delivery/no-symlinks.mjs promoted-api/apps/api/migrations');
  assert.ok(check >= 0, 'the symlink check runs on the promoted tree');
  assert.ok(check < use.run.indexOf('cp -r'), 'the check comes before the copy');
  assert.ok(check < use.run.indexOf('rm -rf'), 'and before the workspace migrations are removed');
});

test('agent.yml is a thin caller: a preview per same-repo pull request, a staging build per commit on main', () => {
  const wf = workflow('agent.yml');
  assert.deepEqual(Object.keys(wf.jobs), ['build']);
  const job = wf.jobs.build;
  assert.equal(job.name, 'build');
  assert.equal(job.uses, './.github/workflows/stage-build.yml');
  assert.equal(job.steps, undefined);
  assert.equal(job.with.app, 'agent');
  assert.match(job.if, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.equal(
    job.with.channel,
    "${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && 'staging' || 'preview' }}",
  );
  assert.equal(job.with.api_base, '${{ vars.API_BASE_URL }}');
  assert.deepEqual(wf.on.push.branches.slice(0, 1), ['main']);
  assert.ok(wf.on.pull_request);
  assert.equal(wf.on.workflow_dispatch, undefined, 'production is never started from here');
  assert.deepEqual(wf.permissions, { contents: 'read', 'pull-requests': 'read' });
  // A staging build on main is never cancelled by a later push.
  assert.doesNotMatch(wf.concurrency['cancel-in-progress'], /refs\/heads\/main'\s*\}\}$/);
  assert.match(wf.concurrency['cancel-in-progress'], /github\.ref != 'refs\/heads\/main'/);
});

test('the agent build: one Windows build per channel, smoke-started against its API before it is uploaded', () => {
  const build = workflow('stage-build.yml').jobs.build;
  assert.match(build['runs-on'], /inputs\.app == 'agent' && 'windows-latest'/);
  const steps = stepsOf(build);
  const index = (predicate) => steps.findIndex(predicate);
  const base = index((s) => s.id === 'agent_api');
  const wake = index((s) => s.run?.includes('scripts/delivery/smoke.mjs api'));
  const config = index((s) => s.id === 'agent_channel');
  const compile = index((s) => s.run?.includes('tauri build'));
  const smoke = index((s) => s.run?.includes('--self-check --online'));
  const verdict = index((s) => s.run?.includes('scripts/delivery/self-check-line.mjs'));
  const upload = index((s) => s.name === 'Upload the agent installers');
  assert.ok(
    base >= 0 &&
      base < wake &&
      wake < config &&
      config < compile &&
      compile < smoke &&
      smoke <= verdict &&
      verdict < upload,
    'API, wake, channel config, compile, smoke start, verdict, then upload',
  );
  // The build is told its channel and API, and takes its identifier and updater from the one table.
  assert.equal(steps[compile].env.D2RMM_CHANNEL, '${{ inputs.channel }}');
  assert.equal(steps[compile].env.D2RMM_API_BASE, '${{ steps.agent_api.outputs.base }}');
  assert.match(steps[compile].run, /--config "\$TAURI_CHANNEL_CONFIG"/);
  assert.match(steps[config].run, /scripts\/delivery\/agent-channel\.mjs "\$CHANNEL"/);
  assert.match(steps[smoke].run, /self-check-line\.mjs self-check\.out "\$CHANNEL"/);
  for (const step of steps.filter((s) => s.if === "inputs.app == 'agent'" || s.id?.startsWith('agent_'))) {
    assert.doesNotMatch(
      JSON.stringify(step),
      /secrets\.|TAURI_SIGNING|SIGNPATH/,
      `${step.name} holds no signing secret`,
    );
  }
});

test('preview and staging installers are workflow artifacts only: never a release, named by channel and SHA', () => {
  const build = workflow('stage-build.yml').jobs.build;
  const upload = stepsOf(build).find((s) => s.name === 'Upload the agent installers');
  assert.equal(upload.with.name, 'agent-${{ inputs.channel }}-${{ inputs.sha }}');
  assert.ok(upload.with['retention-days'] <= 14, 'a test installer expires');
  assert.match(upload.with.path, /bundle\/nsis\/\*\.exe/);
  assert.doesNotMatch(
    JSON.stringify(build),
    /gh release|action-gh-release|releases\/|softprops|create-release/,
  );
  const refuse = stepsOf(build)[0].run;
  assert.match(
    refuse,
    /"\$CHANNEL" != "preview" \] && \[ "\$CHANNEL" != "staging"/,
    'production is refused here',
  );
  assert.match(refuse, /release-please/);
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
