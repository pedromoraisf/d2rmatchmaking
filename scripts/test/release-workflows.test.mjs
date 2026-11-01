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
