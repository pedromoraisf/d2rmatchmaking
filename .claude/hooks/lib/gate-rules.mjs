// Gate rules for the Claude Code PreToolUse hook (ADR 019, ADR 021).
// Pure: every decision is a function of the tool call and a read-only repo context,
// so the rules are unit-tested in gate-rules.test.mjs.
//
// deny → the call never runs; the reason goes back to the agent.
// ask  → Claude Code asks the human. This is how mid-phase escalations reach the user.
import { activePhase, approvalsIn } from './delegation.mjs';
import { checkBackgroundReview, noteDispatch } from './verdicts.mjs';
import { allowedShape, deliveryDecision, mergesAfterMainSwitch } from './delivery.mjs';
import { guardDecision } from './guard.mjs';
import { compareBaselines } from '../../../scripts/lib/ratchet.mjs';
import { sessionId } from '../../../scripts/lib/budget.mjs';
import { checkBudget, countDenial, GIT_DIR_CD, LEDGER_REF } from './budget-rules.mjs';
import { countScenarios } from '../../../scripts/lib/acceptance.mjs';
import { checkMutationSpec } from '../../../scripts/lib/mutation-scope.mjs';
import { indirections, MAX_DEPTH, SHELL } from './shell-indirection.mjs';
import { resolveInside } from './io.mjs';
import path from 'node:path';

const deny = (reason) => ({ decision: 'deny', reason });
const ask = (reason) => ({ decision: 'ask', reason });
const strongest = (a, b) => (a?.decision === 'deny' ? a : b?.decision === 'deny' ? b : (a ?? b));

// ---------------------------------------------------------------- paths
const ENV_FILE = /(^|\/)\.env($|\.(?!example$)[^/]*$)/;
const VENDORED = /^\.claude\/skills\/tlc-spec-driven\//;
const MIGRATION = /^apps\/api\/(src\/)?.*migrations\/[^/]+\.(sql|ts)$/;
const ADR = /^docs\/adr\/\d{3}-[^/]+\.md$/;
const BASELINE = '.quality-baseline.json';
const TEST_FILE =
  /(\.(test|spec)\.[cm]?[jt]sx?$)|(^|\/)tests?\/.*\.rs$|(^|\/)__tests__\/|\.feature$|^tests\/acceptance\/steps\//;
const FEATURE_FILE = /\.feature$/;
const GHERKIN_SKIP = /(^|\s)@(skip|fixme|fail|wip|ignore|todo)\b/gi;
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
  /(^|\/)playwright\.config\.[cm]?[jt]s$/,
  /^scripts\/(acceptance-check\.mjs|lib\/(gherkin|acceptance)\.mjs)$/,
  /^scripts\/(phase-status|commit-trailers)\.mjs$/,
  /^scripts\/lib\/(phase-state|trailers|roadmap)\.mjs$/,
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
const RM_SAFE =
  /^(\.\/)?((apps|packages)\/[^/]+\/)?(node_modules|dist|build|coverage|\.turbo|target|reports|\.stryker-tmp|mutants\.out[^/]*|test-results|playwright-report)(\/.*)?$|^\/tmp\/|^\$TMPDIR|^\$\{?RUNNER_TEMP/;
const PROD_DB = /neon\.tech|NEON_DATABASE_URL|DATABASE_URL_PROD|PROD(UCTION)?_DATABASE_URL|PGPASSWORD=/i;

function splitCommands(cmd) {
  // Good enough for gating: split on ; && || | and newlines (quotes are rare in risky commands).
  // Commands hidden inside quotes (`bash -c "…"`) are judged separately, see checkIndirections().
  return cmd
    .split(/\n|;|&&|\|\||\|/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function words(segment) {
  return segment.match(/"[^"]*"|'[^']*'|\S+/g)?.map((w) => w.replace(/^["']|["']$/g, '')) ?? [];
}

// Global options come before the subcommand: `git -C dir push` is a push.
const GIT_VALUED = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
  '--config-env',
]);
function gitArgs(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) i += GIT_VALUED.has(args[i]) ? 2 : 1;
  return args.slice(i);
}

