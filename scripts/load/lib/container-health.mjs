// Whether the API container survived a step, and its peaks (LB-08). Pure: it reads the fields of two `docker inspect`
// results and the samples of `docker stats --format json`; no Docker call happens here.

const UNITS = {
  B: 1,
  kB: 1e3,
  KB: 1e3,
  KiB: 2 ** 10,
  MB: 1e6,
  MiB: 2 ** 20,
  GB: 1e9,
  GiB: 2 ** 30,
  TB: 1e12,
  TiB: 2 ** 40,
};

function stateOf(inspect) {
  const state = inspect?.State;
  if (typeof state?.Running !== 'boolean' || typeof state?.OOMKilled !== 'boolean') {
    throw new TypeError('an inspect result needs State.Running and State.OOMKilled');
  }
  if (!Number.isInteger(inspect.RestartCount) || typeof state.StartedAt !== 'string') {
    throw new TypeError('an inspect result needs RestartCount and State.StartedAt');
  }
  return {
    running: state.Running,
    oomKilled: state.OOMKilled,
    restartCount: inspect.RestartCount,
    startedAt: state.StartedAt,
  };
}

/**
 * True when the container still runs after the step as it did before it: not stopped, not OOM-killed, no restart
 * (a higher restart count) and no new start (a different start time).
 * @param {object} before `docker inspect` of the container before the step
 * @param {object} after `docker inspect` of the container after the step
 * @returns {boolean}
 */
export function containerOk(before, after) {
  const was = stateOf(before);
  const now = stateOf(after);
  if (!now.running || now.oomKilled) {
    return false;
  }
  if (now.restartCount > was.restartCount) {
    return false;
  }
  return now.startedAt === was.startedAt;
}

function percentOf(text) {
  const match = /^(\d+(?:\.\d+)?)%$/u.exec(String(text));
  if (!match) {
    throw new TypeError(`not a CPU percentage: ${String(text)}`);
  }
  return Number(match[1]);
}

function bytesOf(text) {
  const match = /^(\d+(?:\.\d+)?)([A-Za-z]+)$/u.exec(String(text).trim());
  if (!match || !(match[2] in UNITS)) {
    throw new TypeError(`not a memory size: ${String(text)}`);
  }
  return Math.round(Number(match[1]) * UNITS[match[2]]);
}

/**
 * The highest CPU percent and memory bytes of the `docker stats --format json` samples; 0 for no samples.
 * @param {{ CPUPerc: string, MemUsage: string }[]} samples
 * @returns {{ peakCpuPercent: number, peakMemoryBytes: number }}
 */
export function peakOf(samples) {
  let peakCpuPercent = 0;
  let peakMemoryBytes = 0;
  for (const sample of samples) {
    peakCpuPercent = Math.max(peakCpuPercent, percentOf(sample.CPUPerc));
    const [used] = String(sample.MemUsage).split(' / ');
    peakMemoryBytes = Math.max(peakMemoryBytes, bytesOf(used));
  }
  return { peakCpuPercent, peakMemoryBytes };
}
