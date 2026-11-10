// Shared I/O helpers for Claude Code hooks. Hooks are plain Node ESM with zero dependencies,
// so they work before `pnpm install` and on every contributor machine.
import { execFileSync, spawnSync } from 'node:child_process';
import * as nodeFs from 'node:fs';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
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

/** A path with its symbolic links resolved; for a path that does not exist yet, its nearest existing ancestor's. */
function realPathOf(p) {
  let probe = path.resolve(p);
  const missing = [];
  while (!existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    missing.unshift(path.basename(probe));
    probe = parent;
  }
  try {
    return path.join(realpathSync(probe), ...missing);
  } catch {
    return path.resolve(p);
  }
}

/**
 * HBS-20: the absolute path `rel` names under `base`, after resolving `..` and the symbolic links of its nearest
 * existing directory. Both the base and the result are real paths, so they compare the same way.
 */
export function resolveInside(base, rel) {
  return realPathOf(path.resolve(realPathOf(base), rel));
}

/** Is `rel` (after resolveInside) the base or a path under it? */
export function insideRepo(base, rel) {
  const root = realPathOf(base);
  const abs = resolveInside(base, rel);
  return abs === root || abs.startsWith(`${root}${path.sep}`);
}

// gate-precision (GPR-22): the git directory, the common directory and the branch are read from files, so a call
// spawns no `git rev-parse`. A linked worktree's `.git` is a file (`gitdir: <path>`); its `commondir` file names the
// common directory and its `HEAD` names the branch. A file that is missing or says something else gives null, and the
// caller falls back to `git` as before. Each answer is memoised per process.
const locationMemo = new Map();

/** The kind of a path: a directory, a regular file, anything else, or null when it does not exist. */
function kindOf(p) {
  try {
    const st = statSync(p);
    if (st.isDirectory()) return 'dir';
    return st.isFile() ? 'file' : 'other';
  } catch {
    return null;
  }
}