// ADR 026: mutations are proved by unit tests only. Whoever runs mutate.py / check_proofs.py --mutations
// hands the gate a spec file; every proof in it must be a unit-test command.
const MUTATION_RUN = /\b(?:mutate\.py\b[^|;&]*?--spec|check_proofs\.py\b[^|;&]*?--mutations)(?:\s+|=)(\S+)/;
function checkMutationRun(cmd, ctx) {
  const m = MUTATION_RUN.exec(cmd);
  if (!m) return null;
  const arg = m[1].replace(/^['"]|['"]$/g, '');
  if (arg === '-') {
    return deny(
      'Pass the mutation spec as a file so its proofs can be checked: mutations run against unit tests only (ADR 026).',
    );
  }
  const rel = arg.startsWith(`${ctx.root}/`) ? arg.slice(ctx.root.length + 1) : arg.replace(/^\.\//, '');
  const text = ctx.readFile(rel);
  if (text === null) return null;
  let spec;
  try {
    spec = JSON.parse(text);
  } catch {
    return deny(`${rel} is not valid JSON, so the mutation scope cannot be checked (ADR 026).`);
  }
  const errors = checkMutationSpec(spec);
  if (errors.length === 0) return null;
  return deny(
    `Mutations run against unit tests only (ADR 026). Fix ${rel} first (\`node scripts/mutation-scope-check.mjs --file ${rel}\`): ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? `; and ${errors.length - 3} more` : ''}`,
  );
}

// ---------------------------------------------------------------- indirection
// A command can hide the one that really runs: `bash -c "…"`, `eval`, `sudo`/`env`/`timeout`, `xargs`, `find -exec`,
// inline interpreter code, a script, a shell reading a pipe. Each is judged by what it hides (shell-indirection.mjs).
const INLINE_ENV = /(^|[^\w.])\.env(\.(?!example\b)[\w-]+)?(?![\w./-])/;
const INLINE_SPAWN =
  /\bchild_process\b|\b(execSync|execFileSync|spawnSync|execFile|spawn)\s*\(|\bsubprocess\b|\bos\.(system|popen|exec\w*|spawn\w*)\b|\bpty\.spawn\b|\bDeno\.(run|Command)\b|\bBun\.(spawn|\$)|(?<![.\w])(system|exec)\s*\(|%x[({]|\bqx[({/]|\bIO\.popen\b|\bOpen3\b/;
const INLINE_WRITE =
  /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|unlink|unlinkSync|rm|rmSync|rmdir|rmdirSync|rename|renameSync|truncate|truncateSync|copyFile|copyFileSync|cpSync|write_text|write_bytes|remove|rmtree|move|copyfile|copy2)\s*\(|\bopen\s*\([^)]*['"][^'"]*[wax+]|\.write\s*\(|\bunlink\b|\bFile\.(write|delete|open)\b/;
const SHELL_SCRIPT = /\.(sh|bash|zsh)$/;

function isGuardedPath(token, root) {
  let rel = token.startsWith(`${root}/`) ? token.slice(root.length + 1) : token;
  rel = rel.replace(/^\.\//, '').replace(/^\.claude\/worktrees\/[^/]+\//, '');
  return (
    rel === BASELINE ||
    VENDORED.test(rel) ||
    MIGRATION.test(rel) ||
    ADR.test(rel) ||
    TEST_FILE.test(rel) ||
    SPEC_DOC.test(rel) ||
    BRIEF.test(rel) ||
    /^\.git(\/|$)/.test(rel) ||
    /^\.specs\/phases\/F\d+\/attempts\.json$/.test(rel) ||
    isHarnessFile(rel) ||
    isSelfProtected(rel)
  );
}

/** Inline interpreter code (`python -c`, `node -e`, a heredoc, an untracked script): what the shell rules can't see. */
function checkInlineCode(code, ctx) {
  const text = String(code ?? '');
  if (LEDGER_REF.test(text) || GIT_DIR_CD.test(text)) {
    return deny(
      'This code names the retry ledger or the security verdicts, or enters .git: only the hooks and scripts/attempt.mjs touch those.',
    );
  }
  if (INLINE_ENV.test(text)) {
    return deny(
      '.env files hold secrets and are off-limits to the agent, from inline code too. Use .env.example.',
    );
  }
  if (INLINE_SPAWN.test(text)) {
    return ask(
      'This code starts other processes, which hides those commands from the gate. Run them as shell commands instead.',
    );
  }
  if (INLINE_WRITE.test(text)) {
    const hit = (text.match(/[\w@.\-/]+/g) ?? []).find((t) => /[./]/.test(t) && isGuardedPath(t, ctx.root));
    if (hit) {
      return ask(
        `This code writes and names ${hit}, a protected file. Use the Edit tool so the gate can check it.`,
      );
    }
  }
  return null;
}

function checkScript(x, ctx, depth) {
  const rel = x.path.startsWith(`${ctx.root}/`)
    ? x.path.slice(ctx.root.length + 1)
    : x.path.replace(/^\.\//, '');
  if (/^(\/|~|\.\.)/.test(rel) || rel.includes('$')) {
    return ask(
      `${x.path} is a script outside the repository, so the gate cannot read it. Run its commands directly or add it to the repo.`,
    );
  }
  if (ctx.isTracked?.(rel)) return null; // committed through the same sensors
  const text = ctx.readFile(rel);
  if (text === null) return null;
  const shell =
    (x.via && SHELL.test(x.via)) || SHELL_SCRIPT.test(rel) || /^#!.*\b(ba|z|da|k)?sh\b/.test(text);
  return shell ? checkBash(text, ctx, depth + 1) : checkInlineCode(text, ctx);
}

function checkIndirections(cmd, ctx, depth) {
  let found = null;
  for (const x of indirections(cmd)) {
    let r = null;
    if (x.kind === 'shell') r = checkBash(x.text, ctx, depth + 1);
    else if (x.kind === 'code') r = checkInlineCode(x.text, ctx);
    else if (x.kind === 'script') r = checkScript(x, ctx, depth);
    else if (!/<</.test(cmd)) {
      r = ask(
        `${x.lang} is reading commands from a pipe, which hides them from the gate. Run them directly.`,
      );
    } else if (!SHELL.test(x.lang)) {
      r = checkInlineCode(cmd, ctx); // a heredoc: its body is part of this command line
    } // a shell heredoc: its lines are already judged as segments of this command
    found = strongest(found, r);
    if (found?.decision === 'deny') return found;
  }
  return found;
}

export function checkBash(command, ctx, depth = 0) {
  const cmd = String(command ?? '');
  if (depth > MAX_DEPTH) {
    return ask('This command nests shells too deep to check what runs. Run the inner command directly.');
  }
  // HBS-31: nested shells and untracked scripts are judged by their text too.
  if (LEDGER_REF.test(cmd) || GIT_DIR_CD.test(cmd)) {
    return deny(
      'The retry ledger and the security verdicts are maintained by the hooks and scripts/attempt.mjs only, and no shell enters .git.',
    );
  }
  // ADR 028 § 1: one delivery command in an allowed shape runs without asking, unless another rule denies or asks.
  // Only the top-level line can be such a shape: a command hidden in a nested shell or a wrapper is judged as a segment.
  const shaped = depth === 0 && allowedShape(cmd, ctx);
  const found = strongest(checkSegments(cmd, ctx, shaped), checkIndirections(cmd, ctx, depth));
  if (found) return found;
  return shaped
    ? { decision: 'allow', reason: 'ADR 028 § 1: a delivery command in an allowed shape.' }
    : null;
}

function checkSegments(cmd, ctx, shaped) {
  if (PROD_DB.test(cmd)) {
    return deny(
      'Production database access is an escalation: never run commands with the production connection string. Ask the maintainer.',
    );
  }
  if (/--no-verify\b|\bLEFTHOOK=0\b|\bHUSKY=0\b|\bSKIP_HOOKS?\b/.test(cmd)) {
    return deny(
      'Bypassing local sensors (--no-verify / disabling Lefthook) is not allowed. Fix what the hook reports.',
    );
  }
  const mutationDenial = checkMutationRun(cmd, ctx);
  if (mutationDenial) return mutationDenial;
  // The merge guard (ADR 028 § 3) denies whatever the shape: its denial beats the allow of an allowed shape.
  const guarded = guardDecision(cmd, ctx);
  if (guarded?.decision === 'deny') return guarded;
  if (shaped) return guarded; // a whole line in an allowed shape has no other command to judge
  let found = strongest(
    guarded,
    mergesAfterMainSwitch(cmd)
      ? ask('Merging after switching to main is an escalation: the maintainer decides it (HBS-14).')
      : null,
  );
  for (const seg of splitCommands(cmd)) {
    found = strongest(found, checkSegment(seg, ctx));
    if (found?.decision === 'deny') return found;
  }
  return found;
}

/** The ADR 019/021 rules for one segment (the delivery rules of ADR 028 come first). */
function checkSegment(seg, ctx) {
  const delivery = deliveryDecision(seg, ctx);
  if (delivery) return delivery;
  const w = words(seg);
  const at = w.findIndex((x) => !/^[A-Z_]+=/.test(x)); // skip env assignments
  const head = w.slice(at);
  const [c0, c1] = head;

  if (c0 === 'git') {
    const g = gitArgs(head.slice(1));
    const [sub] = g;
    const rest = g.join(' ');
    if (sub === 'push' && /(^|\s)(-f|--force|--force-with-lease|--mirror|--delete|-d)\b|\s\+\S/.test(rest)) {
      return deny('Force push / remote deletion is never allowed.');
    }
    if (sub === 'push')
      return ask('git push needs the maintainer’s explicit go-ahead (escalation: remote operation).');
    if (sub === 'reset' && /--hard/.test(rest))
      return deny('git reset --hard discards work. Use git stash or a new commit.');
    if (sub === 'clean' && /-[a-z]*f/.test(rest)) return ask('git clean -f deletes untracked files.');
    if ((sub === 'checkout' || sub === 'restore') && /(^|\s)(--\s+)?\.(\s|$)/.test(rest)) {
      return ask('Discarding all working-tree changes.');
    }
    if (sub === 'merge' && (ctx.currentBranch?.() === 'main' || /\bmain\b/.test(rest))) {
      return ask('Merging into main is an escalation (phase review).');
    }
    if (sub === 'rm' && g.slice(1).some((p) => TEST_FILE.test(p))) {
      return ask('Deleting tests is an escalation: tests are never removed to make a gate pass.');
    }
    if (sub === 'tag' && !/(^|\s)(-l|--list)\b/.test(rest) && g.length > 1) {
      return ask('Tags trigger releases (agent-v*). Ask first.');
    }
  }

  if (c0 === 'gh') {
    if (c1 === 'secret' || (c1 === 'variable' && head[2] === 'set'))
      return ask('Creating or changing secrets/variables is an escalation.');
    if (c1 === 'pr' && head[2] === 'merge') return ask('Merging a PR is an escalation (phase review).');
    if (c1 === 'release') return ask('Releases are an escalation.');
    if (c1 === 'workflow' && head[2] === 'run')
      return ask('Running workflows manually can deploy. Ask first.');
    if (c1 === 'repo' && /delete|archive|edit/.test(head[2] ?? ''))
      return deny('Repository settings are maintainer-only.');
  }

  if (c0 === 'wrangler' || (c0 === 'npx' && c1 === 'wrangler') || (c0 === 'pnpm' && c1 === 'wrangler')) {
    if (/\b(deploy|publish|secret)\b/.test(seg))
      return ask('Cloudflare deploys and secrets are escalations.');
  }
  if (/api\.render\.com\/deploy|RENDER_DEPLOY_HOOK/.test(seg))
    return ask('Render deploys are an escalation.');
  if ((c0 === 'npm' || c0 === 'pnpm') && c1 === 'publish')
    return ask('Publishing packages is an escalation.');

  if (c0 === 'rm') {
    const flags = head.filter((x) => x.startsWith('-')).join('');
    const targets = head.slice(1).filter((x) => !x.startsWith('-'));
    if (
      /r/i.test(flags) &&
      targets.some((t) => t === '/' || t === '~' || t === '.' || t === '*' || t === '..')
    ) {
      return deny(`Refusing "${seg}".`);
    }
    if (/r/i.test(flags) && targets.some((t) => !RM_SAFE.test(t))) {
      return deny(
        `rm -r is allowed only on build/test output folders (node_modules, dist, coverage, target, reports…). Blocked: ${targets.filter((t) => !RM_SAFE.test(t)).join(' ')}`,
      );
    }
    if (targets.some((t) => TEST_FILE.test(t))) return ask('Deleting tests is an escalation.');
  }

  // Reading or printing secrets files.
  if (
    /(^|\s)(cat|less|more|head|tail|type|bat|cp|mv|source|\.)\s/.test(` ${seg}`) &&
    head.some((x) => ENV_FILE.test(x))
  ) {
    return deny('.env files hold secrets and are off-limits to the agent. Use .env.example.');
  }

  // Shell writes to harness files bypass the Edit-level checks below. BUD-18: a descriptor redirection (2>&1, >&2,
  // >/dev/null) writes no file, so its `>` is not a write.
  const writeText = seg.replace(/\d*>&\d+|&?\d*>>?\s*\/dev\/null/g, ' ');
  const writes = /(\bsed\s+-i|\btee\b|>|\bmv\b|\bcp\b|\btruncate\b|\bperl\s+-p?i)/.test(writeText);
  if (writes && head.some((x) => x === BASELINE || x.endsWith(`/${BASELINE}`))) {
    return deny(
      'Edit .quality-baseline.json with the Edit tool (so the ratchet check runs) or via `pnpm quality:ratchet --update`.',
    );
  }
  if (writes && head.some((x) => isHarnessFile(inRepoPath(x)) || isSelfProtected(inRepoPath(x)))) {
    return ask('Shell write to a harness/sensor file. Use the Edit tool so the gate can check it.');
  }
  return null;
}

// ---------------------------------------------------------------- edits
function applyEdits(before, input) {
  if (typeof input.content === 'string') return input.content; // Write
  let text = before ?? '';
  const edits = Array.isArray(input.edits)
    ? input.edits
    : [{ old_string: input.old_string, new_string: input.new_string, replace_all: input.replace_all }];
  for (const e of edits) {
    if (typeof e.old_string !== 'string' || typeof e.new_string !== 'string') continue;
    text = e.replace_all
      ? text.split(e.old_string).join(e.new_string)
      : text.replace(e.old_string, e.new_string);
  }
  return text;
}

const countTests = (text) =>
  (text.match(/\b(it|test)(\.each\([^)]*\))?\s*\(/g) ?? []).length +
  (text.match(/#\[(tokio::)?test\]/g) ?? []).length;

function newApprovalLines(before, after) {
  const old = new Set(approvalsIn(before).map((a) => a.line));
  return approvalsIn(after).filter((a) => !old.has(a.line));
}

export function checkEdit(rel, toolInput, ctx) {
  if (!rel || rel.startsWith('..')) return deny('Edits outside the repository are not allowed.');
  if (ENV_FILE.test(rel))
    return deny(
      '.env files hold secrets. Put placeholders in .env.example; real values live in GitHub/Render secrets.',
    );
  if (/^\.specs\/phases\/F\d+\/attempts\.json$/.test(rel))
    return deny(
      'attempts.json is the committed retry-ledger snapshot; only `phase-status --write` writes it (ADR 024).',
    );
  if (VENDORED.test(rel))
    return deny(
      'tlc-spec-driven is vendored and unmodified (see VENDORED.md). Project behaviour goes in .claude/skills/d2rmm-phase-runner.',
    );
  if (MIGRATION.test(rel) && ctx.isTracked(rel))
    return deny(
      'This migration is already committed. Add a new migration instead of editing an applied one.',
    );

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
      return deny(
        `The quality baseline is a ratchet: it only tightens. Loosening needs the maintainer: ${loosened.join('; ')}`,
      );
    }
    return null;
  }

  if (FEATURE_FILE.test(rel)) {
    if (/(^|\s)@only\b/i.test(after)) return deny('@only would silence the rest of the acceptance suite.');
    if (/^#\s*language:\s*(?!en\b)/m.test(after))
      return deny('Gherkin keywords are English in this project (ADR 023).');
    if (before !== null) {
      if ((after.match(GHERKIN_SKIP) ?? []).length > (before.match(GHERKIN_SKIP) ?? []).length) {
        return ask('Skipping acceptance scenarios is an escalation (ADR 023).');
      }
      if (countScenarios(after) < countScenarios(before)) {
        return ask('This edit removes acceptance scenarios. Removing scenarios is an escalation.');
      }
      if (
        (after.match(/^\s*#\s*not-scenario:/gm) ?? []).length >
        (before.match(/^\s*#\s*not-scenario:/gm) ?? []).length
      ) {
        return ask(
          'A new not-scenario exemption: the maintainer confirms that requirement is proved another way.',
        );
      }
    }
  }
  if (TEST_FILE.test(rel) && before !== null) {
    const onlyRe = /\b(it|test|describe)\.only\s*\(/g;
    if ((after.match(onlyRe) ?? []).length > (before.match(onlyRe) ?? []).length)
      return deny('.only() would silence the rest of the suite.');
    const skipsBefore = (before.match(/\.(skip|todo)\s*\(|#\[ignore\]/g) ?? []).length;
    const skipsAfter = (after.match(/\.(skip|todo)\s*\(|#\[ignore\]/g) ?? []).length;
    if (skipsAfter > skipsBefore)
      return ask('Skipping tests is an escalation (tests are never weakened to pass a gate).');
    if (countTests(after) < countTests(before))
      return ask('This edit removes test cases. Removing tests is an escalation.');
  }

  const added = newApprovalLines(before, after);
  if (added.length > 0) {
    if (BRIEF.test(rel)) {
      return ask('Only the maintainer approves a phase brief. Confirm these are the maintainer’s own words.');
    }
    if (SPEC_DOC.test(rel)) {
      const phase = activePhase(ctx);
      if (!phase?.approved || !phase.scopes.has('specs-and-tasks')) {
        return ask(
          'Approvals are the maintainer’s. No approved phase delegation covers specs/tasks — confirm with the maintainer.',
        );
      }
      const delegated = phase.approvals.map((a) => a.words);
      const bad = added.filter(
        (a) => !delegated.includes(a.words) || !a.line.includes(`delegated via ${phase.briefPath}`),
      );
      if (bad.length > 0) {
        return deny(
          `A delegated approval must quote the kickoff words verbatim and cite "(delegated via ${phase.briefPath})". Run the automatic gates first.`,
        );
      }
      return null;
    }
    return ask('Approval line written outside a spec/tasks/brief file.');
  }

  if (ADR.test(rel) && before && /^\**\s*Status\s*\**\s*:\s*\**\s*Accepted/im.test(before)) {
    return ask('Changing an accepted ADR is an escalation. Write a new ADR that supersedes it instead.');
  }

  if (isSelfProtected(rel)) {
    // HBS-20: a feature the brief covers edits the gate in its own worktree. Every other rule above still applied.
    if (ctx.coveredWorktree) return null;
    return ask(
      'The gate and its registration protect themselves: the maintainer confirms every change here.',
    );
  }
  if (isHarnessFile(rel)) {
    const phase = activePhase(ctx);
    if (phase?.approved && phase.scopes.has('harness-edits')) return null;
    return ask(
      'Harness/sensor configuration change. Outside a phase that delegated `harness-edits`, the maintainer confirms it.',
    );
  }
  return null;
}

/**
 * Edits inside a feature worktree (.claude/worktrees/<feature>/…) are judged exactly like edits to the same path in
 * the repository — same protected files, same test rules — reading the worktree's own copy of each file.
 */
function worktreeView(rel, ctx) {
  const m = /^(\.claude\/worktrees\/([^/]+))\/(.*)$/.exec(rel);
  if (!m) return { rel, ctx };
  const [, prefix, name, inner] = m;
  // HBS-19/20: covered only by the main checkout's brief (activePhase reads it from there).
  const covered = (activePhase(ctx)?.covered ?? []).includes(name);
  return {
    rel: inner,
    ctx: {
      ...ctx,
      coveredWorktree: covered,
      readFile: (r) => ctx.readFile(`${prefix}/${r}`),
      isTracked: (r) =>
        ctx.git ? ctx.git('-C', prefix, 'ls-files', '--error-unmatch', '--', r) !== null : false,
    },
  };
}

/**
 * The path an edit names, relative to the main checkout, after `..` and the symbolic links of its nearest existing
 * directory (HBS-20): a link out of a worktree, or a `..` through one, is judged where it really lands.
 */
function repoRelative(ctx, filePath) {
  if (!filePath) return '';
  const main = ctx.mainRoot ?? ctx.root;
  return path.relative(resolveInside(main, '.'), resolveInside(ctx.root, filePath)).split(path.sep).join('/');
}

/** A path of a shell command, relative to the main checkout, without a leading `./` (the same rule as the edits). */
function inRepoPath(token) {
  return token.replace(/^\.\//, '').replace(/^\.claude\/worktrees\/[^/]+\//, '');
}

function regularRules(tool, ti, ctx, toRelative) {
  if (tool === 'Bash') return checkBash(ti.command, ctx);
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    const view = worktreeView(repoRelative(ctx, ti.file_path ?? ti.notebook_path), ctx);
    return checkEdit(view.rel, ti, view.ctx);
  }
  if (tool === 'Agent' || tool === 'Task') return checkBackgroundReview({ tool_name: tool, tool_input: ti });
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
  // ADR 028 § 3: a foreground security review of a diff notes its head when it starts, unless it is denied.
  const effects = [...(budget?.effects ?? []), ...(counted?.effects ?? [])];
  if (counted?.decision !== 'deny') {
    const noted = noteDispatch(input, ctx);
    if (noted) effects.push(noted);
  }
  if (effects.length === 0) return counted;
  return counted ? { ...counted, effects } : { decision: null, reason: '', effects };
}
