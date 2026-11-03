// The entry of the load run (design.md § Orchestrator and § Work directory and credentials; LB-17, LB-18, LB-19). It
// reads LOAD_PROFILE (`full` or `smoke`), refuses a target or a Docker variable before anything else, takes the lock
// directory, and runs the sequence of orchestrate.mjs over the real adapters: the `docker` CLI through `spawn` with an
// argument array and `shell: false`, node:fs, global fetch and the clock. The signal and error handlers call the same
// idempotent cleanup the sequence registers. Exit codes: the summary's (0 or 1), 2 for a refusal, 130/143/129 for a signal.
//
// `node scripts/load/run.mjs` is the entry; `pnpm test:load` and `pnpm test:load:smoke` set LOAD_PROFILE.

import { spawn } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { profileFor } from './lib/profile.mjs';
import { guardDocker, guardTarget } from './lib/target-guard.mjs';
import { runLoad } from './orchestrate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const LOCK_NAME = 'd2rmm-load.lock';
const LABEL_KEY = 'd2rmm-load';

/**
 * One `docker` call with an argument array and no shell. Resolves with the exit code and both streams, never rejects: a
 * missing binary resolves with code 127 and the spawn error as its stderr, which the preflight classifies.
 * @param {string[]} args
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function runDocker(args) {
  return new Promise((resolve) => {
    const child = spawn('docker', args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => resolve({ code: 127, stdout, stderr: String(error) }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function linesOf(text) {
  return String(text)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** `k1=v1,k2=v2` as an object; the values are never secrets (the run id only). */
