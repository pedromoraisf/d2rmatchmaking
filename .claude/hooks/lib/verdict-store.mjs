// Persistence for the security-review verdicts (ADR 028 § 3): `verdicts.json` in the `d2rmm/` folder of the git common
// directory, next to the retry ledger. Like the ledger, it is never committed, and agents reach it through no edit or
// shell command (budget-rules.mjs). Writes are serialized with a mkdir lock and replaced atomically, as
// scripts/lib/ledger-store.mjs does.
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ledgerPath } from '../../../scripts/lib/ledger-store.mjs';
import { applyVerdictEffect } from './verdicts.mjs';

export function emptyVerdicts() {
  return { version: 1, notes: {}, verdicts: [] };
}

/** `verdicts.json` next to the ledger (the same folder, so the same lock and the same reach), or null. */
export function verdictsPath(cwd) {
  const ledger = ledgerPath(cwd);
  return ledger ? path.join(path.dirname(ledger), 'verdicts.json') : null;
}

export function loadVerdicts(file) {
  if (!file || !existsSync(file)) return emptyVerdicts();
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const ok = parsed && typeof parsed.notes === 'object' && Array.isArray(parsed.verdicts);
    return ok ? { version: 1, notes: parsed.notes, verdicts: parsed.verdicts } : emptyVerdicts();
  } catch {
    // A corrupt file reads as no verdict: every merge needs a PASS that is recorded, so this fails closed.
    return emptyVerdicts();
  }
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
      if (Date.now() - start > timeoutMs) throw new Error(`verdicts lock busy: ${lockDir}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

/** Read-modify-write under the lock. `fn(store)` mutates the store it is given. */
export function withVerdicts(file, fn) {
  if (!file) return fn(emptyVerdicts());
  mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  acquire(lock);
  try {
    const store = loadVerdicts(file);
    const result = fn(store);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`);
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

/** Apply a list of note/verdict effects in one locked write. */
export function applyVerdictEffects(file, effects) {
  if (!effects?.length) return;
  withVerdicts(file, (store) => {
    for (const e of effects) applyVerdictEffect(store, e);
  });
}
