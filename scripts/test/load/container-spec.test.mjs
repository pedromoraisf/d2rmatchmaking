import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanupPlan } from '../../load/lib/cleanup-plan.mjs';
import {
  DEFAULT_LIMITS,
  assertSafe,
  apiArgs,
  apiEnvironment,
  certificateArgs,
  containerNameOf,
  databaseUrlOf,
  envFileText,
  k6Args,
  limitsFrom,
  meterArgs,
  migrateArgs,
  networkArgs,
  postgresArgs,
  publicCaProblemOf,
  sinkArgs,
  volumeArgs,
  volumeNameOf,
} from '../../load/lib/container-spec.mjs';
import { OPENSSL_IMAGE } from '../../load/lib/images.mjs';

const RUN = 'k7q2mz9a';
const WORK = '/var/folders/ab/T/d2rmm-load-k7q2mz9a';
const ENV_FILE = `${WORK}/api.env`;
const CA_FILE = `${WORK}/ca.crt`;
const TOKEN_FILE = `${WORK}/token`;
const LOAD_DIR = '/Users/dev/repo/scripts/load';
const IN_DIR = `${WORK}/in`;
const OUT_DIR = `${WORK}/out`;
const PASSWORD = 'Abcdefghijklmnop1234';
const DATABASE_URL = databaseUrlOf({ runId: RUN, password: PASSWORD });
const SITE_ORIGIN = 'http://localhost:8788';
const ENVIRONMENT = apiEnvironment({ siteOrigin: SITE_ORIGIN, port: 8787, databaseUrl: DATABASE_URL });
const SINK = containerNameOf(RUN, 'sink');
const VOLUME = volumeNameOf(RUN);

const api = () =>
  apiArgs({
    runId: RUN,
    image: 'd2rmm-load-api:test',
    environment: ENVIRONMENT,
    envFile: ENV_FILE,
    caFile: CA_FILE,
  });

/** Every builder of a run, with the image names the orchestrator passes. */
const builders = () => ({
  network: networkArgs(RUN),
  cert: certificateArgs({ runId: RUN }),
  postgres: postgresArgs({ runId: RUN, image: 'postgres:17-alpine', envFile: ENV_FILE }),
  sink: sinkArgs({ runId: RUN, image: 'node:26', loadDir: LOAD_DIR, tokenFile: TOKEN_FILE }),
  api: api(),
  meter: meterArgs({ runId: RUN, image: 'node:26', loadDir: LOAD_DIR, tokenFile: TOKEN_FILE, apiPort: 8787 }),
  migrate: migrateArgs({ runId: RUN, image: 'd2rmm-load-api:test', envFile: ENV_FILE, caFile: CA_FILE }),
  k6: k6Args({ runId: RUN, image: 'd2rmm-load-k6:test', inDir: IN_DIR, outDir: OUT_DIR }),
});

/** The value after a flag, or undefined. */
const valueAfter = (args, flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};

test('builders return argument arrays with the run name and label', () => {
  for (const [role, args] of Object.entries(builders())) {
    assert.ok(Array.isArray(args), `${role} is an argument array`);
    for (const arg of args) {
      assert.equal(typeof arg, 'string', `${role} holds only strings`);
    }
    if (role === 'network') {
      assert.deepEqual(args.slice(-1), [`d2rmm-load-${RUN}-net`], 'the network is named for the run');
      assert.equal(valueAfter(args, '--label'), `d2rmm-load=${RUN}`);
      continue;
    }
    assert.equal(valueAfter(args, '--name'), `d2rmm-load-${RUN}-${role}`);
    assert.equal(valueAfter(args, '--label'), `d2rmm-load=${RUN}`, `${role} carries the run label`);
  }
  assert.throws(() => containerNameOf(RUN, 'redis'), TypeError, 'an unknown role is refused');
  assert.throws(() => containerNameOf('UPPER123', 'api'), TypeError, 'a run id is lower-case');
});

