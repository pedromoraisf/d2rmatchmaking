// Retry budget (ADR 022). The ONE place where the number lives.
//
// Rule: every unit of agentic work gets the first attempt plus at most MAX_RETRIES retries.
// After the last failed attempt the unit is BLOCKED: no further attempt is allowed by the hooks,
// the feature is recorded as blocked, and only the maintainer can reset it.
//
// Pure functions over a plain ledger object; persistence lives in ledger-store.mjs.

export const MAX_RETRIES = 2;
export const MAX_ATTEMPTS = 1 + MAX_RETRIES;

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
 * Step names a subagent dispatch may use. Closed list, so a re-dispatch cannot dodge the budget by renaming
 * the step ("execute-batch-1b"). The subagent type is NOT part of the key: switching agent types for the
 * same step shares the same budget.
 */
export const DISPATCH_STEPS = /^(feature|spec|design|tasks|execute|execute-batch-[1-9]|verify|verify-r2|screens|review-spec|review-architecture|review-security|review-diff)$/;

export function emptyLedger() {
  return { version: 1, units: {} };
}

export function unitKey(kind, ...parts) {
  if (!UNIT_KINDS.includes(kind)) throw new Error(`unknown unit kind: ${kind}`);
  const clean = parts.map((p) => String(p ?? '').trim().replace(/\s+/g, ' ')).filter(Boolean);
  if (clean.length === 0) throw new Error('unit key needs at least one part');
  return `${kind}:${clean.join('/')}`;
}

function unit(ledger, key) {
  return ledger.units[key] ?? { attempts: [], status: 'open' };
}

export function failuresOf(ledger, key) {
  return unit(ledger, key).attempts.filter((a) => !a.ok).length;
}

export function status(ledger, key) {
  return unit(ledger, key).status;
}

/** May this unit be attempted again? */
export function canAttempt(ledger, key) {
  const u = unit(ledger, key);
  if (u.status === 'blocked') return { ok: false, reason: blockedMessage(key, u) };
  const failures = failuresOf(ledger, key);
  if (failures >= MAX_ATTEMPTS) return { ok: false, reason: blockedMessage(key, u) };
  return { ok: true, attempt: failures + 1, of: MAX_ATTEMPTS };
}

/**
 * Record one attempt. Failures accumulate over the unit's whole life: the unit is blocked as soon as it
 * has MAX_ATTEMPTS failures, even if it passed in between (a passed gate that breaks again does not get
 * a fresh budget). Only a maintainer reset clears the count.
 * Returns { status, attempt, remainingRetries }.
 */
export function recordAttempt(ledger, key, ok, { note = '', at = new Date().toISOString() } = {}) {
  const u = structuredClone(unit(ledger, key));
  if (u.status === 'blocked') {
    return { status: 'blocked', attempt: u.attempts.length, failures: MAX_ATTEMPTS, remainingRetries: 0 };
  }
  u.attempts.push({ at, ok: Boolean(ok), note: String(note).slice(0, 500) });
  const failures = u.attempts.filter((a) => !a.ok).length;
  if (ok) u.status = 'passed';
  else if (failures >= MAX_ATTEMPTS) u.status = 'blocked';
  else u.status = 'open';
  ledger.units[key] = u;
  return { status: u.status, attempt: u.attempts.length, failures, remainingRetries: Math.max(0, MAX_ATTEMPTS - failures) };
}

/**
 * Dispatches: every dispatch of the same (feature, step, subagent) is one attempt, whatever its outcome
 * (a successful step is never re-dispatched under the same key). The first MAX_ATTEMPTS dispatches are
 * allowed; asking for one more blocks the unit and is refused.
 */
export function recordDispatch(ledger, key, { note = '', at = new Date().toISOString() } = {}) {
  const u = structuredClone(unit(ledger, key));
  if (u.status === 'blocked') return { allowed: false, attempt: u.attempts.length, reason: blockedMessage(key, u) };
  if (u.attempts.length >= MAX_ATTEMPTS) {
    u.status = 'blocked';
    u.attempts.push({ at, ok: false, note: `refused dispatch #${u.attempts.length + 1}: ${note}`.slice(0, 500) });
    ledger.units[key] = u;
    return { allowed: false, attempt: u.attempts.length, reason: blockedMessage(key, u) };
  }
  u.attempts.push({ at, ok: true, note: `dispatch: ${note}`.slice(0, 500) });
  u.status = 'open';
  ledger.units[key] = u;
  return { allowed: true, attempt: u.attempts.length, of: MAX_ATTEMPTS };
}

