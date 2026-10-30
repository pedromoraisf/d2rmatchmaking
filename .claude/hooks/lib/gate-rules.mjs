// Gate rules for the Claude Code PreToolUse hook (ADR 019, ADR 021).
// Pure: every decision is a function of the tool call and a read-only repo context,
// so the rules are unit-tested in gate-rules.test.mjs.
//
// deny → the call never runs; the reason goes back to the agent.
// ask  → Claude Code asks the human. This is how mid-phase escalations reach the user.
import { activePhase, approvalsIn } from './delegation.mjs';
import { compareBaselines } from '../../../scripts/lib/ratchet.mjs';
import { sessionId } from '../../../scripts/lib/budget.mjs';
import { checkBudget, countDenial } from './budget-rules.mjs';

const deny = (reason) => ({ decision: 'deny', reason });
const ask = (reason) => ({ decision: 'ask', reason });

// ---------------------------------------------------------------- paths
const ENV_FILE = /(^|\/)\.env($|\.(?!example$)[^/]*$)/;
const VENDORED = /^\.claude\/skills\/tlc-spec-driven\//;
const MIGRATION = /^apps\/api\/(src\/)?.*migrations\/[^/]+\.(sql|ts)$/;
const ADR = /^docs\/adr\/\d{3}-[^/]+\.md$/;
const BASELINE = '.quality-baseline.json';
const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?$)|(^|\/)tests?\/.*\.rs$|(^|\/)__tests__\//;
const SPEC_DOC = /^\.specs\/features\/[^/]+\/(spec|tasks)\.md$/;
const BRIEF = /^\.specs\/phases\/F\d+\/brief\.md$/;
const HARNESS_FILES = [
  /^\.claude\/settings\.json$/,
  /^\.claude\/hooks\//,
  /^\.claude\/agents\//,
  /^\.claude\/skills\/d2rmm-phase-runner\//,
  /^lefthook\.yml$/,
  /^\.dependency-cruiser\.cjs$/,
  /^eslint\.config\.mjs$/,
  /^\.harness-score\.json$/,
  /^\.gitleaks\.toml$/,
  /^\.github\/workflows\//,
  /(^|\/)stryker\.config\.[cm]?[jt]s(on)?$/,
  /(^|\/)vitest\.config\.[cm]?[jt]s$/,
  /^scripts\/(quality-|specs-check)/,
  /^scripts\/lib\//,
];
const isHarnessFile = (rel) => HARNESS_FILES.some((re) => re.test(rel));
// The gate guards itself: no delegation covers editing the hooks or their registration.
const SELF_PROTECTED = [
  /^\.claude\/settings\.json$/,
  /^\.claude\/hooks\//,
  /^scripts\/lib\/(ratchet|budget|ledger-store|steps)\.mjs$/, // ratchet and retry budget (ADR 021/022)
  /^scripts\/attempt\.mjs$/,
  /^scripts\/test\/(ratchet|budget|attempt-cli)\.test\.mjs$/,
];
const isSelfProtected = (rel) => SELF_PROTECTED.some((re) => re.test(rel));

// ---------------------------------------------------------------- bash
const RM_SAFE = /^(\.\/)?((apps|packages)\/[^/]+\/)?(node_modules|dist|build|coverage|\.turbo|target|reports|\.stryker-tmp|mutants\.out[^/]*|test-results|playwright-report)(\/.*)?$|^\/tmp\/|^\$TMPDIR|^\$\{?RUNNER_TEMP/;
const PROD_DB = /neon\.tech|NEON_DATABASE_URL|DATABASE_URL_PROD|PROD(UCTION)?_DATABASE_URL|PGPASSWORD=/i;

function splitCommands(cmd) {
  // Good enough for gating: split on ; && || | and newlines (quotes are rare in risky commands).
  return cmd
    .split(/\n|;|&&|\|\||\|/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function words(segment) {
  return segment.match(/"[^"]*"|'[^']*'|\S+/g)?.map((w) => w.replace(/^["']|["']$/g, '')) ?? [];
}

