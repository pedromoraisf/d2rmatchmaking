// Static checks of staging-bots.yml (staging-bots SBT-01, SBT-02, SBT-08, SBT-12): a manual run in the staging environment,
// read-only, with no secret, one at a time, bounded, and with the target taken from the environment and never from an input.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parse } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const text = readFileSync(path.join(root, '.github/workflows/staging-bots.yml'), 'utf8');
const wf = parse(text);
const job = wf.jobs.bots;

test('SBT-01 it runs only by hand, with the inputs of the spec', () => {
  assert.deepEqual(Object.keys(wf.on), ['workflow_dispatch']);
  const inputs = Object.keys(wf.on.workflow_dispatch.inputs);
  for (const name of [
    'mode',
    'difficulty',
    'region',
    'ladder',
    'era',
    'activity',
    'role',
    'bots',
    'minutes',
    'human_first',
    'host_policy',
  ]) {
    assert.ok(inputs.includes(name), `input ${name}`);
  }
  assert.equal(wf.on.workflow_dispatch.inputs.human_first.default, true);
  assert.equal(wf.on.workflow_dispatch.inputs.host_policy.default, 'bot-reports');
  assert.ok(!wf.on.workflow_dispatch.inputs.role.options.includes('teleporter'));
});

test('SBT-02 the target is the staging environment variable, never an input', () => {
  assert.equal(job.environment, 'staging');
  assert.ok(!Object.keys(wf.on.workflow_dispatch.inputs).some((name) => /url|origin|target|api/i.test(name)));
  const run = job.steps.find((step) => step.run?.includes('scripts/staging/bots.mjs'));
  assert.equal(run.env.STAGING_API_URL, '${{ vars.STAGING_API_URL }}');
  assert.equal(run.env.SITE_ORIGIN, '${{ vars.SITE_ORIGIN }}');
});

test('SBT-12 it is read-only, holds no secret, and every action is pinned by a full SHA', () => {
  assert.deepEqual(wf.permissions, { contents: 'read' });
  assert.doesNotMatch(text, /secrets\./);
  assert.doesNotMatch(text, /BNET_|DATABASE_URL|RENDER_|CLOUDFLARE_/);
  for (const step of job.steps.filter((s) => s.uses)) {
    assert.match(step.uses, /^[^@\s]+@[0-9a-f]{40}$/, step.uses);
  }
  for (const step of job.steps.filter((s) => s.run)) {
    assert.doesNotMatch(step.run, /\$\{\{/, 'no expression inside run');
  }
});

test('SBT-08 one run at a time that is never cut, and a timeout above the longest stay', () => {
  assert.equal(wf.concurrency.group, 'staging-bots');
  assert.equal(wf.concurrency['cancel-in-progress'], false);
  assert.ok(job['timeout-minutes'] > 60 && job['timeout-minutes'] <= 90);
});
