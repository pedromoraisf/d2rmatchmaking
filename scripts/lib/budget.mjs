// Retry budget (ADR 022, budget v2 of ADR 028 § 4). The ONE place where the number lives.
//
// Rule: every unit of agentic work gets the first attempt plus at most MAX_RETRIES retries.
// After the last counted failure the unit is BLOCKED: no further attempt is allowed by the hooks,
// the feature is recorded as blocked, and only a reset clears it.
//
// Budget v2: a failure the machine caused (kind 'env', a signature of lib/env-signatures.mjs) is recorded but
// does not count. ENV_ATTEMPTS_TO_BLOCK environment failures in a row make the unit ENV-BLOCKED: refused and
// blocking its feature like BLOCKED. A rerun refused for an unchanged tree is kept in ledger.refusals, not as an
// attempt. Resets are appended to ledger.resets and never removed.
//
// Pure functions over a plain ledger object; persistence lives in ledger-store.mjs.

export const MAX_RETRIES = 2;
export const MAX_ATTEMPTS = 1 + MAX_RETRIES;
/** Environment failures in a row that block a unit as env-blocked (budget v2, BUD-04). */
export const ENV_ATTEMPTS_TO_BLOCK = 3;
/** Environment failures in all since the unit's last pass or reset that block it as env-blocked (BUD-30, AD-167). */
export const ENV_TOTAL_TO_BLOCK = 4;
/** Red stops of one agent session the machine may cause without counting (BUD-31, AD-167). */
export const UNCOUNTED_RED_STOPS_PER_SESSION = 2;

/** Units of work that consume the budget. */
export const UNIT_KINDS = /** @type {const} */ ([
  'gate', // a task gate, a spec/tasks/verification gate, or any command run through `scripts/attempt.mjs`
  'dispatch', // a subagent dispatch for (feature, step, subagent type)
  'stop', // a Stop/SubagentStop with red sensors, per agent session
  'denial', // the same gate-hook denial, per agent session
  'feedback', // the same sensor failing on the same file after edits, per agent session
]);

/** Fixed step names a gate unit may use besides the task ids (T1, T2…) declared in tasks.md. */
export const FIXED_STEPS = ['spec', 'design', 'tasks', 'proofs', 'verification', 'integration'];

/**
 * Step names a subagent dispatch may use: a closed list, so a re-dispatch cannot dodge the budget by renaming the
 * step. The subagent type is NOT part of the key. The list and the step → subagent mapping live in model-policy.mjs
 * (ADR 025): planning steps are done by the orchestrator and are not dispatchable.
 */
export { DISPATCH_STEP_RE as DISPATCH_STEPS } from './model-policy.mjs';

export function emptyLedger() {
  return { version: 1, units: {} };
}

export function unitKey(kind, ...parts) {
  if (!UNIT_KINDS.includes(kind)) throw new Error(`unknown unit kind: ${kind}`);
  const clean = parts
    .map((p) =>
      String(p ?? '')
        .trim()
        .replace(/\s+/g, ' '),
    )
    .filter(Boolean);
  if (clean.length === 0) throw new Error('unit key needs at least one part');
  return `${kind}:${clean.join('/')}`;
}

function unit(ledger, key) {
  return ledger.units[key] ?? { attempts: [], status: 'open' };
}

/** Statuses that refuse further attempts: BLOCKED (budget used) and ENV-BLOCKED (machine failures in a row). */
const BLOCKING_STATUSES = ['blocked', 'env-blocked'];

export function isBlocked(u) {
  return BLOCKING_STATUSES.includes(u?.status);
}

/** A failed attempt that counts toward the budget. Attempts without a kind (the ones before budget v2) count. */
export function isCountedFailure(a) {
  return !a.ok && a.kind !== 'env';
}

/** A failed attempt the machine caused: recorded, not counted. */
export function isEnvFailure(a) {
  return !a.ok && a.kind === 'env';
}

function countedFailuresOf(u) {
  return u.attempts.filter(isCountedFailure).length;
}

export function failuresOf(ledger, key) {
  return countedFailuresOf(unit(ledger, key));
}

