// Static checks of render.yaml (ADR 033, DLP-05): staging and production are separate free services, every secret is a
// `sync: false` name with no value in the file, and production has no test endpoints and no previews.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parse } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const blueprint = parse(readFileSync(path.join(root, 'render.yaml'), 'utf8'));
const service = (name) => blueprint.services.find((entry) => entry.name === name);
const staging = service('d2rmm-api');
const production = service('d2rmm-api-production');
const SECRETS = [
  'DATABASE_URL',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'BNET_CLIENT_ID',
  'BNET_CLIENT_SECRET',
];
// Production's site URL is a secret-name entry too: this file must not hand it staging's value.
const PRODUCTION_ONLY_SECRETS = ['SITE_ORIGIN'];
const envOf = (entry) => Object.fromEntries(entry.envVars.map((variable) => [variable.key, variable]));

test('the blueprint declares exactly the staging and the production service, staging first', () => {
  assert.deepEqual(
    blueprint.services.map((entry) => entry.name),
    ['d2rmm-api', 'd2rmm-api-production'],
  );
});

test('both services are free, never auto-deploy, check /healthz and build the same way', () => {
  for (const entry of [staging, production]) {
    assert.equal(entry.type, 'web');
    assert.equal(entry.plan, 'free', 'nothing costs beyond the free tiers (NFR-07)');
    assert.equal(entry.autoDeploy, false);
    assert.equal(entry.healthCheckPath, '/healthz');
    assert.equal(entry.region, 'virginia');
  }
  assert.equal(production.buildCommand, staging.buildCommand);
  assert.equal(production.startCommand, staging.startCommand);
});

test('every secret name is declared with sync: false and no value, in both services', () => {
  for (const entry of [staging, production]) {
    const env = envOf(entry);
    const names = entry === production ? [...SECRETS, ...PRODUCTION_ONLY_SECRETS] : SECRETS;
    for (const name of names) {
      assert.ok(env[name], `${entry.name} must declare ${name}`);
      assert.equal(env[name].sync, false, `${entry.name} ${name} must be sync: false`);
      assert.equal(env[name].value, undefined, `${entry.name} ${name} must carry no value`);
    }
    for (const variable of entry.envVars.filter((v) => !names.includes(v.key))) {
      assert.notEqual(variable.sync, false, `${entry.name} ${variable.key} is not a secret name`);
      assert.equal(typeof variable.value, 'string', `${entry.name} ${variable.key} needs a value`);
    }
  }
});

test('the two services differ in environment and in what they expose', () => {
  const s = envOf(staging);
  const p = envOf(production);
  assert.equal(s.D2RMM_ENV.value, 'staging');
  assert.equal(p.D2RMM_ENV.value, 'production');
  assert.equal(s.ENABLE_STAGING_ENDPOINTS.value, 'true');
  assert.equal(p.ENABLE_STAGING_ENDPOINTS.value, 'false', 'production serves no test endpoints');
  assert.match(s.SITE_ORIGIN.value, /^https:\/\/[a-z0-9.-]+$/);
  // Production carries no site URL at all: the maintainer sets it in Render, so staging's site is never copied.
  assert.deepEqual(p.SITE_ORIGIN, { key: 'SITE_ORIGIN', sync: false });
  assert.doesNotMatch(JSON.stringify(production), /pages\.dev|https?:\/\//, 'no URL anywhere in production');
});

test('previews come only from the staging service, manually (ADR 030)', () => {
  assert.deepEqual(staging.previews, { generation: 'manual' });
  assert.deepEqual(production.previews, { generation: 'off' });
});