test('limits and strict values', () => {
  assert.deepEqual(limitsFrom({}), { cpus: '0.5', memory: '512m', k6Memory: '1500m' }, 'the defaults');
  assert.deepEqual(DEFAULT_LIMITS, { cpus: '0.5', memory: '512m', k6Memory: '1500m' });
  assert.deepEqual(
    limitsFrom({ LOAD_CPUS: '1.5', LOAD_MEMORY: '1g', LOAD_K6_MEMORY: '2000m' }),
    { cpus: '1.5', memory: '1g', k6Memory: '2000m' },
    'the values from the environment',
  );
  assert.deepEqual(limitsFrom({ LOAD_CPUS: '' }).cpus, '0.5', 'an empty value takes the default');

  assert.throws(() => limitsFrom({ LOAD_K6_MEMORY: '1500m --privileged' }), RangeError);
  assert.throws(() => limitsFrom({ LOAD_CPUS: '0.5 --privileged' }), RangeError);
  assert.throws(() => limitsFrom({ LOAD_MEMORY: '512' }), RangeError, 'a memory needs m or g');
  assert.throws(() => limitsFrom({ LOAD_MEMORY: '1.5g' }), RangeError, 'memory is a whole number');
  assert.throws(() => limitsFrom({ LOAD_CPUS: '0' }), RangeError, 'zero CPUs is refused');
  assert.throws(() => limitsFrom({ LOAD_CPUS: '-1' }), RangeError);
  assert.throws(() => limitsFrom({ LOAD_MEMORY: '0m' }), RangeError);

  const args = apiArgs({
    runId: RUN,
    image: 'd2rmm-load-api:test',
    environment: ENVIRONMENT,
    envFile: ENV_FILE,
    caFile: CA_FILE,
  });
  assert.equal(valueAfter(args, '--cpus'), '0.5', 'the API defaults to half a CPU');
  assert.equal(valueAfter(args, '--memory'), '512m', 'the API defaults to 512 MB');

  const tuned = apiArgs({
    runId: RUN,
    image: 'd2rmm-load-api:test',
    environment: ENVIRONMENT,
    envFile: ENV_FILE,
    caFile: CA_FILE,
    limits: limitsFrom({ LOAD_CPUS: '1', LOAD_MEMORY: '1g' }),
  });
  assert.equal(valueAfter(tuned, '--cpus'), '1');
  assert.equal(valueAfter(tuned, '--memory'), '1g');

  assert.equal(valueAfter(builders().k6, '--memory'), '1500m', 'k6 takes LOAD_K6_MEMORY, default 1500m');
  assert.throws(
    () =>
      k6Args({
        runId: RUN,
        image: 'd2rmm-load-k6:test',
        inDir: IN_DIR,
        outDir: OUT_DIR,
        limits: { cpus: '0.5', memory: '512m', k6Memory: '1500m --privileged' },
      }),
    RangeError,
    'a k6 memory with extra arguments is refused',
  );
});