/** Environment failures of a unit (recorded, not counted). */
export function envFailuresOf(ledger, key) {
  return unit(ledger, key).attempts.filter(isEnvFailure).length;
}

export function status(ledger, key) {
  return unit(ledger, key).status;
}

/** Consecutive environment failures at the end of a unit's attempts. A counted failure or a pass ends the run. */
function trailingEnvRun(attempts) {
  let n = 0;
  for (let i = attempts.length - 1; i >= 0 && attempts[i].kind === 'env'; i -= 1) n += 1;
  return n;
}

/** Environment failures since the unit's last pass (a reset starts the attempts list again). Counted failures do not end it. */
function envTotalSincePass(attempts) {
  let n = 0;
  for (let i = attempts.length - 1; i >= 0 && !attempts[i].ok; i -= 1) if (attempts[i].kind === 'env') n += 1;
  return n;
}

/**
 * The environment total of a unit: its own attempts since the last pass, plus the environment failures a merge carried
 * from another copy of the unit (`envCarried`, set by mergeLedgers and cleared by a pass).
 */
function envTotalOf(u) {
  return envTotalSincePass(u.attempts) + (u.envCarried ?? 0);
}

/** May this unit be attempted again? */
export function canAttempt(ledger, key) {
  const u = unit(ledger, key);
  if (isBlocked(u)) return { ok: false, reason: blockedMessage(key, u) };
  const failures = countedFailuresOf(u);
  if (failures >= MAX_ATTEMPTS) return { ok: false, reason: blockedMessage(key, u) };
  return { ok: true, attempt: failures + 1, of: MAX_ATTEMPTS };
}

/**
 * Record one attempt. Counted failures accumulate over the unit's whole life: the unit is blocked as soon as it
 * has MAX_ATTEMPTS counted failures, even if it passed in between (a passed gate that breaks again does not get
 * a fresh budget). Only a reset clears the count.
 * `kind: 'env'` (with `signature`) records a failure the machine caused: it is stored and not counted; three in a row
 * set status 'env-blocked'. Any other attempt is counted when it fails.
 * `command`, `head` (the commit, or null) and `clean` (the tree had no uncommitted change) are stored on the attempt
 * when given (HBS-25); attempts recorded without them still load and count.
 * Returns { status, attempt, failures, remainingRetries }.
 */
export function recordAttempt(
  ledger,
  key,
  ok,
  { note = '', at = new Date().toISOString(), command, head, clean, kind, signature, fingerprint } = {},
) {
  const u = structuredClone(unit(ledger, key));
  if (isBlocked(u)) {
    const failures = u.status === 'blocked' ? MAX_ATTEMPTS : countedFailuresOf(u);
    return {
      status: u.status,
      attempt: u.attempts.length,
      failures,
      remainingRetries: retriesLeft(failures),
    };
  }
  if (kind !== undefined && kind !== 'env') throw new Error(`unknown attempt kind: ${kind}`);
  if (kind === 'env' && !signature) throw new Error('an environment failure needs its signature');
  const attempt = { at, ok: Boolean(ok), note: String(note).slice(0, 500) };
  if (kind === 'env') {
    attempt.kind = 'env';
    attempt.signature = String(signature);
  }
  if (command !== undefined) attempt.command = String(command);
  if (head !== undefined) attempt.head = head === null ? null : String(head);
  if (clean !== undefined) attempt.clean = Boolean(clean);
  if (fingerprint !== undefined) attempt.fingerprint = fingerprint === null ? null : String(fingerprint);
  u.attempts.push(attempt);
  const failures = countedFailuresOf(u);
  if (ok) {
    u.status = 'passed';
    delete u.envCarried;
  } else if (kind === 'env')
    u.status =
      trailingEnvRun(u.attempts) >= ENV_ATTEMPTS_TO_BLOCK || envTotalOf(u) >= ENV_TOTAL_TO_BLOCK
        ? 'env-blocked'
        : 'open';
  else if (failures >= MAX_ATTEMPTS) u.status = 'blocked';
  else u.status = 'open';
  ledger.units[key] = u;
  return { status: u.status, attempt: u.attempts.length, failures, remainingRetries: retriesLeft(failures) };
}

