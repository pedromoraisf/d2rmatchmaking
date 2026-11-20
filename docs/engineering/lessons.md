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

- **A binary handed to a human is started by CI first.** Every installer CI uploads or releases is smoke-started
  (`--self-check`) before the upload. Why: on 2026-11-19 the PR test installer was built without `D2RMM_API_BASE`, every
  check was green, and the agent exited silently on the maintainer's PC (a GUI-subsystem exe prints nothing).

- **Remove a worker's worktree once its branch is pushed and its report is read.** Each worktree holds 5–7 GB of Rust
  `target/`. Why: on 2026-11-11 six finished worktrees filled the maintainer's disk; a worker could not build, and
  Docker and Postgres failed with I/O errors until Docker Desktop was restarted (characters-reading, lobby-rooms).

- **A task that adds a Rust crate to the agent runs `cargo deny --locked check` in its gate**, and the security reviewer
  reads `apps/agent/src-tauri/deny.toml`. Why: `tauri-plugin-global-shortcut` is banned there, and PR #52 passed the
  worker's gates and both reviews before CI refused it (ready-check, 2026-11-11).

- **A task that adds or changes a route runs the whole API integration suite in its gate**, not only the module's
  tests. Why: `openapi.int.test.ts` pins every route, and three new character routes reached CI unlisted (#44).

- **Never commit a game screenshot, not even blurred, not even on a feature branch.** Why: on 2026-11-11 three of the
  maintainer's D2R screenshots (other players' names blurred) were committed as OCR fixtures and pushed to the public
  `feat/F1-agent-game-name` (commit 614337d). The repository is public and the runner may not force push, so they stay
  in that branch's history (the maintainer chose to keep the record). Real screenshots are read from a local path by an
  `xtask` command; fixtures are drawn. `scripts/check-images.mjs` now refuses captures at commit time and in CI.

- **When `docker pull` (or a Testcontainers start) hangs with no output, look for a stuck `docker-credential-desktop
get`.** Pull the public images with an empty config (`DOCKER_CONFIG=<dir holding {}> docker pull postgres:17-alpine`,
  same for `testcontainers/ryuk`) and run the suite with the same `DOCKER_CONFIG`; never touch `~/.docker`. Why: on
  2026-11-12 the room-view fix waited more than 10 minutes twice on the macOS credential helper before any test ran.
  An empty config also hides `buildx` (the legacy builder then fails on `--platform`), so for image builds such as
  `pnpm test:load` write `{ "cliPluginsExtraDirs": ["/Applications/Docker.app/Contents/Resources/cli-plugins"] }`
  instead of `{}` (F1 review, 2026-11-12).

- **Format and commit a worktree's files from inside that worktree, after `pnpm install` there.** `.prettierignore`
  skips `.claude/worktrees/`, so `prettier --write <worktree path>` run from the main checkout changes nothing and
  says nothing, and without `node_modules` Lefthook does not run. Why: the merge of `phase/F1` into PR #50 reached CI
  unformatted and `verify` failed (2026-11-12).

- **A task that changes the load journey (`scripts/load/k6/`) runs `pnpm test:load` and
  `node --test scripts/load/check/full-summary.check.mjs` before its PR.** Why: journeys-e2e made the k6 journey close
  each room within its iteration, and "rooms open at the step end" silently became 0. Only the phase review's full run
  saw it (F1 review, 2026-11-12).

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
- **A port found free is not a port held.** The acceptance stack allocates ports, releases them and binds them seconds
  later, so another worker or the kernel can take one (`Address already in use` from wrangler or the API, four CI runs
  on 2026-11-19). A stack that loses the race restarts on new ports (`support/ports.ts`); never retry on the same port.
  Locally, the `@OBS-`/`@RTL-09` scenarios time out at 5 min when `grafana/otel-lgtm` is not pulled: pull it first.
- **`instrument.int.test.ts` failed in CI on two PRs in a row (#43, #44).** If it fails a third time, fix the wait on the
  fake OTLP backend instead of rerunning.

- **Read traces from Tempo by trace id, not by search.** The search index of `grafana/otel-lgtm:0.39.0` lags ingest by
  about 30 s.
- **Load-test idempotency keys must be unique across virtual users.** `<name>-<per-VU sequence>` collided and showed up
  as `pending-at-close` errors that looked like a capacity limit.
- **In k6 with `xk6-sse`, no JavaScript timer fires while a stream is open**, and `postgres:17-alpine` has no `openssl`.

## Releases

- **release-please publishes the GitHub Release immediately unless the package sets `"draft": true`** (with
  `"force-tag-creation": true`, since a draft has no tag). Why: agent-v0.3.0 went public and Latest with no assets, so the
  download link and installed agents' `latest.json` were broken until the build ended; `releaseDraft` on tauri-action
  does nothing for a release another tool created.
- **Render's free tier sleeps after idle and takes 30-60 s to wake, so any online probe must wake it first** (retry
  `/healthz` with backoff for about 90 s). Why: `--self-check --online` failed with "the API could not be reached"
  after about 10 s on agent-v0.3.0 and passed on a rerun minutes later.
- **A bot-authored release PR needs "Approve and run" on its workflows before it can merge.** Why: PRs opened by the
  release bot do not start their checks on their own (agent 0.3.0, #70).

## Agent reading

- **Prove OCR on the real font with every glyph the server can generate, not on one fixed name.** Why: presence failed
  in production on `B` read as `8`, and CI only had the real print "DUEL NK LOCKS".
- **A fixed pixel box breaks across window and full screen, because D2R does not scale its HUD linearly; search for the
  words in a wide area.** Why: "Screen: not recognised" in windowed mode.
- **A diagnostic line in the agent window must reflect state changes.** Why: "waiting for the game" after a
  successful match was read as broken presence.

## Harness

- **Do not build a gate on a subagent's report or on a tight `git` timeout.** Why: `verdict.mjs` never saw the reports
  (they arrive as a separate message), and 2 s git reads timed out under load and exhausted a session (ADR 029).
- **The gate reads the whole shell command, heredocs included.** A commit message or PR body that names an env file
  in a heredoc or `-m` is denied. Write long messages to a file in the scratchpad and pass it with `-F` /
  `--body-file`.
- **The settings deny rule `Read(./.env.*)` also matches `.env.example`**, so the Write tool refuses it. Ask the
  maintainer to add the lines; do not write the file through the shell around the rule.
