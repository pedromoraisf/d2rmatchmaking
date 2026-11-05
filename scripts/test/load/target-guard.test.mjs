import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guardDocker, guardTarget } from '../../load/lib/target-guard.mjs';

test('refuses a non-empty target', () => {
  const remote = guardTarget({ LOAD_TARGET: 'https://api.example.com' });
  assert.equal(remote.variable, 'LOAD_TARGET');
  assert.match(remote.message, /LOAD_TARGET/, 'the refusal names the variable');
  assert.doesNotMatch(remote.message, /example\.com/, 'the refusal never echoes the value');

  const loopback = guardTarget({ LOAD_TARGET: 'http://127.0.0.1:8787' });
  assert.equal(loopback.variable, 'LOAD_TARGET', 'a loopback target is refused too');

  const database = guardTarget({ DATABASE_URL: 'postgres://user:pw@localhost:5432/app' });
  assert.equal(database.variable, 'DATABASE_URL');
  assert.match(database.message, /DATABASE_URL/);
  assert.doesNotMatch(database.message, /pw@/, 'a connection string is never echoed');

  assert.equal(guardTarget({ LOAD_TARGET: ' ' }).variable, 'LOAD_TARGET', 'a blank value is not empty');
});

test('ignores unset and empty', () => {
  assert.equal(guardTarget({}), null);
  assert.equal(guardTarget({ LOAD_TARGET: '', DATABASE_URL: '' }), null, 'empty values are ignored');
  assert.equal(guardTarget({ LOAD_TARGET: undefined, DATABASE_URL: undefined, PATH: '/usr/bin' }), null);
  assert.equal(guardDocker({}), null, 'the Docker guard ignores unset variables too');
  assert.equal(
    guardDocker({ DOCKER_HOST: '', DOCKER_CONTEXT: '' }),
    null,
    'empty Docker variables are ignored',
  );
});

test('refuses a remote Docker host', () => {
  const tcp = guardDocker({ DOCKER_HOST: 'tcp://10.0.0.5:2375' });
  assert.equal(tcp.variable, 'DOCKER_HOST');
  assert.match(tcp.message, /DOCKER_HOST/);

  assert.equal(guardDocker({ DOCKER_HOST: 'ssh://builder@build.example.com' }).variable, 'DOCKER_HOST');
  assert.equal(
    guardDocker({ DOCKER_HOST: 'unix://run/docker.sock' }).variable,
    'DOCKER_HOST',
    'a relative socket is not local',
  );
  assert.equal(guardDocker({ DOCKER_HOST: 'unix:///' }).variable, 'DOCKER_HOST', 'a socket needs a path');
  assert.equal(
    guardDocker({ DOCKER_HOST: 'unix:///var/run/docker.sock' }),
    null,
    'a local unix socket is allowed',
  );

  const context = guardDocker({ DOCKER_CONTEXT: 'production' });
  assert.equal(context.variable, 'DOCKER_CONTEXT');
  assert.match(context.message, /DOCKER_CONTEXT/);
  assert.equal(guardDocker({ DOCKER_CONTEXT: 'default' }), null, 'the default context is allowed');

  const otel = guardDocker({ OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example.com' });
  assert.equal(otel.variable, 'OTEL_EXPORTER_OTLP_ENDPOINT', 'an inherited OTEL variable is refused by name');
  assert.equal(
    guardDocker({ OTEL_SERVICE_NAME: '' }).variable,
    'OTEL_SERVICE_NAME',
    'a set OTEL variable is refused even when empty',
  );
  assert.equal(guardDocker({ OTELX: 'fine' }), null, 'only OTEL_ variables are refused');
});
