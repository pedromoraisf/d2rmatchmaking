// The sequence of a load run over injected ports (design.md § Orchestrator, § Work directory and credentials, § Error
// Handling Strategy; LB-07, LB-08, LB-10 to LB-12, LB-19). Every effect goes through a port: `docker` (the CLI, with
// argument arrays only), `http` (fetch), `clock`, `fs` (node:fs/promises), `random` (crypto bytes), `randomInt`, `log`.
// The decisions are the pure rules of `lib/`: guards, profile, verdict, error ratio, percentile, container health,
// summary and writer. Nothing here reads the process environment except the `env` object it is given.
//
// The run's order: guards and the Docker preflight (refusals, exit 2); a sweep of stale run resources; the images; the
// work directory with its 0600 secret files; the network; Postgres with TLS (the public CA copied out); the migration; the
// sink; the API; the meter; then each step: provision the players it adds, write the plan, run one k6 container, read the
// step file, the rooms, `docker inspect` and `docker stats`, apply the verdict, and stop after a failed step. The summary is
// built and written whole; the cleanup runs in `finally` and on the handlers of run.mjs (the same idempotent function).

import { join } from 'node:path';
import { cleanupPlan, sweepPlan } from './lib/cleanup-plan.mjs';
import { containerOk, peakOf } from './lib/container-health.mjs';
import {
  apiArgs,
  apiEnvironment,
  certificateArgs,
  containerNameOf,
  DATABASE_NAME,
  databaseUrlOf,
  envFileText,
  k6Args,
  labelOf,
  limitsFrom,
  meterArgs,
  METER_CONTROL_PORT,
  METER_PORT,
  migrateArgs,
  networkArgs,
  networkNameOf,
  postgresArgs,
  publicCaProblemOf,
  sinkArgs,
  SINK_CONTROL_PORT,
  volumeArgs,
  volumeNameOf,
} from './lib/container-spec.mjs';
import { errorRatio } from './lib/error-ratio.mjs';
import {
  API_IMAGE_TAG,
  K6_IMAGE_TAG,
  NODE_ALPINE_IMAGE,
  OPENSSL_IMAGE,
  POSTGRES_IMAGE,
} from './lib/images.mjs';
import { classifyDockerFailure } from './lib/preflight.mjs';
import { nextStep, profileFor } from './lib/profile.mjs';
import { p95 } from './lib/percentile.mjs';
import { playerFor, runIdFrom } from './lib/players.mjs';
import { redact } from './lib/redact.mjs';
import { buildSummary, exitCodeOf } from './lib/summary.mjs';
import { verdictOf } from './lib/step-verdict.mjs';
import { guardDocker, guardTarget } from './lib/target-guard.mjs';
import { writeSummary } from './lib/write-summary.mjs';
import { provision } from './provision.mjs';

/** The agent version the provisioner and the journey report (at least the minimum the API sets, AD-045). */
export const AGENT_VERSION = '0.1.0';
/** Every journey player requests a test match this often (design.md § k6 journey). */
export const MATCH_EVERY_SECONDS = 60;
/** The port the API listens on inside the sink's network namespace. */
export const API_PORT = 3000;
/** The origin of the site as the API sees it: the meter's published port, which the provisioner and the journey use. */
export const SITE_ORIGIN = `http://127.0.0.1:${METER_PORT}`;
/** The base of the provisioning requests: the meter's published port on loopback. */
export const PROVISION_BASE = `http://127.0.0.1:${METER_PORT}`;
/** The SSE extension the k6 image is built with (k6.Dockerfile, pinned by commit). */
export const SSE_EXTENSION = 'xk6-sse v0.2.0';
/** The constant query that counts the rooms in `created` at the end of a step (design.md § Integration Points). */
export const ROOMS_QUERY = "select count(*) from lobby.rooms where stage = 'created'";

const LABEL_KEY = 'd2rmm-load';
const SAMPLE_INTERVAL_MS = 5000;
const READY_TRIES = 90;
const READY_INTERVAL_MS = 1000;
const SECRET_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const STEP_COUNTERS = [
  'errors',
  'requests',
  'iterations',
  'agentAssignedFrames',
  'meterBytes',
  'sinkBytes',
  'windowSeconds',
];
const SAMPLE_LINE = /msg="LB_SAMPLE ([0-9][0-9.eE+-]*)"/gu;