/** A green outcome resets a per-session counter (stop hook) without un-blocking anything. */
export function clearIfOpen(ledger, key) {
  const u = ledger.units[key];
  if (u && u.status !== 'blocked') delete ledger.units[key];
}

/** Maintainer-only. Returns true when something was reset. */
export function reset(ledger, key, { by, at = new Date().toISOString() } = {}) {
  const u = ledger.units[key];
  if (!u) return false;
  ledger.resets = [...(ledger.resets ?? []), { key, by: by ?? 'unknown', at, previous: u }];
  delete ledger.units[key];
  return true;
}

export function blockedUnits(ledger, prefix = '') {
  return Object.entries(ledger.units)
    .filter(([k, u]) => u.status === 'blocked' && k.startsWith(prefix))
    .map(([k]) => k);
}

/** Is any gate or dispatch unit of this feature blocked? Feature is the first part after the kind. */
export function featureBlocked(ledger, feature) {
  return Object.entries(ledger.units).some(([k, u]) => {
    const [kind, rest = ''] = k.split(':');
    return u.status === 'blocked' && (kind === 'gate' || kind === 'dispatch') && rest.split('/')[0] === feature;
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
    ([k, u]) => u.status === 'blocked' && (k === `stop:${sid}` || k.startsWith(`denial:${sid}/`) || k.startsWith(`feedback:${sid}/`)),
  );
}

export function blockedMessage(key, u) {
  const last = u?.attempts?.filter((a) => !a.ok).at(-1)?.note ?? '';
  return (
    `BLOCKED — ${key} used its ${MAX_ATTEMPTS} attempts (1 + ${MAX_RETRIES} retries). Do not try again by any other route. ` +
    `Record it as blocked (feature tasks.md "## Handoff" and the phase decisions.md "Blocked" table) and return to the ` +
    `orchestrator / maintainer.${last ? ` Last error: ${last}` : ''}`
  );
}

export function report(ledger) {
  const rows = Object.entries(ledger.units).map(([k, u]) => {
    const failures = u.attempts.filter((a) => !a.ok).length;
    return `| \`${k}\` | ${u.status} | ${u.attempts.length} | ${failures} | ${(u.attempts.filter((a) => !a.ok).at(-1)?.note ?? '').replace(/\|/g, '\\|').slice(0, 120)} |`;
  });
  return ['| Unit | Status | Attempts | Failures | Last error |', '| --- | --- | --- | --- | --- |', ...rows].join('\n');
}

/**
 * Merge two ledgers without ever loosening: for each unit keep the version with more failures; blocked wins.
 * Used to combine the live ledger (.git/d2rmm) with the committed snapshot (.specs/phases/<F>/attempts.json),
 * so a fresh clone or another machine never gets a fresh budget.
 */
export function mergeLedgers(a, b) {
  const out = { version: 1, units: {}, resets: [...(a?.resets ?? []), ...(b?.resets ?? [])] };
  const resetAt = new Map(out.resets.map((r) => [r.key, r.at]));
  for (const src of [a, b]) {
    for (const [k, u] of Object.entries(src?.units ?? {})) {
      // A maintainer reset newer than every attempt in a snapshot drops that stale copy.
      const last = u.attempts?.at(-1)?.at ?? '';
      if (resetAt.has(k) && resetAt.get(k) > last) continue;
      const cur = out.units[k];
      const fails = (x) => x.attempts.filter((t) => !t.ok).length;
      if (!cur || u.status === 'blocked' && cur.status !== 'blocked' || (cur.status !== 'blocked' && fails(u) > fails(cur)) ||
        (fails(u) === fails(cur) && u.attempts.length > cur.attempts.length)) {
        out.units[k] = structuredClone(u);
      }
    }
  }
  return out;
}