test('API environment allow-list', () => {
  assert.deepEqual(
    Object.keys(ENVIRONMENT).sort(),
    [
      'D2RMM_ENV',
      'ENABLE_STAGING_ENDPOINTS',
      'NODE_EXTRA_CA_CERTS',
      'OTEL_EXPORTER_OTLP_ENDPOINT',
      'PORT',
      'SITE_ORIGIN',
      'DATABASE_URL',
    ].sort(),
    'exactly the allow-listed names',
  );
  assert.equal(ENVIRONMENT.D2RMM_ENV, 'staging');
  assert.equal(ENVIRONMENT.ENABLE_STAGING_ENDPOINTS, 'true');
  assert.equal(ENVIRONMENT.SITE_ORIGIN, SITE_ORIGIN);
  assert.equal(ENVIRONMENT.PORT, '8787');
  assert.equal(ENVIRONMENT.OTEL_EXPORTER_OTLP_ENDPOINT, 'http://127.0.0.1:4318', 'the loopback exporter');
  assert.equal(ENVIRONMENT.NODE_EXTRA_CA_CERTS, '/run/d2rmm-ca/ca.crt', 'the CA the run mounts');
  assert.equal('D2RMM_ACCEPTANCE' in ENVIRONMENT, false, 'no acceptance control');

  const args = api();
  assert.equal(args.includes('D2RMM_ACCEPTANCE'), false, 'no acceptance control in an argument');
  assert.equal(valueAfter(args, '--network'), `container:${SINK}`, 'the API shares the sink namespace');
  assert.equal(valueAfter(args, '--env-file'), ENV_FILE, 'the secret travels in the env-file');
  const pairs = args.flatMap((arg, index) => (arg === '-e' ? [args[index + 1]] : []));
  assert.deepEqual(
    pairs.map((pair) => pair.split('=')[0]).sort(),
    [
      'D2RMM_ENV',
      'ENABLE_STAGING_ENDPOINTS',
      'NODE_EXTRA_CA_CERTS',
      'OTEL_EXPORTER_OTLP_ENDPOINT',
      'PORT',
      'SITE_ORIGIN',
    ],
    'every other allow-listed variable is an -e pair',
  );
  assert.equal(
    args.some((arg) => arg.includes(PASSWORD) || arg.includes('DATABASE_URL')),
    false,
    'no secret in an argument',
  );
  assert.deepEqual(
    args.slice(-4),
    ['node', '--import', './apps/api/src/main/instrument.ts', 'apps/api/src/main/render.ts'],
    'the Render start command ends the API call',
  );

  assert.throws(
    () =>
      apiArgs({
        runId: RUN,
        image: 'x',
        environment: { ...ENVIRONMENT, D2RMM_ACCEPTANCE: 'true' },
        envFile: ENV_FILE,
        caFile: CA_FILE,
      }),
    TypeError,
    'a name outside the allow-list is refused, so D2RMM_ACCEPTANCE cannot be added',
  );
  assert.throws(
    () =>
      apiArgs({
        runId: RUN,
        image: 'x',
        environment: { ...ENVIRONMENT, D2RMM_ENV: 'production' },
        envFile: ENV_FILE,
        caFile: CA_FILE,
      }),
    TypeError,
    'the API never runs as production',
  );
  const withoutDatabase = { ...ENVIRONMENT };
  delete withoutDatabase.DATABASE_URL;
  assert.throws(
    () =>
      apiArgs({ runId: RUN, image: 'x', environment: withoutDatabase, envFile: ENV_FILE, caFile: CA_FILE }),
    TypeError,
    'the API needs its database',
  );
  assert.throws(
    () =>
      apiEnvironment({
        siteOrigin: SITE_ORIGIN,
        port: 8787,
        databaseUrl: 'postgres://postgres:x@h:5432/postgres',
      }),
    TypeError,
    'the database URL must verify the certificate',
  );

  for (const [role, args] of Object.entries(builders())) {
    if (role === 'api') {
      continue;
    }
    const text = args.join(' ');
    assert.equal(text.includes('D2RMM_ENV'), false, `${role} gets no staging variable`);
    assert.equal(text.includes('ENABLE_STAGING_ENDPOINTS'), false, `${role} gets no staging endpoint switch`);
  }

  assert.equal(envFileText({ DATABASE_URL }), `DATABASE_URL=${DATABASE_URL}\n`);
  assert.throws(() => envFileText({ 'bad key': 'x' }), TypeError);
  assert.throws(() => envFileText({ PASSWORD: 'a\nb' }), TypeError, 'a newline cannot enter an env-file');
});