/** Retries left after `failures` counted failures: never more than MAX_RETRIES, never negative. */
function retriesLeft(failures) {
  return Math.min(MAX_RETRIES, Math.max(0, MAX_ATTEMPTS - failures));
}

/**
 * BUD-09: is this run an unchanged rerun? True when the unit's latest counted failure since its last pass or reset has
 * the same tree fingerprint and the same command. A null fingerprint (no git) never matches. Environment failures in
 * between are skipped, so a counted failure, an environment failure and the same tree is still refused.
 */
export function isUnchangedRerun(ledger, key, { fingerprint, command }) {
  if (fingerprint === null || fingerprint === undefined) return false;
  const attempts = unit(ledger, key).attempts;
  for (let i = attempts.length - 1; i >= 0; i -= 1) {
    const a = attempts[i];
    if (a.ok) return false;
    if (isCountedFailure(a)) return a.fingerprint === fingerprint && a.command === String(command);
  }
  return false;
}

/**
 * A rerun refused because nothing changed since the unit's latest counted failure (BUD-11). Kept in `ledger.refusals`,
 * apart from the attempts: a refusal spends nothing.
 */
export function recordRefusal(ledger, key, at = new Date().toISOString()) {
  const refusal = { key, at };
  ledger.refusals = [...(ledger.refusals ?? []), refusal];
  return refusal;
}

/** Red stops of an agent session left uncounted so far (BUD-31). */
export function uncountedRedStopsOf(ledger, sid) {
  return (ledger.uncountedStops ?? []).filter((s) => s.sid === sid).length;
}

/**
 * A red stop left uncounted under BUD-07 (BUD-31). Kept in `ledger.uncountedStops` with its session and its sequence
 * number in that session, so a merge keeps each one once.
 */
export function recordUncountedRedStop(ledger, sid, at = new Date().toISOString()) {
  const entry = { sid, seq: uncountedRedStopsOf(ledger, sid) + 1, at };
  ledger.uncountedStops = [...(ledger.uncountedStops ?? []), entry];
  return entry;
}

/**
 * Dispatches: every dispatch of the same (feature, step, subagent) is one attempt, whatever its outcome
 * (a successful step is never re-dispatched under the same key). The first MAX_ATTEMPTS dispatches are
 * allowed; asking for one more blocks the unit and is refused.
 */
export function recordDispatch(ledger, key, { note = '', at = new Date().toISOString() } = {}) {
  const u = structuredClone(unit(ledger, key));
  if (isBlocked(u)) return { allowed: false, attempt: u.attempts.length, reason: blockedMessage(key, u) };
  if (u.attempts.length >= MAX_ATTEMPTS) {
    u.status = 'blocked';
    u.attempts.push({
      at,
      ok: false,
      note: `refused dispatch #${u.attempts.length + 1}: ${note}`.slice(0, 500),
    });
    ledger.units[key] = u;
    return { allowed: false, attempt: u.attempts.length, reason: blockedMessage(key, u) };
  }
  u.attempts.push({ at, ok: true, note: `dispatch: ${note}`.slice(0, 500) });
  u.status = 'open';
  ledger.units[key] = u;
  return { allowed: true, attempt: u.attempts.length, of: MAX_ATTEMPTS };
}

function removeUnit(ledger, key) {
  ledger.units = Object.fromEntries(Object.entries(ledger.units).filter(([k]) => k !== key));
}

/** A green outcome resets a per-session counter (stop hook) without un-blocking anything. */
export function clearIfOpen(ledger, key) {
  const u = ledger.units[key];
  if (u && !isBlocked(u)) removeUnit(ledger, key);
}

/**
 * Reset a unit. Returns true when something was reset. Every reset is appended to `ledger.resets` with its `by`
 * and `reason`; earlier resets are never removed. The orchestrator's and the maintainer's go through the same
 * function: attempt.mjs decides who may call it.
 */
export function reset(ledger, key, { by, reason, at = new Date().toISOString() } = {}) {
  const u = ledger.units[key];
  if (!u) return false;
  ledger.resets = [
    ...(ledger.resets ?? []),
    { key, by: by ?? 'unknown', reason: reason ?? null, at, previous: u },
  ];
  removeUnit(ledger, key);
  return true;
}

