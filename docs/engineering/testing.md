# Testing

| Level                | Tool                                                                            | Where                             | Runs                                        |
| -------------------- | ------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------- |
| Unit                 | Vitest; `cargo nextest` + `insta`                                               | next to code                      | on edit (related), pre-commit (related), CI |
| Integration          | Vitest + Testcontainers (Postgres)                                              | `apps/api/test/integration`       | CI                                          |
| Contract             | Zod → JSON Schema snapshot; OpenAPI/AsyncAPI drift                              | `packages/contracts`              | Stop hook, CI                               |
| Acceptance (BDD)     | playwright-bdd running `.specs/features/*/acceptance.feature` (English Gherkin) | steps in `tests/acceptance/steps` | proofs, CI integration job (ADR 023)        |
| End to end (non-BDD) | Playwright                                                                      | `apps/web/e2e`                    | CI                                          |
| Load                 | k6 (+ SSE extension) in Docker                                                  | `scripts/load`                    | on demand, end of a phase, nightly (NFR-14) |
| Mutation             | StrykerJS (domain ≥ 80%, application ≥ 70%); cargo-mutants (agent core ≥ 70%)   | per workspace                     | nightly only (ADR 029)                      |

Rules:

0. The highest level is BDD: every requirement ID of a feature has a Gherkin scenario in its `acceptance.feature`,
   approved with the spec and executed as-is. `pnpm acceptance:check` enforces coverage and hygiene.
1. Tests come from acceptance criteria (TLC); name them after the behaviour (`expires the room when the host does not create the game in 3 minutes`).
2. Fakes over mocks for ports we own (`FakeClock`, `InMemoryQueueStore`). Mock only third-party edges.
3. Never delete, skip or loosen a test to pass a gate — the gate hook escalates it.
4. Every domain invariant (`docs/domain/invariants.md`) has a test that names its ID.
5. OCR and capture use recorded fixtures (`apps/agent/fixtures/`), never live game screens in CI.
6. Floors live in `.quality-baseline.json` and only tighten.
7. Mutation testing runs against unit tests only (ADR 026). Unit tests are the base of the pyramid (many, fast, fakes
   for ports, no server/DB/browser/container); integration, e2e and acceptance are few and never run per mutation.
   Rust: `cargo nextest run -p <crate> --lib`; TypeScript: `vitest run <colocated *.test.ts>`. `pnpm specs:check`
   (`scripts/mutation-scope-check.mjs`) and the gate refuse a `mutations.json` that breaks this.
   The agent's `cargo mutants` builds with `[profile.mutants]` (`.cargo/mutants.toml`): workspace crates unoptimised and
   incremental without debug info, dependencies optimised (`opt-level = 2`), debug assertions and overflow checks on.
   Every mutant rebuilds the crates it touches, so an optimised workspace build cost more per mutant than the tests it
   saved (nightly 45115512456: core 20 → 42 min, adapters 21 → over 60 min); measured per mutant, this shape was the
   cheapest of five candidates on the domain, core and adapters slices.
8. The load run (NFR-14, AD-110) is on demand, runs at the end of a phase, and runs in the nightly on a GitHub runner
   (ADR 035, Proposed). It is never part of `pnpm check` or a pull-request workflow; `scripts/test/load-scripts.test.mjs`
   refuses it in any workflow except `nightly.yml`. Three commands: `pnpm test:load` (the full ramp),
   `pnpm test:load:smoke` (5 players for 30 s, writes `smoke-summary.json` only) and `pnpm load:publish` (writes
   `docs/engineering/load-baseline.md` from a passed full summary, and refuses anything else). The run needs Docker: it
   starts its own Postgres, API and k6 containers, and it refuses any target it did not start (`LOAD_TARGET`, a
   non-empty `DATABASE_URL`, a remote Docker host). Its code lives in `scripts/load`; its unit tests live in `scripts/test/load`.

9. The real-print OCR check (`.github/workflows/ocr-real.yml`, `apps/agent/ocr-lab/README.md`) runs on pull requests that
   touch the agent. Its `ocr-variations` check is sharded: a matrix of 8 Windows jobs (`ocr-variations-shard`, each
   `ocr-check --variations --shard i/8`, 120-minute cap) reads the prints, a 20-minute per-print budget fails a slow print,
   and the final job `ocr-variations` merges the partial counts (`scripts/agent/ocr-variations-shards.mjs`) and holds the
   totals to the quality ratchet, context `ocr`, exactly as the unsharded run did. A missing shard, or a print counted twice
   or not at all, fails the merge.

## The nightly and its report

The nightly (`.github/workflows/nightly.yml`) runs its suites as parallel jobs: agent mutation (a matrix per crate, two
shards for the domain and the adapters), API mutation (per layer), acceptance, load, the quality ratchet and one report
job that always runs last. The report (`nightly-report.md` and `nightly-report.json`) is the run's job summary and an
artifact. It shows the jobs, the mutation scores and survivors per file, the load steps, every acceptance scenario
(failures first) and the change since the latest earlier scheduled run on `main`. Its rules are pure functions in
`scripts/nightly/`, tested in `scripts/test/nightly-*.test.mjs`.

### Dispatching a suite on a branch

Any session can run part of the nightly on its branch, without waiting for the schedule:

```text
gh workflow run nightly.yml --ref <branch> -f suites=<all|mutation|load|acceptance>
gh run list --workflow nightly.yml --branch <branch> --limit 1
gh run watch <run-id>
```

The job summary of the run is the report; `gh run download <run-id> -n nightly-report` fetches it. `gh workflow run`
can only dispatch a workflow file that is on the default branch or on the `--ref` branch, so a workflow change is tested
by dispatching on the branch that carries it. A missed mutant still fails its matrix job: the nightly turns green by
killing survivors, never by tolerating them. The schedule always runs every suite.
