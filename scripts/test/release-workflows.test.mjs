// Static checks of the agent release workflows (AGS-28, AGS-29, AGS-33). The workflows run only after a release or a
// maintainer's tag and with secrets, so their shape is checked here; their first runs are the phase review's proof
// (C43). release-please.yml chains into release-agent.yml by workflow_call.
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
const usesOf = (wf) =>
  Object.values(wf.jobs).flatMap((job) =>
    stepsOf(job)
      .filter((step) => step.uses)
      .map((step) => step.uses),
  );

test('release-please calls release-agent only when the agent was released', () => {
  const wf = workflow('release-please.yml');
  const releasePlease = wf.jobs['release-please'];
  const call = wf.jobs['release-agent'];

  assert.deepEqual(wf.permissions, { contents: 'read' }, 'the top level grants read only');
  assert.deepEqual(releasePlease.permissions, {
    contents: 'write',
    'pull-requests': 'write',
    actions: 'write',
  });
  assert.equal(call.needs, 'release-please');
  assert.equal(call.if, "needs.release-please.outputs.agent_release_created == 'true'");
  assert.deepEqual(call.permissions, { contents: 'write' }, 'the calling job holds its own write permission');
  assert.equal(call.uses, './.github/workflows/release-agent.yml');
  assert.equal(call.with.tag, '${{ needs.release-please.outputs.agent_tag }}');
  assert.equal(call.secrets, 'inherit');
});

test('release-please runs on main pushes and starts CI on the release PR branch', () => {
  const wf = workflow('release-please.yml');
  assert.deepEqual(wf.on, { push: { branches: ['main'] } });

  const job = wf.jobs['release-please'];
  const release = stepsOf(job).find((step) => step.id === 'release');
  assert.ok(release?.uses.startsWith('googleapis/release-please-action@'));
  const dispatch = stepsOf(job).find(
    (step) => typeof step.run === 'string' && step.run.includes('gh workflow run ci.yml'),
  );
  assert.ok(dispatch, 'a step dispatches ci.yml');
  assert.equal(dispatch.if, "steps.release.outputs.prs_created == 'true'");
  assert.ok(dispatch.run.includes('--ref "$branch"'), 'the dispatch targets the PR head branch');
});

test('ci.yml can be dispatched by hand and by release-please', () => {
  const ci = parse(readText('.github/workflows/ci.yml'));
  assert.ok('workflow_dispatch' in ci.on, 'ci.yml declares workflow_dispatch');
  assert.ok('pull_request' in ci.on, 'the pull_request trigger stays');
});

test('every uses in release-please.yml is pinned by a 40-char SHA', () => {
  const wf = workflow('release-please.yml');
  const external = usesOf(wf).filter((uses) => !uses.startsWith('./'));
  assert.ok(external.length > 0, 'the workflow has external actions to pin');
  for (const uses of external) {
    assert.match(uses, SHA_PINNED, `${uses} must be pinned by SHA`);
  }
});

test('the agent is the only released package', () => {
  const config = JSON.parse(readText('release-please-config.json'));
  const manifest = JSON.parse(readText('.release-please-manifest.json'));
  assert.deepEqual(Object.keys(config.packages), ['apps/agent']);
  assert.deepEqual(Object.keys(manifest), ['apps/agent']);
  assert.equal(config.packages['apps/agent'].component, 'agent');
});

// release-agent.yml (AGS-28, AGS-33): the build job of the agent release.
const RELEASE_AGENT = 'release-agent.yml';
const releaseAgent = () => workflow(RELEASE_AGENT);
const buildJob = () => releaseAgent().jobs.build;
const findStep = (job, predicate) => stepsOf(job).find(predicate);
const indexOfStep = (job, predicate) => stepsOf(job).findIndex(predicate);
const tauriAction = (job) => findStep(job, (step) => step.uses?.startsWith('tauri-apps/tauri-action@'));

test('release-agent builds on tag push, call and dispatch', () => {
  const wf = releaseAgent();
  assert.deepEqual(Object.keys(wf.on).sort(), ['push', 'workflow_call', 'workflow_dispatch']);
  assert.deepEqual(wf.on.push, { tags: ['agent-v*'] });
  assert.equal(wf.on.workflow_call.inputs.tag.type, 'string');
  assert.equal(wf.on.workflow_call.inputs.tag.required, true);
  assert.equal(wf.on.workflow_dispatch.inputs.tag.required, false);
  assert.deepEqual(wf.permissions, { contents: 'read' });

  const job = buildJob();
  assert.equal(job['runs-on'], 'windows-latest');
  assert.equal(job.environment, 'release');
  assert.deepEqual(job.permissions, { contents: 'write' });
});