/** A failure of a tool the run uses (Docker, a file, a container answer). The message never carries a secret. */
export class ToolError extends Error {
  constructor(message) {
    super(redact(message));
    this.name = 'ToolError';
  }
}

/** A refusal during the preflight or a build: nothing was started, so the run exits 2 and writes no summary. */
class Refusal extends Error {
  constructor(message) {
    super(redact(message));
    this.name = 'Refusal';
  }
}

/**
 * A secret of the run from random bytes: letters and digits only, one character per byte. The Postgres password needs
 * sixteen or more letters and digits; the control bearer needs sixteen or more printable characters.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function secretOf(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    throw new TypeError('a secret needs random bytes');
  }
  return Array.from(bytes, (byte) => SECRET_ALPHABET[byte % SECRET_ALPHABET.length]).join('');
}

/**
 * The latency samples of a step, read from the lines k6 prints for each windowed iteration (`LB_SAMPLE <ms>`). The
 * lines come from the container's output; handleSummary cannot see the values, so this is the only channel.
 * @param {string} text the stdout and stderr of the k6 container
 * @returns {number[]}
 */
export function samplesOf(text) {
  return [...String(text).matchAll(SAMPLE_LINE)].map((match) => Number(match[1]));
}

/**
 * Runs one load (profile `full` or `smoke`) over the given ports.
 * @param {{
 *   profile: 'full' | 'smoke',
 *   env: Record<string, string | undefined>,
 *   docker: object,
 *   http: (url: string, init?: object) => Promise<Response>,
 *   clock: { iso: () => string, sleep: (ms: number) => Promise<void> },
 *   fs: object,
 *   paths: { root: string, loadDir: string, tmpdir: string, commit: string, uid: number },
 *   random: { bytes: (size: number) => Uint8Array },
 *   randomInt: (max: number) => number,
 *   log?: (line: string) => void,
 *   registerCleanup?: (cleanup: () => Promise<string[]>) => void,
 * }} input
 * @returns {Promise<{ summary: object | null, exitCode: number, leftBehind: string[], refusal?: string }>}
 */
export async function runLoad(input) {
  const { profile, env, docker, http, clock, fs, paths, random, randomInt, registerCleanup } = input;
  const log = (line) => (input.log ?? (() => {}))(redact(String(line)));

  let limits;
  try {
    profileFor(profile);
    const refusal = guardTarget(env) ?? guardDocker(env);
    if (refusal !== null) return refused(refusal.message);
    limits = limitsFrom(env);
  } catch (error) {
    return refused(messageOf(error));
  }

  const runId = runIdFrom(randomInt);
  const ctx = {
    profile,
    env,
    docker,
    http,
    clock,
    fs,
    paths,
    random,
    log,
    runId,
    limits,
    names: namesOf(runId),
    created: { containers: [], network: null, volume: null, workDir: null },
    state: { stopping: false },
    rows: [],
    dirs: null,
    bearer: null,
    password: null,
  };
  const cleanup = makeCleanup(ctx);
  registerCleanup?.(cleanup);

  const startedAt = clock.iso();
  let versions = null;
  let error = null;
  let refusalMessage = null;
  let leftBehind = [];
  try {
    const version = await docker.version();
    if (version.code !== 0) {
      throw new Refusal(classifyDockerFailure({ message: 'docker version', stderr: version.stderr }).message);
    }
    await sweep(ctx);
    await buildImages(ctx);
    await prepareWorkDir(ctx);
    await startServices(ctx);
    versions = await probeVersions(ctx);
    await runSteps(ctx);
  } catch (caught) {
    if (caught instanceof Refusal) refusalMessage = caught.message;
    else error = messageOf(caught);
  } finally {
    leftBehind = await cleanup();
  }
  if (refusalMessage !== null) return refused(refusalMessage);

  const endedAt = clock.iso();
  const summary = summaryOf({
    profile,
    rows: ctx.rows,
    limits,
    versions: versions ?? unmeasuredVersions(),
    commit: paths.commit,
    startedAt,
    endedAt,
    error,
  });
  let writeFailed = false;
  try {
    const reportsDir = join(paths.root, 'reports', 'load');
    await fs.mkdir(reportsDir, { recursive: true });
    const target = await writeSummary(fs, reportsDir, summary);
    log(`summary written to ${target}`);
  } catch (caught) {
    writeFailed = true;
    log(`the summary could not be written: ${messageOf(caught)}`);
  }

  let exitCode = writeFailed ? 1 : exitCodeOf(summary);
  if (leftBehind.length > 0) exitCode = 1;
  return { summary, exitCode, leftBehind };
}

