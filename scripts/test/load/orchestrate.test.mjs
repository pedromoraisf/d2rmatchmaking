// The orchestration sequence (design.md § Orchestrator, § Work directory and credentials; LB-07, LB-08, LB-10 to LB-12,
// LB-19). Every port is a fake: `docker` records the argument arrays and answers like the CLI, `http` answers the
// provisioning routes and the health route, `fs` is in memory, the clock is immediate. No container and no network are used.
// Every test that runs the sequence has its own timeout, because a hang here would never fail on its own.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playerFor } from '../../load/lib/players.mjs';
import { API_IMAGE_TAG, K6_IMAGE_TAG } from '../../load/lib/images.mjs';
import { runLoad, samplesOf, secretOf } from '../../load/orchestrate.mjs';

const UID = 501;
const TMP = '/fake/tmp';
const ROOT = '/fake/repo';
const LOAD_DIR = '/fake/repo/scripts/load';
const RUN_ID = 'dddddddd';
const NAME = (role) => `d2rmm-load-${RUN_ID}-${role}`;
const SLOW_TEST_MS = 60_000;
const ALL_PLAYERS = Array.from({ length: 400 }, (_, index) => playerFor(RUN_ID, index));

/** The secrets of one player: distinct per index, so a leaked value is recognisable. */
function secretsOf(index) {
  return {
    session: `Sess${index}Value`,
    token: `d2rmm_a_Tok${index}Value`,
    claimSecret: `Clm${index}Secret`,
  };
}

/** The answer of one k6 step: passing numbers by default; a test changes what it needs. */
const PASSING_K6 = () => ({
  code: 0,
  errors: 0,
  requests: 1000,
  iterations: 100,
  agentAssignedFrames: 100,
  meterBytes: 50_000_000,
  sinkBytes: 1000,
  windowSeconds: 90,
  samples: [400, 500, 600],
});

function fakeFs() {
  const files = new Map();
  const dirs = new Map();
  const notFound = (path) =>
    Object.assign(new Error(`ENOENT: no such file or directory, ${path}`), { code: 'ENOENT' });
  const under = (path, key) => key === path || key.startsWith(`${path}/`);
  return {
    files,
    dirs,
    async mkdtemp(prefix) {
      const path = `${prefix}AbC123`;
      dirs.set(path, { mode: 0o700 });
      return path;
    },
    async mkdir(path, options = {}) {
      dirs.set(path, { mode: options.mode ?? 0o777 });
    },
    async writeFile(path, text, options = {}) {
      files.set(path, { text: String(text), mode: options.mode ?? 0o666 });
    },
    async readFile(path) {
      const entry = files.get(path);
      if (entry === undefined) throw notFound(path);
      return entry.text;
    },
    async chmod(path, mode) {
      const entry = files.get(path) ?? dirs.get(path);
      if (entry === undefined) throw notFound(path);
      entry.mode = mode;
    },
    async copyFile(from, to) {
      files.set(to, { text: `copy of ${from}`, mode: 0o644 });
    },
    async rename(from, to) {
      const entry = files.get(from);
      if (entry === undefined) throw notFound(from);
      files.delete(from);
      files.set(to, entry);
    },
    async rm(path, options = {}) {
      let removed = false;
      for (const map of [files, dirs]) {
        for (const key of [...map.keys()]) {
          if (under(path, key)) {
            map.delete(key);
            removed = true;
          }
        }
      }
      if (!removed && options.force !== true) throw notFound(path);
    },
    async readdir(path) {
      return [...dirs.keys()]
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .map((key) => key.slice(path.length + 1));
    },
    async lstat(path) {
      const entry = dirs.get(path) ?? files.get(path);
      if (entry === undefined) throw notFound(path);
      return { uid: UID, mode: entry.mode | 0o040000, isSymbolicLink: () => false };
    },
  };
}

function nameOf(args) {
  const at = args.indexOf('--name');
  return at === -1 ? undefined : args[at + 1];
}

function mountOf(args, target, mode) {
  const suffix = `:${target}:${mode}`;
  const spec = args.find((arg) => arg.endsWith(suffix));
  return spec.slice(0, spec.length - suffix.length);
}

