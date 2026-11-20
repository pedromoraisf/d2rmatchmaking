// The `verify` stage (ADR 033): reads the `ci` run of a commit and never re-runs it. The decision is a pure function;
// the CLI polls `gh api` with long sleeps until ci finishes (a run that has not started is waited for, a bounded time).
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * `runs` are the workflow runs of one commit (`{ status, conclusion }`, newest first). Returns `pass`, `fail`, `wait`
 * (a run is not finished) or `absent` (no run). With `required` false an absent run is a pass: a branch push without a
 * pull request has no ci run, and its preview must not wait for one.
 */
export function verdictOf(runs, { required }) {
  const list = Array.isArray(runs) ? runs : [];
  if (list.length === 0) return required ? 'absent' : 'pass';
  const latest = list[0];
  if (latest.status !== 'completed') return 'wait';
  return latest.conclusion === 'success' ? 'pass' : 'fail';
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `readRuns` until the verdict is final or `budgetMs` is spent; returns the last verdict. */
export async function waitForVerdict(
  readRuns,
  { required, budgetMs, intervalMs, now = Date.now, wait = sleep },
) {
  const start = now();
  for (;;) {
    const verdict = verdictOf(await readRuns(), { required });
    if (verdict === 'pass' || verdict === 'fail') return verdict;
    if (now() - start + intervalMs > budgetMs) return verdict;
    await wait(intervalMs);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // `ci-verdict.mjs <sha> <required: true|false>`; needs GH_TOKEN and GH_REPO.
  const [sha, required] = process.argv.slice(2);
  const readRuns = () => {
    const json = execFileSync(
      'gh',
      [
        'api',
        '-X',
        'GET',
        `repos/${process.env.GH_REPO}/actions/workflows/ci.yml/runs`,
        '-f',
        `head_sha=${sha}`,
      ],
      { encoding: 'utf8' },
    );
    return JSON.parse(json).workflow_runs;
  };
  const verdict = await waitForVerdict(readRuns, {
    required: required === 'true',
    budgetMs: 30 * 60_000,
    intervalMs: 30_000,
  });
  process.stdout.write(`ci verdict for ${sha}: ${verdict}\n`);
  if (verdict !== 'pass') {
    process.stderr.write(
      `::error::The ci run of ${sha} is not green (${verdict}); nothing is deployed from it\n`,
    );
    process.exit(1);
  }
}
