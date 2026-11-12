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

const dashboardText = readText('infra/observability/dashboards/skeleton.json');
const dashboard = JSON.parse(dashboardText);
const DASHBOARD_MOUNT = '/var/lib/d2rmm/dashboards';
const PROVIDER_MOUNT = '/otel-lgtm/grafana/conf/provisioning/dashboards/';

test('the dashboard holds the listed panels', () => {
  assert.equal(
    dashboard.panels.length,
    10,
    'ten panels: request rate, error rate, duration, outbox lag, streams, queue size, queue wait, ready checks, room final stage, room time to active',
  );
  for (const panel of dashboard.panels) {
    assert.ok(panel.title, `panel ${panel.id} has a title`);
    for (const target of panel.targets) {
      assert.match(target.expr, /service_name="d2rmm-api"/u, `panel "${panel.title}" filters on the API`);
    }
  }

  const exprs = dashboard.panels.flatMap((panel) => panel.targets.map((target) => target.expr));
  const queries = (metric) => exprs.some((expr) => expr.includes(metric));
  assert.ok(
    queries('http_server_request_duration_seconds_count'),
    'the request rate panel reads the request count',
  );
  assert.ok(queries('http_response_status_class="5xx"'), 'the error rate panel reads the 5xx class');
  assert.ok(
    queries('http_server_request_duration_seconds_bucket'),
    'the duration panel reads the histogram buckets',
  );
  assert.ok(queries('outbox_lag_seconds'), 'the outbox lag panel reads outbox_lag');
  assert.ok(queries('sse_connections'), 'the streams panel reads sse_connections');
  assert.ok(queries('d2r_queue_size'), 'the queue size panel reads d2r_queue_size');
  assert.ok(
    queries('d2r_queue_wait_seconds_bucket'),
    'the queue wait panel reads the wait histogram buckets',
  );
  assert.ok(
    queries('d2r_ready_check_resolved_total'),
    'the ready check panel reads the outcome counter by its outcome',
  );
  assert.ok(queries('d2r_room_final_stage_total'), 'the room panel reads the final stage counter');
  assert.ok(
    queries('d2r_room_time_to_active_seconds_bucket'),
    'the time to active panel reads the histogram buckets',
  );

  assert.doesNotMatch(
    dashboardText,
    /token|secret|password|authorization|cookie/iu,
    'the dashboard carries no secret',
  );
});

test('compose provisions the dashboard', () => {
  const volumes = compose.services.lgtm.volumes.map(String);
  assert.ok(
    volumes.includes(`./dashboards:${DASHBOARD_MOUNT}:ro`),
    'compose mounts the dashboards read-only at the provider path',
  );

  const providerMount = volumes.find((volume) => volume.includes(PROVIDER_MOUNT));
  assert.ok(
    providerMount,
    'compose mounts a provisioning provider file into the Grafana providers directory',
  );
  const [hostFile] = providerMount.split(':');
  const provider = parse(readText(path.join('infra/observability', hostFile)));
  assert.equal(
    provider.providers[0].options.path,
    DASHBOARD_MOUNT,
    'the provider reads the mounted dashboards',
  );
  assert.equal(provider.providers[0].type, 'file', 'the provider loads dashboard files');
});
