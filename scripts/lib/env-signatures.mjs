// Environment signatures (budget-v2, ADR 028 § 4): the failures the machine causes, not the code.
//
// `classify` names the signature of a failed command, or returns null when the failure is the code's own.
// The list is fixed and lives only here. A test-failure marker in the output always wins: a real test failure
// never spends nothing, even when a signature also matches (AD-156).

/** Markers that show a test failed. Any of them in the output means the failure is an ordinary one. */
export const TEST_FAILURE_MARKERS = ['not ok ', '✖', '✗', ' FAIL ', 'failing', 'test result: FAILED'];
const TEST_FAILURE_LINE = /Tests?:.*failed/;

const has = (output, needles) => needles.some((needle) => output.includes(needle));

/**
 * One entry per signature, in the order they are tried. `match` sees the status, signal, output and timeout flag.
 * `timeout` comes first: the wrapper stopped that command itself with SIGKILL, so its signal would also read `killed`
 * and the cause is the wrapper's timeout (BUD-06).
 */
export const ENV_SIGNATURES = [
  {
    name: 'timeout',
    match: ({ timedOut }) => timedOut === true,
  },
  {
    name: 'docker',
    match: ({ output }) =>
      has(output, [
        'Cannot connect to the Docker daemon',
        'Could not find a working container runtime strategy',
      ]),
  },
  {
    name: 'disk',
    match: ({ output }) =>
      has(output, ['ENOSPC']) || output.toLowerCase().includes('no space left on device'),
  },
  {
    name: 'killed',
    match: ({ status, signal }) => status === 137 || signal === 'SIGKILL',
  },
  {
    name: 'port',
    match: ({ output }) => has(output, ['EADDRINUSE']),
  },
  {
    name: 'not-found',
    match: ({ status, output }) =>
      status === 127 || /: command not found\r?$/m.test(output) || /\bspawn \S+ ENOENT/.test(output),
  },
];

/** True when the output shows a test failed. */
export function hasTestFailure(output) {
  return has(output, TEST_FAILURE_MARKERS) || TEST_FAILURE_LINE.test(output);
}

/**
 * The first matching environment signature of a failed command, as `{ signature }`, or null.
 * `status` is the exit status (null when killed by a signal), `signal` the termination signal, `output` the
 * stdout and stderr together, `timedOut` true when the wrapper stopped the command.
 */
export function classify({ status = null, signal = null, output = '', timedOut = false } = {}) {
  const text = String(output ?? '');
  if (hasTestFailure(text)) return null;
  const probe = { status, signal, output: text, timedOut: timedOut === true };
  const hit = ENV_SIGNATURES.find((s) => s.match(probe));
  return hit ? { signature: hit.name } : null;
}
