// The workflow that publishes the dashboards to Grafana Cloud: its triggers, its least privilege, pinned actions and the
// secrets it reads (and only those). It never reads a secret itself: the script gets them through the environment.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parse } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const text = readFileSync(path.join(root, '.github', 'workflows', 'publish-dashboards.yml'), 'utf8');
const workflow = parse(text);
const SHA = /@[0-9a-f]{40}$/u;

test('it runs on a push to main that touches the dashboards, and on demand', () => {
  assert.deepEqual(workflow.on.push.branches, ['main']);
  assert.ok(workflow.on.push.paths.includes('infra/observability/dashboards/**'));
  assert.ok('workflow_dispatch' in workflow.on);
  assert.equal('pull_request' in workflow.on, false, 'a pull request never reaches the secrets');
});

test('permissions are read-only for the contents and nothing else', () => {
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  for (const job of Object.values(workflow.jobs)) assert.equal(job.permissions, undefined);
});

test('every action is pinned by its full commit SHA', () => {
  const uses = Object.values(workflow.jobs).flatMap((job) => job.steps.flatMap((step) => step.uses ?? []));
  assert.ok(uses.length >= 2);
  for (const use of uses) assert.match(use, SHA, `${use} is pinned`);
});

test('the publish step gets exactly the two secrets through the environment', () => {
  const step = workflow.jobs.publish.steps.find((item) =>
    String(item.run).includes('publish-dashboards.mjs'),
  );
  assert.equal(step.run, 'node scripts/obs/publish-dashboards.mjs');
  assert.deepEqual(step.env, {
    GRAFANA_URL: '${{ secrets.GRAFANA_URL }}',
    GRAFANA_SA_TOKEN: '${{ secrets.GRAFANA_SA_TOKEN }}',
  });
  assert.equal(
    [...text.matchAll(/secrets\.([A-Z_]+)/gu)].every((match) => match[1].startsWith('GRAFANA_')),
    true,
  );
  assert.equal(workflow.jobs.publish.steps[0].with['persist-credentials'], false);
});
