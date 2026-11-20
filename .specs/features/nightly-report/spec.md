# Nightly report — Specification

**Phase**: F2 (covered by the brief's approval, ADR 029) · **Size**: Large · **Security review**: no (CI workflow and
report scripts; no new secret, and the `backup` job is unchanged)

## Problem

The nightly has failed every night since 2026-11-13, for three reasons:

- The core's mutation baseline fails on an order-dependent test. This is fixed by `ocr-protection` OCP-04.
- The domain has 51 missed mutants (also `ocr-protection`), and the adapters have one, at `http/sse.rs:60`.
- The quality ratchet then reports `mutation.agent.core` as missing.

Its critical path is about 73 minutes: the three crates run one after another, and `quality` waits for them. It shows
nothing readable. Load runs only on the maintainer's machine (`testing.md` rule 8), and acceptance runs only in the PR
CI.

The maintainer wants one report per run, covering mutation, load and acceptance. They want the load run in the
nightly, and agents dispatching the nightly while they work, as fast as possible (2026-11-20, `F1/post-close.md`;
brief inputs 3 and the exit criterion "Nightly green and readable").

## Requirements

- **NGT-01** — The nightly SHALL run its suites as parallel jobs:
  - agent mutation as a matrix per crate, sharded where one crate takes more than 15 minutes;
  - API mutation per layer;
  - acceptance;
  - load;
  - the quality ratchet;
  - one report job that runs last, even when others failed.

  A full run SHALL take 40 minutes or less of wall time on GitHub's standard runners.

- **NGT-02** — `workflow_dispatch` SHALL take an input `suites` (`all`, `mutation`, `load`, `acceptance`, default `all`),
  so any session can run part of the nightly on a branch with `gh workflow run` and `-f suites=<suite>`. The schedule
  SHALL always run `all`.
- **NGT-03** — The report job SHALL publish one report, `nightly-report.md`, as the run's job summary and as an
  artifact, together with its data as `nightly-report.json`. Its header SHALL give the commit, the branch, the suites
  that ran, and each job's duration and result.
- **NGT-04** — The mutation section SHALL show, per agent crate and per API layer: the score, the counts (caught,
  missed, timeout, unviable), and the survivors grouped by file with line and mutation. Survivors in a reading module
  (`scripts/agent/reading-modules.json`) SHALL be marked as such. A crate whose baseline failed SHALL say so, instead
  of showing a score.
- **NGT-05** — The load section SHALL show, per step: players, errors, p95, bytes per player-hour against the 70,000
  budget, and rooms. It SHALL also give the verdict of `full-summary.check.mjs`.
- **NGT-06** — The acceptance section SHALL list every scenario with its feature, its tags and its result (passed,
  failed, flaky, skipped), failures first.
- **NGT-07** — The report SHALL compare each score and count with the latest earlier nightly on `main` that published a
  report, and show the change. When there is none, it SHALL say "no previous report".
- **NGT-08** — The load job SHALL run `pnpm test:load` on a GitHub runner with the API container limited as today
  (`--cpus 0.5 --memory 512m` by default), and SHALL refuse any remote target as the load harness already does. ADR 035
  (Proposed) and `testing.md` rule 8 SHALL record that the nightly runs it.
- **NGT-09** — The adapters' survivor at `http/sse.rs:60` (`ready_check_open_from_body` → `None`) SHALL be killed by a
  unit test.
- **NGT-10** — The report's rules SHALL be pure functions in `scripts/nightly/`, unit-tested on fixture reports from
  cargo-mutants, Stryker, the load summary and Playwright's JSON (rule 12). The workflow's structure SHALL be checked by
  `scripts/test/nightly-workflow.test.mjs`. That covers the jobs, `needs`, the `always()` report and the pinned actions.

## Sources

| ID     | Source                                                                        |
| ------ | ----------------------------------------------------------------------------- |
| NGT-01 | brief exit "Nightly green and readable"; maintainer 2026-11-20 ("celeridade") |
| NGT-02 | maintainer 2026-11-20 ("desenvolva e dispare ele em sequencia"); ADR 029      |
| NGT-03 | maintainer 2026-11-20 ("relatorio a cada execução")                           |
| NGT-04 | same ("relatorio util sobre mutação, resumido"); `ocr-protection` OCP-02      |
| NGT-05 | same ("como esta a carga do jogo"); NFR-14; `scripts/load/lib/summary.mjs`    |
| NGT-06 | same ("se as aceitações (bdd) estão passando… listar elas também"); ADR 023   |
| NGT-07 | same ("trend"); `F1/post-close.md` § Nightly                                  |
| NGT-08 | brief input 3 (approved: nightly, ADR 035); NFR-14; AD-110                    |
| NGT-09 | ADR 026; nightly 44558970584                                                  |
| NGT-10 | AGENTS.md rule 12; ADR 026                                                    |

## Requirement Traceability

| Requirement ID | Story      | Proof                                                                |
| -------------- | ---------- | -------------------------------------------------------------------- |
| NGT-01         | Parallel   | `nightly-workflow` harness test + a dispatched run of 40 min or less |
| NGT-02         | Dispatch   | `nightly-workflow` harness test + acceptance `@NGT-02`               |
| NGT-03         | Report     | unit tests (`scripts/nightly`) + the dispatched run's summary        |
| NGT-04         | Mutation   | unit tests on cargo-mutants and Stryker fixtures                     |
| NGT-05         | Load       | unit tests on a load summary fixture                                 |
| NGT-06         | Acceptance | unit tests on a Playwright JSON fixture + acceptance `@NGT-06`       |
| NGT-07         | Trend      | unit tests (previous report present and absent)                      |
| NGT-08         | Load in CI | `nightly-workflow` harness test + the dispatched run                 |
| NGT-09         | Survivor   | Rust unit test in adapters                                           |
| NGT-10         | Purity     | `pnpm test:harness`                                                  |

## Decisions (conservative defaults)

- A missed mutant still fails its matrix job, as today. The nightly turns green by killing survivors (this feature and
  `ocr-protection`), never by tolerating them (AGENTS.md rule 4).
- New ratchet metrics for the agent domain and adapters are proposed in `decisions.md → To confirm`, not added:
  `.quality-baseline.json` is the maintainer's.
- The trend reads the previous report through `gh run download` with the run's own `GITHUB_TOKEN` and read-only
  permissions.
