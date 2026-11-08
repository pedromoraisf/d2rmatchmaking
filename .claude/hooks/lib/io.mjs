// Shared I/O helpers for Claude Code hooks. Hooks are plain Node ESM with zero dependencies,
// so they work before `pnpm install` and on every contributor machine.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function projectDir(input = {}) {
  return process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
}

export function toRelative(root, filePath) {
  if (!filePath) return '';
  const abs = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  return path.relative(root, abs).split(path.sep).join('/');
}

/**
 * The main checkout (ADR 028 § 3): the parent of the git common directory, whatever directory the hook runs from.
 * Returns null outside a git repository.
 */
export function mainCheckout(root) {
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return path.dirname(path.resolve(root, common));
  } catch {
    return null;
  }
}

export function makeRepoContext(root) {
  const git = (...args) => {
    try {
      return execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return null;
    }
  };
  const main = mainCheckout(root) ?? root;
  return {
    root,
    mainRoot: main,
    now: () => new Date().toISOString(),
    readFile(rel) {
      const abs = path.join(root, rel);
      return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    },
    /** A file of the main checkout (the phase, its brief): never a worktree's copy. */
    readMainFile(rel) {
      const abs = path.join(main, rel);
      return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    },
    isTracked(rel) {
      return git('ls-files', '--error-unmatch', '--', rel) !== null;
    },
    currentBranch() {
      return git('rev-parse', '--abbrev-ref', 'HEAD');
    },
    headTime(dir) {
      const t = dir ? git('-C', dir, 'log', '-1', '--format=%ct') : git('log', '-1', '--format=%ct');
      return t ? Number(t) : null;
    },
    git,
  };
}

export function bin(root, name) {
  const local = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
  return existsSync(local) ? local : null;
}

/** Run a command, never throw. Returns { ok, code, out } with stdout+stderr merged and trimmed. */
export function run(cmd, args, { cwd, timeoutMs = 120_000 } = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: timeoutMs, shell: false });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  if (r.error) return { ok: false, code: -1, out: `${cmd}: ${r.error.message}` };
  return { ok: r.status === 0, code: r.status ?? -1, out };
}

export function tail(text, lines = 60) {
  const all = String(text ?? '').split('\n');
  return all.length <= lines ? all.join('\n') : ['…', ...all.slice(-lines)].join('\n');
}