test('Postgres with TLS', () => {
  const args = builders().postgres;
  assert.equal(valueAfter(args, '--env-file'), ENV_FILE, 'the password comes from an env-file path');
  assert.equal(args.includes('-e'), false, 'no value is passed with -e');
  assert.equal(
    args.some((arg) => arg.includes(PASSWORD) || arg.includes('POSTGRES_PASSWORD')),
    false,
  );

  const mounts = args.flatMap((arg, index) => (arg === '-v' ? [args[index + 1]] : []));
  assert.deepEqual(
    mounts,
    [`${VOLUME}:/tls:ro`],
    'Postgres mounts the TLS volume read-only, and nothing else',
  );
  assert.equal(
    args.includes('openssl') || args.includes('sh'),
    false,
    'Postgres makes no certificate itself',
  );
  const image = args.indexOf('postgres:17-alpine');
  assert.deepEqual(
    args.slice(image + 1),
    ['postgres', '-c', 'ssl=on', '-c', 'ssl_cert_file=/tls/server.crt', '-c', 'ssl_key_file=/tls/server.key'],
    'the stock entrypoint starts with TLS on and the certificate files of the volume',
  );

  const cert = builders().cert;
  for (const [flag, value] of [
    ['--entrypoint', 'sh'],
    ['--network', 'none'],
    ['--cap-drop', 'ALL'],
    ['--cap-add', 'CHOWN'],
    ['--security-opt', 'no-new-privileges'],
  ]) {
    assert.equal(valueAfter(cert, flag), value, `the certificate container runs with ${flag} ${value}`);
  }
  assert.ok(cert.includes('--read-only'), 'the certificate container has a read-only root');
  assert.equal(cert.includes('--rm'), false, 'the certificate container is kept until the CA is copied out');
  assert.deepEqual(
    cert.flatMap((arg, index) => (arg === '-v' ? [cert[index + 1]] : [])),
    [`${VOLUME}:/tls`],
    'its only mount is the volume at /tls',
  );
  for (const flag of ['-p', '--publish', '-e', '--env', '--env-file', '--mount']) {
    assert.equal(cert.includes(flag), false, `the certificate container has no ${flag}`);
  }

  assert.throws(
    () => postgresArgs({ runId: RUN, image: 'postgres:17-alpine', envFile: 'relative.env' }),
    TypeError,
  );
  assert.throws(
    () => databaseUrlOf({ runId: RUN, password: 'short' }),
    TypeError,
    'a weak password is refused',
  );
  assert.equal(
    DATABASE_URL,
    `postgres://postgres:${PASSWORD}@${containerNameOf(RUN, 'postgres')}:5432/postgres?sslmode=verify-full`,
    'the URL verifies the certificate by the container name',
  );
});

test('certificate container and volume', () => {
  // The image is the pinned constant, and the builder takes it from there (AD-120).
  assert.match(OPENSSL_IMAGE, /^alpine\/openssl:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$/u, 'a tag and a digest');
  const cert = builders().cert;
  const at = cert.indexOf(OPENSSL_IMAGE);
  assert.ok(at > 0, 'the certificate container runs the pinned image');
  assert.deepEqual(
    cert.slice(at + 1, at + 4),
    ['-c', cert[at + 2], 'certificate-tls'],
    'the script is one argument',
  );
  assert.equal(
    cert[at + 4],
    containerNameOf(RUN, 'postgres'),
    'the certificate names the Postgres container, as $1',
  );

  const script = cert[at + 2];
  for (const required of [
    'set -eu',
    'openssl req -x509',
    'openssl x509 -req',
    'rm -f ca.key',
    'chown 70:70 server.key',
    'chmod 600 server.key',
    'chmod 755 /tls',
  ]) {
    assert.ok(script.includes(required), `the script makes the TLS material: ${required}`);
  }
  assert.equal(script.includes(RUN), false, 'the script is a constant, with no run value in it');
  assert.equal(
    script.includes('postgres:postgres'),
    false,
    'the key belongs to uid 70, not to a user the image lacks',
  );

  // The volume: created with the run id in its name, and mounted only by the two TLS containers.
  assert.equal(VOLUME, `d2rmm-load-${RUN}-tls`);
  assert.deepEqual(volumeArgs(RUN), ['volume', 'create', '--label', `d2rmm-load=${RUN}`, VOLUME]);
  assert.throws(() => volumeArgs('UPPER'), TypeError, 'a run id is lower-case');
  for (const [role, args] of Object.entries(builders())) {
    const mountsIt = args.some((arg) => arg.startsWith(`${VOLUME}:`));
    assert.equal(
      mountsIt,
      role === 'postgres' || role === 'cert',
      `${role} mounts the TLS volume only when it is TLS`,
    );
  }

  // The cleanup removes the containers (the certificate container started first, so it goes last) and then the volume.
  const plan = cleanupPlan({
    containers: [containerNameOf(RUN, 'cert'), containerNameOf(RUN, 'postgres')],
    network: `d2rmm-load-${RUN}-net`,
    volume: VOLUME,
    workDir: `/var/folders/ab/T/d2rmm-load-${RUN}-AbC123`,
  });
  assert.deepEqual(plan.containers, [containerNameOf(RUN, 'postgres'), containerNameOf(RUN, 'cert')]);
  assert.deepEqual(plan.volumes, [VOLUME], 'the volume is removed after the containers');
});

