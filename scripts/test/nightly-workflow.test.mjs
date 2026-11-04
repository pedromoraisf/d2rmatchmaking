// CRF-12 to CRF-17 and CRF-25 (ci-and-review-fixes): the nightly ratchet waits for the agent's mutation job and receives
// its report. The agent job creates its report directory before cargo-mutants runs, and uploads what it has even when a
// command fails, so a missed mutant's score still reaches the ratchet (AD-130). The download action is pinned by full SHA.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parse } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflow = parse(readFileSync(path.join(root, '.github', 'workflows', 'nightly.yml'), 'utf8'));
const quality = workflow.jobs.quality;
const agent = workflow.jobs['agent-mutation'];
const SHA = /@[0-9a-f]{40}(?:\s|$)/u;
const DOWNLOAD = 'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093';

const downloadStep = () =>
  quality.steps.find((step) => step.name === "Download the agent's mutation reports");
const ratchetIndex = () => quality.steps.findIndex((step) => step.name === 'Quality ratchet (nightly)');

// CRF-12: the ratchet starts only once the agent's mutation job has finished.
test('quality waits for the agent mutation job', () => {
  assert.deepEqual([quality.needs].flat(), ['agent-mutation']);
});

// CRF-13: a failed or skipped agent job does not stop the ratchet, unless the workflow was cancelled.
test('quality runs unless cancelled', () => {
  assert.equal(quality.if, '${{ !cancelled() }}');
});

// CRF-14: the agent's artifact lands in reports/mutation, where the ratchet reads it, before the ratchet runs.
test('the agent reports are downloaded before the ratchet', () => {
  const download = downloadStep();
  assert.ok(download, "a step downloads the agent's mutation reports");
  assert.ok(
    String(download.uses).startsWith('actions/download-artifact@'),
    'the step uses the artifact download action',
  );
  assert.deepEqual(download.with, { name: 'agent-mutation', path: 'reports/mutation' });
  assert.ok(quality.steps.indexOf(download) < ratchetIndex(), 'the download comes before the ratchet');
});

// CRF-15: when the agent job was skipped, there is no artifact to download.
test('the download is skipped with the agent job', () => {
  assert.equal(downloadStep().if, "needs.agent-mutation.result != 'skipped'");
});

// CRF-16: the download action is pinned by its full commit SHA.
test('the download action is pinned by its full commit', () => {
  const download = downloadStep();
  assert.equal(download.uses, DOWNLOAD, 'the action is the pinned commit');
  assert.match(download.uses, SHA, 'the pin is a full commit SHA');
});

// CRF-17: a missing artifact does not fail the job, so the ratchet step still runs and gives its own verdict.
test('a failed download does not fail quality', () => {
  assert.equal(downloadStep()['continue-on-error'], true);
});

// CRF-25: the agent job creates reports/mutation with bash, before its first cargo-mutants command.
test('the agent job creates the reports directory first', () => {
  const mkdir = agent.steps.findIndex(
    (step) => step.run === 'mkdir -p reports/mutation' && step.shell === 'bash',
  );
  const firstMutants = agent.steps.findIndex((step) => String(step.run ?? '').includes('cargo mutants'));
  assert.ok(mkdir >= 0, 'a bash step creates reports/mutation');
  assert.ok(firstMutants > mkdir, 'the directory exists before the first cargo mutants');
});

// AD-130: the upload keeps if: always(), so a non-zero cargo-mutants exit (a missed mutant) still uploads the score.
test('the agent job uploads its reports even when a command fails', () => {
  const upload = agent.steps.find((step) => String(step.uses ?? '').startsWith('actions/upload-artifact@'));
  assert.ok(upload, 'the agent job uploads its reports');
  assert.equal(upload.if, 'always()');
  assert.equal(upload.with.path, 'reports/mutation');
});
