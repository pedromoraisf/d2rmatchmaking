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
import { sessionId } from '../../../scripts/lib/budget.mjs';
import { checkBudget, countDenial, GIT_DIR_CD, isPackageScopeOnly, LEDGER_REF } from './budget-rules.mjs';
import { indirections, MAX_DEPTH, SHELL, splitShell } from './shell-indirection.mjs';
import { parseLine } from './shell-parse.mjs';
import { readOnlyDecision } from './read-only.mjs';
import { writeDecision, writeTargets } from './writes.mjs';
import { pollingDecision, repeatDecision } from './polling.mjs';
import { resolveInside } from './io.mjs';
import path from 'node:path';

const deny = (reason) => ({ decision: 'deny', reason });
const ask = (reason) => ({ decision: 'ask', reason });
const strongest = (a, b) => (a?.decision === 'deny' ? a : b?.decision === 'deny' ? b : (a ?? b));
// deny beats ask beats allow beats no opinion: an earlier allow never hides a later ask (GPR-04, GPR-11).
const RANK = { deny: 3, ask: 2, allow: 1 };
const worse = (a, b) => ((RANK[b?.decision] ?? 0) > (RANK[a?.decision] ?? 0) ? b : a);

// GPR-21: the rule modules that need an import (ratchet, acceptance, mutation-scope, model-policy) are passed in as
// `ctx.modules` by gate.mjs, loaded only for the calls that use them. A rule whose module is missing asks.
const moduleOf = (ctx, name) => ctx.modules?.[name] ?? null;
const missingRule = (name) =>
  ask(`The ${name} rule did not load for this call, so the gate asks instead of allowing (GPR-21).`);

// ---------------------------------------------------------------- paths
export const ENV_FILE = /(^|\/)\.env($|\.(?!example$)[^/]*$)/;
const VENDORED = /^\.claude\/skills\/tlc-spec-driven\//;
const MIGRATION = /^apps\/api\/(src\/)?.*migrations\/[^/]+\.(sql|ts)$/;
const ADR = /^docs\/adr\/\d{3}-[^/]+\.md$/;
export const BASELINE = '.quality-baseline.json';
export const TEST_FILE =
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
export const isHarnessFile = (rel) => HARNESS_FILES.some((re) => re.test(rel));
// The gate guards itself: no delegation covers editing the hooks or their registration.
const SELF_PROTECTED = [
  /^\.claude\/settings\.json$/,
  /^\.claude\/hooks\//,
  /^scripts\/lib\/(ratchet|budget|ledger-store|steps)\.mjs$/, // ratchet and retry budget (ADR 021/022)
  /^scripts\/attempt\.mjs$/,
  /^scripts\/test\/(ratchet|budget|attempt-cli)\.test\.mjs$/,
];
export const isSelfProtected = (rel) => SELF_PROTECTED.some((re) => re.test(rel));

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
  const mutationScope = moduleOf(ctx, 'mutationScope');
  if (!mutationScope) return missingRule('mutation-scope');
  let spec;
  try {
    spec = JSON.parse(text);
  } catch {
    return deny(`${rel} is not valid JSON, so the mutation scope cannot be checked (ADR 026).`);
  }
  const errors = mutationScope.checkMutationSpec(spec);
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