/** A private-key block, assembled from pieces so that no scanner reads a key header in the source (a fake, never a key). */
const KEY_BLOCK =
  '-----' + 'BEGIN ' + 'PRIVATE KEY' + '-----\nMIIB\n-----' + 'END ' + 'PRIVATE KEY' + '-----\n';

test('the public CA is one certificate block and no key', () => {
  const block = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
  assert.equal(publicCaProblemOf(block), null);
  assert.notEqual(publicCaProblemOf(block + block), null, 'two blocks are refused');
  assert.notEqual(publicCaProblemOf(''), null, 'no block is refused');
  assert.notEqual(publicCaProblemOf(`${block}${KEY_BLOCK}`), null, 'a key is refused');
});

test('the sink, meter, migration and k6 take no staging variable and no secret', () => {
  const sink = builders().sink;
  assert.equal(sink.includes('--env-file'), false, 'the sink reads its token from a file');
  assert.equal(valueAfter(sink, '--token-file'), '/run/d2rmm/token');
  assert.equal(valueAfter(sink, '--listen'), '127.0.0.1:4318', 'the sink listens inside the API namespace');

  const meter = meterArgs({
    runId: RUN,
    image: 'node:26',
    loadDir: LOAD_DIR,
    tokenFile: TOKEN_FILE,
    apiPort: 8787,
  });
  assert.equal(valueAfter(meter, '--upstream'), `${SINK}:8787`, 'the meter reaches the API through the sink');
  assert.equal(meter.includes(`${TOKEN_FILE}:/run/d2rmm/token:ro`), true, 'the token is mounted read-only');
  assert.equal(meter.includes('-e'), false);

  const migrate = builders().migrate;
  assert.equal(valueAfter(migrate, '--env-file'), ENV_FILE);
  assert.equal(migrate.at(-2), 'node', 'the migration runs the TypeScript entry');
  assert.equal(migrate.at(-1), 'apps/api/src/main/migrate.ts', 'the migration entry is last');

  const k6 = builders().k6;
  assert.equal(
    k6.some((arg) => arg.includes(PASSWORD) || arg.includes('cookie') || arg.includes('Bearer')),
    false,
  );
  assert.equal(valueAfter(k6, '--network'), `d2rmm-load-${RUN}-net`);
  assert.equal(k6.at(-1), '/work/in/journey.mjs', 'k6 runs the journey from the mounted plan');
});

