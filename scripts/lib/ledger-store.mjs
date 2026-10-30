// Persistence for the retry ledger (ADR 022).
//
// The ledger lives in the git COMMON dir (`.git/d2rmm/ledger.json`), so:
//  - every worktree of the repo (parallel feature workers) shares one ledger;
//  - it is never committed and never part of a diff an agent could "fix";
//  - the gate hook denies agent edits to anything under `.git/` and shell writes that mention it.
// Writes are serialized with a mkdir lock and replaced atomically.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { emptyLedger, mergeLedgers } from './budget.mjs';

export function ledgerPath(cwd) {
  if (process.env.D2RMM_LEDGER) return process.env.D2RMM_LEDGER; // tests only
  let common;
  try {
    common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null; // not a git repo: no budget tracking possible
  }
  return path.join(path.resolve(cwd, common), 'd2rmm', 'ledger.json');
}

/** Committed snapshot of the active phase (written by `pnpm phase:status --write`), relative to a checkout. */
export function snapshotPath(cwd) {
  const active = existsSync(path.join(cwd, '.specs/phases/ACTIVE'))
    ? readFileSync(path.join(cwd, '.specs/phases/ACTIVE'), 'utf8').trim()
    : '';
  return /^F\d+$/.test(active) ? path.join(cwd, '.specs/phases', active, 'attempts.json') : null;
}

function readJsonLedger(file) {
  if (!file || !existsSync(file)) return emptyLedger();
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed.units === 'object' ? parsed : emptyLedger();
  } catch {
    // A corrupt ledger must not become an open drain: keep the broken file for inspection and
    // block everything until the maintainer looks at it.
    return { version: 1, units: { 'gate:ledger/corrupt': { status: 'blocked', attempts: [{ at: new Date().toISOString(), ok: false, note: `corrupt ledger at ${file}` }] } } };
  }
}

/** Live ledger merged with the committed snapshot of the active phase (never looser than either). */
export function loadLedger(file, cwd = process.cwd()) {
  const live = readJsonLedger(file);
  const snap = snapshotPath(cwd);
  return snap && existsSync(snap) ? mergeLedgers(live, readJsonLedger(snap)) : live;
}

function acquire(lockDir, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    try {
      mkdirSync(lockDir);
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        if (Date.now() - statSync(lockDir).mtimeMs > 30_000) rmdirSync(lockDir); // stale lock
      } catch {
        /* raced with another releaser */
      }
      if (Date.now() - start > timeoutMs) throw new Error(`ledger lock busy: ${lockDir}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

/** Read-modify-write under the lock. `fn(ledger)` mutates and may return a value. */
export function withLedger(file, fn) {
  if (!file) return fn(emptyLedger());
  mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  acquire(lock);
  try {
    const ledger = loadLedger(file, path.resolve(path.dirname(file), '..', '..'));
    const result = fn(ledger);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`);
    renameSync(tmp, file);
    return result;
  } finally {
    try {
      rmdirSync(lock);
    } catch {
      /* already released */
    }
  }
}