/** A small text file read whole, or null. */
function smallText(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

/** The branch a git directory's HEAD names, as `--abbrev-ref HEAD` prints it; null when the HEAD says something else. */
function branchOf(gitDir) {
  const head = smallText(path.join(gitDir, 'HEAD'));
  if (head === null) return null;
  const line = head.trim();
  const ref = /^ref: refs\/heads\/(.+)$/.exec(line);
  if (ref) return ref[1];
  return /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(line) ? 'HEAD' : null;
}

/** The locations of the checkout that holds `start`, from its git files; null when the files do not say. */
function readGitLocations(start) {
  // git's own overrides of the directory are answered by git, not by the files.
  if (process.env.GIT_DIR || process.env.GIT_COMMON_DIR) return null;
  let dir = start;
  for (;;) {
    const dotGit = path.join(dir, '.git');
    const kind = kindOf(dotGit);
    if (kind === 'dir') return fromGitDir(dotGit, dotGit);
    if (kind === 'file') return fromGitFile(dotGit, dir);
    if (kind !== null) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function fromGitDir(gitDir, common) {
  const branch = branchOf(gitDir);
  return branch === null ? null : { gitDir, common, branch };
}

function fromGitFile(dotGit, dir) {
  const text = smallText(dotGit);
  const link = text === null ? null : /^gitdir:[ \t]*(.+)$/.exec(text.trim());
  if (!link) return null;
  const gitDir = path.resolve(dir, link[1].trim());
  const commonText = smallText(path.join(gitDir, 'commondir'));
  if (commonText === null) return null;
  const common = path.resolve(gitDir, commonText.trim());
  if (kindOf(common) !== 'dir') return null;
  return fromGitDir(gitDir, common);
}

/**
 * The git directory (`gitDir`), the common directory (`common`) and the branch (`branch`) of the checkout that holds
 * `start`, read from files (GPR-22). Null when the files do not say; the caller then asks git.
 */
export function gitLocations(start = process.cwd()) {
  const key = path.resolve(start);
  if (!locationMemo.has(key)) locationMemo.set(key, readGitLocations(key));
  return locationMemo.get(key);
}

/**
 * The main checkout (ADR 028 § 3): the parent of the git common directory, whatever directory the hook runs from.
 * Returns null outside a git repository.
 */
export function mainCheckout(root) {
  const found = gitLocations(root);
  if (found) return path.dirname(found.common);
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
      const found = gitLocations(root);
      return found ? found.branch : git('rev-parse', '--abbrev-ref', 'HEAD');
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

/** One gate call's I/O deadline (gate-precision, GPR-20): the whole call, not each step. */
export const DEADLINE_MS = 5000;
/** One `git` spawn's own timeout, never longer than the time left (gate-precision). */
export const SPAWN_MAX_MS = 2000;
/** The most a `readFile` reads (gate-precision): larger files are refused, never cut short. */
export const READ_MAX_BYTES = 1024 * 1024;

/**
 * The bounded I/O of one gate call (gate-precision, design "I/O deadline"). `now`, `spawn` and `fs` are injected: the
 * gate passes the real ones, the unit tests fakes. Every call checks the deadline before it starts; past it, or when a
 * `git` spawn times out, the call returns `{ timedOut: true }` instead of throwing. A missing file, a refused file or a
 * failed `git` returns null, as the older helpers do.
 */
// How many git calls of this process timed out (T21): the guard reads a timed-out call as unknown, never as absent.
let gitTimeoutCount = 0;

/** The number of `git` calls that timed out so far in this process (see makeIo's `git`). */
export function gitTimeouts() {
  return gitTimeoutCount;
}

export function makeIo({
  now = () => Date.now(),
  spawn = execFileSync,
  fs = nodeFs,
  deadlineMs = DEADLINE_MS,
} = {}) {
  const deadline = now() + deadlineMs;
  const late = () => now() >= deadline;
  const TIMED_OUT = Object.freeze({ timedOut: true });
  let spawns = 0;
  return {
    /** `git` with an argument array, never a shell. Returns the trimmed stdout, null on failure, or timedOut. */
    git(args, { cwd = process.cwd() } = {}) {
      if (late()) {
        gitTimeoutCount += 1;
        return TIMED_OUT;
      }
      const timeout = Math.min(SPAWN_MAX_MS, deadline - now());
      spawns++;
      try {
        return spawn('git', ['-c', 'core.fsmonitor=false', ...args], {
          cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
          timeout,
          killSignal: 'SIGKILL',
        }).trim();
      } catch (err) {
        const timedOut = err?.code === 'ETIMEDOUT' || err?.signal === 'SIGKILL';
        if (timedOut) gitTimeoutCount += 1;
        return timedOut ? TIMED_OUT : null;
      }
    },
    /**
     * A regular file of at most READ_MAX_BYTES with one hard link, read from the same descriptor that was checked.
     * O_NONBLOCK keeps a FIFO from blocking the open; its type is then refused.
     */
    readFile(abs) {
      if (late()) return TIMED_OUT;
      let fd;
      try {
        fd = fs.openSync(abs, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
      } catch {
        return null;
      }
      try {
        const st = fs.fstatSync(fd);
        if (!st.isFile() || st.nlink !== 1 || st.size > READ_MAX_BYTES) return null;
        const buf = Buffer.alloc(READ_MAX_BYTES + 1);
        let len = 0;
        for (;;) {
          const n = fs.readSync(fd, buf, len, buf.length - len, null);
          if (n === 0) break;
          len += n;
          if (len > READ_MAX_BYTES) return null;
        }
        return buf.subarray(0, len).toString('utf8');
      } catch {
        return null;
      } finally {
        fs.closeSync(fd);
      }
    },
    realpath(p) {
      if (late()) return TIMED_OUT;
      try {
        return fs.realpathSync(p);
      } catch {
        return null;
      }
    },
    stat(p) {
      if (late()) return TIMED_OUT;
      try {
        return fs.statSync(p);
      } catch {
        return null;
      }
    },
    /** The number of `git` processes this call has started (GPR-22 caps them at 8 per line). */
    spawnCount: () => spawns,
  };
}
