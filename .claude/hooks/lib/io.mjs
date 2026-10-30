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

export function makeRepoContext(root) {
  const git = (...args) => {
    try {
      return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return null;
    }
  };
  return {
    root,
    readFile(rel) {
      const abs = path.join(root, rel);
      return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    },
    isTracked(rel) {
      return git('ls-files', '--error-unmatch', '--', rel) !== null;
    },
    currentBranch() {
      return git('rev-parse', '--abbrev-ref', 'HEAD');
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
