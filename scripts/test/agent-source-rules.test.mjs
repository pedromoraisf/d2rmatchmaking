// Static rules of the agent's Rust and Tauri sources (AGS-01, AGS-04, AGS-15, AGS-21, AGS-22). Each rule is checked on the
// repository as it is; the fixture variants that prove each rule can fail arrive with AGS-21/22 (T7).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const agentTauri = 'apps/agent/src-tauri';
const readText = (file) => readFileSync(path.join(root, file), 'utf8');
const readJson = (file) => JSON.parse(readText(file));

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src ipc: http://ipc.localhost";

test('tauri.conf.json keeps the hardened shell', () => {
  const conf = readJson(`${agentTauri}/tauri.conf.json`);
  assert.equal(
    conf.version,
    '../package.json',
    'the version has one source, apps/agent/package.json (AGS-04)',
  );
  assert.equal(conf.build.frontendDist, '../dist');
  assert.equal(conf.build.beforeBuildCommand, '', 'no command runs before the build (release supply chain)');
  assert.equal(conf.build.features, undefined, 'the app enables no build features in the config');
  assert.equal(conf.app.withGlobalTauri, false);
  assert.equal(conf.app.security.csp, CSP);
  assert.deepEqual(
    conf.app.windows.map((window) => window.label),
    ['main'],
    'one window, labelled main',
  );
});

test('the window gets only listen, unlisten and get_new_code', () => {
  const capability = readJson(`${agentTauri}/capabilities/main.json`);
  assert.deepEqual(capability.windows, ['main']);
  assert.deepEqual(
    [...capability.permissions].sort(),
    ['allow-get-new-code', 'core:event:allow-listen', 'core:event:allow-unlisten'],
    'no updater, shell, fs or http permission reaches the window',
  );
});

test('core has no tauri dependency', () => {
  const manifest = readText(`${agentTauri}/core/Cargo.toml`);
  assert.doesNotMatch(manifest, /^\s*tauri[\w-]*\s*[=.]/m, 'core/Cargo.toml names no tauri crate');
  assert.doesNotMatch(manifest, /features\s*=/, 'core declares no Cargo features (AGS-01)');
  for (const file of ['core/src/lib.rs']) {
    assert.doesNotMatch(readText(`${agentTauri}/${file}`), /\btauri\b/, `${file} does not use tauri`);
  }
});