test('the tag is validated before use', () => {
  const job = buildJob();
  const resolve = stepsOf(job)[0];
  assert.equal(resolve.id, 'tag', 'the tag is resolved in the first step');
  assert.ok(
    resolve.run.includes("grep -Eq '^agent-v[0-9]+"),
    'the resolved tag is matched against agent-v<semver>',
  );
  assert.equal(resolve.env.INPUT_TAG, '${{ inputs.tag || github.ref_name }}');

  const checkout = findStep(job, (step) => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, '${{ steps.tag.outputs.tag }}', 'checkout uses the validated tag');
  assert.ok(indexOfStep(job, (step) => step === checkout) > 0, 'checkout follows the validation');
  assert.equal(
    tauriAction(job).with.tagName,
    '${{ steps.tag.outputs.tag }}',
    'tauri-action uses the validated tag',
  );

  for (const step of stepsOf(job)) {
    if (typeof step.run === 'string') {
      assert.ok(
        !step.run.includes('${{'),
        `no expression is interpolated into a shell in "${step.name ?? step.id}"`,
      );
    }
  }
});

test('fixture-read cannot reach a release build', () => {
  const text = readText(`.github/workflows/${RELEASE_AGENT}`);
  assert.ok(!text.includes('--features'), 'no step passes --features');
  const job = buildJob();
  const tauri = tauriAction(job);
  assert.ok(!JSON.stringify(tauri.with).includes('feature'), 'tauri-action gets no feature selection');

  const guard = indexOfStep(job, (step) => typeof step.run === 'string' && step.run.includes('fixture-read'));
  const build = indexOfStep(job, (step) => step === tauri);
  assert.ok(guard >= 0 && guard < build, 'the fixture-read check runs before the build');

  const smoke = indexOfStep(
    job,
    (step) => typeof step.run === 'string' && step.run.includes('--read-fixture x'),
  );
  assert.ok(smoke > build, 'the smoke check runs after the build');
  assert.ok(
    findStep(job, (step) => step.run?.includes('-ne 2')),
    'the smoke check expects exit code 2',
  );
});

test('the installer is published as D2RMatchMaking-setup.exe with SHA256SUMS', () => {
  const job = buildJob();
  const publish = findStep(
    job,
    (step) => typeof step.run === 'string' && step.run.includes('gh release upload'),
  );
  assert.ok(publish, 'a step uploads to the release');
  assert.ok(publish.run.includes('cp "$installer" D2RMatchMaking-setup.exe'), 'the fixed name is a copy');
  assert.ok(publish.run.includes('sha256sum'), 'SHA256SUMS is written');
  assert.ok(
    publish.run.includes('D2RMatchMaking-setup.exe SHA256SUMS'),
    'the installer and SHA256SUMS are uploaded',
  );
  assert.ok(!JSON.stringify(job).includes('--clobber'), 'the build job never clobbers');
});

test('secrets live only in the release environment', () => {
  const wf = releaseAgent();
  for (const [name, job] of Object.entries(wf.jobs)) {
    if (JSON.stringify(job).includes('secrets.')) {
      assert.equal(job.environment, 'release', `${name} reads secrets only inside the release environment`);
    }
  }
  const named = new Set(
    [...readText(`.github/workflows/${RELEASE_AGENT}`).matchAll(/secrets\.([A-Z_]+)/g)].map(
      (match) => match[1],
    ),
  );
  for (const secret of named) {
    assert.ok(
      ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD', 'SIGNPATH_API_TOKEN'].includes(
        secret,
      ),
      `${secret} is not an agent release secret`,
    );
  }
});

test('every third-party action of release-agent.yml is pinned by a 40-char SHA', () => {
  const wf = releaseAgent();
  const external = Object.values(wf.jobs)
    .flatMap((job) =>
      stepsOf(job)
        .filter((step) => step.uses)
        .map((step) => step.uses),
    )
    .filter((uses) => !uses.startsWith('./'));
  assert.ok(external.length >= 5, 'the build job uses checkout, pnpm, node, rust and tauri-action');
  for (const uses of external) {
    assert.match(uses, SHA_PINNED, `${uses} must be pinned by SHA`);
  }
});

test('SignPath signing runs only when enabled', () => {
  const wf = releaseAgent();
  const sign = wf.jobs.sign;
  assert.equal(
    sign.if,
    "vars.SIGNPATH_ENABLED == 'true'",
    'the variable gates the job; secrets cannot gate it',
  );
  assert.equal(sign.needs, 'build');
  assert.equal(sign.environment, 'release');
  assert.deepEqual(sign.permissions, { contents: 'write' });

  const submit = findStep(sign, (step) =>
    step.uses?.startsWith('signpath/github-action-submit-signing-request@'),
  );
  assert.ok(submit, 'the official SignPath action submits the installer');
  assert.equal(submit.with['api-token'], '${{ secrets.SIGNPATH_API_TOKEN }}');

  const upload = findStep(buildJob(), (step) => step.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(
    upload.if,
    "vars.SIGNPATH_ENABLED == 'true'",
    'the unsigned installer is kept only for signing',
  );

  const text = readText(`.github/workflows/${RELEASE_AGENT}`);
  assert.ok(
    text.includes('scripts/agent/latest-json.mjs'),
    'the signature is rewritten by the tested helper',
  );
});

test('--clobber is allowed only in the sign job', () => {
  const wf = releaseAgent();
  for (const [name, job] of Object.entries(wf.jobs)) {
    const clobbers = JSON.stringify(job).includes('--clobber');
    assert.equal(clobbers, name === 'sign', `${name} ${clobbers ? 'clobbers assets' : 'does not clobber'}`);
  }
});