function refused(message) {
  return { summary: null, exitCode: 2, leftBehind: [], refusal: redact(message) };
}

function messageOf(error) {
  return redact(error instanceof Error ? error.message : String(error));
}

function namesOf(runId) {
  return {
    network: networkNameOf(runId),
    volume: volumeNameOf(runId),
    cert: containerNameOf(runId, 'cert'),
    postgres: containerNameOf(runId, 'postgres'),
    migrate: containerNameOf(runId, 'migrate'),
    sink: containerNameOf(runId, 'sink'),
    api: containerNameOf(runId, 'api'),
    meter: containerNameOf(runId, 'meter'),
    k6: containerNameOf(runId, 'k6'),
  };
}

function unmeasuredVersions() {
  return {
    k6: 'not measured',
    sseExtension: SSE_EXTENSION,
    node: NODE_ALPINE_IMAGE.split('@')[0],
    postgres: POSTGRES_IMAGE.split('@')[0],
    openssl: OPENSSL_IMAGE.split('@')[0],
    apiImage: API_IMAGE_TAG,
  };
}

function summaryOf({ profile, rows, limits, versions, commit, startedAt, endedAt, error }) {
  const input = { profile, limits, versions, commit, times: { startedAt, endedAt } };
  try {
    return buildSummary({ ...input, steps: rows, error });
  } catch (caught) {
    const text = [error, messageOf(caught)].filter((part) => part !== null).join('; ');
    return buildSummary({ ...input, steps: [], error: text });
  }
}

/**
 * The cleanup of the run. It removes the containers in reverse start order, the network and the work directory; every
 * removal is tried even when an earlier one fails; a repeated call while it runs returns the same promise, and after it
 * ends it returns the same result. Once it has started nothing new is created (`state.stopping`).
 */
function makeCleanup(ctx) {
  const { docker, fs, log, created, state } = ctx;
  const leftBehind = [];
  let running = null;

  async function removeAll() {
    const plan = cleanupPlan(created);
    for (const name of plan.containers) {
      const result = await settle(() => docker.rm(name));
      if (!gone(result)) {
        leftBehind.push(name);
        log(`left behind, remove by name: ${name}`);
      }
    }
    for (const name of plan.networks) {
      const result = await settle(() => docker.networkRm(name));
      if (!gone(result)) {
        leftBehind.push(name);
        log(`left behind, remove by name: ${name}`);
      }
    }
    for (const name of plan.volumes) {
      const result = await settle(() => docker.volumeRm(name));
      if (!gone(result)) {
        leftBehind.push(name);
        log(`left behind, remove by name: ${name}`);
      }
    }
    for (const directory of plan.directories) {
      try {
        await fs.rm(directory, { recursive: true, force: true });
      } catch {
        leftBehind.push(directory);
        log(`left behind, remove by hand: ${directory}`);
      }
    }
    return leftBehind;
  }

  return () => {
    state.stopping = true;
    if (running === null) running = removeAll();
    return running;
  };
}

async function settle(action) {
  try {
    return await action();
  } catch (error) {
    return { code: 1, stderr: messageOf(error) };
  }
}

function gone(result) {
  return result?.code === 0 || /No such (container|network|volume)/iu.test(String(result?.stderr ?? ''));
}

function ensureRunning(ctx) {
  if (ctx.state.stopping) throw new ToolError('the run is stopping: nothing new is started');
}

/** One Docker call that must succeed; a failure is named by the classified text (Docker, or the image). */
async function dockerRun(ctx, args, what, image) {
  ensureRunning(ctx);
  const result = await ctx.docker.run(args);
  checked(result, what, image);
  return result;
}

function checked(result, what, image) {
  if (result.code !== 0) {
    const classified = classifyDockerFailure({ message: what, stderr: result.stderr, image });
    throw new ToolError(`${what}: ${classified.message}`);
  }
  return result;
}