function samplesText(samples) {
  return samples
    .map((ms) => `time="2026-11-03T00:00:00Z" level=warning msg="LB_SAMPLE ${ms}" source=console`)
    .join('\n');
}

function fakeDocker(fs, options) {
  const state = {
    containers: new Set(options.staleContainers ?? []),
    networks: new Set(),
    calls: [],
    k6Runs: 0,
    planModes: [],
  };
  const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
  const fail = (stderr, code = 1) => ({ code, stdout: '', stderr });

  return {
    state,
    async version() {
      state.calls.push(['version']);
      return options.version ?? ok('29.0.0');
    },
    async run(args) {
      state.calls.push(args);
      if (args[0] === 'network' && args[1] === 'create') {
        state.networks.add(args.at(-1));
        return ok();
      }
      if (args.includes('version') && args.includes('--rm')) {
        return ok('k6 v2.3.0 (go1.27.1, linux/amd64) with k6/x/sse');
      }
      if (args.includes('/work/in/journey.mjs')) {
        state.k6Runs += 1;
        const name = nameOf(args);
        state.containers.add(name);
        const inDir = mountOf(args, '/work/in', 'ro');
        state.planModes.push(fs.files.get(`${inDir}/plan.json`)?.mode);
        const answer = options.k6(state.k6Runs);
        if (answer.writeStep !== false) {
          const outDir = mountOf(args, '/work/out', 'rw');
          fs.files.set(`${outDir}/step.json`, {
            text: JSON.stringify({
              latencySamplesMs: [],
              errors: answer.errors,
              requests: answer.requests,
              iterations: answer.iterations,
              agentAssignedFrames: answer.agentAssignedFrames,
              meterBytes: answer.meterBytes,
              sinkBytes: answer.sinkBytes,
              windowSeconds: answer.windowSeconds,
            }),
            mode: 0o644,
          });
        }
        return { code: answer.code ?? 0, stdout: samplesText(answer.samples), stderr: '' };
      }
      const name = nameOf(args);
      if (name !== undefined) state.containers.add(name);
      if (name !== undefined && options.failRun?.has(name)) return fail(options.failRun.get(name));
      return ok(name ?? '');
    },
    async exec(name, args) {
      state.calls.push(['exec', name, ...args]);
      if (args.includes('psql')) return ok(String(options.rooms ?? 3));
      return ok();
    },
    async inspect(name) {
      state.calls.push(['inspect', name]);
      const restarted = options.restartAfterK6 === true && state.k6Runs > 0 && name.endsWith('-api');
      return {
        State: { Running: true, OOMKilled: false, StartedAt: restarted ? 'T1' : 'T0' },
        RestartCount: 0,
      };
    },
    async stats(name) {
      state.calls.push(['stats', name]);
      return [{ CPUPerc: '12.50%', MemUsage: '64MiB / 512MiB' }];
    },
    async build(spec) {
      state.calls.push(['build', spec.tag]);
      return options.failBuild?.(spec) ?? ok();
    },
    async list(label) {
      state.calls.push(['list', label]);
      return options.sweepFound ?? [];
    },
    async rm(name) {
      state.calls.push(['rm', name]);
      if (options.failRemove?.has(name)) return fail('device or resource busy');
      if (state.containers.has(name)) {
        state.containers.delete(name);
        return ok();
      }
      return fail(`Error response from daemon: No such container: ${name}`);
    },
    async networkRm(name) {
      state.calls.push(['networkRm', name]);
      if (state.networks.has(name)) {
        state.networks.delete(name);
        return ok();
      }
      return fail(`Error response from daemon: No such network: ${name}`);
    },
    async cp(from, to) {
      state.calls.push(['cp', from, to]);
      fs.files.set(to, { text: 'PUBLIC CA', mode: 0o644 });
      return ok();
    },
  };
}