/** How many resets of this unit the orchestrator made, across all later resets (BUD-14: one per unit). */
export function orchestratorResets(ledger, key) {
  return (ledger.resets ?? []).filter((r) => r.key === key && r.by === 'orchestrator').length;
}

const RESET_UNIT_FLAG = '--unit';

/** A unit key as the reset option gives it: trimmed, or null when empty (BUD-29). */
export function normaliseUnitKey(value) {
  const key = String(value ?? '').trim();
  return key === '' ? null : key;
}

/**
 * The unit key of a reset: `--unit <key>` or `--unit=<key>` in an argument list, normalised by normaliseUnitKey.
 * The gate and attempt.mjs both read the key with this function (BUD-29). Null when the list names no unit.
 */
export function unitOption(args) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i]);
    if (arg === RESET_UNIT_FLAG) return normaliseUnitKey(args[i + 1]);
    if (arg.startsWith(`${RESET_UNIT_FLAG}=`)) return normaliseUnitKey(arg.slice(RESET_UNIT_FLAG.length + 1));
  }
  return null;
}

export function blockedUnits(ledger, prefix = '') {
  return Object.entries(ledger.units)
    .filter(([k, u]) => isBlocked(u) && k.startsWith(prefix))
    .map(([k]) => k);
}

/** Is any gate or dispatch unit of this feature blocked (or env-blocked)? Feature is the first part after the kind. */
export function featureBlocked(ledger, feature) {
  return Object.entries(ledger.units).some(([k, u]) => {
    const [kind, rest = ''] = k.split(':');
    return isBlocked(u) && (kind === 'gate' || kind === 'dispatch') && rest.split('/')[0] === feature;
  });
}

/** Latest recorded gate attempt of a feature (any step), or null. */
export function lastGateAttempt(ledger, feature) {
  let last = null;
  for (const [k, u] of Object.entries(ledger.units)) {
    if (!k.startsWith(`gate:${feature}/`)) continue;
    for (const a of u.attempts) if (!last || a.at > last.at) last = { ...a, key: k };
  }
  return last;
}

/** Session ids include the subagent id when Claude Code provides it, so parallel workers never share a budget. */
export function sessionId(input) {
  const s = input?.session_id ?? 'unknown-session';
  const a = input?.agent_id ?? input?.subagent_id ?? null;
  return a ? `${s}#${a}` : s;
}

export function sessionExhausted(ledger, sid) {
  return Object.entries(ledger.units).some(
    ([k, u]) =>
      isBlocked(u) &&
      (k === `stop:${sid}` || k.startsWith(`denial:${sid}/`) || k.startsWith(`feedback:${sid}/`)),
  );
}

export function blockedMessage(key, u) {
  const last = u?.attempts?.filter((a) => !a.ok).at(-1)?.note ?? '';
  if (u?.status === 'env-blocked') {
    return (
      `ENV-BLOCKED — ${key} failed ${ENV_ATTEMPTS_TO_BLOCK} times in a row because of the machine, which is not ` +
      'counted against the code. Escalate the machine to the maintainer and do not retry until it is fixed; the ' +
      'orchestrator may reset this unit once, with a reason.' +
      (last ? ` Last error: ${last}` : '')
    );
  }
  return (
    `BLOCKED — ${key} used its ${MAX_ATTEMPTS} attempts (1 + ${MAX_RETRIES} retries). Do not try again by any other route. ` +
    `Record it as blocked (feature tasks.md "## Handoff" and the phase decisions.md "Blocked" table) and return to the ` +
    `orchestrator / maintainer.${last ? ` Last error: ${last}` : ''}`
  );
}

const cell = (text) => String(text ?? '').replace(/\|/g, '\\|');