async function sweep(ctx) {
  const { docker, fs, paths, log } = ctx;
  const labelled = await docker.list(LABEL_KEY);
  if (!Array.isArray(labelled)) throw new ToolError('listing the labelled Docker resources failed');
  const directories = await listRunDirectories(fs, paths.tmpdir);
  const plan = sweepPlan([...labelled, ...directories], { uid: paths.uid });
  for (const name of plan.containers) {
    const result = await settle(() => docker.rm(name));
    log(gone(result) ? `swept a stale container: ${name}` : `could not sweep the container: ${name}`);
  }
  for (const name of plan.networks) {
    const result = await settle(() => docker.networkRm(name));
    log(gone(result) ? `swept a stale network: ${name}` : `could not sweep the network: ${name}`);
  }
  for (const name of plan.volumes) {
    const result = await settle(() => docker.volumeRm(name));
    log(gone(result) ? `swept a stale volume: ${name}` : `could not sweep the volume: ${name}`);
  }
  for (const directory of plan.directories) {
    try {
      await fs.rm(directory, { recursive: true, force: true });
      log(`swept a stale work directory: ${directory}`);
    } catch {
      log(`could not sweep the work directory: ${directory}`);
    }
  }
}

async function listRunDirectories(fs, tmpdir) {
  let names;
  try {
    names = await fs.readdir(tmpdir);
  } catch {
    return [];
  }
  const found = [];
  for (const name of names) {
    if (!name.startsWith('d2rmm-load-')) continue;
    const path = join(tmpdir, name);
    try {
      const info = await fs.lstat(path);
      found.push({
        kind: 'directory',
        name: path,
        uid: info.uid,
        mode: info.mode,
        symlink: typeof info.isSymbolicLink === 'function' ? info.isSymbolicLink() : false,
      });
    } catch {
      // A directory that vanished between the listing and the lstat is not ours to remove.
    }
  }
  return found;
}

async function buildImages(ctx) {
  const { docker, paths, log } = ctx;
  log(`building the API image ${API_IMAGE_TAG}`);
  const api = await docker.build({
    file: join(paths.loadDir, 'docker', 'api.Dockerfile'),
    context: paths.root,
    tag: API_IMAGE_TAG,
  });
  if (api.code !== 0) {
    throw new Refusal(
      classifyDockerFailure({ message: 'the API image', stderr: api.stderr, image: API_IMAGE_TAG }).message,
    );
  }
  log(`building the k6 image ${K6_IMAGE_TAG}`);
  const k6 = await docker.build({
    file: join(paths.loadDir, 'docker', 'k6.Dockerfile'),
    context: join(paths.loadDir, 'docker'),
    tag: K6_IMAGE_TAG,
  });
  if (k6.code !== 0) {
    throw new Refusal(
      classifyDockerFailure({ message: 'the k6 image', stderr: k6.stderr, image: K6_IMAGE_TAG }).message,
    );
  }
}

async function writeSecret(fs, path, text) {
  await fs.writeFile(path, text, { mode: 0o600 });
  await fs.chmod(path, 0o600);
}

/** The work directory (0700) with `in/` (the plan, the journey, 0600) and `out/` (the step file), and the 0600 secrets. */
async function prepareWorkDir(ctx) {
  const { fs, paths, runId, random, created } = ctx;
  const workDir = await fs.mkdtemp(join(paths.tmpdir, `d2rmm-load-${runId}-`));
  created.workDir = workDir;
  await fs.chmod(workDir, 0o700);
  const dirs = {
    workDir,
    inDir: join(workDir, 'in'),
    outDir: join(workDir, 'out'),
    tokenFile: join(workDir, 'control-token'),
    postgresEnv: join(workDir, 'postgres.env'),
    apiEnv: join(workDir, 'api.env'),
    ca: join(workDir, 'ca.crt'),
  };
  await fs.mkdir(dirs.inDir, { mode: 0o700 });
  await fs.chmod(dirs.inDir, 0o700);
  // The k6 container runs as its own user and writes step.json here, so the directory is writable inside the 0700 work
  // directory; nothing outside the run can reach it.
  await fs.mkdir(dirs.outDir, { mode: 0o777 });
  await fs.chmod(dirs.outDir, 0o777);
  ctx.dirs = dirs;

  // The k6 script and the state machine it imports, next to the plan, read-only in the container.
  await fs.copyFile(join(paths.loadDir, 'k6', 'journey.mjs'), join(dirs.inDir, 'journey.mjs'));
  await fs.chmod(join(dirs.inDir, 'journey.mjs'), 0o600);
  await fs.copyFile(join(paths.loadDir, 'lib', 'journey-state.mjs'), join(dirs.inDir, 'journey-state.mjs'));
  await fs.chmod(join(dirs.inDir, 'journey-state.mjs'), 0o600);

  ctx.password = secretOf(random.bytes(24));
  ctx.bearer = secretOf(random.bytes(32));
  await writeSecret(fs, dirs.tokenFile, `${ctx.bearer}\n`);
  await writeSecret(fs, dirs.postgresEnv, envFileText({ POSTGRES_PASSWORD: ctx.password }));
  await writeSecret(
    fs,
    dirs.apiEnv,
    envFileText({ DATABASE_URL: databaseUrlOf({ runId, password: ctx.password }) }),
  );
}

