// Delivery commands (ADR 028 § 1): the shapes the runner may run without asking (HBS-01 to HBS-07), and the decisions
// for the commands that stay the maintainer's or are denied (HBS-08 to HBS-17). Pure: a command line and a read-only
// context (`mainRoot`, `root`, `activePhase`, `covered` are read; nothing is written).
//
// One tokenizer and one evaluator decide both directions, so an allowed shape can never also be a denied one:
//   allowedShape(line)        → true only for one delivery command in an allowed shape, optionally after `cd <dir> &&`
//   deliveryDecision(segment) → deny/ask for a delivery command of a segment (HBS-04/05, HBS-10/11, HBS-12, HBS-13),
//                               and ask for any other delivery command: one that is not run alone in an allowed shape
//                               gets the ADR 021 decision (ask); it is never allowed.
import { activePhase } from './delegation.mjs';
import { insideRepo } from './io.mjs';

const allowVerdict = (reason) => ({ verdict: 'allow', reason });
const askVerdict = (reason) => ({ verdict: 'ask', reason });
const denyVerdict = (reason) => ({ verdict: 'deny', reason });
const notAllowed = { verdict: 'not-allowed', reason: '' };

export const MERGE_FIX = 'Merge with `gh pr merge <head-branch> --merge` (merge commits only, ADR 028 § 1).';
export const NOT_SHAPED =
  'A delivery command runs alone, in one of the shapes ADR 028 § 1 allows. This line chains, wraps or prefixes it, ' +
  'or uses an option outside those shapes, so the maintainer decides it.';

// ---------------------------------------------------------------- ref names (spec.md Definitions)
/** A token that names a ref: the rule of spec.md `## Definitions`. */
export function isRefName(s) {
  return (
    /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/.test(s) &&
    !/^(refs\/|heads\/|origin\/)/.test(s) &&
    !s.includes('..') &&
    !s.includes('@{') &&
    s !== 'main' &&
    s !== 'HEAD'
  );
}

// ---------------------------------------------------------------- tokens
const WORD = /(?:"[^"]*"|'[^']*'|[^\s"'])+/g;

/**
 * The words of one segment: `raw` is the text as typed, `value` the text without its quotes. Null when a quote is
 * unbalanced or a word mixes characters the tokenizer cannot place (such a line is not an allowed shape).
 */
export function tokenize(segment) {
  const text = String(segment ?? '');
  const words = text.match(WORD) ?? [];
  const stripped = text.replace(/"[^"]*"|'[^']*'|\s+/g, (m) => (/^["']/.test(m) ? m : ''));
  if (words.join('') !== stripped) return null;
  return words.map((raw) => ({
    raw,
    quoted: /["']/.test(raw),
    value: raw.replace(/"([^"]*)"|'([^']*)'/g, (_, a, b) => a ?? b),
  }));
}

const isOption = (t) => !t.quoted && t.raw.startsWith('-') && t.raw !== '-';

/** The Render deploy hook URL is the one `$` an allowed shape may hold (HBS-07). */
const RENDER_URL = new Set(['"$RENDER_DEPLOY_HOOK_URL"', '"${RENDER_DEPLOY_HOOK_URL}"']);

/** Characters that make a line something other than one plain command (outside quotes). */
function structuralOk(line) {
  const bare = line.replace(/"[^"]*"|'[^']*'/g, '""');
  return !/[\n\r;|&`<>(){}$\\*?[\]~]/.test(bare);
}

// ---------------------------------------------------------------- git
function evalPush(args) {
  const options = args.filter(isOption);
  const operands = args.filter((t) => !isOption(t));
  for (const o of options) {
    const forced =
      /^--(force|mirror|delete|prune)/.test(o.raw) || (/^-[A-Za-z]+$/.test(o.raw) && /[fd]/.test(o.raw));
    if (forced) {
      return denyVerdict(
        `\`${o.raw}\` forces or deletes on the remote: never allowed (HBS-10). Push without it.`,
      );
    }
  }
  const [remote, ...refspecs] = operands;
  if (refspecs.some((r) => r.value.startsWith('+') || r.value.startsWith(':'))) {
    return denyVerdict(
      'A refspec starting with `+` or `:` forces or deletes on the remote: never allowed (HBS-10).',
    );
  }
  if (remote?.value !== 'origin') {
    return askVerdict('git push goes to origin only; another remote is the maintainer’s decision (HBS-11).');
  }
  if (refspecs.length === 0) return askVerdict('git push names no branch: name the ref to push (HBS-11).');
  if (refspecs.some((r) => !isRefName(r.value))) {
    return askVerdict(
      'git push of main, HEAD, refs/…, a src:dst pair or a pattern is the maintainer’s decision (HBS-11). Push a feature branch by name.',
    );
  }
  const plain = options.every((o) => o.raw === '-u' || o.raw === '--set-upstream');
  return plain ? allowVerdict('a push of ref names to origin') : notAllowed;
}

