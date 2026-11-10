// The call history of the polling rule (gate-precision, GPR-17): `history.json` in the `d2rmm/` folder of the git
// common directory, next to the retry ledger. Like verdict-store.mjs, this module reads, locks and writes its own
// file; only gate.mjs calls it. The polling decision itself stays pure in polling.mjs.
//
// Only a hash and a time are stored per call, never the command text (AD-158). The store fails open on purpose: a
// locked or corrupt store reads as empty, so a call gets no repetition deny; every other rule still runs.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { ledgerPath } from '../../../scripts/lib/ledger-store.mjs';

const VERSION = 1;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_SESSION = 50;
const MAX_SESSIONS = 64;
const LOCK_WAIT_MS = 200;
const LOCK_STALE_MS = 10_000;

export function emptyHistory() {
  return { version: VERSION, sessions: Object.create(null) };
}

/** `history.json` next to the ledger (the same folder, so the same reach as the ledger), or null outside a repo. */
export function historyPath(root) {
  const ledger = ledgerPath(root);
  return ledger ? path.join(path.dirname(ledger), 'history.json') : null;
}

const isEntry = (e) =>
  e !== null && typeof e === 'object' && typeof e.hash === 'string' && Number.isFinite(e.at);

/** Move a corrupt file to the one `.corrupt` file next to it (overwritten each time) and read as empty. */
function setAside(file) {
  try {
    renameSync(file, `${file}.corrupt`);
  } catch {
    /* already moved or unreadable: reading as empty is the outcome either way */
  }
  return emptyHistory();
}

/** The stored history, or an empty one when the file is missing, or corrupt (then it is set aside). */
export function loadHistory(file) {
  if (!file || !existsSync(file)) return emptyHistory();
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return setAside(file);
  }
  const sessions = parsed?.sessions;
  if (
    parsed?.version !== VERSION ||
    sessions === null ||
    typeof sessions !== 'object' ||
    Array.isArray(sessions)
  ) {
    return setAside(file);
  }
  const out = Object.create(null);
  for (const [sid, list] of Object.entries(sessions)) {
    if (!Array.isArray(list) || !list.every(isEntry)) return setAside(file);
    out[sid] = list.map(({ hash, at }) => ({ hash, at }));
  }
  return { version: VERSION, sessions: out };
}

/**
 * A copy of the store with the entries older than ten minutes dropped, the newest 50 kept per session and the most
 * recently used 64 sessions kept; empty sessions are dropped.
 */
export function pruneHistory(store, now) {
  const sessions = Object.create(null);
  for (const [sid, list] of Object.entries(store.sessions)) {
    const kept = list.filter((e) => now - e.at < WINDOW_MS).slice(-MAX_PER_SESSION);
    if (kept.length) sessions[sid] = kept;
  }
  const newest = (sid) => Math.max(...sessions[sid].map((e) => e.at));
  const ranked = Object.keys(sessions).sort((a, b) => newest(b) - newest(a) || (a < b ? -1 : 1));
  const capped = Object.create(null);
  for (const sid of ranked.slice(0, MAX_SESSIONS)) capped[sid] = sessions[sid];
  return { version: VERSION, sessions: capped };
}

/** Add one call's effect (`{ op: 'history', sid, hash, at }` from polling.mjs) to a store in memory. */
export function applyHistoryEffect(store, effect) {
  if (effect?.op !== 'history') return;
  const list = store.sessions[effect.sid] ?? [];
  store.sessions[effect.sid] = [...list, { hash: effect.hash, at: effect.at }];
}

function writeStore(file, store) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

/** Take the lock dir, waiting at most LOCK_WAIT_MS and breaking one older than LOCK_STALE_MS. False when not taken. */
function acquire(lockDir) {
  const start = Date.now();
  for (;;) {
    try {
      mkdirSync(lockDir);
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') return false;
      try {
        if (Date.now() - statSync(lockDir).mtimeMs > LOCK_STALE_MS) rmdirSync(lockDir);
      } catch {
        /* raced with another releaser */
      }
      if (Date.now() - start >= LOCK_WAIT_MS) return false;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
}

/**
 * Read-modify-write under the lock. `fn(store)` receives the pruned store and may mutate it (applyHistoryEffect); the
 * store is pruned and written after `fn` returns, and `fn`'s value is returned. A busy lock or a path that cannot be
 * created gives `fn` an empty store and writes nothing (fails open).
 */
export function withHistory(file, fn, { now = Date.now() } = {}) {
  if (!file) return fn(emptyHistory());
  const lock = `${file}.lock`;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
  } catch {
    return fn(emptyHistory());
  }
  if (!acquire(lock)) return fn(emptyHistory());
  try {
    const store = pruneHistory(loadHistory(file), now);
    const result = fn(store);
    try {
      writeStore(file, pruneHistory(store, now));
    } catch {
      /* an unwritable store loses this call's entry only (fails open) */
    }
    return result;
  } finally {
    try {
      rmdirSync(lock);
    } catch {
      /* already released */
    }
  }
}