async function probeOk(probe) {
  try {
    return await probe();
  } catch {
    return false;
  }
}

async function waitUntil(ctx, what, probe) {
  for (let attempt = 1; attempt <= READY_TRIES; attempt += 1) {
    ensureRunning(ctx);
    if (await probeOk(probe)) return;
    await ctx.clock.sleep(READY_INTERVAL_MS);
  }
  throw new ToolError(`${what} did not answer in time`);
}

function pushContainer(ctx, name) {
  ctx.created.containers.push(name);
}

/** Removes one container of the run now; a removal that succeeds is no longer left for the cleanup. */
async function dropContainer(ctx, name) {
  const result = await settle(() => ctx.docker.rm(name));
  if (gone(result)) {
    ctx.created.containers = ctx.created.containers.filter((created) => created !== name);
  }
}

/** The run's TLS volume. Its name carries the run id, so a volume that already exists is a failure, never reused. */
async function createVolume(ctx) {
  ensureRunning(ctx);
  const result = await ctx.docker.run(volumeArgs(ctx.runId));
  if (result.code !== 0 && /already exists/iu.test(String(result.stderr ?? ''))) {
    throw new ToolError(
      `the TLS volume ${ctx.names.volume} already exists: the run id names it and it is never reused`,
    );
  }
  checked(result, 'creating the TLS volume');
  ctx.created.volume = ctx.names.volume;
}

/**
 * The throwaway TLS material (AD-120): the certificate container makes the CA and the server certificate into the volume.
 * The public CA is copied out of the stopped container, checked to be one certificate block, made readable (0644 inside
 * the 0700 work directory), and the container is removed. The private key never leaves the volume.
 */
async function makeCertificate(ctx) {
  const { docker, names, dirs, fs } = ctx;
  pushContainer(ctx, names.cert);
  await dockerRun(ctx, certificateArgs({ runId: ctx.runId }), 'making the TLS certificate', OPENSSL_IMAGE);
  checked(await docker.cp(`${names.cert}:/tls/ca.crt`, dirs.ca), 'copying the public CA');
  const info = await fs.lstat(dirs.ca);
  if (!info.isFile()) throw new ToolError('the copied public CA is not a regular file');
  const problem = publicCaProblemOf(await fs.readFile(dirs.ca, 'utf8'));
  if (problem !== null) throw new ToolError(problem);
  await fs.chmod(dirs.ca, 0o644);
  await dropContainer(ctx, names.cert);
}