export function checkBash(command, ctx) {
  const cmd = String(command ?? '');
  if (PROD_DB.test(cmd)) {
    return deny('Production database access is an escalation: never run commands with the production connection string. Ask the maintainer.');
  }
  if (/--no-verify\b|\bLEFTHOOK=0\b|\bHUSKY=0\b|\bSKIP_HOOKS?\b/.test(cmd)) {
    return deny('Bypassing local sensors (--no-verify / disabling Lefthook) is not allowed. Fix what the hook reports.');
  }
  for (const seg of splitCommands(cmd)) {
    const w = words(seg);
    const at = w.findIndex((x) => !/^[A-Z_]+=/.test(x)); // skip env assignments
    const head = w.slice(at);
    const [c0, c1] = head;

    if (c0 === 'git') {
      const rest = head.slice(1).join(' ');
      if (c1 === 'push' && /(^|\s)(-f|--force|--force-with-lease|--mirror|--delete|-d)\b|\s\+\S/.test(rest)) {
        return deny('Force push / remote deletion is never allowed.');
      }
      if (c1 === 'push') return ask('git push needs the maintainer’s explicit go-ahead (escalation: remote operation).');
      if (c1 === 'reset' && /--hard/.test(rest)) return deny('git reset --hard discards work. Use git stash or a new commit.');
      if (c1 === 'clean' && /-[a-z]*f/.test(rest)) return ask('git clean -f deletes untracked files.');
      if ((c1 === 'checkout' || c1 === 'restore') && /(^|\s)(--\s+)?\.(\s|$)/.test(rest)) {
        return ask('Discarding all working-tree changes.');
      }
      if (c1 === 'merge' && (ctx.currentBranch?.() === 'main' || /\bmain\b/.test(rest))) {
        return ask('Merging into main is an escalation (phase review).');
      }
      if (c1 === 'rm' && head.slice(2).some((p) => TEST_FILE.test(p))) {
        return ask('Deleting tests is an escalation: tests are never removed to make a gate pass.');
      }
      if (c1 === 'tag' && !/(^|\s)(-l|--list)\b/.test(rest) && head.length > 2) {
        return ask('Tags trigger releases (agent-v*). Ask first.');
      }
    }

    if (c0 === 'gh') {
      if (c1 === 'secret' || (c1 === 'variable' && head[2] === 'set')) return ask('Creating or changing secrets/variables is an escalation.');
      if (c1 === 'pr' && head[2] === 'merge') return ask('Merging a PR is an escalation (phase review).');
      if (c1 === 'release') return ask('Releases are an escalation.');
      if (c1 === 'workflow' && head[2] === 'run') return ask('Running workflows manually can deploy. Ask first.');
      if (c1 === 'repo' && /delete|archive|edit/.test(head[2] ?? '')) return deny('Repository settings are maintainer-only.');
    }

    if (c0 === 'wrangler' || (c0 === 'npx' && c1 === 'wrangler') || (c0 === 'pnpm' && c1 === 'wrangler')) {
      if (/\b(deploy|publish|secret)\b/.test(seg)) return ask('Cloudflare deploys and secrets are escalations.');
    }
    if (/api\.render\.com\/deploy|RENDER_DEPLOY_HOOK/.test(seg)) return ask('Render deploys are an escalation.');
    if ((c0 === 'npm' || c0 === 'pnpm') && c1 === 'publish') return ask('Publishing packages is an escalation.');

    if (c0 === 'rm') {
      const flags = head.filter((x) => x.startsWith('-')).join('');
      const targets = head.slice(1).filter((x) => !x.startsWith('-'));
      if (/r/i.test(flags) && targets.some((t) => t === '/' || t === '~' || t === '.' || t === '*' || t === '..')) {
        return deny(`Refusing "${seg}".`);
      }
      if (/r/i.test(flags) && targets.some((t) => !RM_SAFE.test(t))) {
        return deny(`rm -r is allowed only on build/test output folders (node_modules, dist, coverage, target, reports…). Blocked: ${targets.filter((t) => !RM_SAFE.test(t)).join(' ')}`);
      }
      if (targets.some((t) => TEST_FILE.test(t))) return ask('Deleting tests is an escalation.');
    }

    // Reading or printing secrets files.
    if (/(^|\s)(cat|less|more|head|tail|type|bat|cp|mv|source|\.)\s/.test(` ${seg}`) && head.some((x) => ENV_FILE.test(x))) {
      return deny('.env files hold secrets and are off-limits to the agent. Use .env.example.');
    }

    // Shell writes to harness files bypass the Edit-level checks below.
    const writes = /(\bsed\s+-i|\btee\b|>|\bmv\b|\bcp\b|\btruncate\b|\bperl\s+-p?i)/.test(seg);
    if (writes && head.some((x) => x === BASELINE || x.endsWith(`/${BASELINE}`))) {
      return deny('Edit .quality-baseline.json with the Edit tool (so the ratchet check runs) or via `pnpm quality:ratchet --update`.');
    }
    if (writes && head.some((x) => isHarnessFile(x.replace(/^\.\//, '')))) {
      return ask('Shell write to a harness/sensor file. Use the Edit tool so the gate can check it.');
    }
  }
  return null;
}

// ---------------------------------------------------------------- edits
function applyEdits(before, input) {
  if (typeof input.content === 'string') return input.content; // Write
  let text = before ?? '';
  const edits = Array.isArray(input.edits) ? input.edits : [{ old_string: input.old_string, new_string: input.new_string, replace_all: input.replace_all }];
  for (const e of edits) {
    if (typeof e.old_string !== 'string' || typeof e.new_string !== 'string') continue;
    text = e.replace_all ? text.split(e.old_string).join(e.new_string) : text.replace(e.old_string, e.new_string);
  }
  return text;
}

const countTests = (text) =>
  (text.match(/\b(it|test)(\.each\([^)]*\))?\s*\(/g) ?? []).length + (text.match(/#\[(tokio::)?test\]/g) ?? []).length;

function newApprovalLines(before, after) {
  const old = new Set(approvalsIn(before).map((a) => a.line));
  return approvalsIn(after).filter((a) => !old.has(a.line));
}

export function checkEdit(rel, toolInput, ctx) {
  if (!rel || rel.startsWith('..')) return deny('Edits outside the repository are not allowed.');
  if (ENV_FILE.test(rel)) return deny('.env files hold secrets. Put placeholders in .env.example; real values live in GitHub/Render secrets.');
  if (VENDORED.test(rel)) return deny('tlc-spec-driven is vendored and unmodified (see VENDORED.md). Project behaviour goes in .claude/skills/d2rmm-phase-runner.');
  if (MIGRATION.test(rel) && ctx.isTracked(rel)) return deny('This migration is already committed. Add a new migration instead of editing an applied one.');

  const before = ctx.readFile(rel);
  const after = applyEdits(before, toolInput);

  if (rel === BASELINE) {
    let b, a;
    try {
      b = before ? JSON.parse(before) : { metrics: {} };
      a = JSON.parse(after);
    } catch {
      return deny('.quality-baseline.json must stay valid JSON.');
    }
    const loosened = compareBaselines(b, a);
    if (loosened.length > 0) {
      return deny(`The quality baseline is a ratchet: it only tightens. Loosening needs the maintainer: ${loosened.join('; ')}`);
    }
    return null;
  }

  if (TEST_FILE.test(rel) && before !== null) {
    if (/\b(it|test|describe)\.only\s*\(/.test(after)) return deny('.only() would silence the rest of the suite.');
    const skipsBefore = (before.match(/\.(skip|todo)\s*\(|#\[ignore\]/g) ?? []).length;
    const skipsAfter = (after.match(/\.(skip|todo)\s*\(|#\[ignore\]/g) ?? []).length;
    if (skipsAfter > skipsBefore) return ask('Skipping tests is an escalation (tests are never weakened to pass a gate).');
    if (countTests(after) < countTests(before)) return ask('This edit removes test cases. Removing tests is an escalation.');
  }

  const added = newApprovalLines(before, after);
  if (added.length > 0) {
    if (BRIEF.test(rel)) {
      return ask('Only the maintainer approves a phase brief. Confirm these are the maintainer’s own words.');
    }
    if (SPEC_DOC.test(rel)) {
      const phase = activePhase(ctx);
      if (!phase?.approved || !phase.scopes.has('specs-and-tasks')) {
        return ask('Approvals are the maintainer’s. No approved phase delegation covers specs/tasks — confirm with the maintainer.');
      }
      const delegated = phase.approvals.map((a) => a.words);
      const bad = added.filter((a) => !delegated.includes(a.words) || !a.line.includes(`delegated via ${phase.briefPath}`));
      if (bad.length > 0) {
        return deny(`A delegated approval must quote the kickoff words verbatim and cite "(delegated via ${phase.briefPath})". Run the automatic gates first.`);
      }
      return null;
    }
    return ask('Approval line written outside a spec/tasks/brief file.');
  }

  if (ADR.test(rel) && before && /^\**\s*Status\s*\**\s*:\s*\**\s*Accepted/im.test(before)) {
    return ask('Changing an accepted ADR is an escalation. Write a new ADR that supersedes it instead.');
  }

  if (isSelfProtected(rel)) {
    return ask('The gate and its registration protect themselves: the maintainer confirms every change here.');
  }
  if (isHarnessFile(rel)) {
    const phase = activePhase(ctx);
    if (phase?.approved && phase.scopes.has('harness-edits')) return null;
    return ask('Harness/sensor configuration change. Outside a phase that delegated `harness-edits`, the maintainer confirms it.');
  }
  return null;
}

function regularRules(tool, ti, ctx, toRelative) {
  if (tool === 'Bash') return checkBash(ti.command, ctx);
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    return checkEdit(toRelative(ctx.root, ti.file_path ?? ti.notebook_path), ti, ctx);
  }
  if (tool === 'Read' || tool === 'Grep') {
    const rel = toRelative(ctx.root, ti.file_path ?? ti.path ?? '');
    if (ENV_FILE.test(rel)) return deny('.env files hold secrets and are off-limits to the agent.');
  }
  return null;
}

/**
 * Entry point. Returns { decision, reason, effects } or null (no opinion → normal permission flow).
 * `effects` are ledger updates (ADR 022) that gate.mjs applies under the ledger lock.
 */
export function decide(input, ctx, toRelative) {
  const tool = input?.tool_name ?? '';
  const ti = input?.tool_input ?? {};
  const sid = sessionId(input);
  const rel = toRelative(ctx.root, ti.file_path ?? ti.notebook_path ?? '');

  const budget = checkBudget(input, ctx, sid, rel);
  if (budget?.decision) {
    return budget.reason.startsWith('Retry budget exhausted') ? budget : countDenial(budget, ctx, sid);
  }
  const result = regularRules(tool, ti, ctx, toRelative);
  const counted = countDenial(result, ctx, sid);
  if (budget?.effects?.length) {
    return counted ? { ...counted, effects: [...budget.effects, ...(counted.effects ?? [])] } : { decision: null, reason: '', effects: budget.effects };
  }
  return counted;
}
