// Static checks of the agent release workflows (AGS-28, AGS-29, AGS-33). The workflows run only after a release or a
// maintainer's tag and with secrets, so their shape is checked here; their first runs are the phase review's proof
// (C43). release-please.yml chains into release-agent.yml by workflow_call.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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
  assert.equal(tauriAction(job).with.tauriScript, 'pnpm exec tauri', 'tauri-action runs the workspace CLI');

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

// The startup self-check: a binary that cannot start is never published. The release is a draft until the check has passed,
// and the build job never makes it public: the `publish` job does, after `sign` (AGR-01, AGR-02).
test('the release binary is started with --self-check --online before anything is published', () => {
  const job = buildJob();
  const build = indexOfStep(job, (step) => step === tauriAction(job));
  const check = indexOfStep(
    job,
    (step) => typeof step.run === 'string' && step.run.includes('d2rmm-agent.exe --self-check --online'),
  );
  const upload = indexOfStep(job, (step) => step.run?.includes('gh release upload'));
  assert.ok(check > build, 'the check runs after the build');
  assert.ok(check < upload, 'the check runs before any asset is uploaded');
  assert.equal(
    indexOfStep(job, (step) => step.run?.includes('--draft=false')),
    -1,
    'the build job never makes the release public',
  );
  assert.equal(stepsOf(job)[check]['continue-on-error'], undefined, 'the check can fail the job');
  assert.equal(tauriAction(job).with.releaseDraft, true, 'tauri-action leaves the release a draft');
  assert.ok(stepsOf(job)[check].run.includes('-ne 0'), 'a non-zero exit fails the step');
  assert.ok(
    releaseAgent().jobs.publish.needs.includes('build'),
    'the publication needs the build, so it comes after the check',
  );
});

// The tag-on-main check (AGS-28): the tag's commit must be an ancestor of origin/main. The reversed test is refused.
const TAG_ON_MAIN_LINE = 'if ! git merge-base --is-ancestor HEAD origin/main; then';
const tagOnMainHolds = (run) =>
  run
    .split('\n')
    .map((line) => line.trim())
    .includes(TAG_ON_MAIN_LINE);

// The fixture-read guard (AGS-33): the release build greps the exact feature and exits 1 on a match.
const FIXTURE_GUARD_LINE = `if grep -q 'fixture-read' <<< "$tree"; then`;
const fixtureGuardHolds = (run) => {
  const lines = run.split('\n').map((line) => line.trim());
  const at = lines.indexOf(FIXTURE_GUARD_LINE);
  return at >= 0 && lines[at + 2] === 'exit 1';
};

test('the tag must be an ancestor of origin/main', () => {
  const step = findStep(buildJob(), (candidate) => candidate.name === 'Assert the tag is on main');
  assert.ok(step, 'the tag-on-main step exists');
  assert.ok(tagOnMainHolds(step.run), 'the exact ancestor check runs: tag commit first, origin/main second');
  assert.ok(
    !tagOnMainHolds(step.run.replace('HEAD origin/main', 'origin/main HEAD')),
    'a reversed ancestor check is refused',
  );
});

test('the fixture-read guard greps the exact feature and exits 1 on a match', () => {
  const guard = findStep(
    buildJob(),
    (step) => typeof step.run === 'string' && step.run.includes('fixture-read'),
  );
  assert.ok(guard, 'the fixture-read guard exists');
  assert.ok(fixtureGuardHolds(guard.run), 'the guard greps fixture-read and exits 1 on a match');
  assert.ok(
    !fixtureGuardHolds(guard.run.replace("grep -q 'fixture-read'", "grep -q 'fixture-reed'")),
    'a misspelled feature in the guard is refused',
  );
  assert.ok(
    !fixtureGuardHolds(guard.run.replace('exit 1\nfi', 'exit 0\nfi')),
    'a guard that does not fail the build is refused',
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
  assert.ok(publish.run.includes('--clobber'), 'a re-run of the tag replaces the assets of the draft');
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
    "needs.build.outputs.signing == 'true'",
    'the switch is read once, in build, and the output gates the job; secrets cannot gate it',
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
    "steps.signing.outputs.enabled == 'true'",
    'the unsigned installer is kept only for signing',
  );

  const text = readText(`.github/workflows/${RELEASE_AGENT}`);
  assert.ok(
    text.includes('scripts/agent/latest-json.mjs'),
    'the signature is rewritten by the tested helper',
  );
});

