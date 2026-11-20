# Stream egress — Tasks

Spec: `spec.md` · Scenarios: `acceptance.feature` · Branch: `feat/F2-stream-egress` → `phase/F2`

Rules:

- One PR for the feature, into `phase/F2`, after Batch 2. The spec commit reaches the phase branch **only inside that
  PR**: `playwright-bdd` runs with `missingSteps: 'fail-on-gen'`, so `acceptance.feature` without its steps would fail
  every other PR's acceptance run (lessons). The steps for `@SEG-01`, `@SEG-04` and `@SEG-05` are written by T3, T4 and
  T5.
- No mutation in a gate (ADR 029). `.quality-baseline.json` is not touched: the maintainer applies the new ceiling
  (SEG-09, rule 4).
- A task that changes the load journey (`scripts/load/k6/`) runs `pnpm test:load` and
  `node --test scripts/load/check/full-summary.check.mjs` (lessons, 2026-11-12). Docker Hub may answer 429 in the
  cloud: pull the images with backoff first (`DOCKER_CONFIG=<dir holding {}> docker pull node:26-alpine`, then
  `postgres:17-alpine`); if a load gate still cannot run, say "not run here" in the task's commit message and run it
  in the nightly (ADR 035). **Checked on 2026-11-20 in a cloud session:** the pulls succeed after two 429s, but
  `pnpm test:load:smoke` stops at "the image d2rmm-load-api:f0 could not be built": `npm install -g corepack` inside
  `docker build` has no route through the session's egress proxy. So `pnpm test:load`, `test:load:smoke` and the two
  `check` files in T2 and T9 are **not run here**; run them on the maintainer's machine or by dispatching the nightly
  with `-f suites=load` on the branch. Every other gate below was run once and passes.
- A task that changes a stream event regenerates `asyncapi.json` and stages it before the gate's `git diff --exit-code`.
- Before pushing in a fresh worktree, build the agent window once (`pnpm --filter @d2rmm/agent build`).

## Batch 1 — measure, and the cheap cuts

- [ ] T1 — Count the bytes of each stream event type in the k6 journey (site stream and agent stream), add
      `bytesByEvent` and `matchesPerPlayerHour` to the step summary with "other" as the rest of the metered bytes, and
      show them in `load:publish` (SEG-02). Unit tests on the summary and the journey state. Gate:
      `node --test scripts/test/load/*.test.mjs scripts/test/load-scripts.test.mjs`
- [ ] T2 — Make the journey read the site's presence at the rate SEG-05 allows for each player with an online agent
      (SEG-06), and count the rooms that reached `created` in each step's window (SEG-07). Unit tests first. Gate:
      `node --test scripts/test/load/*.test.mjs scripts/test/load-scripts.test.mjs && pnpm test:load:smoke && node --test scripts/load/check/smoke-summary.check.mjs && pnpm test:load && node --test scripts/load/check/full-summary.check.mjs`
- [ ] T3 — Send the agent's copy of `room.stage_changed` with `roomId` and `stage` only (SEG-01): the projection, the
      regenerated `asyncapi.json`, an API unit test, a Rust unit test that the agent ends a room on an event with and
      without `members`, and the `@SEG-01` steps. Gate:
      `pnpm --filter @d2rmm/api exec vitest run src/platform && pnpm contracts:openapi && git diff --exit-code packages/contracts/openapi.json packages/contracts/asyncapi.json && pnpm arch && cargo nextest run --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-adapters --lib`
- [ ] T4 — Push the offline change (SEG-04): a sweep over agents last seen online that emits
      `agent.presence_changed` (offline) once, within 15 s of the 45 s limit. Unit tests on a `FakeClock`, an
      integration test, the contract if the event changes, and the `@SEG-04` steps. Gate:
      `pnpm --filter @d2rmm/api exec vitest run && pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts && pnpm contracts:openapi && git diff --exit-code packages/contracts/openapi.json packages/contracts/asyncapi.json && pnpm arch`
- [ ] T5 — The site reads the agent's presence at most 12 times an hour, never while hidden, and once on becoming
      visible or on a stream reconnect (SEG-05). Component tests with fake timers and visibility, strings unchanged,
      and the `@SEG-05` steps. After T4. Gate:
      `pnpm --filter @d2rmm/web exec vitest run && pnpm --filter @d2rmm/web lint && pnpm exec turbo run test:acceptance -- --grep @SEG-`
- [ ] T6 — Show the bytes by event type and their change against the latest earlier nightly in the nightly report's load
      section (SEG-08), with and without a previous report. Gate: `node --test scripts/test/nightly-*.test.mjs`
- [ ] T7 — Write `docs/engineering/stream-events.md`: each stream event type, its fields, its consumers, the fields each
      reads and the bytes from a T1 run; mark the fields no consumer reads (SEG-03, the audit). Gate:
      `pnpm format:check && pnpm specs:check`

## Batch 2 (written by the orchestrator from the T1 breakdown; the cuts follow the measured sizes)

- [ ] T8 — Trim the fields of the largest event types that no consumer reads (SEG-03), one event type per commit, each
      with a unit test, the regenerated contract and the consumer's parser change in the same commit. Gate: as T3's
      API, contract and architecture part, plus `pnpm --filter @d2rmm/web exec vitest run`
- [ ] T9 — Run the full load before and after, write both in the PR description by event type, and propose the new
      ceiling and baseline in `decisions.md → To confirm` (SEG-09). Gate:
      `pnpm test:load && node --test scripts/load/check/full-summary.check.mjs`
