#!/usr/bin/env node
// Proof preflight (fast-proofs, FPR-01 to FPR-06). It runs a feature's `## Checks` proofs in file order and records each
// green one under a key: the command, plus the path and content of every file the branch changes against phase/<F>
// (committed, staged, unstaged or untracked). A later run reruns only the proofs whose key is new or whose last run
// failed. The official check_proofs.py stays the once-per-feature run.
//
//   node scripts/proofs-preflight.mjs <feature>      (from the repository root)
//
// Exit codes: 0 every proof is green (ran or cached); 1 a proof failed (its check ID is printed) or no proof was found;
// 2 usage error. A missing or unreadable cache, or a git failure, runs every proof and never fails by itself.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The same patterns as check_proofs.py (CHECK_RE, PROOF_RE): a check line starts with its ID, a proof line with "Proof:".
const CHECK_RE = /^\**\s*(C\d+)\s*\**\s*[-–—:]\s*(.+)$/u;
const PROOF_RE = /^\**\s*Proof\s*\**\s*:\s*(.+)$/iu;
const HEADING_RE = /^#{1,2}\s/u;
const CHECKS_HEADING_RE = /^##\s+Checks\s*$/iu;
// The cache is this script's own output: it is never an input of the key.
const CACHE_DIR = 'reports/proofs-cache/';
const TAIL_LINES = 20;

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The proofs of a tasks.md `## Checks` section, in file order: [{ id, command }]. Pure. */
export function parseChecks(text) {
  const proofs = [];
  let inChecks = false;
  let current = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (HEADING_RE.test(line)) {
      inChecks = CHECKS_HEADING_RE.test(line);
      current = null;
      continue;
    }
    if (!inChecks) continue;
    const check = CHECK_RE.exec(line);
    if (check) {
      current = check[1];
      continue;
    }
    const proof = PROOF_RE.exec(line);
    if (proof && current !== null) {
      proofs.push({
        id: current,
        command: proof[1]
          .trim()
          .replace(/^`+|`+$/gu, '')
          .trim(),
      });
    }
  }
  return proofs;
}

/**
 * The cache key of a proof: SHA-256 over its command and over each file's path and content digest, sorted by path.
 * `files` is [{ path, content }]; a deleted file is passed with empty content. Pure: no I/O.
 */
export function proofKey(command, files) {
  const entries = [...files]
    .map((file) => [file.path, sha256(file.content)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return sha256(JSON.stringify([command, entries]));
}

function gitStdout(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout : null;
}

function activePhase(root) {
  try {
    return readFileSync(path.join(root, '.specs', 'phases', 'ACTIVE'), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

// A file's content for the key. A deleted file (ENOENT) counts as empty; any other read error is thrown to the caller.
function readContent(file) {
  try {
    return readFileSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

/** [{ path, content }] for every file the branch changes against phase/<F>, or null when git cannot list them. */
function changedFiles(root) {
  const phase = activePhase(root);
  if (phase === null) return null;
  const committed = gitStdout(root, ['diff', '-z', '--name-only', '--no-renames', `phase/${phase}...HEAD`]);
  const status = gitStdout(root, ['status', '--porcelain=v1', '-z', '-uall', '--no-renames']);
  if (committed === null || status === null) return null;
  const paths = new Set([
    ...committed.split('\0').filter(Boolean),
    ...status
      .split('\0')
      .filter(Boolean)
      .map((entry) => entry.slice(3)),
  ]);
  try {
    return [...paths]
      .filter((file) => !file.startsWith(CACHE_DIR))
      .sort()
      .map((file) => ({ path: file, content: readContent(path.join(root, file)) }));
  } catch {
    return null;
  }
}

// A missing, unreadable or corrupt cache is an empty one: every proof runs (FPR-06).
function readCache(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return isRecord(data) ? data : {};
  } catch {
    return {};
  }
}

function persist(file, cache) {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(cache, null, 2)}\n`);
  } catch (error) {
    console.error(
      `proofs-preflight: could not write ${file} (${error.message}); the next run reruns the proofs`,
    );
  }
}

function runProof(root, command) {
  const started = Date.now();
  const result = spawnSync('sh', ['-c', command], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    code: result.status ?? 1,
    seconds: (Date.now() - started) / 1000,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

/** Runs the preflight for `feature` in `root`; returns the exit code. */
export function main(argv, root = process.cwd()) {
  const [feature] = argv;
  if (!feature) {
    console.error('usage: node scripts/proofs-preflight.mjs <feature>');
    return 2;
  }
  const tasksFile = path.join(root, '.specs', 'features', feature, 'tasks.md');
  if (!existsSync(tasksFile)) {
    console.error(`proofs-preflight: no tasks.md for feature "${feature}" (${tasksFile})`);
    return 2;
  }
  const proofs = parseChecks(readFileSync(tasksFile, 'utf8'));
  if (proofs.length === 0) {
    console.error(`proofs-preflight: no Proof: line under ## Checks in ${tasksFile}`);
    return 1;
  }

  // Without the changed files no key can be made: every proof runs and nothing is recorded.
  const files = changedFiles(root);
  const cacheFile = path.join(root, CACHE_DIR, `${feature}.json`);
  const cache = files === null ? {} : readCache(cacheFile);
  const failed = [];
  let ran = 0;
  let cached = 0;

  for (const { id, command } of proofs) {
    const key = files === null ? null : proofKey(command, files);
    if (key !== null && isRecord(cache[key])) {
      cached += 1;
      console.log(`${id} cached exit=0 0.00s  ${command}`);
      continue;
    }
    const run = runProof(root, command);
    ran += 1;
    console.log(`${id} ran exit=${run.code} ${run.seconds.toFixed(2)}s  ${command}`);
    if (run.code !== 0) {
      failed.push(id);
      process.stderr.write(`${run.output.trim().split('\n').slice(-TAIL_LINES).join('\n')}\n`);
    }
    if (key !== null) {
      if (run.code === 0) cache[key] = { check: id, command, at: new Date().toISOString() };
      else Reflect.deleteProperty(cache, key);
      persist(cacheFile, cache);
    }
  }

  if (failed.length > 0) {
    console.error(`proofs-preflight failed: ${failed.join(', ')}`);
    return 1;
  }
  console.log(`proofs-preflight green: ${proofs.length} proofs, ${ran} ran, ${cached} cached`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