// Every --clobber replaces assets of a release, so it is only ever done on a draft: the job first refuses a public release
// (AGR-02, AGR-06). `build` clobbers on a re-run of the tag, `sign` replaces the unsigned assets; `publish` never clobbers.
const GUARD_NAME = 'Refuse a release that is already public';
const isGuard = (step) =>
  typeof step.run === 'string' && step.run.includes('gh release view') && step.run.includes('isDraft');

test('every --clobber is preceded in its job by the guard that refuses a public release', () => {
  const wf = releaseAgent();
  for (const [name, job] of Object.entries(wf.jobs)) {
    const steps = stepsOf(job);
    steps.forEach((step, index) => {
      if (typeof step.run !== 'string' || !step.run.includes('--clobber')) return;
      assert.ok(steps.slice(0, index).some(isGuard), `${name}: a --clobber has no isDraft guard before it`);
    });
  }
  assert.ok(JSON.stringify(wf.jobs.publish).includes('--clobber') === false, 'publish never clobbers');
  for (const job of ['build', 'sign']) {
    assert.ok(JSON.stringify(wf.jobs[job]).includes('--clobber'), `${job} clobbers, so it is guarded`);
  }
});

test('build refuses a public release before tauri-action touches it', () => {
  const job = buildJob();
  const guard = indexOfStep(job, isGuard);
  assert.ok(guard >= 0 && guard < indexOfStep(job, (step) => step === tauriAction(job)));
  assert.equal(stepsOf(job)[guard].name, GUARD_NAME);
  assert.ok(guard < indexOfStep(job, (step) => step.run?.includes('gh release upload')));
});

