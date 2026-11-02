// The local observability backend (OBS-23, OBS-35). The compose file pins the `grafana/otel-lgtm` image by tag and digest
// and binds every port to loopback, because the image ships with anonymous admin access. The root scripts start and stop
// it. The dashboard provisioning is checked by the tests of T48.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parse } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readText = (file) => readFileSync(path.join(root, file), 'utf8');
const compose = parse(readText('infra/observability/compose.yaml'));
const rootPackage = JSON.parse(readText('package.json'));

const LGTM_PORTS = ['3000', '3200', '4317', '4318'];

test('compose pins the image tag and digest and binds loopback', () => {
  const lgtm = compose.services.lgtm;
  assert.match(
    lgtm.image,
    /^grafana\/otel-lgtm:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/u,
    'image pins a tag and a digest',
  );

  const ports = lgtm.ports.map((mapping) => String(mapping));
  for (const mapping of ports) {
    assert.ok(mapping.startsWith('127.0.0.1:'), `port ${mapping} must bind to loopback`);
  }
  const containerPorts = ports.map((mapping) => mapping.split(':')[2]).sort();
  assert.deepEqual(containerPorts, LGTM_PORTS, 'the four ports of the backend are published');
});

test('package.json defines obs:up and obs:down', () => {
  const scripts = rootPackage.scripts;
  assert.match(scripts['obs:up'] ?? '', /docker compose -f infra\/observability\/compose\.yaml up/u);
  assert.match(scripts['obs:down'] ?? '', /docker compose -f infra\/observability\/compose\.yaml down/u);
});