function labelsOf(text) {
  const labels = {};
  for (const pair of String(text).split(',')) {
    const at = pair.indexOf('=');
    if (at > 0) labels[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return labels;
}

/** The labelled containers, networks and volumes of every run, for the sweep (design.md § Orchestrator). */
async function listLabelled() {
  const containers = await runDocker([
    'ps',
    '-a',
    '--filter',
    `label=${LABEL_KEY}`,
    '--format',
    '{{.Names}}\t{{.Labels}}',
  ]);
  const networks = await runDocker([
    'network',
    'ls',
    '--filter',
    `label=${LABEL_KEY}`,
    '--format',
    '{{.Name}}\t{{.Labels}}',
  ]);
  const volumes = await runDocker([
    'volume',
    'ls',
    '--filter',
    `label=${LABEL_KEY}`,
    '--format',
    '{{.Name}}\t{{.Labels}}',
  ]);
  if (containers.code !== 0 || networks.code !== 0 || volumes.code !== 0) {
    throw new Error('docker could not list the labelled resources');
  }
  const found = [];
  for (const line of linesOf(containers.stdout)) {
    const [name, labels = ''] = line.split('\t');
    found.push({ kind: 'container', name, labels: labelsOf(labels) });
  }
  for (const line of linesOf(networks.stdout)) {
    const [name, labels = ''] = line.split('\t');
    found.push({ kind: 'network', name, labels: labelsOf(labels) });
  }
  for (const line of linesOf(volumes.stdout)) {
    const [name, labels = ''] = line.split('\t');
    found.push({ kind: 'volume', name, labels: labelsOf(labels) });
  }
  return found;
}

/** The Docker port of the sequence (orchestrate.mjs). Every method returns a result object, except `inspect` and `stats`. */
export const dockerPort = {
  version: () => runDocker(['version', '--format', '{{.Server.Version}}']),
  run: (args) => runDocker(args),
  exec: (name, args) => runDocker(['exec', name, ...args]),
  async inspect(name) {
    const result = await runDocker(['inspect', name]);
    if (result.code !== 0) throw new Error(`docker inspect of ${name} failed`);
    const [first] = JSON.parse(result.stdout);
    if (first === undefined) throw new Error(`docker inspect of ${name} returned nothing`);
    return first;
  },
  async stats(name) {
    const result = await runDocker(['stats', '--no-stream', '--format', '{{json .}}', name]);
    if (result.code !== 0) throw new Error(`docker stats of ${name} failed`);
    return linesOf(result.stdout).map((line) => JSON.parse(line));
  },
  build: ({ file, context, tag }) => runDocker(['build', '-f', file, '-t', tag, context]),
  list: () => listLabelled(),
  rm: (name) => runDocker(['rm', '-f', name]),
  networkRm: (name) => runDocker(['network', 'rm', name]),
  volumeRm: (name) => runDocker(['volume', 'rm', name]),
  cp: (from, to) => runDocker(['cp', from, to]),
};

function commitOf(root) {
  return new Promise((resolve) => {
    const child = spawn('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], {
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('error', () => resolve('unknown'));
    child.on('close', (code) => resolve(code === 0 && stdout.trim() !== '' ? stdout.trim() : 'unknown'));
  });
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

/**
 * Takes the lock directory (one run at a time). A lock whose pid is gone is stale and is taken over; a live holder is
 * refused. Returns null when the lock is ours, or the pid of the live holder.
 */
async function acquireLock(lockDir) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await fs.mkdir(lockDir, { mode: 0o700 });
      await fs.writeFile(join(lockDir, 'pid'), `${process.pid}\n`, { mode: 0o600 });
      return null;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    const text = await fs.readFile(join(lockDir, 'pid'), 'utf8').catch(() => '');
    const holder = Number.parseInt(text, 10);
    if (Number.isInteger(holder) && holder > 0 && processAlive(holder)) return holder;
    await fs.rm(lockDir, { recursive: true, force: true });
  }
  return -1;
}

async function releaseLock(lockDir) {
  await fs.rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
}

function profileNameOf(text) {
  if (text === 'full' || text === 'smoke') return text;
  throw new Error('LOAD_PROFILE must be full or smoke: the load run takes one of the two profiles');
}

/** The run: guards, the lock, the sequence, the exit code. Refusals exit 2 before any container exists. */
async function main() {
  const env = process.env;
  const say = (line) => console.error(line);

  const refusal = guardTarget(env) ?? guardDocker(env);
  if (refusal !== null) {
    say(refusal.message);
    process.exitCode = 2;
    return;
  }
  let profile;
  try {
    profile = profileNameOf(env.LOAD_PROFILE);
    profileFor(profile);
  } catch (error) {
    say(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }

  const tmpdir = os.tmpdir();
  const lockDir = join(tmpdir, LOCK_NAME);
  const holder = await acquireLock(lockDir);
  if (holder !== null) {
    say(
      holder > 0
        ? `another load run is active (pid ${holder}): wait for it to finish, then run again`
        : 'the load lock could not be taken: remove the lock directory by hand if no run is active',
    );
    process.exitCode = 2;
    return;
  }

  let cleanupRef = null;
  let stopping = false;
  const stopOn = (signal, code) => {
    if (stopping) return;
    stopping = true;
    say(`stopping on ${signal}: removing the run's containers, network and work directory`);
    Promise.resolve(cleanupRef?.())
      .catch(() => undefined)
      .then(() => releaseLock(lockDir))
      .finally(() => process.exit(code));
  };
  process.on('SIGINT', () => stopOn('SIGINT', 130));
  process.on('SIGTERM', () => stopOn('SIGTERM', 143));
  process.on('SIGHUP', () => stopOn('SIGHUP', 129));
  process.on('uncaughtException', (error) => {
    say(`an uncaught error stopped the run: ${error instanceof Error ? error.message : String(error)}`);
    stopOn('uncaughtException', 1);
  });
  process.on('unhandledRejection', (reason) => {
    say(
      `an unhandled rejection stopped the run: ${reason instanceof Error ? reason.message : String(reason)}`,
    );
    stopOn('unhandledRejection', 1);
  });

  try {
    const result = await runLoad({
      profile,
      env,
      docker: dockerPort,
      http: (url, init) => fetch(url, init),
      clock: {
        iso: () => new Date().toISOString(),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      },
      fs,
      paths: { root: ROOT, loadDir: HERE, tmpdir, commit: await commitOf(ROOT), uid: process.getuid() },
      random: { bytes: (size) => randomBytes(size) },
      randomInt: (max) => randomInt(max),
      log: say,
      registerCleanup: (cleanup) => {
        cleanupRef = cleanup;
      },
    });
    if (result.refusal !== undefined) {
      say(result.refusal);
      process.exitCode = 2;
    } else {
      process.exitCode = result.exitCode;
    }
  } finally {
    await releaseLock(lockDir);
  }
}

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  await main();
}