export function report(ledger) {
  const refusals = ledger.refusals ?? [];
  const rows = Object.entries(ledger.units).map(([k, u]) => {
    const failures = countedFailuresOf(u);
    const env = u.attempts.filter(isEnvFailure).length;
    const refused = refusals.filter((r) => r.key === k).length;
    const lastError = cell(u.attempts.filter((a) => !a.ok).at(-1)?.note ?? '').slice(0, 120);
    return `| \`${k}\` | ${u.status} | ${u.attempts.length} | ${failures} | ${env} | ${refused} | ${lastError} |`;
  });
  const resets = (ledger.resets ?? []).map(
    (r) => `| \`${r.key}\` | ${cell(r.by)} | ${cell(r.reason ?? '')} | ${cell(r.at)} |`,
  );
  return [
    '| Unit | Status | Attempts | Failures | Environment failures | Refused reruns | Last error |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    '| Reset unit | By | Reason | At |',
    '| --- | --- | --- | --- |',
    ...resets,
  ].join('\n');
}

/**
 * Merge two ledgers without ever loosening: for each unit keep the version with more failures; blocked wins.
 * Used to combine the live ledger (.git/d2rmm) with the committed snapshot (.specs/phases/<F>/attempts.json),
 * so a fresh clone or another machine never gets a fresh budget.
 */
export function mergeLedgers(a, b) {
  const allResets = [...(a?.resets ?? []), ...(b?.resets ?? [])];
  // The same reset is in the live ledger and in the snapshot, and every write merges them again: keep each reset once,
  // first occurrence first. `resetAt` still reads every entry in order (the last one wins), as before.
  const seen = new Set();
  const resets = allResets.filter((r) => {
    const id = `${r.key}\u0000${r.at}\u0000${r.by}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  // Refusals are kept the same way: once each, so repeated merges never multiply them.
  const seenRefusals = new Set();
  const refusals = [...(a?.refusals ?? []), ...(b?.refusals ?? [])].filter((r) => {
    const id = `${r.key}\u0000${r.at}`;
    if (seenRefusals.has(id)) return false;
    seenRefusals.add(id);
    return true;
  });
  const uncountedStops = mergeUncountedStops(a?.uncountedStops ?? [], b?.uncountedStops ?? []);
  const out = { version: 1, units: {}, resets, refusals, uncountedStops };
  const resetAt = new Map(allResets.map((r) => [r.key, r.at]));
  // The largest environment total of each unit over the copies that were kept (BUD-30).
  const envMax = new Map();
  for (const src of [a, b]) {
    for (const [k, u] of Object.entries(src?.units ?? {})) {
      // A reset newer than every attempt in a snapshot drops that stale copy.
      const last = u.attempts?.at(-1)?.at ?? '';
      if (resetAt.has(k) && resetAt.get(k) > last) continue;
      envMax.set(k, Math.max(envMax.get(k) ?? 0, envTotalOf(u)));
      const cur = out.units[k];
      if (
        !cur ||
        (isBlocked(u) && !isBlocked(cur)) ||
        (!isBlocked(cur) && countedFailuresOf(u) > countedFailuresOf(cur)) ||
        (countedFailuresOf(u) === countedFailuresOf(cur) && u.attempts.length > cur.attempts.length)
      ) {
        out.units[k] = structuredClone(u);
      }
    }
  }
  // The kept version may hold fewer environment failures than another copy: it carries the largest total (BUD-30).
  for (const [k, u] of Object.entries(out.units)) {
    const carried = envMax.get(k) - envTotalSincePass(u.attempts);
    if (carried > 0) u.envCarried = carried;
    else delete u.envCarried;
  }
  return out;
}

/**
 * Uncounted red stops (BUD-31) of two ledgers: per session, the side with the larger count is kept, each (sid, seq)
 * once. A merge never gives a session its uncounted stops back, and never lowers its count.
 */
function mergeUncountedStops(fromA, fromB) {
  const sids = [...new Set([...fromA, ...fromB].map((s) => s.sid))];
  const ofSession = (list, sid) => {
    const bySeq = new Map();
    for (const s of list) if (s.sid === sid && !bySeq.has(s.seq)) bySeq.set(s.seq, s);
    return [...bySeq.values()];
  };
  return sids.flatMap((sid) => {
    const a = ofSession(fromA, sid);
    const b = ofSession(fromB, sid);
    return b.length > a.length ? b : a;
  });
}
