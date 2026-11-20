// Static checks of keep-awake.yml (ADR 033, DLP-07, DLP-10): a schedule that pings only inside the window, with no secret.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parse } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const text = readFileSync(path.join(root, '.github/workflows/keep-awake.yml'), 'utf8');
const wf = parse(text);
const job = wf.jobs['keep-awake'];

test('it runs on a schedule every ten minutes, and by hand', () => {
  assert.deepEqual(wf.on.schedule, [{ cron: '*/10 * * * *' }]);
  assert.ok(wf.on.workflow_dispatch !== undefined);
  assert.equal(wf.on.push, undefined);
  assert.equal(wf.on.pull_request, undefined);
});

test('it is read-only, holds no secret, and every action is pinned by a full SHA', () => {
  assert.deepEqual(wf.permissions, { contents: 'read' });
  assert.doesNotMatch(text, /secrets\./);
  assert.ok(Number.isInteger(job['timeout-minutes']));
  for (const step of job.steps.filter((s) => s.uses)) {
    assert.match(step.uses, /^[^@\s]+@[0-9a-f]{40}$/, step.uses);
  }
  for (const step of job.steps.filter((s) => s.run)) {
    assert.doesNotMatch(step.run, /\$\{\{/, 'no expression inside run');
  }
});

test('the window is asked before the ping, and the ping runs only when inside', () => {
  const ask = job.steps.findIndex((s) => s.run?.includes('scripts/delivery/awake-window.mjs'));
  const ping = job.steps.findIndex((s) => s.run?.includes('/healthz'));
  assert.ok(ask >= 0 && ping > ask);
  assert.equal(job.steps[ask].id, 'window');
  assert.equal(job.steps[ping].if, "steps.window.outputs.inside == 'true'");
  assert.equal(job.steps[ask].env.KEEP_AWAKE_WINDOW, '${{ vars.KEEP_AWAKE_WINDOW }}');
});

test('the ping is one long request, not a loop, so it cannot hammer the host', () => {
  const ping = job.steps.find((s) => s.run?.includes('/healthz')).run;
  assert.match(ping, /curl -fsS --max-time 90/);
  assert.doesNotMatch(ping, /\b(while|until|for)\b/);
  assert.equal(wf.concurrency['cancel-in-progress'], false);
});
