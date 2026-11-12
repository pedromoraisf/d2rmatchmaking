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
  assert.ok(wf.jobs.down.if.includes("contains(github.event.pull_request.labels.*.name, 'render-preview')"));
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

test('SITE_ORIGIN is set between DATABASE_URL and the ready marker', () => {
  const step = stepsOf(wf.jobs.up).find((s) => s.run?.includes('put D2RMM_PREVIEW_DATABASE ready'));
  const order = ['put DATABASE_URL', 'put SITE_ORIGIN', 'put D2RMM_PREVIEW_DATABASE'].map((x) =>
    step.run.indexOf(x),
  );
  assert.ok(order[0] >= 0 && order[0] < order[1] && order[1] < order[2], String(order));
  const siteStep = stepsOf(wf.jobs.up).find((s) => s.run?.includes('preview.mjs site-origin'));
  assert.ok(siteStep, 'the site origin is computed in its own step');
  assert.equal(siteStep.env?.RENDER_API_KEY, undefined, 'pull request code runs without the Render key');
});

test('preview-api and deploy-web bake the upstream with the same script, and deploy-web only reads pull requests', () => {
  const bakeOf = (job) => stepsOf(job).find((s) => s.run?.includes('scripts/preview/preview.mjs bake'));
  assert.ok(bakeOf(wf.jobs.site));
  assert.equal(wf.jobs.site.permissions['pull-requests'], 'read');
  const web = parse(readFileSync(path.join(root, '.github/workflows/deploy-web.yml'), 'utf8'));
  const bake = bakeOf(web.jobs.deploy);
  assert.ok(bake);
  assert.equal(bake.run, bakeOf(wf.jobs.site).run);
  assert.deepEqual(web.jobs.deploy.permissions, { contents: 'read', 'pull-requests': 'read' });
  assert.ok(!JSON.stringify(bake).includes('secrets.'), 'the bake step holds no secret');
});

test('the Render key is on the Render steps only, never job-wide or next to pull request code', () => {
  assert.equal(wf.jobs.up.env.RENDER_API_KEY, undefined);
  for (const step of stepsOf(wf.jobs.up)) {
    const holds = step.env?.RENDER_API_KEY !== undefined;
    assert.equal(holds, step.run?.includes('api.render.com') ?? false, step.name);
    if (step.run?.includes('pnpm') || step.run?.includes('preview.mjs site-origin'))
      assert.equal(holds, false, step.name);
  }
  const wait = stepsOf(wf.jobs.up).find((s) => s.id === 'service');
  assert.ok(wait.run.includes('env -u RENDER_API_KEY node scripts/preview/preview.mjs find'));
});

test('a failed Neon delete warns by name', () => {
  const steps = stepsOf(wf.jobs.down);
  assert.equal(steps[0].id, 'delete');
  assert.ok(
    steps[1].if.includes("steps.delete.outcome == 'failure'") && steps[1].run.includes('::warning::'),
  );
});

test('render.yaml turns previews on manually for the API only', () => {
  const blueprint = parse(readFileSync(path.join(root, 'render.yaml'), 'utf8'));
  assert.deepEqual(blueprint.services[0].previews, { generation: 'manual' });
  assert.equal(blueprint.services[0].name, 'd2rmm-api');
});
