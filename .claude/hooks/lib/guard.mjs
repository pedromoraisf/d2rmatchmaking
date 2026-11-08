// The merge guard for covered features (ADR 028 § 3): HBS-32 to HBS-36 and HBS-46 to HBS-48, and the operand-less
// `git merge` / `git pull` rule. Pure: git is read through `ctx.git` (read-only commands), the retry ledger through
// `ctx.ledger` and the verdicts through `ctx.verdicts`; nothing is written. A covered feature exists only when the
// active phase's brief (read from the main checkout) ticks `harness-self` for it.
//
// A merge of a covered branch passes only with its proofs at its head: a passed `pnpm test:harness` (exact command,
// clean tree, that commit) and a PASS verdict for that commit. Its commits must all be in the proven head; `gh pr
// merge` must pin that head with --match-head-commit and must not auto-merge.
import { activePhase } from './delegation.mjs';
import { tokenize } from './delivery.mjs';
import { latestVerdict } from './verdicts.mjs';

const deny = (reason) => ({ decision: 'deny', reason });
const ask = (reason) => ({ decision: 'ask', reason });
const strongest = (a, b) => (a?.decision === 'deny' ? a : b?.decision === 'deny' ? b : (a ?? b ?? null));

const PATCH_REASON =
  'Patches and plumbing change the index or the refs by hand: the maintainer decides them (HBS-48).';
const GIT_VALUED = ['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env'];
const READ_ONLY = new Set([
  'log',
  'diff',
  'show',
  'rev-parse',
  'rev-list',
  'merge-base',
  'status',
  'ls-files',
  'blame',
]);
const PLUMBING = new Set(['apply', 'am', 'read-tree', 'update-ref', 'update-index']);
const MERGE_VALUED = new Set([
  '-m',
  '--message',
  '-F',
  '--file',
  '-s',
  '--strategy',
  '-X',
  '--strategy-option',
  '--into-name',
  '--cleanup',
]);
const GH_MERGE_VALUED = new Set(['--subject', '-t', '--body', '-b', '--match-head-commit']);
const NONE = new Set();

const isOpt = (t) => !t.quoted && t.raw.startsWith('-') && t.raw !== '-';

/** The covered features of the active phase (HBS-19) with their branches. No phase, or no covered feature: none. */
export function guardState(ctx) {
  const phase = activePhase(ctx);
  if (!phase?.approved) return { phaseBranch: null, covered: [] };
  const covered = (phase.covered ?? []).map((feature) => ({
    feature,
    branch: `feat/${phase.id}-${feature}`,
  }));
  return { phaseBranch: `phase/${phase.id}`, covered };
}

// ---------------------------------------------------------------- git reads (read-only, through ctx.git)
const git = (ctx, ...args) => ctx.git?.(...args) ?? null;
const commitOf = (ctx, ref) => git(ctx, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
const resolves = (ctx, ref) => ref !== 'FETCH_HEAD' && Boolean(commitOf(ctx, ref));

/** The commits a range lists, or null when git cannot list them (the caller then fails closed). */
function revList(ctx, range) {
  const out = git(ctx, 'rev-list', range);
  return out === null ? null : out.split('\n').filter(Boolean);
}

/** HBS-32: `ref` touches the covered branch when they share a commit beyond the phase branch. */
function touches(ctx, state, ref, branch) {
  const a = revList(ctx, `${state.phaseBranch}..${ref}`);
  const b = revList(ctx, `${state.phaseBranch}..${branch}`);
  if (a === null || b === null) return true;
  return a.some((c) => b.includes(c));
}

const touchedCovered = (ctx, state, ref) => state.covered.filter((c) => touches(ctx, state, ref, c.branch));

/** Every commit `ref` lists beyond the phase is also listed beyond the proven head (HBS-32). */
function isSubsetOfProven(ctx, state, ref, proven) {
  const a = revList(ctx, `${state.phaseBranch}..${ref}`);
  const b = revList(ctx, `${state.phaseBranch}..${proven}`);
  return a !== null && b !== null && a.every((c) => b.includes(c));
}

/**
 * The proofs of a covered branch at its current head (HBS-26 to HBS-31): the head when both a passed harness run on a
 * clean tree and a PASS verdict exist for it, else null, with what is missing.
 */
function proofOf(ctx, c) {
  const head = commitOf(ctx, c.branch);
  if (!head) return { head: null, test: false, review: false, branchHead: null };
  const units = ctx.ledger?.units ?? {};
  const test = Object.entries(units).some(
    ([k, u]) =>
      k.startsWith(`gate:${c.feature}/`) &&
      (u.attempts ?? []).some(
        (a) => a.ok === true && a.command === 'pnpm test:harness' && a.clean === true && a.head === head,
      ),
  );
  const review = latestVerdict(ctx.verdicts, c.feature, head)?.verdict === 'PASS';
  return { head: test && review ? head : null, test, review, branchHead: head };
}

function missingReason(c, p) {
  const missing = [];
  if (!p.test) {
    missing.push(
      'a passed `pnpm test:harness` through `scripts/attempt.mjs run`, on a clean tree, at that commit',
    );
  }
  if (!p.review) {
    missing.push(
      'a PASS of a foreground `security-reviewer` dispatch with step `review-diff`, at that commit',
    );
  }
  const at =
    p.branchHead ?? 'its head (it does not resolve here: git fetch origin <branch> or push it first)';
  return `${c.branch} is a covered harness-self branch: it merges only at its proven head (ADR 028 § 3). Missing at ${at}: ${missing.join('; ')}.`;
}

// ---------------------------------------------------------------- tokens
/** The non-option words of a command, skipping the values of the valued options and stopping at `--`. */
function operandsOf(tokens, valued) {
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.raw === '--') break;
    if (!isOpt(t)) out.push(t);
    else if (valued.has(t.raw)) i += 1;
  }
  return out;
}

