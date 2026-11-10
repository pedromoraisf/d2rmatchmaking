// Runs one gate command for `attempt.mjs run` and stops it at its timeout (budget v2, BUD-03, BUD-06).
// The clock and the spawn are injected so the timeout is unit-tested with fakes; attempt.mjs passes the real ones.
import { spawn as nodeSpawn } from 'node:child_process';
import os from 'node:os';

/** After a timeout kill, the pipes can stay open for children of the shell; do not wait for them longer than this. */
export const KILL_GRACE_MS = 2000;

/**
 * Run `command` through the shell in `cwd`. Resolves with { status, signal, stdout, stderr, timedOut } once the
 * command ends. At `timeoutMs` the shell is killed with SIGKILL and `timedOut` is true.
 */
export function runGate(
  command,
  { cwd, timeoutMs, spawn = nodeSpawn, setTimer = setTimeout, clearTimer = clearTimeout } = {},
) {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timer = null;
    let grace = null;
    const finish = (status, signal) => {
      clearTimer(timer);
      clearTimer(grace);
      resolve({ status, signal, stdout, stderr, timedOut });
    };
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', (err) => {
      stderr += `${err.message}\n`;
      finish(null, null);
    });
    child.on('close', (status, signal) => finish(status, signal));
    timer = setTimer(() => {
      timedOut = true;
      child.kill('SIGKILL');
      grace = setTimer(() => finish(null, 'SIGKILL'), KILL_GRACE_MS);
    }, timeoutMs);
  });
}

/**
 * The wrapper's exit status for a finished command: 124 for a timeout, the exit code, 128 + the signal number when a
 * signal ended it (137 for SIGKILL), 1 otherwise.
 */
export function exitStatus({ status, signal, timedOut }) {
  if (timedOut) return 124;
  if (typeof status === 'number') return status;
  if (signal && os.constants.signals[signal] !== undefined) return 128 + os.constants.signals[signal];
  return 1;
}
