# ADR 035 — The nightly runs the load test on a GitHub runner

**Status**: Accepted
**Date**: 2026-11-20 (accepted 2026-11-20 by the maintainer: "aceito o ADR")
**Deciders**: maintainer

## Context

`testing.md` rule 8 says the load run (NFR-14, AD-110) is on demand and runs at the end of a phase, on the maintainer's
machine. The nightly has failed every night since 2026-11-13, and the maintainer asked for one report per run covering
mutation, load and acceptance, with the load run included (2026-11-20, `F1/post-close.md`; F2 brief, input 3 and the
exit criterion "Nightly green and readable"). Nothing in the rule forbids a GitHub runner; the rule forbids the load
from being part of `pnpm check` or a pull-request workflow.

## Decision

The nightly workflow has a `load` job that runs `pnpm test:load` (the full ramp) and then
`node --test scripts/load/check/full-summary.check.mjs` on a GitHub-hosted runner (NGT-08).

- The harness is unchanged. It starts its own Postgres, API and k6 containers, keeps the API container's limits
  (`--cpus 0.5 --memory 512m` by default), and refuses any target it did not start (`LOAD_TARGET`, a non-empty
  `DATABASE_URL`, a remote Docker host). The job sets none of those variables and has no service container.
- The API and k6 images are built first with buildx and the GitHub Actions cache, under the tags the harness uses, so a
  warm cache does not pay for the xk6 compile every night.
- The job uploads `reports/load/summary.json` and the check's verdict. The report job shows them (NGT-05). A failed
  check fails the job.
- The load stays out of `pnpm check`, every pull-request workflow and `ci.yml`. A harness test
  (`scripts/test/load-scripts.test.mjs`) refuses it in any workflow except `nightly.yml`.
- The numbers from a shared runner are not the numbers of the maintainer's machine. `docs/engineering/load-baseline.md`
  is still written only by `pnpm load:publish` from a full summary the maintainer chose. The nightly report shows the
  trend of the runner's own numbers, never replaces the baseline.

## Consequences

- `testing.md` rule 8 changes: the load is on demand on a machine, and also runs in the nightly. It is still never part
  of `pnpm check` or a pull-request workflow.
- The nightly's wall time depends on the load job (about 25 minutes with a warm cache, 20 minutes of it the ramp). The
  other jobs run in parallel with it, so the run's target of 40 minutes holds only while the load job stays under it.
- A runner with fewer resources than the maintainer's machine can fail the ramp at a lower step. The report shows the
  step that stopped it; a lower ceiling than the baseline is information, not a failure of the test, as long as the
  100-player minimum passes (LB-10).
- No new secret, no new cost: the runner minutes are those of a public repository.