/** The words after `git`, without its global options (`-C dir`, `-c key=value`…). */
function gitRest(tokens) {
  let i = 0;
  while (i < tokens.length && isOpt(tokens[i])) i += GIT_VALUED.includes(tokens[i].raw) ? 2 : 1;
  return tokens.slice(i);
}

/** The operands of a git subcommand that name the commit to bring in or move to (HBS-47). */
function namingOperands(sub, rest) {
  if (sub === 'cherry-pick' || sub === 'rebase') return operandsOf(rest, NONE);
  if (sub === 'reset') return operandsOf(rest, NONE).slice(0, 1);
  if (sub === 'checkout') return operandsOf(rest, NONE).slice(0, 1);
  if (sub === 'restore') {
    const i = rest.findIndex((t) => t.raw === '--source' || t.raw === '-s');
    return i >= 0 && rest[i + 1] ? [rest[i + 1]] : [];
  }
  if (sub === 'branch' && rest.some((t) => t.raw === '-f' || t.raw === '--force')) {
    return operandsOf(rest, NONE).slice(-1);
  }
  return [];
}

// ---------------------------------------------------------------- the decisions
function judgeGitMerge(ctx, state, rest) {
  if (rest.some((t) => t.raw === '--abort' || t.raw === '--quit' || t.raw === '--continue')) return null;
  const ops = operandsOf(rest, MERGE_VALUED);
  if (ops.length === 0) {
    return deny(
      '`git merge` names no branch: name the branch to merge, for example `git merge --no-ff <branch>`.',
    );
  }
  if (state.covered.length === 0) return null;
  for (const op of ops) {
    const ref = op.value;
    if (!resolves(ctx, ref)) {
      return deny(`${ref} names no commit here: fetch or push the branch first (git fetch origin <branch>).`);
    }
    for (const c of touchedCovered(ctx, state, ref)) {
      const p = proofOf(ctx, c);
      if (!p.head) return deny(missingReason(c, p));
      if (!isSubsetOfProven(ctx, state, ref, p.head)) {
        return deny(
          `${ref} holds commits that are not in the proven head ${p.head} of ${c.branch}: merge ${c.branch} at that head, with \`git merge --no-ff ${c.branch}\` once it is proven.`,
        );
      }
    }
  }
  return null;
}

function judgeGitPull(ctx, state, rest) {
  const refs = operandsOf(rest, NONE).slice(1); // the first operand is the remote
  if (refs.length === 0) return deny('`git pull` names no branch: name the branch to pull (ADR 028 § 3).');
  if (state.covered.length === 0) return null;
  for (const r of refs) {
    const ref = resolves(ctx, r.value) ? r.value : `origin/${r.value}`;
    if (!resolves(ctx, ref)) return deny(`${r.value} names no commit here: fetch or push the branch first.`);
    const [hit] = touchedCovered(ctx, state, ref);
    if (hit) {
      return deny(
        `git pull would bring ${hit.branch} in without the guard. Merge it by name, at its proven head: \`git merge --no-ff ${hit.branch}\` (HBS-35).`,
      );
    }
  }
  return null;
}