function evalTag(args) {
  if (args.length === 0 || args.some((t) => t.raw === '-l' || t.raw === '--list')) return null; // listing tags
  const options = args.filter(isOption);
  const operands = args.filter((t) => !isOption(t));
  if (options.length === 0 && operands.length === 1 && isRefName(operands[0].value)) {
    return allowVerdict('a tag of one ref name');
  }
  return notAllowed;
}

function evalGit(args) {
  const [sub, ...rest] = args;
  if (!sub || sub.quoted) return null;
  if (sub.raw === 'push') return evalPush(rest);
  if (sub.raw === 'tag') return evalTag(rest);
  return null;
}

// ---------------------------------------------------------------- gh
/** Parse the flags (no value), valued options and operands of a gh subcommand against a closed list. */
function parseGh(rest, { flags = [], valued = [] }) {
  const out = { flags: new Set(), values: {}, operands: [], ok: true };
  for (let i = 0; i < rest.length; i += 1) {
    const t = rest[i];
    if (!isOption(t)) {
      out.operands.push(t);
    } else if (flags.includes(t.raw)) {
      out.flags.add(t.raw);
    } else if (valued.includes(t.raw) && i + 1 < rest.length) {
      out.values[t.raw] = rest[i + 1];
      i += 1;
    } else {
      out.ok = false;
      return out;
    }
  }
  return out;
}

// `gh pr create|edit|ready|comment`: no -R/--repo, closed option lists (ADR 028 § 1).
const PR_SHAPES = {
  create: {
    operands: 0,
    flags: ['--draft', '-d'],
    valued: [
      '--base',
      '-B',
      '--title',
      '-t',
      '--body',
      '-b',
      '--head',
      '-H',
      '--label',
      '-l',
      '--assignee',
      '-a',
      '--reviewer',
      '-r',
      '--milestone',
      '-m',
    ],
  },
  edit: {
    operands: 1,
    flags: [],
    valued: [
      '--add-label',
      '--remove-label',
      '--title',
      '-t',
      '--body',
      '-b',
      '--base',
      '-B',
      '--add-reviewer',
      '--remove-reviewer',
      '--add-assignee',
      '--remove-assignee',
      '--milestone',
      '-m',
    ],
  },
  ready: { operands: 1, flags: ['--undo', '-u'], valued: [] },
  comment: { operands: 1, flags: ['--edit-last'], valued: ['--body', '-b'] },
};

const isPrOrRunRef = (v) => /^\d+$/.test(v) || isRefName(v);

function evalPrOther(action, rest) {
  const shape = PR_SHAPES[action];
  const parsed = parseGh(rest, shape);
  if (!parsed.ok || parsed.operands.length !== shape.operands) return notAllowed;
  if (!parsed.operands.every((o) => isPrOrRunRef(o.value))) return notAllowed;
  return allowVerdict(`gh pr ${action} without -R/--repo`);
}

// `gh pr merge` (HBS-03 to HBS-05): one head branch and the merge options only.
const MERGE_VALUED = ['--subject', '-t', '--body', '-b', '--match-head-commit'];
function evalMerge(rest) {
  let merge = false;
  const operands = [];
  for (let i = 0; i < rest.length; i += 1) {
    const t = rest[i];
    if (!isOption(t)) {
      operands.push(t);
    } else if (t.raw === '--merge' || t.raw === '-m') {
      merge = true;
    } else if (t.raw === '--auto') {
      // allowed here; a covered branch is judged by the merge guard (HBS-34)
    } else if (MERGE_VALUED.includes(t.raw) && i + 1 < rest.length) {
      const value = rest[i + 1];
      i += 1;
      if (t.raw === '--match-head-commit' && !/^[0-9a-f]{4,40}$/i.test(value.value)) {
        return denyVerdict(`\`--match-head-commit ${value.raw}\` is not a commit id. ${MERGE_FIX}`);
      }
    } else {
      return denyVerdict(`\`${t.raw}\` is not a merge option the gate allows. ${MERGE_FIX}`);
    }
  }
  if (operands.length === 0) return denyVerdict(`gh pr merge needs the head branch. ${MERGE_FIX}`);
  if (operands.length > 1)
    return denyVerdict(`gh pr merge takes one head branch, not \`${operands[1].raw}\`. ${MERGE_FIX}`);
  const op = operands[0].value;
  if (/^\d+$/.test(op) || /^https?:\/\//.test(op) || op.includes('/pull/')) {
    return denyVerdict(`\`${op}\` names a PR, not its head branch. ${MERGE_FIX}`);
  }
  if (!isRefName(op)) return denyVerdict(`\`${op}\` is not a branch name. ${MERGE_FIX}`);
  if (!merge) return denyVerdict(`gh pr merge needs --merge. ${MERGE_FIX}`);
  // A covered branch is allowed here too (HBS-36): the merge guard (guard.mjs) denies it unless it is proven.
  return allowVerdict('a merge of a head branch with the merge options');
}

