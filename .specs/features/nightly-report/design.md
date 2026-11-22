# Nightly report — Design

## Jobs

```text
detect ──┬─ agent-mutation (matrix: core · domain 1/4 … 4/4 · adapters 1/2 · adapters 2/2)
         ├─ api-mutation   (matrix: domain · application)
         ├─ acceptance
         ├─ load
         └─ backup (unchanged)
quality  (needs agent-mutation, api-mutation; if: !cancelled()) — the ratchet, as today, from downloaded artifacts
report   (needs every job above; if: always())               — builds nightly-report.md/.json, job summary, artifact
```

- Each job runs only when `inputs.suites` selects it. The schedule has no inputs and runs all of them, so the
  condition is `github.event_name == 'schedule' || inputs.suites == 'all' || inputs.suites == '<suite>'`.
- **Agent mutation**: `cargo mutants --package <crate> [--shard k/n] --output reports/mutation/agent-<crate>[-k] -- --lib`.
  `core` and `adapters` run `--in-place` (their tests read files outside the copied workspace). Each shard uploads `agent-mutation-<crate>[-k]`. Both crate shards use `rust-cache`.
- **API mutation**: `pnpm --filter @d2rmm/api run test:mutation -- --layer <layer>`, or the existing plan script's
  per-layer entry; the worker checks `apps/api/scripts/mutation-plan.ts`. Each layer uploads
  `api-mutation-<layer>`.
- **Acceptance**: `pnpm test:acceptance`, with the JSON reporter that already exists
  (`reports/acceptance/results.json`). The artifact is `acceptance-report`. Shard it only if a single job takes more
  than 25 minutes.
- **Load**: `pnpm test:load`, then `node --test scripts/load/check/full-summary.check.mjs`. The API and k6 images
  build with buildx and the GitHub Actions cache. The artifact is `load-report` (`reports/load/summary.json`).
- **Quality**: downloads every `agent-mutation-*` and `api-mutation-*` artifact into the paths `quality-collect`
  already reads. Sharded cargo-mutants outputs are merged first by `scripts/nightly/merge-mutants.mjs`, so the
  ratchet keeps reading one `outcomes.json` per crate.
- **Report**: downloads every artifact, plus the previous `nightly-report` artifact of the latest earlier scheduled
  run on `main` (`gh run list` and `gh run download`; skipped when there is none). It then runs
  `node scripts/nightly/report.mjs --out reports/nightly` and appends the markdown to `$GITHUB_STEP_SUMMARY`.

Permissions: `contents: read`, plus `actions: read` for the report job to read earlier runs. No new secret is needed.

## Scripts (`scripts/nightly/`, pure, rule 12)

| File                | Exports                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `mutation.mjs`      | `fromCargoMutants(outcomes, readingModules)`, `fromStryker(report)` → `{ score, counts, survivors[] }` |
| `merge-mutants.mjs` | `mergeOutcomes(shards[])` → one cargo-mutants `outcomes.json`                                          |
| `load.mjs`          | `fromLoadSummary(summary, budget)` → steps and verdict                                                 |
| `acceptance.mjs`    | `fromPlaywright(results)` → scenarios `{ feature, title, tags, status }`, failures first               |
| `trend.mjs`         | `compare(current, previous)` → deltas, or `null` when there is no previous report                      |
| `render.mjs`        | `toMarkdown(report)`                                                                                   |
| `report.mjs`        | CLI: reads the files, calls the above, writes `.md` and `.json`                                        |

Fixtures live in `scripts/test/fixtures/nightly/`: small real-shaped files cut from run 44558970584, a load summary
and a Playwright JSON. Tests live in `scripts/test/nightly-*.test.mjs`.

## Report shape (`nightly-report.json`)

```json
{
  "commit": "…",
  "branch": "…",
  "suites": ["mutation", "load", "acceptance"],
  "jobs": [{ "name": "agent-mutation (domain 1/4)", "result": "success", "minutes": 11.2 }],
  "mutation": [
    {
      "target": "agent-domain",
      "baseline": "ok",
      "score": 92.6,
      "counts": { "caught": 640, "missed": 51, "timeout": 1, "unviable": 72 },
      "survivors": [
        {
          "file": "domain/src/layout.rs",
          "reading": true,
          "mutants": [{ "line": 49, "mutation": "replace … with …" }]
        }
      ]
    }
  ],
  "load": {
    "verdict": "passed",
    "steps": [
      { "players": 100, "errors": 0, "p95Ms": 5.5, "bytesPerPlayerHour": 421369, "budget": 70000, "rooms": 0 }
    ]
  },
  "acceptance": {
    "passed": 160,
    "failed": 1,
    "flaky": 1,
    "skipped": 0,
    "scenarios": [{ "feature": "…", "title": "…", "tags": ["@RDY-07"], "status": "failed" }]
  },
  "trend": {
    "previousRun": 44558970584,
    "deltas": [{ "target": "agent-domain", "score": 1.4, "missed": -5 }]
  }
}
```

## Time budget (target 40 minutes)

| Job                | Today                     | Expected                          |
| ------------------ | ------------------------- | --------------------------------- |
| adapters           | 31 min                    | about 17 min per shard            |
| domain             | 22 min                    | about 12 min per shard            |
| core               | 4 min                     | about 6 min, with the new modules |
| API application    | 10 min                    | 10 min                            |
| load               | 20 min, plus image builds | about 25 min with a warm cache    |
| acceptance         | 6–7 min                   | 7 min                             |
| quality and report | after the slowest job     | plus 3 min                        |

## ADRs and docs

- ADR 035 (Proposed): the nightly runs the load test on a GitHub runner. It amends `testing.md` rule 8 ("never part of
  `pnpm check` or a pull-request workflow" stays true).
- `docs/engineering/testing.md`: how to dispatch a suite on a branch.