test('publish guard', () => {
  const published = (args) => args.flatMap((arg, index) => (arg === '-p' ? [args[index + 1]] : []));
  const all = builders();

  assert.deepEqual(
    published(all.sink),
    ['127.0.0.1:9101:9101'],
    'the sink publishes its control port on loopback',
  );
  assert.deepEqual(
    published(all.meter),
    ['127.0.0.1:8080:8080', '127.0.0.1:9100:9100'],
    'the meter publishes its proxy and control ports on loopback',
  );
  for (const role of ['postgres', 'api', 'migrate', 'k6', 'network', 'cert']) {
    assert.deepEqual(published(all[role]), [], `${role} publishes nothing`);
  }
  for (const [role, args] of Object.entries(all)) {
    assert.equal(args.includes('--privileged'), false, `${role} is not privileged`);
    assert.equal(args.includes('host'), false, `${role} shares no host namespace`);
    assert.equal(
      args.some((arg) => arg.includes('docker.sock')),
      false,
      `${role} mounts no Docker socket`,
    );
    assert.equal(assertSafe(args), args, `${role} passes the guard`);
  }

  for (const publish of [
    '0.0.0.0:8080:8080',
    '8080:8080',
    '127.0.0.1:8080',
    '[::1]:8080:8080',
    '192.168.1.5:8080:8080',
  ]) {
    assert.throws(() => assertSafe(['run', '-p', publish, 'image']), TypeError, `${publish} is refused`);
  }
  assert.throws(
    () => assertSafe(['run', '--publish=0.0.0.0:9101:9101', 'image']),
    TypeError,
    'the inline form too',
  );
  assert.throws(() => assertSafe(['run', '-P', 'image']), TypeError, 'publish-all is refused');
  assert.throws(
    () => assertSafe(['run', '--network', 'host', 'image']),
    TypeError,
    'host networking is refused',
  );
  assert.throws(() => assertSafe(['run', '--network=host', 'image']), TypeError, 'host networking, inline');
  assert.throws(
    () => assertSafe(['run', '--pid', 'host', 'image']),
    TypeError,
    'the host PID namespace is refused',
  );
  assert.throws(() => assertSafe(['run', '--privileged', 'image']), TypeError, 'privileged mode is refused');
  assert.throws(
    () => assertSafe(['run', '-v', '/var/run/docker.sock:/var/run/docker.sock', 'image']),
    TypeError,
    'the Docker socket is never mounted',
  );
  assert.throws(
    () => assertSafe(['run', '-v', `${LOAD_DIR}:/load`, 'image']),
    TypeError,
    'a writable mount of scripts/load is refused',
  );
  assert.throws(
    () => assertSafe(['run', '--mount', `type=bind,source=${LOAD_DIR},target=/load`, 'image']),
    TypeError,
    'a writable --mount of scripts/load is refused',
  );
  assert.throws(
    () => assertSafe(['run', '--volume', `${LOAD_DIR}/k6:/k6`, 'image']),
    TypeError,
    'a writable mount of a subdirectory of scripts/load is refused',
  );
  assert.throws(
    () => assertSafe(['run', '-e', 'DATABASE_URL=postgres://u:p@h/db', 'image']),
    TypeError,
    'a database URL is never an argument',
  );
  assert.throws(() => assertSafe(['run', '-e', 'POSTGRES_PASSWORD=x', 'image']), TypeError);
  assert.throws(
    () => assertSafe(['run', '-e', 'X=Bearer abc', 'image']),
    TypeError,
    'a bearer is never an argument',
  );

  assert.equal(
    assertSafe(['run', '-p', '127.0.0.1:8080:8080', 'image']).length,
    4,
    'loopback publish is allowed',
  );
  assert.equal(
    assertSafe(['run', '-p', '127.0.0.1::8080', 'image']).length,
    4,
    'an empty host port is allowed',
  );
  assert.equal(
    assertSafe(['run', '-v', `${LOAD_DIR}:/load:ro`, 'image']).length,
    4,
    'a read-only mount of scripts/load is allowed',
  );
  assert.throws(
    () => assertSafe('run -p 127.0.0.1:1:1'),
    TypeError,
    'a shell string is not an argument list',
  );

  assert.throws(
    () => k6Args({ runId: RUN, image: 'd2rmm-load-k6:test', inDir: IN_DIR, outDir: LOAD_DIR }),
    TypeError,
    'the guard runs inside each builder: a writable scripts/load output is refused',
  );
});