function judgeGitOther(ctx, state, sub, rest) {
  if (state.covered.length === 0) return null;
  if (READ_ONLY.has(sub) || (sub === 'branch' && rest.some((t) => t.raw === '--list' || t.raw === '-l')))
    return null;
  if (sub === 'push') return null; // HBS-01: a push of a covered branch by name is a delivery
  for (const op of namingOperands(sub, rest)) {
    if (!resolves(ctx, op.value)) {
      return deny(`${op.value} names no commit here: fetch or push the branch first (HBS-47).`);
    }
  }
  const noPathspec = !rest.some((t) => t.raw === '--');
  if ((sub === 'switch' || sub === 'checkout') && noPathspec && operandsOf(rest, NONE).length <= 1)
    return null;
  for (const op of operandsOf(rest, NONE)) {
    const [hit] = resolves(ctx, op.value) ? touchedCovered(ctx, state, op.value) : [];
    if (hit) {
      return deny(
        `git ${sub} would bring in or rewrite ${hit.branch}, which merges only by name at its proven head. Use \`git merge --no-ff ${hit.branch}\` (HBS-35).`,
      );
    }
  }
  return null;
}

function judgeGhMerge(ctx, state, rest) {
  const ops = operandsOf(rest, GH_MERGE_VALUED);
  if (ops.length !== 1) return null; // the delivery rules name the missing or extra operand
  const br = ops[0].value;
  if (/^\d+$/.test(br) || /^https?:\/\//.test(br) || state.covered.length === 0) return null;
  const ref = resolves(ctx, br) ? br : resolves(ctx, `origin/${br}`) ? `origin/${br}` : null;
  if (!ref) {
    return deny(
      `${br} does not resolve here: git fetch origin ${br} or push it first, then merge it at its proven head (HBS-47).`,
    );
  }
  const [c] = touchedCovered(ctx, state, ref);
  if (!c) return null;
  const p = proofOf(ctx, c);
  if (!p.head) return deny(missingReason(c, p));
  if (!isSubsetOfProven(ctx, state, ref, p.head)) {
    return deny(`${ref} holds commits that are not in the proven head ${p.head} of ${c.branch} (HBS-32).`);
  }
  if (rest.some((t) => t.raw === '--auto')) {
    return deny(
      `gh pr merge --auto of ${c.branch} is not allowed: merge it at its proven head, now (HBS-34).`,
    );
  }
  const pin = rest.findIndex((t) => t.raw === '--match-head-commit');
  const pinned = pin >= 0 ? rest[pin + 1]?.value : undefined;
  if (pinned === undefined || pinned.toLowerCase() !== p.head) {
    return deny(
      `gh pr merge of ${c.branch} pins the proven head: add \`--match-head-commit ${p.head}\` (HBS-46). ` +
        'Use `gh pr merge <head-branch> --merge --match-head-commit <sha>`.',
    );
  }
  const originHead = commitOf(ctx, `origin/${br}`);
  if (originHead && originHead !== p.head) {
    return deny(
      `origin/${br} is at ${originHead}, not at the proven head ${p.head} (HBS-46): push the proven head first.`,
    );
  }
  return null;
}

function judgeGit(args, ctx, state) {
  const [sub, ...rest] = args;
  if (!sub || sub.quoted) return null;
  const s = sub.raw;
  if (PLUMBING.has(s)) return ask(PATCH_REASON);
  if (s === 'fetch' && rest.some((t) => !isOpt(t) && t.value.includes(':'))) {
    return ask('A fetch into a named ref (src:dst) is the maintainer’s decision (HBS-48).');
  }
  if (s === 'merge') return judgeGitMerge(ctx, state, rest);
  if (s === 'pull') return judgeGitPull(ctx, state, rest);
  return judgeGitOther(ctx, state, s, rest);
}

function judgeSegment(segment, ctx, state) {
  const tokens = tokenize(segment);
  if (!tokens) return null;
  let i = 0;
  while (i < tokens.length && !tokens[i].quoted && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i].raw)) i += 1;
  const [h0, ...rest] = tokens.slice(i);
  if (!h0 || h0.quoted) return null;
  if (h0.raw === 'patch') return ask(PATCH_REASON);
  if (h0.raw === 'git') return judgeGit(gitRest(rest), ctx, state);
  if (h0.raw === 'gh' && rest[0]?.raw === 'pr' && rest[1]?.raw === 'merge') {
    return judgeGhMerge(ctx, state, rest.slice(2));
  }
  return null;
}

/**
 * The guard's decision for a command line: deny, ask, or null (no opinion, so the other rules decide). Deny beats ask.
 * Patches and plumbing ask, and an operand-less merge or pull is denied, in every phase; the covered-branch rules
 * apply only while a covered feature exists.
 */
export function guardDecision(command, ctx) {
  const state = guardState(ctx);
  let found = null;
  for (const seg of String(command ?? '')
    .split(/\n|;|&&|\|\||\|/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    found = strongest(found, judgeSegment(seg, ctx, state));
    if (found?.decision === 'deny') return found;
  }
  return found;
}