async function startServices(ctx) {
  const { docker, runId, names, dirs, limits, paths, created } = ctx;
  created.network = names.network;
  await dockerRun(ctx, networkArgs(runId), 'creating the network');
  await createVolume(ctx);
  await makeCertificate(ctx);

  pushContainer(ctx, names.postgres);
  await dockerRun(
    ctx,
    postgresArgs({ runId, image: POSTGRES_IMAGE, envFile: dirs.postgresEnv }),
    'starting Postgres',
    POSTGRES_IMAGE,
  );
  await waitUntil(ctx, 'Postgres', async () => {
    ensureRunning(ctx);
    return (
      (await docker.exec(names.postgres, ['pg_isready', '-h', '127.0.0.1', '-U', 'postgres'])).code === 0
    );
  });

  pushContainer(ctx, names.migrate);
  await dockerRun(
    ctx,
    migrateArgs({ runId, image: API_IMAGE_TAG, envFile: dirs.apiEnv, caFile: dirs.ca }),
    'migrating the database',
    API_IMAGE_TAG,
  );
  await dropContainer(ctx, names.migrate);

  pushContainer(ctx, names.sink);
  await dockerRun(
    ctx,
    sinkArgs({ runId, image: NODE_ALPINE_IMAGE, loadDir: paths.loadDir, tokenFile: dirs.tokenFile }),
    'starting the telemetry sink',
    NODE_ALPINE_IMAGE,
  );

  pushContainer(ctx, names.api);
  const environment = apiEnvironment({
    siteOrigin: SITE_ORIGIN,
    port: API_PORT,
    databaseUrl: databaseUrlOf({ runId, password: ctx.password }),
  });
  await dockerRun(
    ctx,
    apiArgs({ runId, image: API_IMAGE_TAG, environment, envFile: dirs.apiEnv, caFile: dirs.ca, limits }),
    'starting the API',
    API_IMAGE_TAG,
  );

  pushContainer(ctx, names.meter);
  await dockerRun(
    ctx,
    meterArgs({
      runId,
      image: NODE_ALPINE_IMAGE,
      loadDir: paths.loadDir,
      tokenFile: dirs.tokenFile,
      apiPort: API_PORT,
    }),
    'starting the byte meter',
    NODE_ALPINE_IMAGE,
  );
  await waitUntil(ctx, 'the API', async () => {
    const answer = await ctx.http(`${PROVISION_BASE}/healthz`, { method: 'GET' });
    return answer.status === 200;
  });
}

async function probeVersions(ctx) {
  const result = await dockerRun(
    ctx,
    ['run', '--rm', '--label', labelOf(ctx.runId), K6_IMAGE_TAG, 'version'],
    'reading the k6 version',
    K6_IMAGE_TAG,
  );
  const text = String(result.stdout ?? '');
  if (!/sse/u.test(text)) {
    throw new ToolError('the k6 image has no SSE extension');
  }
  return {
    k6: text.split('\n')[0].trim(),
    sseExtension: SSE_EXTENSION,
    node: NODE_ALPINE_IMAGE.split('@')[0],
    postgres: POSTGRES_IMAGE.split('@')[0],
    openssl: OPENSSL_IMAGE.split('@')[0],
    apiImage: API_IMAGE_TAG,
  };
}

async function runSteps(ctx) {
  let step = nextStep(ctx.profile, ctx.rows);
  let provisioned = [];
  while (step !== null) {
    const outcome = await runStep(ctx, step, provisioned);
    provisioned = outcome.players;
    ctx.rows.push(outcome.row);
    step = nextStep(ctx.profile, ctx.rows);
  }
}

async function writePlan(ctx, step, players) {
  const { fs, dirs, names } = ctx;
  const plan = {
    base: `http://${names.meter}:${METER_PORT}`,
    origin: SITE_ORIGIN,
    version: AGENT_VERSION,
    players: players.map(({ name, cookie, token, address }) => ({ name, cookie, token, address })),
    offsets: {
      rampSeconds: step.rampSeconds,
      windowStartSeconds: step.windowOffsets.start,
      windowEndSeconds: step.windowOffsets.end,
      holdSeconds: step.holdSeconds,
    },
    matchEverySeconds: MATCH_EVERY_SECONDS,
    control: {
      bearer: ctx.bearer,
      meter: { url: `http://${names.meter}:${METER_CONTROL_PORT}`, host: `127.0.0.1:${METER_CONTROL_PORT}` },
      sink: { url: `http://${names.sink}:${SINK_CONTROL_PORT}`, host: `127.0.0.1:${SINK_CONTROL_PORT}` },
    },
  };
  await writeSecret(fs, join(dirs.inDir, 'plan.json'), JSON.stringify(plan));
}

async function inspectOf(ctx, name) {
  try {
    return await ctx.docker.inspect(name);
  } catch (error) {
    throw new ToolError(`inspecting ${name} failed: ${messageOf(error)}`);
  }
}

