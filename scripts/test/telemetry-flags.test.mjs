// The telemetry switches stay off in production (OBS-44, AD-098). The site's `VITE_TELEMETRY` and the agent's
// `D2RMM_TELEMETRY` are read at build or start time; a release or deploy workflow that sets one would ship spans to the
// relay. The workflows run only after the maintainer's push, so their text is checked here. The e2e build sets the switch
// in the acceptance support code only (the acceptance stack), never in a workflow.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readText = (file) => readFileSync(path.join(root, file), 'utf8');
const FLAGS = ['VITE_TELEMETRY', 'D2RMM_TELEMETRY'];
const RELEASE_AND_DEPLOY = ['deploy-api.yml', 'deploy-web.yml', 'release-agent.yml', 'release-please.yml'];

/** The telemetry switches a workflow's text names, in the order of FLAGS. A word match: a longer name is not a match. */
function flagsSetIn(text) {
  return FLAGS.filter((flag) => new RegExp(`\\b${flag}\\b`, 'u').test(text));
}

test('release and deploy workflows leave VITE_TELEMETRY and D2RMM_TELEMETRY unset', () => {
  for (const name of RELEASE_AND_DEPLOY) {
    const text = readText(`.github/workflows/${name}`);
    assert.deepEqual(flagsSetIn(text), [], `${name} must not set a telemetry switch`);
  }
});

test('the flag check fails on a fixture workflow that sets one', () => {
  const fixture = readText('scripts/test/fixtures/telemetry-flags/sets-vite-telemetry.yml');
  assert.deepEqual(flagsSetIn(fixture), ['VITE_TELEMETRY']);
});