/** A token as the repository names it: no root prefix, no `./`, no feature worktree prefix. */
function repoRelOf(token, root) {
  const rel = token.startsWith(`${root}/`) ? token.slice(root.length + 1) : token;
  return rel.replace(/^\.\//, '').replace(/^\.claude\/worktrees\/[^/]+\//, '');
}

function isGuardedPath(token, root) {
  const rel = repoRelOf(token, root);
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

// GPR-09: the interpreters whose inline code and scripts are judged for writes to the Edit-only files.
const GPR09_LANG = /^(python[\d.]*|node|perl)$/;
// The calls that write a file (GPR-05). Deleting calls are not writes: they keep today's ask.
const WRITE_CALL =
  /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|rename|renameSync|truncate|truncateSync|copyFile|copyFileSync|cpSync|write_text|write_bytes|copyfile|copy2|move)\s*\(|\bopen\s*\([^)]*['"][^'"]*[wax+]|\.write\s*\(|\bFile\.write\b/;

/**
 * GPR-08 files that inline code may not write: harness, sensor and test files, except the self-protected ones
 * (GPR-10, ask) and the quality baseline (AD-165, ask).
 */
function isEditOnlyFile(token, root) {
  const rel = repoRelOf(token, root);
  return !isSelfProtected(rel) && rel !== BASELINE && (isHarnessFile(rel) || TEST_FILE.test(rel));
}

// AD-166: the calls whose first argument (or first two) is the path they write, and `open`, whose mode decides.
const PATH_FIRST =
  /\b(writeFile\w*|appendFile\w*|createWriteStream|truncate\w*|write_text|write_bytes)\s*\(/g;
const PATH_PAIR = /\b(rename\w*|copyFile\w*|cpSync|copy2|copyfile|move)\s*\(/g;
const OPEN_CALL = /\bopen\s*\(/g;
const LITERAL_PATH = /^(?:'[^'\\]*'|"[^"\\$@]*")$/;

/** The arguments of a call whose `(` ends just before `start`, split at top-level commas (quotes and brackets kept). */
function argsAt(text, start) {
  const args = [];
  let arg = '';
  let depth = 0;
  let quote = null;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && text[i - 1] !== '\\') quote = null;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) {
        args.push(arg.trim());
        return args;
      }
      depth--;
    } else if (ch === ',' && depth === 0) {
      args.push(arg.trim());
      arg = '';
      continue;
    }
    arg += ch;
  }
  args.push(arg.trim());
  return args;
}

/**
 * AD-166: inline code whose write call takes a path that is not a string literal (a variable, an expression) writes
 * something the gate cannot see. `open` writes when its mode is a literal with `w`, `a`, `x`, `+` or, in perl, `>`.
 */
function writesUnreadablePath(text, lang) {
  for (const [re, n] of [
    [PATH_FIRST, 1],
    [PATH_PAIR, 2],
  ]) {
    for (const m of text.matchAll(re)) {
      if (
        argsAt(text, m.index + m[0].length)
          .slice(0, n)
          .some((a) => !LITERAL_PATH.test(a))
      )
        return true;
    }
  }
  for (const m of text.matchAll(OPEN_CALL)) {
    const args = argsAt(text, m.index + m[0].length);
    if (lang === 'perl') {
      if (
        args.length >= 3 &&
        LITERAL_PATH.test(args[1]) &&
        /[>+]/.test(args[1]) &&
        !LITERAL_PATH.test(args[2])
      ) {
        return true;
      }
      if (args.length === 2 && !LITERAL_PATH.test(args[1]) && /["']\s*\+?>/.test(args[1])) return true;
    } else if (
      args.length >= 2 &&
      LITERAL_PATH.test(args[1]) &&
      /[wax+]/.test(args[1]) &&
      !LITERAL_PATH.test(args[0])
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Inline interpreter code (`python -c`, `node -e`, a heredoc, a script judged by its content): what the shell rules
 * can't see. `lang` is the interpreter that runs it.
 */
function checkInlineCode(code, ctx, lang) {
  const text = String(code ?? '');
  if ((LEDGER_REF.test(text) && !isPackageScopeOnly(text)) || GIT_DIR_CD.test(text)) {
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
    const tokens = (text.match(/[\w@.\-/]+/g) ?? []).filter((t) => /[./]/.test(t));
    const guarded = tokens.filter((t) => isGuardedPath(t, ctx.root));
    if (guarded.length > 0) {
      const editOnly = guarded.find((t) => isEditOnlyFile(t, ctx.root));
      if (editOnly && WRITE_CALL.test(text) && GPR09_LANG.test(lang ?? '')) {
        return deny(
          `This code writes ${editOnly}, a harness, sensor or test file. Use the Edit tool so the gate can check it.`,
        );
      }
      return ask(
        `This code writes and names ${guarded[0]}, a protected file. Use the Edit tool so the gate can check it.`,
      );
    }
  }
  if (writesUnreadablePath(text, lang)) {
    return ask(
      'This code writes to a path the gate cannot read (a variable or an expression), so it cannot check the write. Use a literal path or the Edit tool.',
    );
  }
  return null;
}

// ---------------------------------------------------------------- scripts (GPR-11 to GPR-13)
const SCRIPT_MAX_BYTES = 1024 * 1024;
const SHELL_SHEBANG = /^#!(\/bin\/(sh|bash|zsh)|\/usr\/bin\/env (sh|bash|zsh))$/;
const CODE_SHEBANG = /^#!(?:\/usr\/bin\/env |\/usr\/bin\/|\/bin\/)(python[\d.]*|node|ruby|perl)$/;
const CODE_EXT = { '.py': 'python', '.js': 'node', '.mjs': 'node', '.rb': 'ruby', '.pl': 'perl' };
const SET_E = new Set(['set -e', 'set -eu', 'set -euo pipefail']);
// GPR-13: `//`, `/**` and any token with a glob, group or pipe is never a script.
const NOT_A_SCRIPT = /[*?[(|]|^\/+$/;

/**
 * What a file is to the gate: `text-shell` (an exact shell shebang, or `.sh` with no shebang), `text-code` (a
 * shebang or extension of an interpreter the gate reads), or `other` (binary, a FIFO, unreadable, over 1 MB, or no
 * known kind). A read that times out is `other`.
 */
function readScript(file, ctx) {
  const text = ctx.readFile(file);
  if (typeof text !== 'string') return { kind: 'other', text: null, lang: null };
  if (text.includes('\0') || Buffer.byteLength(text) > SCRIPT_MAX_BYTES) {
    return { kind: 'other', text, lang: null };
  }
  const first = text.split('\n', 1)[0].trimEnd();
  if (first.startsWith('#!')) {
    if (SHELL_SHEBANG.test(first)) return { kind: 'text-shell', text, lang: 'sh' };
    const m = CODE_SHEBANG.exec(first);
    return m ? { kind: 'text-code', text, lang: m[1] } : { kind: 'other', text, lang: null };
  }
  const ext = path.extname(file);
  if (ext === '.sh') return { kind: 'text-shell', text, lang: 'sh' };
  if (CODE_EXT[ext]) return { kind: 'text-code', text, lang: CODE_EXT[ext] };
  return { kind: 'other', text, lang: null };
}

export function scriptKind(file, ctx) {
  return readScript(file, ctx).kind;
}

/** A shell script runs only under a shell (or as the command word); code runs under anything but a shell. */
function runnerFits(kind, via) {
  if (kind === 'text-shell') return via === null || SHELL.test(via);
  return via === null || !SHELL.test(via);
}

/** A path a script may not reach without leaving the checkout: absolute outside it, `~`, `$`, or `..`. */
function outsideScript(p, ctx) {
  return /[$~]/.test(p) || /(^|\/)\.\.(\/|$)/.test(p) || (p.startsWith('/') && !p.startsWith(`${ctx.root}/`));
}

/**
 * The shell script's own verdict: the content judged as commands (deny or ask), every line checked for a shell write
 * to a protected file, and `allow` only when every command line is a read-only shape (GPR-01, GPR-11). Shebang,
 * comments, blank lines and `set -e` forms are skipped whole.
 */
function shellScriptDecision(text, input, ctx, depth, token) {
  const commands = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#') && !SET_E.has(l));
  const body = commands.join('\n');
  // GPR-12: a script that runs or sources a file outside the checkout is not judged; it asks.
  const leaves = indirections(body).some(
    (y) =>
      y.kind === 'script' &&
      (y.via !== null || scriptKind(y.path, ctx) !== 'other') &&
      outsideScript(y.path, ctx),
  );
  if (leaves) {
    return ask(`${token} runs or sources a file outside the checkout, which the gate cannot judge (GPR-12).`);
  }
  const verdicts = [];
  const content = checkBash(body, ctx, depth + 1, input);
  if (content) verdicts.push(content);
  let readOnly = commands.length > 0;
  for (const line of commands) {
    const parsed = parseLine(line);
    const r = readOnlyDecision(parsed, input, ctx);
    if (r?.decision !== 'allow') readOnly = false;
    if (r && r.decision !== 'allow') verdicts.push(r);
    const w = writeDecision(parsed, ctx);
    if (w) verdicts.push(w);
  }
  const bad = verdicts.find((v) => v.decision === 'deny') ?? verdicts.find((v) => v.decision === 'ask');
  if (bad) return bad;
  return readOnly ? { decision: 'allow', reason: `GPR-11: ${token} is a read-only script.` } : null;
}

/**
 * A script named by a command (GPR-11 to GPR-13). `script` is the indirection `{ kind: 'script', path, via }` of one
 * segment; `via` is the word that runs it, or null when the script is the command word itself. A command word that is
 * no text script is a command, so it gets no opinion here and the rules of its name decide (GPR-32).
 */
export function scriptDecision(script, input, ctx, depth = 0) {
  const token = script.path;
  if (NOT_A_SCRIPT.test(token)) return null;
  const prefix = `${ctx.root}/`;
  const resolvable = !/[$~]/.test(token) && !/(^|\/)\.\.(\/|$)/.test(token);
  const inside = resolvable && (!token.startsWith('/') || token.startsWith(prefix));
  const rel = inside
    ? token.startsWith('/')
      ? token.slice(prefix.length)
      : token.replace(/^\.\//, '')
    : null;
  if (rel !== null && ctx.isTracked?.(rel)) return null; // committed through the same sensors
  const file = inside ? rel : resolvable ? token : null;
  const found = file === null ? { kind: 'other', text: null, lang: null } : readScript(file, ctx);
  // A command word that is no text script is a command (GPR-13). A script inside the checkout that cannot be read
  // keeps today's no opinion; one that is read but is not a text script asks.
  if (found.kind === 'other' && (script.via === null || (inside && found.text === null))) return null;
  if (found.kind === 'other') {
    return ask(
      `${token} is not a text script the gate can read (GPR-12). Run its commands directly or add it to the repo.`,
    );
  }
  if (!runnerFits(found.kind, script.via)) {
    return ask(
      `${token} is run by ${script.via}, which is not the kind of script it is (GPR-13). Run it directly.`,
    );
  }
  if (found.kind === 'text-code') return checkInlineCode(found.text, ctx, script.via ?? found.lang);
  return shellScriptDecision(found.text, input, ctx, depth, token);
}

function checkIndirections(cmd, ctx, depth, input) {
  let found = null;
  for (const x of indirections(cmd)) {
    let r = null;
    if (x.kind === 'shell') r = checkBash(x.text, ctx, depth + 1, input);
    else if (x.kind === 'code') r = checkInlineCode(x.text, ctx, x.lang);
    else if (x.kind === 'script') r = scriptDecision(x, input, ctx, depth);
    else if (!/<</.test(cmd)) {
      r = ask(
        `${x.lang} is reading commands from a pipe, which hides them from the gate. Run them directly.`,
      );
    } else if (!SHELL.test(x.lang)) {
      r = checkInlineCode(cmd, ctx, x.lang); // a heredoc: its body is part of this command line
    } // a shell heredoc: its lines are already judged as segments of this command
    // A script's allow holds only for a line that is that script alone: beside another command it is no opinion.
    if (r?.decision === 'allow' && splitShell(cmd).length > 1) r = null;
    found = worse(found, r);
    if (found?.decision === 'deny') return found;
  }
  return found;
}

/** Whether the context carries the I/O the read-only rule uses. A context without it gets no read-only opinion. */
const hasIo = (ctx) =>
  typeof ctx.realpath === 'function' && typeof ctx.stat === 'function' && typeof ctx.git === 'function';

/** A line nested in shells deeper than MAX_DEPTH: its bottom call asks (checkBash), so the whole line asks as before. */
function nestsTooDeep(cmd, depth = 0) {
  if (depth > MAX_DEPTH) return true;
  return indirections(cmd).some((x) => x.kind === 'shell' && nestsTooDeep(x.text, depth + 1));
}

/**
 * Checks that spawn nothing run before every segment rule (GPR-04): the polling rules (GPR-15, GPR-16) and the shell
 * writes (GPR-05 to GPR-10). A line nested too deep is left to the indirection rule, which asks. Returns a decision
 * or null.
 */
const spawnFreeScan = (cmd, parsed, ctx) =>
  strongest(nestsTooDeep(cmd) ? null : pollingDecision(parsed), writeDecision(parsed, ctx));

// HBS-31: nested shells and untracked scripts are judged by their text too.
export function checkBash(command, ctx, depth = 0, input = undefined) {
  const cmd = String(command ?? '');
  if (depth > MAX_DEPTH) {
    return ask('This command nests shells too deep to check what runs. Run the inner command directly.');
  }
  if ((LEDGER_REF.test(cmd) && !isPackageScopeOnly(cmd)) || GIT_DIR_CD.test(cmd)) {
    return deny(
      'The retry ledger and the security verdicts are maintained by the hooks and scripts/attempt.mjs only, and no shell enters .git.',
    );
  }
  const parsed = parseLine(cmd);
  // GPR-30 and GPR-01: the read-only rule's verdict. Its allow is held back until every other rule has given no opinion.
  const readOnly = hasIo(ctx) ? readOnlyDecision(parsed, input, ctx) : null;
  const early = strongest(spawnFreeScan(cmd, parsed, ctx), readOnly?.decision === 'allow' ? null : readOnly);
  if (early?.decision === 'deny') return early;
  // ADR 028 § 1: one delivery command in an allowed shape runs without asking, unless another rule denies or asks.
  // Only the top-level line can be such a shape: a command hidden in a nested shell or a wrapper is judged as a segment.
  const shaped = depth === 0 && allowedShape(cmd, ctx);
  const found = strongest(
    early,
    strongest(checkSegments(cmd, ctx, shaped), checkIndirections(cmd, ctx, depth, input)),
  );
  if (found) return found;
  if (shaped) return { decision: 'allow', reason: 'ADR 028 § 1: a delivery command in an allowed shape.' };
  // GPR-04: the read-only allow comes last, and only for the top-level line.
  return depth === 0 && readOnly?.decision === 'allow' ? readOnly : null;
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
  // GPR-32: the command word is judged by its last path segment, so `/bin/rm` gets the decision of `rm`.
  const head = w.slice(at).map((x, i) => (i === 0 ? path.posix.basename(x) : x));
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
    /(^|\s)(cat|less|more|head|tail|type|bat|cp|mv|source|\.)\s/.test(` ${head.join(' ')}`) &&
    head.some((x) => ENV_FILE.test(x))
  ) {
    return deny('.env files hold secrets and are off-limits to the agent. Use .env.example.');
  }

  // Shell writes to harness files bypass the Edit-level checks below. The writes are the parsed write targets
  // (GPR-06): `2>&1`, `2>/dev/null` and a `>` inside quotes name no file.
  const writes = segmentWriteTargets(seg, head);
  if (writes.some((x) => x === BASELINE || x.endsWith(`/${BASELINE}`))) {
    return deny(
      'Edit .quality-baseline.json with the Edit tool (so the ratchet check runs) or via `pnpm quality:ratchet --update`.',
    );
  }
  if (writes.some((x) => isHarnessFile(inRepoPath(x)) || isSelfProtected(inRepoPath(x)))) {
    return ask('Shell write to a harness/sensor file. Use the Edit tool so the gate can check it.');
  }
  return null;
}

// The raw write test, kept for a segment that does not parse (GPR-06: the parser cannot say what it writes).
const RAW_WRITE = /(\bsed\s+-i|\btee\b|>|\bmv\b|\bcp\b|\btruncate\b|\bperl\s+-p?i)/;

/** The paths a segment writes: its parsed write targets (writes.mjs), or the words of the segment when it does not parse. */
function segmentWriteTargets(seg, head) {
  const parsed = parseLine(seg);
  if (parsed.unsafe.includes('unparsed')) return RAW_WRITE.test(seg) ? head : [];
  return writeTargets(parsed).map((t) => t.path);
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
    const ratchet = moduleOf(ctx, 'ratchet');
    if (!ratchet) return missingRule('ratchet');
    const loosened = ratchet.compareBaselines(b, a);
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
      const acceptance = moduleOf(ctx, 'acceptance');
      if (!acceptance) return missingRule('acceptance');
      if ((after.match(GHERKIN_SKIP) ?? []).length > (before.match(GHERKIN_SKIP) ?? []).length) {
        return ask('Skipping acceptance scenarios is an escalation (ADR 023).');
      }
      if (acceptance.countScenarios(after) < acceptance.countScenarios(before)) {
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

function regularRules(tool, ti, ctx, toRelative, input) {
  if (tool === 'Bash') return checkBash(ti.command, ctx, 0, input);
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
 * GPR-17: the repetition rule for one Bash call. Every Bash call returns the history effect that records it (AD-158);
 * the call is denied on the fifth identical one. Without a history snapshot or a clock in `ctx` there is no check.
 */
function repetitionOf(tool, ti, sid, ctx) {
  if (tool !== 'Bash' || !ctx.history || typeof ctx.nowMs !== 'function') {
    return { decision: null, reason: '', effects: [] };
  }
  return repeatDecision(ti.command, sid, ctx.history, ctx.nowMs());
}

/** Adds effects to a decision (a decision may be null: then the effects alone are returned). */
const withEffects = (out, extra) =>
  extra.length === 0
    ? out
    : { ...(out ?? { decision: null, reason: '' }), effects: [...(out?.effects ?? []), ...extra] };

/**
 * Entry point. Returns { decision, reason, effects } or null (no opinion → normal permission flow).
 * `effects` are ledger updates (ADR 022) that gate.mjs applies under the ledger lock.
 */
export function decide(input, ctx, toRelative) {
  if (typeof input?.tool_name !== 'string' || input.tool_name === '') {
    return ask('The gate got a call with no tool name, so it cannot judge it. Asking instead of allowing.');
  }
  const tool = input.tool_name;
  const ti = input.tool_input ?? {};
  const sid = sessionId(input);
  const rel = toRelative(ctx.root, ti.file_path ?? ti.notebook_path ?? '');
  const repeat = repetitionOf(tool, ti, sid, ctx);

  const budget = checkBudget(input, ctx, sid, rel);
  if (budget?.decision) {
    const out = budget.reason.startsWith('Retry budget exhausted') ? budget : countDenial(budget, ctx, sid);
    return withEffects(out, repeat.effects);
  }
  // GPR-17 denies before the other rules; the call is still recorded (its effect is kept on every path).
  const result =
    repeat.decision === 'deny'
      ? { decision: 'deny', reason: repeat.reason }
      : regularRules(tool, ti, ctx, toRelative, input);
  const counted = countDenial(result, ctx, sid);
  // ADR 028 § 3: a foreground security review of a diff notes its head when it starts, unless it is denied.
  const effects = [...(budget?.effects ?? []), ...repeat.effects, ...(counted?.effects ?? [])];
  if (counted?.decision !== 'deny') {
    const noted = noteDispatch(input, ctx);
    if (noted) effects.push(noted);
  }
  if (effects.length === 0) return counted;
  return counted ? { ...counted, effects } : { decision: null, reason: '', effects };
}
