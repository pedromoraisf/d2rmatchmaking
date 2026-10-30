// Retry-budget rules for the PreToolUse gate (ADR 022). Pure: decisions come from the tool call,
// a read-only repo context and a ledger snapshot; side effects are returned as `effects` and applied
// by gate.mjs under the ledger lock.
import {
  recordAttempt,
  clearIfOpen,
  MAX_ATTEMPTS,
  MAX_RETRIES,
  unitKey,
  canAttempt,
  failuresOf,
  featureBlocked,
  lastGateAttempt,
  sessionExhausted,
  blockedMessage,
  DISPATCH_STEPS,
} from '../../../scripts/lib/budget.mjs';
import { activePhase } from './delegation.mjs';
import { checkDispatchPolicy, READ_ONLY_HELPERS } from '../../../scripts/lib/model-policy.mjs';

const deny = (reason, effects = []) => ({ decision: 'deny', reason, effects });
const allow = (effects = []) => ({ decision: null, effects });

const FEATURE_BRANCH = /^feat\/(F\d+)-(.+)$/;
const PHASE_BRANCH = /^phase\/(F\d+)$/;
const WORKTREE = /(?:^|[\s"'=/])\.claude\/worktrees\/([a-z0-9][a-z0-9-]*)(?:\/|\s|"|'|$)/;
const SPECS_FILE = /^(\.claude\/worktrees\/[a-z0-9][a-z0-9-]*\/)?\.specs\//;
const LEDGER_REF = /\.git\/d2rmm|d2rmm\/ledger|D2RMM_LEDGER/;
const WRAPPER = /(^|\s)(node\s+)?(\.\/)?scripts\/attempt\.mjs\s+run\s/;
const WRAPPER_ANY = /scripts\/attempt\.mjs\s+(\w+)/;
// A sensor runs when it is the command a shell segment executes — never when its name is only an argument or a path
// (`grep -i stryker x`, `sed -n 1p scripts/acceptance-check.mjs`). Runners (npx, pnpm exec, python3, node…) are
// peeled off first, so `npx vitest` and `python3 …/check_proofs.py` still count.
const SENSOR_HEAD =
  /^(vitest|jest|playwright\s+test|cargo\s+(nextest|test|clippy|mutants)|turbo\s+run\s+(test|typecheck|lint)\S*|check_proofs\.py|validate_(spec|tasks|verification)\.py|acceptance-check\.mjs|bddgen|stryker|depcruise|eslint|tsc)(\s|$)/;
const PKG_SCRIPT = /^(test|check|lint|typecheck|arch|test:\S+|harness:gate)(\s|$)/;
const RUNNER =
  /^(npx|pnpx|bunx|pnpm\s+(exec|dlx)|npm\s+exec|uv\s+run|time|env|exec|python[\d.]*|node|tsx)(\s+-\S+)*\s+/;
const PKG_MANAGER =
  /^(pnpm|npm|yarn)(\s+(-[Cw]|--(dir|filter|prefix|workspace))\s+\S+|\s+(-r|-w|--recursive|--workspace-root))*\s+/;
const ENV_PREFIX = /^([A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/;
const READ_ONLY_BASH =
  /^(git\s+(status|diff|log|show|branch)|node\s+(\.\/)?scripts\/attempt\.mjs\s+(status|report)|python[\d.]*\s+\S*lessons\.py\s+list|ls|cat|head|tail|grep|rg|wc|pwd)\b/;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const DISPATCH_TOOLS = new Set(['Agent', 'Task']);
const DISPATCH_HEADER = /\[d2rmm\s+feature=([a-z0-9][a-z0-9-]*)\s+step=([a-z0-9][a-z0-9-]*)\]/i;

const unquoted = (s) => s.replace(/"[^"]*"|'[^']*'/g, '""');
const segments = (s) =>
  unquoted(s)
    .split(/\n|;|&&|\|\||\|/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Whether a shell segment executes a test/gate tool (not merely names one). */
function runsSensor(segment) {
  let s = segment.replace(ENV_PREFIX, '');
  for (let prev = null; prev !== s;) {
    prev = s;
    s = s.replace(RUNNER, '').replace(ENV_PREFIX, '');
  }
  const pkg = PKG_MANAGER.exec(s);
  if (pkg) {
    const rest = s.slice(pkg[0].length).replace(/^(run|run-script)\s+/, '');
    if (PKG_SCRIPT.test(rest)) return true;
    s = rest; // `pnpm vitest`, `yarn eslint`
  }
  s = s.replace(/^\S*\//, ''); // ./node_modules/.bin/vitest, …/scripts/check_proofs.py
  return SENSOR_HEAD.test(s);
}

function hash(text) {
  let h = 5381;
  for (const ch of String(text)) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  return h.toString(16);
}

function branchInfo(ctx) {
  const b = ctx.currentBranch?.() ?? '';
  const f = FEATURE_BRANCH.exec(b);
  if (f) return { kind: 'feature', phase: f[1], feature: f[2] };
  const p = PHASE_BRANCH.exec(b);
  if (p) return { kind: 'phase', phase: p[1] };
  return { kind: 'other' };
}

/** Rules that apply before the regular gate rules. Returns a decision or null. */
export function checkBudget(input, ctx, sid, rel) {
  const tool = input?.tool_name ?? '';
  const ti = input?.tool_input ?? {};
  const ledger = ctx.ledger ?? { units: {} };
  const cmd = String(ti.command ?? '');

  // 1. The ledger is out of reach for agents (it lives in .git/, outside any diff).
  if (EDIT_TOOLS.has(tool) && (rel.startsWith('.git/') || rel.includes('/.git/') || rel === '.git')) {
    return deny('Files under .git/ (including the retry ledger) are off-limits.');
  }
  if (tool === 'Bash' && LEDGER_REF.test(cmd)) {
    return deny('The retry ledger is maintained by the hooks and scripts/attempt.mjs only.');
  }
  if (tool === 'Bash' && WRAPPER_ANY.exec(cmd)?.[1] === 'reset') {
    return {
      decision: 'ask',
      reason: 'Resetting a retry budget is a maintainer decision (ADR 022).',
      effects: [],
    };
  }

  // 2. An exhausted session may only record the blocker and read.
  if (sessionExhausted(ledger, sid)) {
    const recording = EDIT_TOOLS.has(tool) && SPECS_FILE.test(rel);
    const readOnly = tool === 'Bash' && segments(cmd).every((s) => READ_ONLY_BASH.test(s));
    if (!recording && !readOnly && (EDIT_TOOLS.has(tool) || tool === 'Bash' || DISPATCH_TOOLS.has(tool))) {
      return deny(
        `Retry budget exhausted for this agent session (${MAX_RETRIES} retries used). Only record the blocker ` +
          '(.specs/ files) and report back. Do not try again by any other route.',
      );
    }
    return null;
  }

  const phase = activePhase(ctx);
  const running = Boolean(phase?.approved);
  // Hooks run in the main checkout, but implementers work in .claude/worktrees/<feature>: a command or edit that
  // targets a worktree is judged as work on that feature's branch.
  const worktree = WORKTREE.exec(tool === 'Bash' ? cmd : rel)?.[1] ?? null;
  const where = worktree
    ? { kind: 'feature', feature: worktree, dir: `.claude/worktrees/${worktree}` }
    : branchInfo(ctx);

  // 3. Subagent dispatches: each (feature, step, type) gets 1 + MAX_RETRIES dispatches.
  if (DISPATCH_TOOLS.has(tool) && running) {
    if (READ_ONLY_HELPERS.includes(ti.subagent_type)) {
      return ti.model === undefined
        ? null
        : deny('Read-only helpers run on their default model; do not override it.');
    }
    const m = DISPATCH_HEADER.exec(String(ti.prompt ?? ''));
    if (!m) {
      return deny(
        'During a phase run every dispatch starts with "[d2rmm feature=<feature> step=<step>]" so its retry budget can be counted.',
      );
    }
    const [, feature, rawStep] = m;
    const step = rawStep.toLowerCase();
    if (!DISPATCH_STEPS.test(step)) {
      return deny(
        `Unknown dispatch step "${step}". Allowed: ${DISPATCH_STEPS.source.replace(/^\^\(|\)\$$/g, '').replace(/\|/g, ', ')}.`,
      );
    }
    const policy = checkDispatchPolicy(step, ti);
    if (policy) return deny(policy);
    const brief = ctx.readFile(phase.briefPath) ?? '';
    if (!new RegExp(`(^|[^a-z0-9-])${feature}([^a-z0-9-]|$)`, 'm').test(brief)) {
      return deny(`Feature "${feature}" is not listed in ${phase.briefPath}.`);
    }
    if (featureBlocked(ledger, feature))
      return deny(`Feature ${feature} is blocked; do not dispatch more work for it.`);
    const key = unitKey('dispatch', feature, step);
    const used = (ledger.units[key]?.attempts ?? []).length;
    if (ledger.units[key]?.status === 'blocked' || used >= MAX_ATTEMPTS) {
      return deny(blockedMessage(key, ledger.units[key]), [
        { op: 'dispatch', key, note: ti.description ?? '' },
      ]);
    }
    return allow([{ op: 'dispatch', key, note: ti.description ?? '' }]);
  }

  if (!running || where.kind === 'other') return null;

  // 4. On phase/feature branches, gates run only through the wrapper (so every failure is counted).
  if (tool === 'Bash') {
    if (WRAPPER.test(cmd)) {
      if (segments(cmd).length > 1) {
        return deny('Quote the whole gate command after "--" so nothing runs outside the attempt wrapper.');
      }
      return null;
    }
    if (segments(cmd).some(runsSensor)) {
      return deny(
        'During a phase run, tests and gates run only through the retry-budget wrapper: ' +
          '`node scripts/attempt.mjs run --feature <feature> --step <T#|spec|tasks|proofs|verification|integration> -- "<command>"`.',
      );
    }
  }

  // 5. A blocked feature takes no more code changes and no commits.
  if (where.kind === 'feature' && featureBlocked(ledger, where.feature)) {
    if (EDIT_TOOLS.has(tool) && !SPECS_FILE.test(rel)) {
      return deny(
        `Feature ${where.feature} is blocked (retry budget). Record the blocker in .specs/ and return.`,
      );
    }
  }
  if (
    tool === 'Bash' &&
    where.kind === 'feature' &&
    segments(cmd).some((s) => /\bgit\b(?:\s+-[Cc]\s+\S+)*\s+commit\b/.test(s))
  ) {
    if (featureBlocked(ledger, where.feature))
      return deny(`Feature ${where.feature} is blocked (retry budget): no commits.`);
    const last = lastGateAttempt(ledger, where.feature);
    const head = ctx.headTime?.(where.dir) ?? null;
    if (!last || !last.ok || (head !== null && Date.parse(last.at) / 1000 < head)) {
      return deny(
        'Commit refused: the latest gate of this feature since the last commit has not passed through ' +
          '`scripts/attempt.mjs run`. Run the task gate through the wrapper first.',
      );
    }
  }
  return null;
}

/** Turn a regular deny into a counted one: the same denial at most 1 + MAX_RETRIES times per session. */
export function countDenial(result, ctx, sid) {
  if (!result || result.decision !== 'deny') return result;
  const key = unitKey('denial', sid, hash(result.reason.slice(0, 80)));
  const failures = failuresOf(ctx.ledger ?? { units: {} }, key) + 1;
  const suffix =
    failures >= MAX_ATTEMPTS
      ? ` [denial ${failures}/${MAX_ATTEMPTS}: retry budget exhausted — this session may now only record the blocker and report]`
      : ` [denial ${failures}/${MAX_ATTEMPTS}: do not retry the same action; ${MAX_ATTEMPTS - failures} left]`;
  return {
    ...result,
    reason: result.reason + suffix,
    effects: [...(result.effects ?? []), { op: 'fail', key, note: result.reason }],
  };
}

/**
 * Stop / SubagentStop with sensors red (consecutive): block the stop to force a fix at most MAX_RETRIES times;
 * on the next red stop let the agent stop, with the session marked exhausted. Green resets the counter.
 * Mutates the ledger. Returns { block, message }.
 */
export function onStop(ledger, sid, failuresText) {
  const key = unitKey('stop', sid);
  if (!failuresText) {
    clearIfOpen(ledger, key);
    return { block: false, message: '' };
  }
  const res = recordAttempt(ledger, key, false, { note: failuresText.slice(0, 400) });
  if (res.status === 'blocked') {
    return {
      block: false,
      message:
        `[d2rmm stop] Sensors still red after ${MAX_RETRIES} retries — retry budget exhausted. This session may now only ` +
        'record the blocker (tasks.md "## Handoff", phase decisions.md "Blocked") and report back.',
    };
  }
  return {
    block: true,
    message:
      `[d2rmm stop] Sensors are red (failure ${res.failures}/${MAX_ATTEMPTS}, ${res.remainingRetries} retr${res.remainingRetries === 1 ? 'y' : 'ies'} left). ` +
      `Fix the root cause before ending the turn:\n\n${failuresText}`,
  };
}

/**
 * Feedback sensors after an edit: the same sensor failing on the same file is counted (consecutive);
 * green clears it. Mutates the ledger. Returns the keys that became blocked.
 */
export function onFeedback(ledger, sid, rel, results) {
  const blocked = [];
  for (const r of results) {
    const key = unitKey('feedback', sid, `${rel}:${r.id}`);
    if (r.ok) {
      clearIfOpen(ledger, key);
      continue;
    }
    const res = recordAttempt(ledger, key, false, { note: String(r.out ?? '').slice(0, 300) });
    if (res.status === 'blocked') blocked.push(key);
  }
  return blocked;
}

export { canAttempt };