// `gh release create|edit|upload`, `gh workflow run`, `gh run rerun` (HBS-06).
const SAFE_FILE = /^[A-Za-z0-9._-][A-Za-z0-9._/-]*$/;
const isSafeFile = (v) => SAFE_FILE.test(v) && !v.split('/').includes('..');
const RELEASE_SHAPES = {
  create: {
    flags: ['--generate-notes', '--draft', '-d', '--prerelease', '--latest'],
    valued: ['--title', '-t', '--notes', '-n', '--target', '--discussion-category'],
  },
  edit: { flags: ['--draft', '-d', '--prerelease', '--latest'], valued: ['--title', '-t', '--notes', '-n'] },
  upload: { flags: [], valued: [] },
};

function evalRelease(action, rest) {
  const parsed = parseGh(rest, RELEASE_SHAPES[action]);
  if (!parsed.ok || parsed.operands.length === 0) return notAllowed;
  const [tag, ...files] = parsed.operands.map((o) => o.value);
  if (!isRefName(tag) || !files.every(isSafeFile)) return notAllowed;
  if (action === 'edit' && files.length > 0) return notAllowed;
  if (action === 'upload' && files.length === 0) return notAllowed;
  return allowVerdict(`gh release ${action}`);
}

function evalWorkflowRun(rest) {
  const parsed = parseGh(rest, { flags: [], valued: ['--ref', '-r'] });
  if (!parsed.ok || parsed.operands.length !== 1) return notAllowed;
  if (!/^[A-Za-z0-9._-]+$/.test(parsed.operands[0].value)) return notAllowed;
  return allowVerdict('a workflow run of one workflow');
}

function evalRunRerun(rest) {
  const parsed = parseGh(rest, { flags: ['--failed'], valued: [] });
  if (!parsed.ok || parsed.operands.length !== 1 || !/^\d+$/.test(parsed.operands[0].value))
    return notAllowed;
  return allowVerdict('a rerun of one run id');
}

/** HBS-13: a gh api write (a method other than GET, a field or an input) or GraphQL stays the maintainer's. */
const API_WRITE = /^(-f|-F|--field|--raw-field|--input|-X|--method)/;
function evalApi(rest) {
  for (let i = 0; i < rest.length; i += 1) {
    const t = rest[i];
    if (!t.quoted && t.raw === 'graphql') {
      return askVerdict('gh api graphql can write: the maintainer decides it (HBS-13).');
    }
    if (isOption(t) && API_WRITE.test(t.raw)) {
      const method = t.raw === '-X' || t.raw === '--method' ? rest[i + 1]?.value : undefined;
      if (method === undefined || method.toUpperCase() !== 'GET') {
        return askVerdict(
          'A gh api call that writes (a method other than GET, a field or an input) is the maintainer’s decision (HBS-13).',
        );
      }
    }
  }
  return null;
}

function evalGh(args) {
  const [group, action, ...rest] = args;
  if (!group || group.quoted) return null;
  if (group.raw === 'pr') {
    if (action?.raw === 'merge') return evalMerge(rest);
    if (action && Object.hasOwn(PR_SHAPES, action.raw)) return evalPrOther(action.raw, rest);
    return null;
  }
  if (group.raw === 'release') {
    return action && Object.hasOwn(RELEASE_SHAPES, action.raw) ? evalRelease(action.raw, rest) : null;
  }
  if (group.raw === 'workflow') return action?.raw === 'run' ? evalWorkflowRun(rest) : null;
  if (group.raw === 'run') return action?.raw === 'rerun' ? evalRunRerun(rest) : null;
  if (group.raw === 'variable') {
    return action?.raw === 'delete'
      ? askVerdict('Deleting a variable is the maintainer’s decision (HBS-12).')
      : null;
  }
  if (group.raw === 'api') return evalApi(args.slice(1));
  return null;
}

