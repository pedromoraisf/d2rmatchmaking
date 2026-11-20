# Upkeep — Tasks

Spec: `spec.md` · Scenarios: `acceptance.feature` · Branch: `feat/F2-upkeep` → `phase/F2`

No design.md (Medium). Placement:

- UPK-01: the schema comes from `packages/contracts/src/events/stream.ts` (`RoomStageChangedEvent`). Add
  `agent-event-room-stage-changed.json` beside the other agent event schemas (`packages/contracts/scripts/generate.ts`
  writes them), list it in `apps/agent/src-tauri/xtask/src/lib.rs` `CONTRACTS`, regenerate with
  `cargo run -p xtask -- contracts`, and replace `StageChanged` in `adapters/src/http/sse.rs`. The adapter keeps its own
  validation of the room id and the two stages. **Only `adapters/src/http/sse.rs` and the contract files change; no file
  of `scripts/agent/reading-modules.json` is touched.** If the change would reach one, stop and split it out (rule 14).
- UPK-02 and UPK-03: one limiter in `apps/api/src/platform/http/` built on `shared-kernel/sliding-window.ts` (in
  memory, one instance, ADR 006). The routes call it in a `preHandler` after the guard; the route files never import
  another module's internals.
- Scenario steps (UPK-02, UPK-03, UPK-07) are committed with the feature, in `tests/acceptance/steps/upkeep.steps.ts`
  (lessons: a feature's scenarios reach the phase branch together with their steps).

Rules:

- `acceptance.feature` is never edited, and no test is weakened. The one test removed, the CSS-reading test of
  `QueuePanel.test.tsx` (UPK-07), is replaced by its scenario in the same commit, as the spec says.
- Never commit a screenshot. No game capture is involved.
- In a fresh checkout, run `pnpm --filter @d2rmm/agent build` once before the first push (lessons).
- Docker: use `DOCKER_CONFIG=<dir with {}>` (lessons). On a cloud runner, a Docker Hub pull can be rate-limited (429);
  that is the environment, not the code: pull `postgres:17-alpine` and `testcontainers/ryuk` once, then run the gate.
- A dependency task runs `pnpm install` (the lockfile changes with it) and ends with `pnpm format:check`.

## Batch 1

- [x] T1 — UPK-01: schema file for `room.stage_changed`, regenerated Rust type, `sse.rs` parses through it, unit tests
      for both stages, another stage, a bad room id and a wrong shape. Gate:
      `pnpm contracts:check && cargo nextest run --manifest-path apps/agent/src-tauri/Cargo.toml -p xtask -p d2rmm-agent-adapters --lib --test contracts_are_current && cargo clippy --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets -- -D warnings`
- [x] T2 — UPK-04: `projectStreamEvent` does the per-member `currentAgentOf` lookups with `Promise.all` in the three
      cases that await in a loop; unit tests pin the delivery order and that the lookups start together (a gated fake).
      Gate: `pnpm --filter @d2rmm/api exec vitest run src/platform/stream-projection.test.ts && pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api lint`
- [x] T3 — UPK-02, UPK-03: the per-account limiter (60 per minute, sliding window, `Retry-After` in whole seconds, no
      leak between accounts, entries older than the window pruned) as a pure class with unit tests at the boundaries
      (59, 60, 61, window edge). Gate:
      `pnpm --filter @d2rmm/api exec vitest run src/platform/http && pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api lint && pnpm arch`
- [x] T4 — UPK-02, UPK-03: wire the limiter to `GET /v1/agents/me` and to the three ready-check routes (one shared window
      per principal for the ready-check routes), add `429` to their response schemas, regenerate and commit
      `openapi.json`, update `openapi.int.test.ts`, add integration tests (61st request, other account, the existing
      401/404/409/426 unchanged under the limit). A route changed, so the whole API integration suite runs. Gate:
      `pnpm contracts:openapi && git diff --exit-code -- packages/contracts/asyncapi.json && pnpm --filter @d2rmm/api test && DOCKER_CONFIG=<dir with {}> pnpm --filter @d2rmm/api test:integration`
- [x] T5 — UPK-02, UPK-03: step definitions for the four scenarios (`upkeep.steps.ts`). A "minute passes" step moves the
      stack's clock (`world.stack.advanceClock`). Gate:
      `pnpm --filter @d2rmm/acceptance typecheck && DOCKER_CONFIG=<dir with {}> pnpm exec turbo run test:acceptance -- --grep "@UPK-02|@UPK-03" && node scripts/acceptance-check.mjs upkeep`
- [x] T6 — UPK-07: the `@UPK-07` steps compare the bounding boxes of the "Hell" name and its locked label in a real
      browser; remove the `readFileSync` CSS test and its imports from `QueuePanel.test.tsx` (the DOM-order test next
      to it stays). Gate:
      `pnpm --filter @d2rmm/web exec vitest run src/features/matchmaking/QueuePanel.test.tsx && pnpm --filter @d2rmm/web typecheck && pnpm --filter @d2rmm/web lint && DOCKER_CONFIG=<dir with {}> pnpm exec turbo run test:acceptance -- --grep "@UPK-07"`
- [x] T7 — UPK-05, UPK-06, UPK-08: (a) report p95 and its trend rounded to two decimals, `n/a` when absent
      (`scripts/nightly/render.mjs`, `trend.mjs`, `load.mjs`); (b) `LOAD_IMAGES_PREBUILT=1` makes `pnpm test:load`
      skip `buildImages` when both tags exist, and the load job sets it after its cached builds (`nightly.yml`; no
      change to `ci.yml` job names or `ocr-real.yml`); (c) a unit test reads the committed
      `scripts/agent/reading-modules.json` and fails on a shape that is neither a list nor `{modules|files}` or on no
      path (when `ocr-protection` is not yet on the branch, the test skips the file read and still pins the shapes
      `readingModulesFrom` accepts; merge `phase/F2` first and make it read the file). Gate:
      `node --test scripts/test/nightly-report.test.mjs scripts/test/load-scripts.test.mjs scripts/test/nightly-workflow.test.mjs && pnpm lint:root && pnpm exec prettier --check .github scripts`

## Batch 2

- [x] T8 — UPK-09: ADR 017 lists `n`, `m` and `h` (in the ADR's own Consequences or Pattern section, Proposed status
      rules of ADR 029 apply: a clarification of an accepted ADR is a note, not a change of decision; if the maintainer
      must accept it, add a row to `decisions.md → To confirm`); a unit test of the `app.ts` match-refused branch checks
      the error log and the `lobby.match-refused` span event. Gate:
      `pnpm --filter @d2rmm/api exec vitest run src/main/app.test.ts && pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api lint && pnpm exec prettier --check docs`
- [x] T9 — UPK-10: `openSiteFor` throws "no accountId for <name>" naming the player; the traced stack's port retry
      reuses its telemetry site; the drift test iterates the game-name module's activities. Unit tests for each. Gate:
      `pnpm --filter @d2rmm/acceptance exec vitest run && pnpm --filter @d2rmm/acceptance typecheck && node --test scripts/test/agent-game-name-drift.test.mjs`
- [ ] T10 — UPK-11, group 1 (actions): `actions/upload-artifact` 7, `download-artifact` 8, `github-script` 9 in `ci.yml`,
      `nightly.yml`, `deploy-*.yml`, `preview-*.yml` where used, pinned by SHA with the version comment as today; only
      `uses:` lines change, never a job name; `ocr-real.yml` untouched. Read each major's release notes for breaking
      inputs (download-artifact 8 names, upload-artifact 7 hidden files) and fix the callers. Gate:
      `node --test scripts/test/ci-workflow.test.mjs scripts/test/deploy-workflows.test.mjs scripts/test/nightly-workflow.test.mjs scripts/test/ocr-real-workflow.test.mjs scripts/test/preview-workflow.test.mjs scripts/test/release-workflows.test.mjs && pnpm exec prettier --check .github`
- [ ] T11 — UPK-11, group 2 (npm minor and patch): `import-in-the-middle` 3.6.0, `@opentelemetry/instrumentation-pg`
      0.78.0 and the dev-tooling group, except anything that Dependabot grouped as ESLint, OpenTelemetry-major or Playwright
      (those are T12–T14). Gate: `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm arch && pnpm format:check`
- [ ] T12 — UPK-11, group 3 (OpenTelemetry): `@opentelemetry/exporter-metrics-otlp-http` 0.301 with the packages that must
      move with it (`pnpm why` shows the pair set); the telemetry and traced-stack tests are the proof. Gate:
      `pnpm install && pnpm --filter @d2rmm/telemetry test && pnpm --filter @d2rmm/api test && DOCKER_CONFIG=<dir with {}> pnpm --filter @d2rmm/api test:integration && pnpm typecheck && pnpm lint`
- [ ] T13 — UPK-11, group 4 (ESLint majors): `eslint`, `@eslint/*`, `typescript-eslint` in one step; fix new findings
      in the code, never by relaxing a rule or adding an ignore (rule 4). Gate:
      `pnpm install && pnpm lint && pnpm typecheck && pnpm test`
- [ ] T14 — UPK-11, group 5 (Playwright): `@playwright/test` 1.65 with the `playwright-bdd` version its changelog lists
      for it (ADR 023); if none is listed, stop and defer with the reason in `decisions.md`. Gate:
      `pnpm install && pnpm --filter @d2rmm/acceptance typecheck && DOCKER_CONFIG=<dir with {}> pnpm exec turbo run test:acceptance -- --grep "@UPK-"`
- [ ] T15 — UPK-11: write the Dependabot outcome table in `.specs/phases/F2/decisions.md` (one row per PR: #13, #14, #15,
      #16, #17, #18, #36, #38, #39, #42, #78 → the task that took it, or the reason it is closed: #14 and #15 as in the
      spec; any group a worker had to defer, with its last error). The orchestrator closes the PRs after the merge.
      Gate: `pnpm specs:check && pnpm exec prettier --check .specs && node scripts/acceptance-check.mjs upkeep`
- [ ] T16 — Final: the whole feature together. Gate: `pnpm check`

## Gate notes (run once on 2026-11-20 before writing)

Verified green on `phase/F2` as it is: `vitest` of `stream-projection.test.ts` and `main/app.test.ts`; the nightly,
load and workflow `node --test` files; `QueuePanel.test.tsx`; the acceptance support vitest; the cargo gate of T1
(89 tests); typecheck and lint of api, web and acceptance; `pnpm arch`; `pnpm secrets:scan`; `pnpm contracts:check`
(runs; its turbo warnings are the cache, not a failure).

Not verifiable in the spec session: `pnpm --filter @d2rmm/api test:integration` and every `test:acceptance` run need
Docker Hub images, and the cloud runner got HTTP 429 on the pull. Their commands are the ones the repository's lessons
and earlier feature tasks use.
