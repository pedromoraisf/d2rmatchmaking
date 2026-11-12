// Static checks of preview-api.yml and the render.yaml preview setting (ADR 030). The workflow runs only on a labelled
// pull request with secrets, so its shape is checked here; its first real run is the proof of the Render side.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parse } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const text = readFileSync(path.join(root, '.github/workflows/preview-api.yml'), 'utf8');
const wf = parse(text);
const stepsOf = (job) => job.steps ?? [];

test('runs on labelled, updated, reopened and closed pull requests into main, read-only', () => {
  assert.deepEqual(wf.on.pull_request.types, ['labeled', 'synchronize', 'reopened', 'closed']);
  assert.deepEqual(wf.on.pull_request.branches, ['main']);
  assert.deepEqual(wf.permissions, { contents: 'read' });
  assert.equal(wf.concurrency.group, 'preview-api-${{ github.event.pull_request.number }}');
});

test('every job has a timeout and every action is pinned by commit SHA', () => {
  for (const [name, job] of Object.entries(wf.jobs)) {
    assert.ok(Number.isInteger(job['timeout-minutes']), `${name} has no timeout`);
    for (const step of stepsOf(job).filter((s) => s.uses)) {
      assert.match(step.uses, /^[^@\s]+@[0-9a-f]{40}$/, step.uses);
    }
  }
});

test('up and the site run only for this repository and the render-preview label; down always cleans up', () => {
  for (const name of ['up', 'site-build']) {
    const condition = wf.jobs[name].if;
    assert.ok(condition.includes("github.event.action != 'closed'"));
    assert.ok(condition.includes('github.event.pull_request.head.repo.full_name == github.repository'));
    assert.ok(condition.includes("contains(github.event.pull_request.labels.*.name, 'render-preview')"));
  }
  assert.ok(wf.jobs.down.if.includes("github.event.action == 'closed'"));
  assert.ok(!wf.jobs.down.if.includes('render-preview'));
  assert.deepEqual(wf.jobs.site.needs, ['up', 'site-build']);
});

test('the connection strings are masked before the migration, and the single-variable endpoint is used', () => {
  const steps = stepsOf(wf.jobs.up);
  const mask = steps.findIndex((s) => s.run?.includes('::add-mask::$DB_URL'));
  const migrate = steps.findIndex((s) => s.run?.includes('db:migrate'));
  assert.ok(mask >= 0 && migrate > mask, 'mask before migrate');
  assert.ok(steps.some((s) => s.run?.includes('/env-vars/$1')));
  assert.ok(!/env-vars"/.test(text), 'never PUT the whole variable list');
  assert.ok(!/set -x|echo "?\$(DATABASE_URL|DB_URL)/.test(text));
});

test('render.yaml turns previews on manually for the API only', () => {
  const blueprint = parse(readFileSync(path.join(root, 'render.yaml'), 'utf8'));
  assert.deepEqual(blueprint.services[0].previews, { generation: 'manual' });
  assert.equal(blueprint.services[0].name, 'd2rmm-api');
});
