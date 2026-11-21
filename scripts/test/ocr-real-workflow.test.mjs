// Static checks of the ocr-real workflow: it decrypts the maintainer's real screenshots, so its shape is the safeguard.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parse } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const text = readFileSync(path.join(root, '.github/workflows/ocr-real.yml'), 'utf8');
const wf = parse(text);
const job = wf.jobs['ocr-real'];
const steps = job.steps;
const SHA_PINNED = /^[^@\s]+@[0-9a-f]{40}$/;
const ci = parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
const agentBuild = ci.jobs['agent-build'].steps;

test('it runs on pull requests that touch the agent, read-only, on Windows', () => {
  assert.deepEqual(wf.on.pull_request.paths, [
    'apps/agent/**',
    'scripts/agent/**',
    '.github/workflows/ocr-real.yml',
  ]);
  assert.deepEqual(wf.permissions, { contents: 'read' });
  assert.equal(job['runs-on'], 'windows-latest');
});

test('a fork pull request never runs it (no secret for forks)', () => {
  assert.match(job.if, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
});

test('checkout keeps no credentials', () => {
  const checkout = steps.find((s) => /^actions\/checkout@/.test(s.uses ?? ''));
  assert.equal(checkout.with['persist-credentials'], false);
});

test('the actions are the pins of agent-build', () => {
  const pinned = (list) =>
    list.filter((s) => s.uses && !/^actions\/checkout/.test(s.uses)).map((s) => s.uses);
  const mine = pinned(steps);
  assert.ok(mine.length >= 4);
  for (const use of mine) {
    assert.match(use, SHA_PINNED);
    assert.ok(pinned(agentBuild).includes(use), `${use} is not used by agent-build`);
  }
});

test('it builds the UI then the ocr-check example, locked', () => {
  const runs = steps.filter((s) => typeof s.run === 'string').map((s) => s.run);
  const ui = runs.findIndex((r) => r.includes('pnpm --filter @d2rmm/agent build'));
  const build = runs.findIndex((r) => r.includes('cargo build --locked --release --example ocr-check'));
  assert.ok(ui >= 0 && build > ui);
});

test('the password reaches the extract step only, through an env var, and nothing echoes it', () => {
  assert.equal(
    (text.match(/OCR_PRINTS_PASSWORD/g) ?? []).length,
    3,
    'once in the header comment, once on the extract step of each of the two jobs',
  );
  const withSecret = steps.filter((s) => JSON.stringify(s).includes('secrets.'));
  assert.equal(withSecret.length, 1);
  assert.match(withSecret[0].run, /7z\.exe" e .*-p"\$PW"/);
  assert.equal(withSecret[0].env.PW, '${{ secrets.OCR_PRINTS_PASSWORD }}');
  assert.doesNotMatch(text, /set -x|set -o xtrace|echo .*\$PW|ACTIONS_STEP_DEBUG/);
  assert.doesNotMatch(JSON.stringify(wf.env ?? {}) + JSON.stringify(job.env ?? {}), /secrets\./);
});

test('the extracted folder is never uploaded and is deleted by a final always() step', () => {
  assert.ok(!steps.some((s) => /upload-artifact|actions\/cache|upload-pages/.test(s.uses ?? '')));
  const last = steps.at(-1);
  assert.equal(last.if, 'always()');
  assert.match(last.run, /rm -rf "\$RUNNER_TEMP\/real-prints"/);
});

test('the verdict is the exit code of ocr-check.exe on the extracted folder', () => {
  const read = steps.find((s) => (s.run ?? '').includes('ocr-check.exe'));
  assert.match(read.run, /ocr-check\.exe "\$RUNNER_TEMP\/real-prints"$/);
  assert.doesNotMatch(read.run, /\|\||continue-on-error|\| *tee/);
  assert.notEqual(read['continue-on-error'], true);
});

// The variations job (robustness measure under the quality ratchet), sharded over 8 Windows jobs and merged by the
// required check `ocr-variations`.
const shard = wf.jobs['ocr-variations-shard'];
const variations = wf.jobs['ocr-variations'];
const SHARDS = 8;

test('the variations shards have the same guards as the check', () => {
  assert.equal(shard['runs-on'], 'windows-latest');
  assert.match(shard.if, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.equal(shard['timeout-minutes'], 120);
  const checkout = shard.steps.find((s) => /^actions\/checkout@/.test(s.uses ?? ''));
  assert.equal(checkout.with['persist-credentials'], false);
  for (const step of shard.steps.filter((s) => s.uses)) assert.match(step.uses, SHA_PINNED);
  const withSecret = shard.steps.filter((s) => JSON.stringify(s).includes('secrets.'));
  assert.equal(withSecret.length, 1);
  assert.equal(withSecret[0].env.PW, '${{ secrets.OCR_PRINTS_PASSWORD }}');
  assert.match(withSecret[0].run, /7z\.exe" e .*-p"\$PW"/);
});

test('the prints are split over a matrix of 8 shards that all run and report', () => {
  assert.deepEqual(shard.strategy.matrix.shard, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(shard.strategy.matrix.shard.length, SHARDS);
  assert.equal(shard.strategy['fail-fast'], false);
  const run = shard.steps.find((s) => (s.run ?? '').includes('--variations'));
  assert.match(run.run, new RegExp(`--shard \\$\\{\\{ matrix\\.shard \\}\\}/${SHARDS} `));
});

test('the shards upload only their counts file and delete the extracted folder last', () => {
  const uploads = shard.steps.filter((s) => /upload-artifact/.test(s.uses ?? ''));
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].with.name, 'ocr-variations-shard-${{ matrix.shard }}');
  assert.match(uploads[0].with.path, /ocr-variations\.json$/);
  assert.doesNotMatch(uploads[0].with.path, /real-prints/);
  const last = shard.steps.at(-1);
  assert.equal(last.if, 'always()');
  assert.match(last.run, /rm -rf "\$RUNNER_TEMP\/real-prints"/);
});

test('a shard run is never given the show-reads flag and its failure is not swallowed', () => {
  const run = shard.steps.find((s) => (s.run ?? '').includes('--variations'));
  assert.match(
    run.run,
    /ocr-check\.exe --variations --shard .* --summary .*--json .*"\$RUNNER_TEMP\/real-prints"/,
  );
  assert.doesNotMatch(text, /--show-reads/);
  assert.doesNotMatch(run.run, /continue-on-error/);
  assert.notEqual(run['continue-on-error'], true);
});

test('each print is held to the 20-minute budget, after the run and before the upload', () => {
  const steps = shard.steps;
  const run = steps.findIndex((s) => (s.run ?? '').includes('--variations'));
  const budget = steps.findIndex((s) => (s.run ?? '').includes('ocr-variations-shards.mjs budget'));
  const upload = steps.findIndex((s) => /upload-artifact/.test(s.uses ?? ''));
  assert.ok(run < budget && budget < upload);
  assert.match(steps[budget].run.trim(), /--json "\$RUNNER_TEMP\/ocr-variations\.json" --minutes 20$/);
  assert.notEqual(steps[budget]['continue-on-error'], true);
  assert.equal(
    steps[upload].if.includes('always()'),
    true,
    'the counts are uploaded even when the budget fails',
  );
});

test('the required check ocr-variations keeps its name, needs every shard and fails when one did not succeed', () => {
  assert.equal(variations.name, 'ocr-variations');
  assert.equal(variations.needs, 'ocr-variations-shard');
  assert.match(variations.if, /always\(\)/);
  assert.match(variations.if, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  const verdict = variations.steps.find((s) =>
    (s.env?.SHARDS ?? '').includes('needs.ocr-variations-shard.result'),
  );
  assert.match(verdict.run, /\[ "\$SHARDS" != "success" \].*exit 1/);
  assert.notEqual(verdict['continue-on-error'], true);
});

test('the merge job sees no secret and no screenshot, and merges the same number of shards the matrix runs', () => {
  assert.doesNotMatch(JSON.stringify(variations), /secrets\.|real-prints"|7z/);
  const checkout = variations.steps.find((s) => /^actions\/checkout@/.test(s.uses ?? ''));
  assert.equal(checkout.with['persist-credentials'], false);
  for (const step of variations.steps.filter((s) => s.uses)) assert.match(step.uses, SHA_PINNED);
  const download = variations.steps.find((s) => /download-artifact/.test(s.uses ?? ''));
  assert.equal(download.with.pattern, 'ocr-variations-shard-*');
  const merge = variations.steps.find((s) => (s.run ?? '').includes('ocr-variations-shards.mjs merge'));
  assert.match(merge.run.trim(), new RegExp(`--count ${SHARDS} --out reports/ocr-variations\\.json$`));
  assert.match(merge.run, /--dir "\$RUNNER_TEMP\/shards"/);
});

test('the merged counts are held to the ratchet in the ocr context, after the merge and before the upload', () => {
  const steps = variations.steps;
  const merge = steps.findIndex((s) => (s.run ?? '').includes('ocr-variations-shards.mjs merge'));
  const gate = steps.findIndex((s) => (s.run ?? '').includes('quality-ratchet.mjs'));
  const upload = steps.findIndex((s) => /upload-artifact/.test(s.uses ?? ''));
  assert.ok(merge < gate && gate < upload);
  assert.match(steps[gate].run, /quality-collect\.mjs/);
  assert.match(steps[gate].run, /quality-ratchet\.mjs --context ocr/);
  assert.notEqual(steps[gate]['continue-on-error'], true);
  assert.equal(steps[upload].with.name, 'ocr-variations');
  assert.equal(steps[upload].with.path, 'reports/ocr-variations.json');
});
