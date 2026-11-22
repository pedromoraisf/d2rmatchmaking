// Telemetry is on in every release build (OBT-01, OBT-05, OBT-07; ADR 037, which lifts AD-098). The agent's
// `D2RMM_TELEMETRY` switch is gone, and the site's `VITE_TELEMETRY` can only turn the site off (`off`) for a local build; the
// tier (full or production) comes from the environment (API), the boot configuration (site) and the compile-time channel
// (agent). A workflow that names either switch, or an agent source that names `D2RMM_TELEMETRY`, brings back a build that
// exports nothing or a different amount than its tier says. The channel stays the one input of the agent.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readText = (file) => readFileSync(path.join(root, file), 'utf8');
const FLAGS = ['VITE_TELEMETRY', 'VITE_TELEMETRY_RATIO', 'D2RMM_TELEMETRY'];
const AGENT_FLAGS = ['D2RMM_TELEMETRY'];
// What each place may not name: a workflow, no switch; an agent source, no agent switch.
const SOURCE_DIRS = [
  { dir: '.github/workflows', ext: /\.ya?ml$/u, flags: FLAGS },
  { dir: 'apps/agent/src-tauri/src', ext: /\.rs$/u, flags: AGENT_FLAGS },
  { dir: 'apps/agent/src-tauri/adapters/src', ext: /\.rs$/u, flags: AGENT_FLAGS },
  { dir: 'apps/agent/src-tauri/core/src', ext: /\.rs$/u, flags: AGENT_FLAGS },
];

/** The old telemetry switches a text names, in the order of FLAGS. A word match: a longer name is not a match. */
function flagsSetIn(text, flags = FLAGS) {
  return flags.filter((flag) => new RegExp(`\\b${flag}\\b`, 'u').test(text));
}

function filesUnder(dir, ext) {
  const found = [];
  for (const entry of readdirSync(path.join(root, dir))) {
    const relative = path.join(dir, entry);
    if (statSync(path.join(root, relative)).isDirectory()) found.push(...filesUnder(relative, ext));
    else if (ext.test(entry)) found.push(relative);
  }
  return found;
}

test('no workflow or agent source names a telemetry switch', () => {
  for (const { dir, ext, flags } of SOURCE_DIRS) {
    for (const file of filesUnder(dir, ext)) {
      assert.deepEqual(flagsSetIn(readText(file), flags), [], `${file} must not name a telemetry switch`);
    }
  }
});

test('the flag check fails on a fixture workflow that sets one', () => {
  const fixture = readText('scripts/test/fixtures/telemetry-flags/sets-vite-telemetry.yml');
  assert.deepEqual(flagsSetIn(fixture), ['VITE_TELEMETRY']);
  assert.deepEqual(flagsSetIn('D2RMM_TELEMETRY_X=1 MY_VITE_TELEMETRY=1'), [], 'a longer name is not a match');
  assert.deepEqual(flagsSetIn('option_env!("D2RMM_TELEMETRY")'), ['D2RMM_TELEMETRY']);
});

test('the agent exports in every release build with the tier of its channel', () => {
  const app = readText('apps/agent/src-tauri/src/app.rs');
  const start = app.indexOf('fn export_config(');
  assert.ok(start > 0, 'app.rs builds the export configuration');
  const body = app.slice(start, app.indexOf('\n    }\n', start));
  assert.match(body, /cfg!\(debug_assertions\)/u, 'only a debug profile exports nothing');
  assert.match(body, /tier_of\(channel\)/u, 'the tier comes from the build channel');
  assert.match(body, /ratio_of\(tier,/u, 'the full tier samples everything');
  assert.doesNotMatch(body, /option_env!\("(?!D2RMM_CHANNEL)/u, 'no switch other than the channel is read');
  assert.match(app, /set_full_tier\(/u, 'the span detail follows the same tier');
});
