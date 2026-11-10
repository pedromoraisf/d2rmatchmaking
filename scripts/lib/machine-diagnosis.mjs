// The machine's state, printed when a unit is env-blocked (budget v2, BUD-04): the runner escalates the machine,
// not the code. Each probe runs at most PROBE_TIMEOUT_MS and reads `unavailable` when it fails or times out.
// The process runner is injected so the formatting is unit-tested with fake probes.
import { spawnSync as nodeSpawnSync } from 'node:child_process';
import os from 'node:os';

export const PROBE_TIMEOUT_MS = 10_000;

const ACCEPTANCE_PROCESS = /playwright|bddgen/i;

/** Stdout of a command, trimmed, or null when it fails, is missing or times out. */
function probe(run, file, args) {
  try {
    const r = run(file, args, {
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (r.error || r.status !== 0 || r.signal) return null;
    return String(r.stdout ?? '').trim();
  } catch {
    return null;
  }
}

const oneLine = (text) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' | ');

function swapLine(run, platform) {
  if (platform === 'darwin') {
    const out = probe(run, 'sysctl', ['-n', 'vm.swapusage']);
    return out === null ? 'unavailable' : out;
  }
  if (platform === 'linux') {
    const out = probe(run, 'free', ['-m']);
    const line = out?.split('\n').find((l) => /^swap:/i.test(l.trim()));
    return line ? line.trim() : 'unavailable';
  }
  return 'unavailable';
}

function containersLine(run) {
  const out = probe(run, 'docker', ['ps', '--format', '{{.Names}} ({{.Status}})']);
  if (out === null) return 'unavailable';
  return out === '' ? 'none' : oneLine(out);
}

function acceptanceLine(run) {
  const out = probe(run, 'ps', ['-axo', 'command=']);
  if (out === null) return 'unavailable';
  const found = out.split('\n').filter((l) => ACCEPTANCE_PROCESS.test(l));
  if (found.length === 0) return 'none';
  return `${found.length} running (${found
    .slice(0, 3)
    .map((l) => l.trim().slice(0, 100))
    .join(' | ')})`;
}

/** The diagnosis as printable lines. Every probe is injectable: `run` (spawnSync), `freemem`, `loadavg`, `platform`. */
export function diagnose({
  run = nodeSpawnSync,
  freemem = os.freemem,
  loadavg = os.loadavg,
  platform = process.platform,
} = {}) {
  const gib = (bytes) => `${(bytes / 2 ** 30).toFixed(1)} GiB`;
  return [
    'Machine diagnosis (not counted against the code; the machine needs attention):',
    `  free memory: ${gib(freemem())} of ${gib(os.totalmem())}`,
    `  swap used: ${swapLine(run, platform)}`,
    `  load average (1, 5, 15 min): ${loadavg()
      .map((x) => x.toFixed(2))
      .join(' ')}`,
    `  running containers: ${containersLine(run)}`,
    `  leftover acceptance processes: ${acceptanceLine(run)}`,
  ];
}