// The guard's own behaviour, run with a stand-in `gh`: no release yet (a maintainer's tag), a draft (a re-run) and a public
// release (refused).
test('the guard lets a new tag and a draft through, and refuses a public release or any other error', async () => {
  const { mkdtempSync, writeFileSync, chmodSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const guard = (job) => stepsOf(job).find(isGuard).run;
  const bin = mkdtempSync(path.join(tmpdir(), 'fake-gh-'));
  const run = (script, answer) => {
    const fake = path.join(bin, 'gh');
    writeFileSync(fake, answer);
    chmodSync(fake, 0o755);
    return spawnSync('bash', ['-e', '-c', script], {
      env: { PATH: `${bin}:${process.env.PATH}`, TAG: 'agent-v0.4.0' },
      encoding: 'utf8',
    });
  };
  for (const job of [releaseAgent().jobs.build, releaseAgent().jobs.sign]) {
    const script = guard(job);
    const draft = run(script, '#!/bin/sh\necho true\n');
    assert.equal(draft.status, 0, `a draft is let through: ${draft.stderr}`);
    const missing = run(script, '#!/bin/sh\necho "release not found" >&2\nexit 1\n');
    assert.equal(missing.status, 0, 'an explicit "release not found": the first build creates the draft');
    // Any other error is not "no release yet": the guard fails closed (an auth error, a rate limit, a network error).
    for (const error of [
      'HTTP 401: Bad credentials (https://api.github.com/graphql)',
      'HTTP 403: API rate limit exceeded',
      'error connecting to api.github.com',
    ]) {
      const failed = run(script, `#!/bin/sh\necho "${error}" >&2\nexit 1\n`);
      assert.equal(failed.status, 1, `${error} fails the guard`);
      assert.match(failed.stdout + failed.stderr, /could not read the release/);
    }
    const published = run(script, '#!/bin/sh\necho false\n');
    assert.equal(published.status, 1, 'a public release is refused');
    assert.match(published.stdout, /::error::agent-v0\.4\.0 is already public/);
  }
});

// First real release (agent-v0.3.0): release-please published the release at once, with no assets, and the online
// self-check hit a sleeping Render free tier. See docs/engineering/lessons.md.
test('release-please creates the agent release as a draft and still creates the tag', () => {
  const config = JSON.parse(readText('release-please-config.json'));
  const agent = config.packages['apps/agent'];
  assert.equal(agent.draft, true, 'the release stays a draft until release-agent.yml publishes it');
  assert.equal(
    agent['force-tag-creation'],
    true,
    'a draft release has no tag unless release-please creates it',
  );
});

test('the release is published and marked latest only after the self-check, by the publish job', () => {
  const wf = releaseAgent();
  const publish = indexOfStep(
    wf.jobs.publish,
    (s) => typeof s.run === 'string' && s.run.includes('gh release edit'),
  );
  assert.ok(publish >= 0, 'the publish job runs gh release edit');
  const run = stepsOf(wf.jobs.publish)[publish].run;
  assert.ok(run.includes('--draft=false'), 'the publish step undrafts the release');
  assert.ok(run.includes('"$latest"'), 'whether it is Latest comes from the publication decision');
  assert.ok(run.includes('scripts/agent/publish-release.mjs'), 'the decision is the tested helper');
  assert.ok(run.includes('skip'), 'a release that is already public is left alone');
  assert.ok(
    indexOfStep(wf.jobs.build, (s) => typeof s.run === 'string' && s.run.includes('--self-check --online')) >=
      0,
    'the self-check runs in the build job, which the publish job needs',
  );
});

test('the API is woken, with retries, before the online self-check', () => {
  const job = buildJob();
  const isRun = (text) => (s) => typeof s.run === 'string' && s.run.includes(text);
  const wake = indexOfStep(job, isRun('/healthz'));
  const selfCheck = indexOfStep(job, isRun('--self-check --online'));
  assert.ok(wake >= 0, 'a step probes /healthz');
  assert.ok(wake < selfCheck, 'the wake comes before the self-check');
  const step = stepsOf(job)[wake];
  assert.equal(step.env.API_BASE, '${{ vars.API_BASE_URL }}', 'same variable the build embeds');
  assert.ok(step.run.includes('curl -fsS'), 'a failing status is a failed probe');
  assert.ok(step.run.includes('until curl'), 'the probe is retried');
  assert.ok(step.run.includes('SECONDS + 90'), 'it waits up to 90 s');
  assert.ok(step.run.includes('sleep "$delay"'), 'with a backoff');
  assert.ok(step.run.includes('exit 1'), 'it fails when the API never wakes');
});

// Publish after sign (AGR-01, AGR-02): the release becomes public once, in its own job, after the signed assets are attached.
const PUBLISH_IF =
  "always() && needs.build.result == 'success' && (needs.sign.result == 'success' || (needs.sign.result == 'skipped' && needs.build.outputs.signing != 'true'))";
const isRun = (text) => (step) => typeof step.run === 'string' && step.run.includes(text);

test('the release is made public by one step, in the publish job, after build and sign', () => {
  const wf = releaseAgent();
  const publish = wf.jobs.publish;
  assert.ok(publish, 'a publish job exists');
  assert.deepEqual(publish.needs, ['build', 'sign']);
  assert.equal(publish.if, PUBLISH_IF, 'it runs with signing on and off, and never after a failed sign');
  assert.equal(publish['runs-on'], 'windows-latest', 'the Authenticode check needs Windows');
  assert.deepEqual(publish.permissions, { contents: 'write' });
  const text = readText(`.github/workflows/${RELEASE_AGENT}`);
  assert.equal(text.match(/--draft=false/g)?.length, 1, 'exactly one step makes a release public');
  assert.equal(text.match(/gh release edit/g)?.length, 1, 'and it is the only release edit');
  assert.equal(
    indexOfStep(wf.jobs.build, isRun('gh release edit')),
    -1,
    'the build job does not edit the release',
  );
  assert.equal(indexOfStep(wf.jobs.sign, isRun('gh release edit')), -1, 'nor does the sign job');
});

test('the draft is checked as a set, and its signature verified, before the release is made public', () => {
  const job = releaseAgent().jobs.publish;
  const download = indexOfStep(job, isRun('gh release download'));
  const assets = indexOfStep(job, isRun('scripts/agent/release-assets.mjs'));
  const verify = indexOfStep(job, (step) => JSON.stringify(step).includes('Get-AuthenticodeSignature'));
  const publish = indexOfStep(job, isRun('--draft=false'));
  assert.ok(download >= 0 && download < assets, 'the draft assets are downloaded, then checked');
  assert.ok(assets < publish, 'the asset check comes before the publication');
  assert.ok(verify >= 0 && verify < publish, 'the signature check comes before the publication');
  const verifyStep = stepsOf(job)[verify];
  assert.equal(
    verifyStep.if,
    "needs.build.outputs.signing == 'true'",
    'only a signed flow verifies a signature',
  );
  assert.ok(
    JSON.stringify(verifyStep).includes('scripts/agent/signature-verdict.mjs'),
    'the verdict is the tested helper',
  );
  assert.ok(
    JSON.stringify(verifyStep).includes('vars.SIGNPATH_PUBLISHER'),
    'the expected publisher is a variable',
  );
  assert.equal(stepsOf(job)[assets]['continue-on-error'], undefined, 'the asset check can fail the job');
});

test('the signing key and the SignPath token are read only by build and sign', () => {
  for (const [name, job] of Object.entries(releaseAgent().jobs)) {
    const secrets = JSON.stringify(job).match(/secrets\.[A-Z_]+/g) ?? [];
    assert.equal(
      secrets.length > 0,
      name === 'build' || name === 'sign',
      `${name} ${secrets.length > 0 ? 'reads secrets' : 'reads none'}`,
    );
  }
  for (const [name, job] of Object.entries(releaseAgent().jobs)) {
    const installs = stepsOf(job).filter((step) => step.run?.includes('pnpm install'));
    for (const step of installs)
      assert.ok(step.run.includes('--ignore-scripts'), `${name} installs without scripts`);
  }
});

test('sign submits the artifact id that build produced', () => {
  const wf = releaseAgent();
  assert.equal(wf.jobs.build.outputs['unsigned-artifact-id'], '${{ steps.unsigned.outputs.artifact-id }}');
  const submit = findStep(wf.jobs.sign, (step) =>
    step.uses?.startsWith('signpath/github-action-submit-signing-request@'),
  );
  assert.equal(submit.with['github-artifact-id'], '${{ needs.build.outputs.unsigned-artifact-id }}');
  const upload = findStep(wf.jobs.build, (step) => step.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(upload.with['retention-days'], 1, 'the unsigned installer lives one day');
});

// One channel releases (AGR-05, ADR 033 §8): only release-agent.yml and release-please.yml touch a release.
test('no workflow but the two release workflows creates, edits or uploads to a release', () => {
  const dir = path.join(root, '.github', 'workflows');
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.yml'))) {
    if (name === RELEASE_AGENT || name === 'release-please.yml') continue;
    const text = readText(`.github/workflows/${name}`);
    for (const forbidden of [
      'gh release',
      'tauri-apps/tauri-action',
      'softprops/action-gh-release',
      'release-please-action',
    ]) {
      assert.ok(!text.includes(forbidden), `${name} must not use ${forbidden}`);
    }
  }
});

test('the release build is the production channel and uses no channel override', () => {
  const text = readText(`.github/workflows/${RELEASE_AGENT}`);
  for (const forbidden of ['agent-channel.mjs', 'D2RMM_CHANNEL', 'TAURI_CHANNEL_CONFIG']) {
    assert.ok(!text.includes(forbidden), `release-agent.yml must not use ${forbidden}`);
  }
  const conf = JSON.parse(readText('apps/agent/src-tauri/tauri.conf.json'));
  const channels = JSON.parse(readText('apps/agent/src-tauri/channels.json'));
  assert.equal(
    conf.identifier,
    channels.production.identifier,
    'the default build is the production identifier',
  );
  assert.equal(conf.productName, channels.production.productName);
  assert.equal(channels.production.updater, true, 'the updater is on in production');
  assert.equal(conf.bundle.createUpdaterArtifacts, true);
  assert.ok(
    conf.plugins.updater.endpoints.some((url) => url.endsWith('/releases/latest/download/latest.json')),
  );
  for (const channel of ['preview', 'staging']) {
    assert.equal(channels[channel].updater, false, `${channel} has the updater off`);
  }
});

// The runbook names what the workflow reads (AGR-11): a variable or secret the maintainer must create is never a surprise.
test('docs/engineering/releases.md names every variable and secret release-agent.yml reads', () => {
  const workflowText = readText(`.github/workflows/${RELEASE_AGENT}`);
  const runbook = readText('docs/engineering/releases.md');
  const read = [
    ...[...workflowText.matchAll(/\bvars\.([A-Z_]+)/g)].map((match) => match[1]),
    ...[...workflowText.matchAll(/\bsecrets\.([A-Z_]+)/g)].map((match) => match[1]),
  ];
  assert.ok(
    read.includes('SIGNPATH_PUBLISHER') && read.includes('API_BASE_URL'),
    'the pattern finds the names',
  );
  for (const name of new Set(read)) {
    assert.ok(runbook.includes(`\`${name}\``), `releases.md must name ${name}`);
  }
});

// AGR-01, AGR-10: whether the release is signed is decided once. Flipping the variable between the jobs of a run cannot skip
// the signature check of a release that was built for signing.
test('SIGNPATH_ENABLED is read once, in build, and the other jobs use its output', () => {
  const wf = releaseAgent();
  const text = readText(`.github/workflows/${RELEASE_AGENT}`);
  assert.equal(text.match(/vars\.SIGNPATH_ENABLED/g)?.length, 1, 'the variable is named in one place');
  const step = findStep(wf.jobs.build, (candidate) => candidate.id === 'signing');
  assert.equal(step.env.SIGNPATH_ENABLED, '${{ vars.SIGNPATH_ENABLED }}');
  assert.equal(wf.jobs.build.outputs.signing, '${{ steps.signing.outputs.enabled }}');
  assert.match(step.run, /= true \]; then/, 'only the exact word true turns signing on');
  assert.equal(
    wf.jobs.publish.if,
    PUBLISH_IF,
    'publish needs a successful sign whenever the build was made for signing',
  );
});

test('publish checks the assets of this repository with the updater key of the tag, and says why ls-remote works', () => {
  const job = releaseAgent().jobs.publish;
  const check = findStep(job, isRun('scripts/agent/release-assets.mjs'));
  assert.ok(
    check.run.includes('--repo "$GITHUB_REPOSITORY"'),
    'the download URL is checked against this repository',
  );
  assert.ok(
    check.run.includes('--tauri-conf apps/agent/src-tauri/tauri.conf.json'),
    'the key is the one the tag ships',
  );
  const text = readText(`.github/workflows/${RELEASE_AGENT}`);
  assert.match(
    text,
    /ls-remote[^\n]*\n?[^\n]*public|public[^\n]*\n?[^\n]*ls-remote/i,
    'a comment explains the credential-less ls-remote',
  );
});

test('no comment claims --clobber lives in one job only', () => {
  assert.doesNotMatch(readText(`.github/workflows/${RELEASE_AGENT}`), /the only --clobber in/);
});
