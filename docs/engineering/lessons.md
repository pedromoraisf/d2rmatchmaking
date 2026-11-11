# Lessons

Read this file at the start of every session and before writing a plan. Each lesson is one rule and why it exists.
Add one when the same thing failed twice, when a reviewer or CI caught a class of mistake, or when a blocker was
recorded in a phase's `decisions.md` (ADR 029). Keep each lesson to a rule and a reason; delete a lesson that stops
being true.

## Working loop

- **After three failures of the same thing, stop.** Record the blocker (what failed, the last error, what each attempt
  changed) in the phase's `decisions.md`, add a lesson here if it teaches one, and move to work that does not depend
  on it. Why: in F0 the third and later attempts rarely fixed anything; they repeated the same diagnosis.
- **Change the cause before a retry, never the test or the check.** An unchanged rerun proves nothing.
- **Run a command once before writing it into `tasks.md` as a gate or a proof.** Why: `cargo mutants --locked` is not a
  cargo-mutants flag (`--cargo-arg=--locked` is), and the wrong command in an approved plan cost a full retry cycle in
  agent-hexagonal-migration.
- **Never poll.** Run long work (builds, test suites, `gh pr checks --watch`) in the background and continue on its
  notification. Why: one F0 worker made 1,204 status checks in 76 minutes.
- **Format files before the format check runs.** Files written by an agent or a tool (reports, `verification.md`) fail
  `pnpm format:check` until Prettier runs on them. Why: a verification gate was spent on formatting alone.

- **A feature's `acceptance.feature` reaches the phase branch together with its steps, in the feature PR.** Why:
  playwright-bdd runs with `missingSteps: 'fail-on-gen'`, so a spec committed to `phase/F1` before its steps would
  fail generation in every other PR's acceptance run (found before the first F1 dispatch).

- **In a fresh worktree, build the agent window once (`pnpm --filter @d2rmm/agent build`) before pushing.** Why: the
  pre-push `cargo clippy` needs `apps/agent/dist` (Tauri `frontendDist`) and fails without it, which looks like a code
  failure (characters, Batch 1).

- **A task that adds or changes a route runs the whole API integration suite in its gate**, not only the module's
  tests. Why: `openapi.int.test.ts` pins every route, and three new character routes reached CI unlisted (#44).

- **Never commit a game screenshot, not even blurred, not even on a feature branch.** Why: on 2026-11-11 three of the
  maintainer's D2R screenshots (other players' names blurred) were committed as OCR fixtures and pushed to the public
  `feat/F1-agent-game-name` (commit 614337d). The repository is public and the runner may not force push, so they stay
  in that branch's history (the maintainer chose to keep the record). Real screenshots are read from a local path by an
  `xtask` command; fixtures are drawn. `scripts/check-images.mjs` now refuses captures at commit time and in CI.

## Tests

- **No tight wall-clock limits in unit tests.** The maintainer's machine has 8 GB and runs the suites in parallel; a test
  that fails only there and passes in CI is the machine, not the code. Why: the gate watchdog test (1 s margin) and a
  gate-precision timing test failed only under local load.
- **A fixture must be an input the production code accepts.** Read the guard before writing the fixture. Why: an 8x8
  test image produced no observation because the core reads only supported resolutions (1920x1080), and the T46 gate
  failed three times on it.
- **Extract a decision into a pure function and unit-test its boundaries** (rule 12): request validation, status
  mappings, tracing attributes. Why: mutants in `bodyRefusal` and in `shared-kernel/tracing.ts` survived until the rule
  had its own unit tests.
- **When a privacy rule drops personal data, test every attribute key a library can carry it under**, not only the key
  the spec names. Why: observability-e2e, verification finding 1.
- **Read OpenTelemetry metrics in tests with `reader.collect()` on a non-exporting `MetricReader`**, not from an
  in-memory exporter after `forceFlush()`. Why: the exporter returned more series than the view kept (T8).
- **Work done before the first request spends the sampler's shared budget.** Every root span (a statement with no
  parent, a timer job, a boot query) takes a token from the 40-token burst (AD-100). Migrating a fresh database inside the
  traced process records about 47 roots before the first request, and a request that arrives after the budget is spent
  loses its server span. Migrate in an untraced process before the traced one starts. Why: the CI failure of
  `instrument.int.test.ts` (run 42965570821) showed the migration statements and no server span.

## Observability and load

- **Closing a Playwright browser context does not end its `EventSource` connection promptly** (Chromium kept a site
  stream open > 10 s behind the Pages proxy). A Given that needs "the site is gone" closes the browser and then ends the
  account's streams through a test control. Why: queues QUE-05 failed four times on sleeps and polls (2026-11-11).

- **Locally, run the traced scenarios (`@OBS-`) alone with `--workers=1`**, never mixed into a broad acceptance gate.
  Why: the traced stack (API, site, telemetry backend per worker) did not become ready within 90 s under 4 workers on
  the 8 GB machine, and the same 22 scenarios passed with one worker (characters, T14).
- **`instrument.int.test.ts` failed in CI on two PRs in a row (#43, #44).** If it fails a third time, fix the wait on the
  fake OTLP backend instead of rerunning.

- **Read traces from Tempo by trace id, not by search.** The search index of `grafana/otel-lgtm:0.39.0` lags ingest by
  about 30 s.
- **Load-test idempotency keys must be unique across virtual users.** `<name>-<per-VU sequence>` collided and showed up
  as `pending-at-close` errors that looked like a capacity limit.
- **In k6 with `xk6-sse`, no JavaScript timer fires while a stream is open**, and `postgres:17-alpine` has no `openssl`.

## Harness

- **Do not build a gate on a subagent's report or on a tight `git` timeout.** Why: `verdict.mjs` never saw the reports
  (they arrive as a separate message), and 2 s git reads timed out under load and exhausted a session (ADR 029).
- **The gate reads the whole shell command, heredocs included.** A commit message or PR body that names an env file
  in a heredoc or `-m` is denied. Write long messages to a file in the scratchpad and pass it with `-F` /
  `--body-file`.
- **The settings deny rule `Read(./.env.*)` also matches `.env.example`**, so the Write tool refuses it. Ask the
  maintainer to add the lines; do not write the file through the shell around the rule.
