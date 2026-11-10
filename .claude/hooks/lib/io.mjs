// Shared I/O helpers for Claude Code hooks. Plain Node ESM with zero dependencies, so hooks work before
// `pnpm install`.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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

/** Files changed against HEAD plus untracked ones, relative to `root`. */
export function changedFiles(root) {
  const git = (...args) => {
    try {
      return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return '';
    }
  };
  return [
    ...git('diff', '--name-only', 'HEAD').split('\n'),
    ...git('ls-files', '--others', '--exclude-standard').split('\n'),
  ].filter(Boolean);
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