/** Samples `docker stats` of the API until the flag clears; a missed sample is skipped, never fatal. */
async function sampleStats(ctx, name, samples, isSampling) {
  while (isSampling()) {
    try {
      samples.push(...(await ctx.docker.stats(name)));
    } catch {
      // A missed sample: the step still has the others, and none at all is refused below.
    }
    if (!isSampling()) break;
    await ctx.clock.sleep(SAMPLE_INTERVAL_MS);
  }
}

async function readStepFile(ctx) {
  let parsed;
  try {
    parsed = JSON.parse(await ctx.fs.readFile(join(ctx.dirs.outDir, 'step.json'), 'utf8'));
  } catch {
    throw new ToolError('the k6 step file is missing or is not JSON');
  }
  for (const key of STEP_COUNTERS) {
    if (typeof parsed?.[key] !== 'number' || !Number.isFinite(parsed[key])) {
      throw new ToolError(`the k6 step file lacks ${key}`);
    }
  }
  return parsed;
}

async function roomsCreated(ctx) {
  const result = await ctx.docker.exec(ctx.names.postgres, [
    'psql',
    '-U',
    'postgres',
    '-d',
    DATABASE_NAME,
    '-tAc',
    ROOMS_QUERY,
  ]);
  if (result.code !== 0) throw new ToolError('counting the rooms in created failed');
  const count = Number.parseInt(String(result.stdout ?? '').trim(), 10);
  if (!Number.isInteger(count) || count < 0)
    throw new ToolError('the count of rooms in created is not a number');
  return count;
}

/** One step: provision, plan, run k6, read, verdict. Returns the StepResult row and the players that now exist. */
async function runStep(ctx, step, provisioned) {
  const { docker, names, dirs, limits, runId, log, fs } = ctx;
  ensureRunning(ctx);
  const wanted = Array.from({ length: step.players }, (_, index) => playerFor(runId, index));
  const fresh = await provision({
    players: wanted.slice(provisioned.length),
    base: PROVISION_BASE,
    origin: SITE_ORIGIN,
    version: AGENT_VERSION,
    fetch: ctx.http,
  });
  const players = [...provisioned, ...fresh];
  log(`step ${step.players}: ${fresh.length} players provisioned, ${players.length} in the step`);

  await writePlan(ctx, step, players);
  await fs.rm(join(dirs.outDir, 'step.json'), { force: true });
  const before = await inspectOf(ctx, names.api);

  const samples = [];
  let sampling = true;
  const sampler = sampleStats(ctx, names.api, samples, () => sampling);
  pushContainer(ctx, names.k6);
  let k6;
  try {
    ensureRunning(ctx);
    k6 = await docker.run(
      k6Args({ runId, image: K6_IMAGE_TAG, inDir: dirs.inDir, outDir: dirs.outDir, limits }),
    );
  } finally {
    sampling = false;
    await sampler;
    await dropContainer(ctx, names.k6);
  }
  const after = await inspectOf(ctx, names.api);
  if (k6.code !== 0) throw new ToolError(`k6 ended with status ${k6.code}`);

  const measured = await readStepFile(ctx);
  const latencySamplesMs = samplesOf(`${String(k6.stdout ?? '')}\n${String(k6.stderr ?? '')}`);
  if (samples.length === 0) throw new ToolError('no docker stats sample of the API');
  const rooms = await roomsCreated(ctx);

  const healthy = containerOk(before, after);
  const ratio = errorRatio({
    errors: measured.errors,
    requests: measured.requests,
    iterations: measured.iterations,
  });
  const latency = p95(latencySamplesMs);
  const verdict = verdictOf({ containerOk: healthy, errorRatio: ratio, p95Ms: latency });
  const peaks = peakOf(samples);
  const row = {
    players: step.players,
    latencyP95Ms: latency,
    latencyCount: latencySamplesMs.length,
    errors: measured.errors,
    requests: measured.requests,
    iterations: measured.iterations,
    errorRatio: ratio,
    bytesReceived: measured.meterBytes,
    telemetryBytes: measured.sinkBytes,
    windowSeconds: measured.windowSeconds,
    peakCpuPercent: peaks.peakCpuPercent,
    peakMemoryBytes: peaks.peakMemoryBytes,
    roomsCreated: rooms,
    containerOk: healthy,
    passed: verdict.passed,
    failedRule: verdict.failedRule,
  };
  log(`step ${step.players}: ${verdict.passed ? 'passed' : `failed the ${verdict.failedRule} rule`}`);
  return { row, players };
}
