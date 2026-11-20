// The gate of `stage-promote` (ADR 033, § 7): a commit is promoted only when its staging run passed the smoke stage.
// The run is found through the GitHub REST API: the caller workflow's runs for the SHA, on a push to main, whose
// `smoke` job succeeded. The pure rule is here; the CLI reads the API.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Whether a job is the smoke stage of a run: the job `smoke`, or `smoke / smoke` of a reusable-workflow caller. */
export function isSmokeJob(job) {
  return typeof job?.name === 'string' && /^smoke( \/ smoke)?$/.test(job.name);
}

/**
 * The id of the newest run in `runs` (`{ id, head_sha, head_branch, event, conclusion }`) that is a staging run of `sha`
 * (a push to main), concluded successfully, and whose jobs (`jobsOf(runId)`) hold a successful smoke job; else undefined.
 */
export function stagingSmokeRunId(runs, sha, jobsOf) {
  if (!/^[0-9a-f]{40}$/.test(String(sha))) return undefined;
  for (const run of Array.isArray(runs) ? runs : []) {
    if (run.head_sha !== sha || run.event !== 'push' || run.head_branch !== 'main') continue;
    if (run.conclusion !== 'success') continue;
    if (jobsOf(run.id).some((job) => isSmokeJob(job) && job.conclusion === 'success')) return run.id;
  }
  return undefined;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // `promotable.mjs <app> <sha>`: prints the staging run id, or exits 1. Needs GH_TOKEN and GH_REPO.
  const [app, sha] = process.argv.slice(2);
  const api = (route, ...fields) =>
    JSON.parse(execFileSync('gh', ['api', '-X', 'GET', route, ...fields], { encoding: 'utf8' }));
  const repo = process.env.GH_REPO;
  const runs = api(`repos/${repo}/actions/workflows/${app}.yml/runs`, '-f', `head_sha=${sha}`).workflow_runs;
  const id = stagingSmokeRunId(runs, sha, (runId) => api(`repos/${repo}/actions/runs/${runId}/jobs`).jobs);
  if (id === undefined) {
    process.stderr.write(
      `::error::${sha} has no successful staging smoke run in ${app}.yml; it is not promoted\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`${id}\n`);
}