/** A fake `fetch`: the provisioning routes with real Responses, and the API's health route. */
function fakeHttp({ throwOn = null } = {}) {
  const indexOf = new Map(ALL_PLAYERS.map((player, index) => [player.address, index]));
  const claimPolls = new Map();
  const calls = [];
  async function http(url, init = {}) {
    const parsed = new URL(url);
    calls.push({ hostname: parsed.hostname, pathname: parsed.pathname, method: init.method ?? 'GET' });
    if (throwOn === parsed.pathname) throw new Error('socket hang up');
    if (parsed.pathname === '/healthz') return new Response('{"status":"ok"}', { status: 200 });
    const index = indexOf.get(init.headers?.['X-Forwarded-For']);
    const json = (status, body, headers = {}) =>
      new Response(body === undefined ? '' : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      });
    if (parsed.pathname === '/v1/auth/test-login') {
      return json(
        200,
        {},
        { 'set-cookie': `__Host-d2rmm_session=${secretsOf(index).session}; Path=/; HttpOnly; Secure` },
      );
    }
    if (parsed.pathname === '/v1/agents/pairing-codes') {
      return json(201, { code: '123456', claimSecret: secretsOf(index).claimSecret });
    }
    if (parsed.pathname === '/v1/agents/pair') return json(200, {});
    if (parsed.pathname === '/v1/agents/pairing-codes/claim') {
      const polls = (claimPolls.get(index) ?? 0) + 1;
      claimPolls.set(index, polls);
      if (polls === 1) return json(202, { status: 'pending' });
      return json(200, { token: secretsOf(index).token });
    }
    return json(404, { error: 'not-found' });
  }
  return { http, calls };
}

function randomSource() {
  const issued = [];
  let counter = 0;
  return {
    issued,
    bytes(size) {
      counter += 1;
      const bytes = Uint8Array.from({ length: size }, (_, index) => (counter * 37 + index * 11) % 256);
      issued.push(bytes);
      return bytes;
    },
  };
}

const CLOCK = {
  iso: () => '2026-11-03T00:00:00.000Z',
  sleep: () => new Promise((resolve) => setImmediate(resolve)),
};

/** A run over fakes. `options` configure the docker fake, the http fake and the profile; the result carries the fakes. */
function scenario(options = {}) {
  const fs = fakeFs();
  const logs = [];
  const docker = fakeDocker(fs, {
    k6: options.k6 ?? PASSING_K6,
    failRemove: options.failRemove,
    failRun: options.failRun,
    failBuild: options.failBuild,
    sweepFound: options.sweepFound,
    staleContainers: options.staleContainers,
    version: options.version,
    rooms: options.rooms,
    restartAfterK6: options.restartAfterK6,
  });
  const httpFake = fakeHttp({ throwOn: options.throwOn });
  const random = randomSource();
  const scn = { fs, docker, logs, random, httpFake, cleanup: null };
  scn.input = {
    profile: options.profile ?? 'smoke',
    env: options.env ?? {},
    docker,
    http: httpFake.http,
    clock: CLOCK,
    fs,
    paths: { root: ROOT, loadDir: LOAD_DIR, tmpdir: TMP, commit: 'abc1234', uid: UID },
    random,
    randomInt: () => 3,
    log: (line) => logs.push(line),
    registerCleanup: (cleanup) => {
      scn.cleanup = cleanup;
    },
  };
  return scn;
}

/** What is still on the fakes after a run: containers, networks, and work directories of the run. */
function leftoversOf(scn) {
  const directories = [...scn.fs.dirs.keys()].filter((path) => path.startsWith(`${TMP}/d2rmm-load-`));
  return {
    containers: [...scn.docker.state.containers],
    networks: [...scn.docker.state.networks],
    directories,
  };
}

function assertClean(scn) {
  const leftovers = leftoversOf(scn);
  assert.deepEqual(
    leftovers,
    { containers: [], networks: [], directories: [] },
    'nothing of the run is left behind',
  );
}

