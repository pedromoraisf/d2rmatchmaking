// Security-review verdicts (ADR 028 § 3). Pure: a dispatch is noted at its start, its verdict is recorded at its end,
// and the merge guard (guard.mjs) reads the latest verdict per (feature, head). Side effects are returned as
// `effects` and applied by gate.mjs (start) and verdict.mjs (end) under the lock of verdict-store.mjs.
//
//   start  PreToolUse  Agent|Task  → { op: 'note', id, feature, branch, head, at }   (HBS-26)
//   end    PostToolUse Agent|Task  → { op: 'verdict', id, feature, head, verdict, at } (HBS-27, HBS-28)
//
// A dispatch with no `[d2rmm feature=… step=review-diff]` header at the start of its prompt, or of another agent type,
// records nothing (HBS-29). A review that never returns leaves its note and no verdict (HBS-45).
import { activePhase } from './delegation.mjs';

const DISPATCH_TOOLS = new Set(['Agent', 'Task']);
const REVIEW_DIFF_HEADER = /^\s*\[d2rmm\s+feature=([a-z0-9][a-z0-9-]*)\s+step=review-diff\]/i;

/** The verdict of a review report: PASS only when its last `VERDICT:` line, trimmed, is exactly `VERDICT: PASS`. */
export function verdictOf(report) {
  if (typeof report !== 'string') return 'FAIL';
  const lines = report.split('\n').filter((l) => l.trim().startsWith('VERDICT:'));
  const last = lines.at(-1);
  if (last === undefined) return 'FAIL';
  return last.trim() === 'VERDICT: PASS' ? 'PASS' : 'FAIL';
}

/**
 * The readable text of a PostToolUse `tool_response`: a string, `{ content: [...] }`, or an array of such blocks.
 * Anything else (or an empty array) has no readable text: null, which records a FAIL (HBS-28).
 */
export function responseText(response) {
  if (typeof response === 'string') return response;
  if (Array.isArray(response)) {
    const parts = response.map(responseText);
    return parts.length > 0 && parts.every((p) => p !== null) ? parts.join('\n') : null;
  }
  if (response && typeof response === 'object') {
    if (Array.isArray(response.content)) return responseText(response.content);
    if (response.type === 'text' && typeof response.text === 'string') return response.text;
  }
  return null;
}

/**
 * Start of a foreground `security-reviewer` review of a diff: the note of the head the review starts on.
 * `ctx.git`, `ctx.now` and the active phase are read; nothing is written here.
 */
export function noteDispatch(input, ctx) {
  if (!DISPATCH_TOOLS.has(input?.tool_name)) return null;
  const ti = input?.tool_input ?? {};
  if (ti.subagent_type !== 'security-reviewer' || ti.run_in_background === true) return null;
  const m = REVIEW_DIFF_HEADER.exec(String(ti.prompt ?? ''));
  if (!m || !input.tool_use_id) return null;
  const phase = activePhase(ctx);
  if (!phase) return null;
  const feature = m[1];
  const branch = `feat/${phase.id}-${feature}`;
  const head = ctx.git?.('rev-parse', '--verify', '--quiet', branch) ?? null;
  if (!head) return null;
  return { op: 'note', id: input.tool_use_id, feature, branch, head, at: ctx.now?.() ?? null };
}

/**
 * End of a noted dispatch: the verdict at the noted head. FAIL when the report is not exactly PASS, when it has no
 * readable text, or when the branch head moved since the dispatch started (HBS-28). Returns null for any dispatch
 * that was not noted (HBS-29), and the pending note is dropped with the verdict.
 */
export function recordVerdict(input, ctx) {
  if (!DISPATCH_TOOLS.has(input?.tool_name)) return null;
  const id = input.tool_use_id;
  const note = id ? ctx.verdicts?.notes?.[id] : undefined;
  if (!note) return null;
  const text = responseText(input.tool_response);
  const reported = text === null ? 'FAIL' : verdictOf(text);
  const current = ctx.git?.('rev-parse', '--verify', '--quiet', note.branch) ?? null;
  const verdict = current === note.head ? reported : 'FAIL';
  return { op: 'verdict', id, feature: note.feature, head: note.head, verdict, at: ctx.now?.() ?? null };
}

/** A foreground-only rule (HBS-30): a security review of a diff never runs in the background. */
export function checkBackgroundReview(input) {
  if (!DISPATCH_TOOLS.has(input?.tool_name)) return null;
  const ti = input?.tool_input ?? {};
  if (ti.subagent_type !== 'security-reviewer') return null;
  if (!REVIEW_DIFF_HEADER.test(String(ti.prompt ?? ''))) return null;
  if (ti.run_in_background !== true && ti.run_in_background !== 'true') return null;
  return {
    decision: 'deny',
    reason:
      'A security review of a diff runs in the foreground: dispatch it with run_in_background: false, so its verdict is recorded at the head it reviewed (ADR 028 § 3).',
  };
}

/** Apply one effect to a verdict store (a plain object: { notes, verdicts }). Mutates and returns it. */
export function applyVerdictEffect(store, e) {
  if (e?.op === 'note') {
    store.notes = {
      ...store.notes,
      [e.id]: { feature: e.feature, branch: e.branch, head: e.head, at: e.at },
    };
  }
  if (e?.op === 'verdict') {
    store.notes = Object.fromEntries(Object.entries(store.notes).filter(([k]) => k !== e.id));
    store.verdicts = [...store.verdicts, { feature: e.feature, head: e.head, verdict: e.verdict, at: e.at }];
  }
  return store;
}

/** The latest verdict recorded for a feature at a commit, or null. HBS-32 reads it. */
export function latestVerdict(store, feature, head) {
  const matching = (store?.verdicts ?? []).filter((v) => v.feature === feature && v.head === head);
  return matching.at(-1) ?? null;
}