// ---------------------------------------------------------------- curl (HBS-07)
/** One POST to the Render deploy hook, with only the silent/fail options. Anything else is not this shape. */
function evalCurl(rest) {
  let post = false;
  let url = null;
  for (let i = 0; i < rest.length; i += 1) {
    const t = rest[i];
    if (isOption(t) && /^(-[fsS]+|--fail|--silent|--show-error)$/.test(t.raw)) continue;
    if (t.raw === '-X' && rest[i + 1]?.raw === 'POST' && !post) {
      post = true;
      i += 1;
      continue;
    }
    if (url === null && RENDER_URL.has(t.raw)) {
      url = t.raw;
      continue;
    }
    return null;
  }
  return post && url !== null ? allowVerdict('the Render deploy hook, one POST') : null;
}

// ---------------------------------------------------------------- the decision of one command
/** The verdict of a tokenized command, or null when it is not a delivery command. */
function evaluate(tokens) {
  const [h0, ...rest] = tokens;
  if (!h0 || h0.quoted) return null;
  if (h0.raw === 'git') return evalGit(rest);
  if (h0.raw === 'gh') return evalGh(rest);
  if (h0.raw === 'curl') return evalCurl(rest);
  return null;
}

/** Skip the leading `NAME=value` words of a segment (the line judges them, see allowedShape). */
function withoutEnvPrefix(tokens) {
  let i = 0;
  while (i < tokens.length && !tokens[i].quoted && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i].raw)) i += 1;
  return tokens.slice(i);
}

/** Covered branches of the active phase (HBS-19): `feat/<F>-<f>` for each covered feature. */
export function coveredBranches(ctx) {
  const phase = activePhase(ctx);
  if (!phase?.approved) return [];
  return (phase.covered ?? []).map((f) => `feat/${phase.id}-${f}`);
}

/**
 * The decision one segment of a command line gets from the delivery rules: deny or ask. A delivery command is never
 * allowed here, because a segment is not the whole line (allowedShape decides that). Null when the segment is not a
 * delivery command, so the ADR 021 rules judge it.
 */
export function deliveryDecision(segment) {
  const tokens = tokenize(segment);
  if (!tokens) return null;
  const verdict = evaluate(withoutEnvPrefix(tokens));
  if (!verdict) return null;
  if (verdict.verdict === 'deny') return { decision: 'deny', reason: verdict.reason };
  if (verdict.verdict === 'ask') return { decision: 'ask', reason: verdict.reason };
  return { decision: 'ask', reason: NOT_SHAPED };
}

/**
 * HBS-01 to HBS-07: true when the whole line is one delivery command in an allowed shape, optionally preceded by
 * `cd <dir> &&` where `<dir>` is a literal path that stays inside the main checkout (after `..` and symbolic links).
 */
export function allowedShape(command, ctx) {
  let line = String(command ?? '').trim();
  if (/^cd\s/.test(line)) {
    const cd = /^cd\s+(\S+)\s+&&\s+(.+)$/.exec(line);
    if (!cd || !/^[A-Za-z0-9._/-]+$/.test(cd[1])) return false;
    if (!insideRepo(ctx.mainRoot ?? ctx.root, cd[1])) return false;
    line = cd[2];
  }
  if (!structuralOk(line)) return false;
  const tokens = tokenize(line);
  if (!tokens || tokens.length === 0) return false;
  if (tokens.some((t) => /[$`]/.test(t.raw) && !RENDER_URL.has(t.raw))) return false;
  return evaluate(tokens)?.verdict === 'allow';
}

/** HBS-14: a line that switches to main and merges in the same command line is the maintainer's decision. */
export function mergesAfterMainSwitch(command) {
  const segments = String(command ?? '')
    .split(/\n|;|&&|\|\||\|/)
    .map((s) => s.trim());
  const switches = segments.some((s) => /^git\s+(checkout|switch)\s+main(\s|$)/.test(s));
  const merges = segments.some((s) => /^git\s+merge(\s|$)/.test(s));
  return switches && merges;
}