test('sequence and cleanup on every exit path', { timeout: SLOW_TEST_MS }, async (t) => {
  await t.test('a passing smoke run writes the smoke summary and removes everything', async () => {
    const scn = scenario({ profile: 'smoke' });
    const result = await runLoad(scn.input);

    assert.equal(result.exitCode, 0);
    assert.equal(result.summary.passed, true);
    assert.equal(result.summary.profile, 'smoke');
    assert.equal(result.summary.steps.length, 1);
    assert.equal(result.summary.steps[0].players, 5);
    assert.equal(scn.fs.files.has(`${ROOT}/reports/load/smoke-summary.json`), true);
    assert.equal(
      scn.fs.files.has(`${ROOT}/reports/load/summary.json`),
      false,
      'the smoke run never writes summary.json',
    );
    assert.equal(scn.docker.state.planModes[0], 0o600, 'the plan is written at mode 0600');
    assertClean(scn);
  });

  await t.test(
    'the containers start in the order of the sequence and the images are built first',
    async () => {
      const scn = scenario({ profile: 'smoke' });
      await runLoad(scn.input);
      const builds = scn.docker.state.calls.filter((call) => call[0] === 'build').map((call) => call[1]);
      assert.deepEqual(builds, [API_IMAGE_TAG, K6_IMAGE_TAG]);
      const started = scn.docker.state.calls
        .filter((call) => Array.isArray(call) && call[0] === 'run' && call.includes('--name'))
        .map((call) => nameOf(call));
      assert.deepEqual(
        started,
        [NAME('postgres'), NAME('migrate'), NAME('sink'), NAME('api'), NAME('meter'), NAME('k6')],
        'Postgres, the migration, the sink, the API, the meter, then k6',
      );
      assert.deepEqual(
        scn.docker.state.calls.filter((call) => call[0] === 'cp').map((call) => call[1]),
        [`${NAME('postgres')}:/tls/ca.crt`],
        'only the public CA leaves the Postgres container',
      );
    },
  );

  await t.test('a failed step stops the run after it and names the step and the rule', async () => {
    const scn = scenario({
      profile: 'full',
      k6: (count) => (count === 2 ? { ...PASSING_K6(), errors: 60 } : PASSING_K6()),
    });
    const result = await runLoad(scn.input);

    assert.equal(result.exitCode, 1);
    assert.equal(result.summary.passed, false);
    assert.equal(result.summary.steps.length, 2, 'the 25 and the 50 step ran, nothing after the failure');
    assert.equal(scn.docker.state.k6Runs, 2);
    assert.deepEqual(result.summary.failure, { step: 50, rule: 'errors' });
    assert.equal(result.summary.maxConcurrentPlayers, 25);
    assertClean(scn);
  });

  await t.test('a restarted API fails the run with the container rule', async () => {
    const scn = scenario({ profile: 'smoke', restartAfterK6: true });
    const result = await runLoad(scn.input);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.summary.failure, { step: 5, rule: 'container' });
    assertClean(scn);
  });

  await t.test(
    'a signal during the k6 step runs the same cleanup and ends with an error summary',
    async () => {
      let scn = null;
      scn = scenario({
        profile: 'smoke',
        k6: () => {
          scn.cleanup();
          return { code: 137, writeStep: false, samples: [] };
        },
      });
      const result = await runLoad(scn.input);

      assert.equal(result.exitCode, 1);
      assert.equal(result.summary.passed, false);
      assert.match(result.summary.error, /k6 ended with status 137/u);
      assertClean(scn);
    },
  );

  await t.test(
    'an uncaught error from a port ends the run with an error summary and removes everything',
    async () => {
      const scn = scenario({ profile: 'smoke', throwOn: '/v1/agents/pairing-codes' });
      const result = await runLoad(scn.input);

      assert.equal(result.exitCode, 1);
      assert.equal(result.summary.passed, false);
      assert.match(result.summary.error, /socket hang up/u);
      assertClean(scn);
    },
  );

  await t.test('a failing removal leaves the exit code non-zero and names the leftover', async () => {
    const scn = scenario({ profile: 'smoke', failRemove: new Set([NAME('api')]) });
    const result = await runLoad(scn.input);

    assert.equal(result.exitCode, 1, 'a leftover makes the run fail');
    assert.deepEqual(result.leftBehind, [NAME('api')]);
    assert.ok(
      scn.logs.some((line) => line.includes(NAME('api'))),
      'the leftover is named in the log',
    );
    assert.deepEqual(
      leftoversOf(scn).containers,
      [NAME('api')],
      'the failed removal stays visible to the maintainer',
    );
  });

  await t.test('a labelled stale resource of an earlier run is swept before the new run starts', async () => {
    const stale = 'd2rmm-load-zzzzzzzz-api';
    const staleDirectory = `${TMP}/d2rmm-load-zzzzzzzz-AbCdef`;
    const scn = scenario({
      profile: 'smoke',
      staleContainers: [stale],
      sweepFound: [{ kind: 'container', name: stale, labels: { 'd2rmm-load': 'zzzzzzzz' } }],
    });
    scn.fs.dirs.set(staleDirectory, { mode: 0o700 });
    const result = await runLoad(scn.input);

    assert.equal(result.exitCode, 0);
    assert.ok(scn.logs.some((line) => line.includes(`swept a stale container: ${stale}`)));
    assert.equal(scn.fs.dirs.has(staleDirectory), false, 'the stale work directory is removed');
  });

  await t.test('a missing Docker is refused with exit 2 before any container', async () => {
    const scn = scenario({ version: { code: 127, stdout: '', stderr: 'spawn docker ENOENT' } });
    const result = await runLoad(scn.input);

    assert.equal(result.exitCode, 2);
    assert.equal(result.summary, null);
    assert.match(result.refusal, /Docker is not installed/u);
    assert.deepEqual(scn.docker.state.containers.size, 0);
    assert.equal(scn.fs.files.size, 0, 'no file is written');
  });

  await t.test('an image that cannot be built is refused with exit 2 and names the image', async () => {
    const scn = scenario({
      failBuild: (spec) =>
        spec.tag === API_IMAGE_TAG ? { code: 1, stdout: '', stderr: 'pull access denied for node' } : null,
    });
    const result = await runLoad(scn.input);

    assert.equal(result.exitCode, 2);
    assert.match(result.refusal, new RegExp(API_IMAGE_TAG.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    assert.equal(scn.docker.state.k6Runs, 0);
    assert.equal(
      scn.docker.state.calls.some((call) => call[0] === 'run'),
      false,
      'no container starts',
    );
  });

  await t.test('a target variable is refused with exit 2 before any Docker call', async () => {
    const scn = scenario({ env: { LOAD_TARGET: 'http://127.0.0.1:8787' } });
    const result = await runLoad(scn.input);

    assert.equal(result.exitCode, 2);
    assert.match(result.refusal, /LOAD_TARGET/u);
    assert.equal(scn.docker.state.calls.length, 0, 'the guard refuses before the first Docker call');
  });
});

test('no secret in arguments or logs', { timeout: SLOW_TEST_MS }, async () => {
  const scn = scenario({ profile: 'smoke' });
  const result = await runLoad(scn.input);
  assert.equal(result.exitCode, 0, 'the passing run is the one whose arguments and logs are checked');
  assert.ok(scn.random.issued.length >= 2, 'the password and the bearer were generated from random bytes');

  const password = secretOf(scn.random.issued[0]);
  const bearer = secretOf(scn.random.issued[1]);
  const secrets = [password, bearer];
  for (let index = 0; index < 400; index += 1) {
    const values = secretsOf(index);
    secrets.push(values.session, values.token, values.claimSecret);
  }

  const argumentText = scn.docker.state.calls.map((call) => JSON.stringify(call)).join('\n');
  const logText = scn.logs.join('\n');
  const summaryText = JSON.stringify(result.summary);
  for (const secret of secrets) {
    assert.equal(argumentText.includes(secret), false, 'no secret in a docker argument');
    assert.equal(logText.includes(secret), false, 'no secret in a log line');
    assert.equal(summaryText.includes(secret), false, 'no secret in the summary');
  }
  assert.ok(logText.length > 0, 'the run logs its progress');
});

test('LB_SAMPLE lines are the latency samples of a step', () => {
  assert.deepEqual(
    samplesOf(
      [
        'time="x" level=warning msg="LB_SAMPLE 412.5" source=console',
        'time="x" level=info msg="something else" source=console',
        'time="x" level=warning msg="LB_SAMPLE 2001" source=console',
      ].join('\n'),
    ),
    [412.5, 2001],
  );
});
