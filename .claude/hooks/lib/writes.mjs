// Shell writes and their targets for the PreToolUse gate (gate-precision, GPR-05 to GPR-10). Pure: a parsed command
// line in, a decision out; no I/O.
//
// A read is never a write: `2>&1`, `2>/dev/null`, `>&2` and a `>` inside quotes name no file. The operands of
// `cp`, `mv` and `ln` count as writes, so a protected operand of any of them is a write (GPR-05).
import path from 'node:path';
import { expandOptions } from './shell-parse.mjs';
import { isHarnessFile, isSelfProtected, BASELINE, TEST_FILE } from './gate-rules.mjs';
import { isSecretName } from './read-only.mjs';

const deny = (reason) => ({ decision: 'deny', reason });
const ask = (reason) => ({ decision: 'ask', reason });

// GPR-06: these are never the file a write lands in.
const DEVICE = /^\/dev\/(null|stdout|stderr)$/;
// `>&1` and `>&-` duplicate or close a descriptor; they write no file.
const FD_DUP = /^&?\d+$|^-$/;
const WRITE_OPS = new Set(['>', '>>', '&>', '&>>', '>|', '>&']);
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const COPY_COMMANDS = new Set(['cp', 'ln', 'install']);
const SCRIPT_OPTIONS = ['-e', '-f', '--expression', '--file'];

// Options of each writing command that take a value, so the value is not taken for a file.
const VALUED = {
  tee: [],
  truncate: ['-s', '--size', '-r', '--reference'],
  install: ['-m', '--mode', '-o', '--owner', '-g', '--group', '-S', '--suffix'],
  cp: ['-S', '--suffix'],
  mv: ['-S', '--suffix'],
  ln: ['-S', '--suffix'],
};

/** The command word after environment assignments, by its last path segment (GPR-32), and its arguments. */
function commandOf(words) {
  const at = words.findIndex((w) => !ENV_ASSIGN.test(w.text));
  if (at < 0) return { name: '', args: [] };
  return { name: path.posix.basename(words[at].text), args: words.slice(at + 1) };
}

/** `sed -i`, `--in-place` and `perl -i`: the files are the operands after the script (or all of them with -e/-f). */
function inPlaceTargets(name, args) {
  const inPlace =
    name === 'sed'
      ? args.some((w) => /^--in-place(=|$)|^-[^-]*i/.test(w.text))
      : args.some((w) => /^-(?![MI])[A-Za-z]*i/.test(w.text));
  if (!inPlace) return [];
  const { operands, options } = expandOptions(args, { valued: SCRIPT_OPTIONS });
  const scripted = options.some((o) => SCRIPT_OPTIONS.includes(o.name));
  return (scripted ? operands : operands.slice(1)).map((w) => ({ path: w.text, how: `${name} -i` }));
}

/** The file operands of a command that writes them (GPR-05). */
function commandWrites(name, args) {
  if (name === 'sed' || name === 'perl') return inPlaceTargets(name, args);
  if (!Object.hasOwn(VALUED, name)) return [];
  const { operands } = expandOptions(args, { valued: VALUED[name] });
  return operands.map((w) => ({ path: w.text, how: name }));
}

/**
 * The files a command line writes, with how each is written: output redirections to a file, and the operands of
 * `tee`, `sed -i`, `perl -i`, `truncate`, `install`, `cp`, `mv` and `ln`.
 * @returns {{ path: string, how: string }[]}
 */
export function writeTargets(parsed) {
  const out = [];
  for (const seg of parsed.segments) {
    for (const r of seg.redirections) {
      if (!WRITE_OPS.has(r.op)) continue;
      if (r.op === '>&' && FD_DUP.test(r.target)) continue;
      if (DEVICE.test(r.target)) continue;
      out.push({ path: r.target, how: 'redirect' });
    }
    const { name, args } = commandOf(seg.words);
    for (const t of commandWrites(name, args)) {
      if (!DEVICE.test(t.path)) out.push(t);
    }
  }
  return out;
}

/** A path as the repository names it: without the root prefix, `./`, `..` or a feature worktree prefix. */
function repoPath(p, root) {
  const prefix = root ? `${root}/` : '';
  const inside = prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p;
  return path.posix.normalize(inside).replace(/^\.claude\/worktrees\/[^/]+\//, '');
}

/** GPR-10 before GPR-08: a self-protected file keeps `ask`, every other protected file is denied (AD-157). */
function targetVerdict(p, ctx) {
  const rel = repoPath(p, ctx.root);
  if (isSelfProtected(rel)) {
    return ask('Shell write to a harness/sensor file. Use the Edit tool so the gate can check it.');
  }
  if (isHarnessFile(rel) || rel === BASELINE || TEST_FILE.test(rel)) {
    return deny(
      `Shell write to ${rel}, a harness, sensor, baseline or test file. Use the Edit tool so the gate can check it.`,
    );
  }
  return null;
}

/** A secret named as the source of `cp`, `ln` or `install` (the last operand is the destination unless `-t`). */
function copySourceVerdicts(parsed, ctx) {
  const out = [];
  for (const seg of parsed.segments) {
    const { name, args } = commandOf(seg.words);
    if (!COPY_COMMANDS.has(name)) continue;
    const { operands, options } = expandOptions(args, { valued: VALUED[name] });
    const toDirectory = options.some((o) => o.name === '-t' || o.name === '--target-directory');
    const sources = toDirectory ? operands : operands.slice(0, -1);
    for (const w of sources) {
      if (isSecretName(w.text, ctx)) {
        out.push(deny(`${w.text} is a secret file: the agent may not copy, link or install it.`));
      }
    }
  }
  return out;
}

/**
 * The decision for the shell writes of a command line: `deny` (with the Edit tool named) for a protected file,
 * `ask` for a self-protected one, or null. A deny beats an ask.
 */
export function writeDecision(parsed, ctx) {
  const verdicts = [
    ...writeTargets(parsed)
      .map((t) => targetVerdict(t.path, ctx))
      .filter(Boolean),
    ...copySourceVerdicts(parsed, ctx),
  ];
  return verdicts.find((v) => v.decision === 'deny') ?? verdicts[0] ?? null;
}
