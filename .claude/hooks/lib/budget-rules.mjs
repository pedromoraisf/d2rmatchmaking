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
  orchestratorResets,
  unitOption,
  UNCOUNTED_RED_STOPS_PER_SESSION,
  uncountedRedStopsOf,
  recordUncountedRedStop,
} from '../../../scripts/lib/budget.mjs';
import { activePhase } from './delegation.mjs';
import { checkDispatchPolicy, READ_ONLY_HELPERS } from '../../../scripts/lib/model-policy.mjs';
import { classify } from '../../../scripts/lib/env-signatures.mjs';
import { innerShellCommands, shellWords, splitShell } from './shell-indirection.mjs';

const deny = (reason, effects = []) => ({ decision: 'deny', reason, effects });
const allow = (effects = []) => ({ decision: null, effects });

const FEATURE_BRANCH = /^feat\/(F\d+)-(.+)$/;
const PHASE_BRANCH = /^phase\/(F\d+)$/;
const WORKTREE = /(?:^|[\s"'=/])\.claude\/worktrees\/([a-z0-9][a-z0-9-]*)(?:\/|\s|"|'|$)/;
const SPECS_FILE = /^(\.claude\/worktrees\/[a-z0-9][a-z0-9-]*\/)?\.specs\//;
// HBS-31: the retry ledger and the security verdicts live in the d2rmm/ folder of the git common directory. Any
// command, inline code or script that names them, or enters a .git directory, is refused. The status commands of
// scripts/attempt.mjs and scripts/phase-status.mjs name neither, so they stay allowed.
export const LEDGER_REF = /\.git\/d2rmm|d2rmm\/|verdicts\.json|ledger\.json|D2RMM_LEDGER/;
export const GIT_DIR_CD = /(^|[;&|(\n]\s*)cd\s+\S*\.git(?=\/|\s|$|[;&|)])/;
const WRAPPER = /(^|\s)(node\s+)?(\.\/)?scripts\/attempt\.mjs\s+run\s/;
// BUD-14: the wrapper is recognised by its file name, with an optional quote and any directory (or none, after `cd`).
// T24: case-insensitive, because the macOS file system is; it reads the command with its quotes and escapes removed.
// T26: the first word after the file name is read whole (`$(echo reset)`, `$x`, `reset;`).
const WRAPPER_ANY = /(?:^|[\s/"'])attempt\.mjs["']?\s+(\S+)/gi;
// T30: every character the shell expands, globs or redirects. A word that holds one is one the shell builds.
const EXPANDED_ARG = /[$`{*?[~<>(]/;
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

// BUD-15: a reset command is read the way attempt.mjs reads it: whitespace tokens, quotes removed.
const RESET_CALL = /^(node\s+)?(\.\/)?scripts\/attempt\.mjs\s+reset(\s|$)/;
const TOKEN = /"([^"]*)"|'([^']*)'|(\S+)/g;
const tokens = (s) => [...s.matchAll(TOKEN)].map((m) => m[1] ?? m[2] ?? m[3]);
const LEDGER_CORRUPT = 'gate:ledger/corrupt'; // the ledger store's marker for a ledger it cannot read

/** BUD-15: null when the reset is the orchestrator's first reset of a unit with a reason; otherwise an ask. */
function resetDecision(cmd, ledger) {
  const ask = (reason) => ({ decision: 'ask', reason, effects: [] });
  if (!ledger || ledger.units?.[LEDGER_CORRUPT]) {
    return ask("The retry ledger cannot be read; the reset is the maintainer's (ADR 022).");
  }
  const plain = RESET_CALL.test(cmd.trim()) && segments(cmd).length === 1 && !/[<>$`&]/.test(unquoted(cmd));
  if (!plain) return ask('Resetting a retry budget is a maintainer decision (ADR 022).');
  const args = tokens(cmd);
  const valueOf = (flag) => {
    const i = args.indexOf(flag);
    return i < 0 ? undefined : args[i + 1];
  };
  const reason = (valueOf('--reason') ?? '').trim();
  const key = unitOption(args);
  if (!key || valueOf('--by') !== 'orchestrator' || !reason) {
    return ask('Resetting a retry budget is a maintainer decision (ADR 022).');
  }
  if (orchestratorResets(ledger, key) >= 1) {
    return ask(
      `${key} was already reset once by the orchestrator; the next reset is the maintainer's (ADR 022).`,
    );
  }
  return null;
}

// BUD-15 (T24): a program whose name expands or globs (`att${x}empt.mjs`, `att*.mjs`) may be the wrapper.
// T26: `{` (brace expansion) is an expansion too.
const BARE = (s) => s.replace(/['"\\]/g, '');
const EXPANDS = /[$`*?[{]/;
const ASSIGN_WORD = /^[A-Za-z_][A-Za-z0-9_]*=/;
const PREFIX_WORDS = new Set(['env', 'time', 'exec', 'command', 'nohup']);
const RUNNER_WORD =
  /^(node|python[\d.]*|bun|tsx|deno|sh|bash|zsh|pnpm|pnpx|npx|bunx|npm|yarn|env|exec|time|nohup|command)$/;
// T32: a word the shell builds (it holds an expanding, globbing or redirecting character) may be a script, whatever its shape.
const isDynamicScript = (w) => EXPANDED_ARG.test(w);

/**
 * Whether a shell segment runs a reset that the shell builds. Its program expands or globs and has `reset` or an
 * expanding word among its arguments. Or a dynamic script path (T30) comes after a runner, and another word is `reset`
 * or expands (`pnpm node scripts/att*.mjs reset`, `node -r x scripts/a{t,t}empt.mjs $x`).
 */
function runsExpandedReset(segment) {
  const words = shellWords(segment);
  let i = 0;
  while (i < words.length && (ASSIGN_WORD.test(words[i]) || PREFIX_WORDS.has(words[i]))) i++;
  const head = words.slice(i);
  if (head.length === 0) return false;
  const args = head.slice(1);
  if (EXPANDS.test(head[0]) && (args.includes('reset') || args.some((w) => EXPANDED_ARG.test(w))))
    return true;
  return words.some(
    (w, j) =>
      isDynamicScript(w) &&
      words.slice(0, j).some((p) => RUNNER_WORD.test(p)) &&
      words.some((x, k) => k !== j && (x === 'reset' || EXPANDED_ARG.test(x))),
  );
}

/** Whether a wrapper call in the text may be a reset: its first word after the file name is reset or expands. */
function wrapperMayReset(text) {
  return [...BARE(text).matchAll(WRAPPER_ANY)].some(
    (m) => m[1].toLowerCase() === 'reset' || EXPANDED_ARG.test(m[1]),
  );
}

/** BUD-14, BUD-15: whether a Bash line may reset a budget, read as the shell would run it (the commands it hides too). */
function mayReset(cmd) {
  return [cmd, ...innerShellCommands(cmd)].some(
    (text) => wrapperMayReset(text) || splitShell(text).some(runsExpandedReset),
  );
}

const GATE_QUOTED = /^\s*("[^"]*"|'[^']*')/;
// BUD-18: after the wrapper, an optional 2>&1 and exactly one read-only filter: tail -n, head -n, or grep with the
// options -i -E -v -c -n and one pattern (a single-quoted string without ' or a plain token).
const READ_ONLY_FILTER = new RegExp(
  String.raw`^\s*(?:2>&1\s*)?\|\s*(?:(?:tail|head)\s+-n\s+\d+|grep(?:\s+-[iEvcn])*\s+(?:'[^']*'|[A-Za-z0-9_.:@/-]+))\s*$`,
);
const CD_PREFIX = /^cd\s+\S+\s*&&\s*/;
const FEATURE_OPT = /--feature\s+(\S+)/;
const STEP_OPT = /--step\s+(\S+)/;
const quoteGate = (g) =>
  !g.includes('"') ? `"${g}"` : !g.includes("'") ? `'${g}'` : `"${g.replace(/"/g, '\\"')}"`;

/**
 * BUD-20: the wrapper call the agent should make instead, ready to run. The feature is the worktree's when the command
 * runs in one, else the call's own, else `<feature>`; the step is the call's, else `<step>`.
 */
function correctedCommand(cmd, input) {
  const sep = /\s--\s+/.exec(cmd);
  const head = sep ? cmd.slice(0, sep.index) : cmd;
  let gate;
  if (sep) {
    const rest = cmd.slice(sep.index + sep[0].length);
    const quoted = GATE_QUOTED.exec(rest);
    gate = quoted ? quoted[1].slice(1, -1) : rest.trim();
  } else {
    gate = cmd.trim().replace(CD_PREFIX, '');
  }
  const worktree = WORKTREE.exec(cmd)?.[1] ?? WORKTREE.exec(String(input?.cwd ?? ''))?.[1] ?? null;
  const feature = worktree ?? FEATURE_OPT.exec(head)?.[1] ?? '<feature>';
  const step = STEP_OPT.exec(head)?.[1] ?? '<step>';
  return `node scripts/attempt.mjs run --feature ${feature} --step ${step} -- ${quoteGate(gate)}`;
}

/** BUD-18/19 and the quoting rule: null when a wrapper call is allowed, otherwise why it is denied. */
function wrapperProblem(cmd) {
  const sep = /\s--\s+/.exec(cmd);
  if (!sep)
    return segments(cmd).length > 1
      ? 'Quote the whole gate command after "--" so nothing runs outside the attempt wrapper.'
      : null;
  const head = cmd.slice(0, sep.index);
  const rest = cmd.slice(sep.index + sep[0].length);
  const quote = 'Quote the whole gate command after "--" so nothing runs outside the attempt wrapper.';
  if (segments(head).length > 1) return quote;
  const quoted = GATE_QUOTED.exec(rest);
  if (!quoted) return segments(rest).length > 1 ? quote : null;
  const tail = rest.slice(quoted[0].length);
  if (tail.trim() === '' || /^\s*2>&1\s*$/.test(tail) || READ_ONLY_FILTER.test(tail)) return null;
  return 'After the wrapper only 2>&1 and one read-only filter may follow (| tail -n N, | head -n N, | grep [-i -E -v -c -n] PATTERN).';
}

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
  if (
    EDIT_TOOLS.has(tool) &&
    (rel.startsWith('.git/') || rel.includes('/.git/') || rel === '.git' || /(^|\/)d2rmm\//.test(rel))
  ) {
    return deny('Files under .git/ (including the retry ledger and the verdicts) are off-limits.');
  }
  if (tool === 'Bash' && (LEDGER_REF.test(cmd) || GIT_DIR_CD.test(cmd))) {
    return deny(
      'The retry ledger and the security verdicts are maintained by the hooks and scripts/attempt.mjs only, and no shell enters .git.',
    );
  }
  // BUD-14, BUD-15: every wrapper call in the line is read, so a reset behind a status call is judged too, and so is one
  // spelled with quotes, escapes or case, or run by an expanded program (T24).
  if (tool === 'Bash' && mayReset(cmd)) {
    const answer = resetDecision(cmd, ctx.ledger);
    if (answer) return answer;
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
      const problem = wrapperProblem(cmd);
      return problem ? deny(`${problem} Run it as: ${correctedCommand(cmd, input)}`) : null;
    }
    // Nested shells (`bash -c "pnpm test"`, `eval …`) run their command too: judge what they hide.
    const executed = [cmd, ...innerShellCommands(cmd)].flatMap(segments);
    if (executed.some(runsSensor)) {
      return deny(
        'During a phase run, tests and gates run only through the retry-budget wrapper: ' +
          '`node scripts/attempt.mjs run --feature <feature> --step <T#|spec|tasks|proofs|verification|integration> -- "<command>"`. ' +
          `Run it as: ${correctedCommand(cmd, input)}`,
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
    [cmd, ...innerShellCommands(cmd)]
      .flatMap(segments)
      .some((s) => /\bgit\b(?:\s+-[Cc]\s+\S+)*\s+commit\b/.test(s))
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
 * BUD-07: `failing` lists each failing check as { status, output }; when every one is environmental (ENV signatures,
 * no test-failure marker) the red stop is not counted and the agent may stop.
 * BUD-31: only the first UNCOUNTED_RED_STOPS_PER_SESSION such red stops of a session are left uncounted; a red stop of
 * a session with no session id (`unknown-session`) is never left uncounted.
 * Mutates the ledger. Returns { block, message }.
 */
export function onStop(ledger, sid, failuresText, failing = []) {
  const key = unitKey('stop', sid);
  if (!failuresText) {
    clearIfOpen(ledger, key);
    return { block: false, message: '' };
  }
  const signatures = failing.map(
    (check) => classify({ status: check.status, output: check.output })?.signature,
  );
  const namedSession = !String(sid).startsWith('unknown-session');
  if (
    signatures.length > 0 &&
    signatures.every(Boolean) &&
    namedSession &&
    uncountedRedStopsOf(ledger, sid) < UNCOUNTED_RED_STOPS_PER_SESSION
  ) {
    recordUncountedRedStop(ledger, sid);
    const used = uncountedRedStopsOf(ledger, sid);
    return {
      block: false,
      message:
        `[d2rmm stop] Sensors are red because of the machine (${[...new Set(signatures)].join(', ')}). ` +
        `The red stop is not counted (${used} of ${UNCOUNTED_RED_STOPS_PER_SESSION} this session); ` +
        'the machine needs attention before the next run.',
    };
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
