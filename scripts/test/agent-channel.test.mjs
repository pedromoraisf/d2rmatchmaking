// The channel override of the agent build (ADR 033, DLP-06): one table, three channels that install side by side.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CHANNEL_NAMES, channelConfig, readChannels } from '../delivery/agent-channel.mjs';

const conf = JSON.parse(
  readFileSync(new URL('../../apps/agent/src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
);

test('the table names exactly the three channels, each with an identifier, a product name and an updater switch', () => {
  assert.deepEqual(Object.keys(readChannels()).sort(), [...CHANNEL_NAMES].sort());
  for (const name of CHANNEL_NAMES) {
    const config = channelConfig(name);
    assert.match(config.identifier, /^com\.d2rmm\.agent(\.[a-z]+)?$/);
    assert.equal(typeof config.productName, 'string');
    assert.equal(typeof config.bundle.createUpdaterArtifacts, 'boolean');
  }
});

test('the channels install side by side: no identifier and no product name repeats', () => {
  const configs = CHANNEL_NAMES.map((name) => channelConfig(name));
  assert.equal(new Set(configs.map((c) => c.identifier)).size, 3);
  assert.equal(new Set(configs.map((c) => c.productName)).size, 3);
  assert.equal(channelConfig('preview').identifier, 'com.d2rmm.agent.preview');
  assert.equal(channelConfig('staging').identifier, 'com.d2rmm.agent.staging');
});

test('only production makes updater artifacts', () => {
  assert.equal(channelConfig('production').bundle.createUpdaterArtifacts, true);
  assert.equal(channelConfig('staging').bundle.createUpdaterArtifacts, false);
  assert.equal(channelConfig('preview').bundle.createUpdaterArtifacts, false);
});

test('production is what tauri.conf.json already says, so a release does not change', () => {
  const production = channelConfig('production');
  assert.equal(production.identifier, conf.identifier);
  assert.equal(production.productName, conf.productName);
  assert.equal(production.bundle.createUpdaterArtifacts, conf.bundle.createUpdaterArtifacts);
});

test('an unknown channel or an incomplete entry is refused', () => {
  for (const bad of ['', 'Production', 'prod', 'main', undefined, 'constructor']) {
    assert.throws(() => channelConfig(bad), /is not a channel/, String(bad));
  }
  assert.throws(() => channelConfig('staging', { staging: { identifier: 'x' } }), /no complete entry/);
  assert.throws(() => channelConfig('staging', {}), /no complete entry/);
});
