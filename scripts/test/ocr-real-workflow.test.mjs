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
    2,
    'once in the header comment, once on the extract step',
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
