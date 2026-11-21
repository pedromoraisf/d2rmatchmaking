# Remote configuration — Tasks

Spec: `spec.md` · Design: `design.md` · Scenarios: `acceptance.feature` · Branch: `feat/F2-remote-config` → `phase/F2`

Paths are relative to the repository root unless they start with `apps/agent/src-tauri` shortened to `agent/` (so
`agent/domain/src/…` is `apps/agent/src-tauri/domain/src/…`). `CARGO` stands for
`cargo … --manifest-path apps/agent/src-tauri/Cargo.toml`.

Dependencies: batch 1 (API and contract) can start now. Batches 2 and 3 need `capture-cascade` merged into `phase/F2` (the
capture constants) and batch 3 also `game-name-reading` (the chat phrases) and `feat/F2-screen-recognition-2` (the search
cadences). Until each merges, its fields are not in the schema; a field is added in the PR that merges after it.

Gates marked **(CI)** need Docker for Testcontainers Postgres, which the cloud session cannot pull when Docker Hub answers
429; the worker runs the unit gates and the orchestrator reads the CI run for these.

## Rules for this feature

**Data, never commands (ADR 010, AGT-04).** No field of the configuration, in the contract or in the agent, may be a
command, a path, a URL, a script, a key or a pattern. If a task seems to need one, stop and return it.

**NFR-02 call counts (RCF-09).** Every task that lets a configured value change how often the agent captures or reads has a
unit test that counts captures and `FrameReader::read` calls over 600 looks at every extreme of the range.

**Rule 14 (OCR protection).** Batch 3 threads values into reading modules (`agent/domain/src/layout.rs`, `hud_track.rs`,
`language.rs`, `anchors.rs`, `character_screen.rs`, `core/src/screen_reader.rs`, `party.rs`). Each such task writes the pinning
tests first (the built-in default equals today's value, at each client size the existing tests use), changes the non-test
line in a separate step and leaves the real-print proof to CI: `ocr-real` green and `ocr-variations` not regressing, with
before and after counts written into the PR by the orchestrator. Never edit `scripts/agent/reading-modules.json`,
`.cargo/mutants.toml` or `.quality-baseline.json` (the gate asks the maintainer; O1 below is the orchestrator's).

**Contracts first.** Every route or schema change runs `pnpm contracts:openapi` and commits the generated JSON.

**Mutation never appears in a gate** (ADR 029).

## Batch 1 — contract and API, runs in the cloud

- [x] T1 — **Pin today's agent route list (tests only).** In `apps/api/src/main/__tests__/agent-route-table.ts` and the AGT-01
      test, add nothing yet; add a test that fails when an agent-guarded route is not in the table, if one does not exist,
      and pin the eight routes as they are. Gate: `pnpm --filter @d2rmm/api test`
- [x] T2 — The contract (RCF-02, RCF-03). New `packages/contracts/src/http/agent-config.ts`: `AgentConfig` with closed
      objects (`.strict()`), the four sections and the version, every number with `.int().min().max()` from the design
      table, every phrase a string with a character class and a length limit, the 64 KiB body limit as a documented constant;
      `AgentConfigResponse`; export from `packages/contracts/src/index.ts`. Tests: each range at, below and above; an unknown
      field refused; a pattern-looking phrase refused; an empty document valid (every field optional). Run
      `pnpm contracts:openapi` and commit the JSON. Gate:
      `pnpm --filter @d2rmm/contracts test && pnpm contracts:check`
- [x] T3 — The committed document and its loader (RCF-12). `apps/api/src/modules/agents/config/agent-config.json` (version 1,
      the built-in values of the constants that exist on `phase/F2`), `modules/agents/domain/agent-config.ts`
      (`parseAgentConfig`, `etagOf(version)`), and a unit test that the committed file parses, that every value equals the
      agent's default (a table in the test, kept next to the Rust pinning tests of T10) and that a field outside the schema
      fails. `main/local.ts` and `main/render.ts` read the file once at start; a bad file stops the start (a test).
      Gate: `pnpm --filter @d2rmm/api test && pnpm --filter @d2rmm/api typecheck`
- [x] T4 — The use case and the route (RCF-01). `modules/agents/application/get-agent-config.ts`, the port entry in
      `modules/agents/index.ts`, `GET /v1/agents/config` in `adapters/http/routes.ts` behind `requireAgentVersion` and
      `requireAgent`, `ETag`, `If-None-Match` → `304`, `Cache-Control: no-cache`, no account data. Unit tests for the use
      case and for the route with fakes. Gate: `pnpm --filter @d2rmm/api test && pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api lint`
- [x] T5 — The route reach (RCF-01, AGT-01). Add the route to `agent-route-table.ts` and AGT-01's list in
      `.specs/features/agent-trust/spec.md` (the spec change the decision asks for; the orchestrator confirms it), prove
      that a cookie alone, an unknown token and no credential answer `401`, and that a revoked agent is refused on its next
      request. Run the whole API integration suite, since `openapi.int.test.ts` pins every route (lessons). Gate **(CI)**:
      `pnpm test:integration` (the new route is listed in `openapi.json`; run `pnpm contracts:openapi` first)
- [x] T6 — The staging test control (RCF-05, RCF-06 scenarios). `main/test-controls.ts`: `PUT /v1/test/agent-config` serves a raw
      body, a broken body or none, for the staging and local compositions only; `render.ts` never registers it and the
      `render-no-test-controls` rule stays green. Unit test and the architecture check. Gate:
      `pnpm --filter @d2rmm/api test && pnpm arch`
- [x] T7 — The API acceptance steps (RCF-01, RCF-02) in `tests/acceptance/steps/remote-config.steps.ts`, reusing the paired-agent
      Background; never edit `acceptance.feature`. Gate **(CI)**:
      `pnpm exec turbo run test:acceptance -- --grep "@RCF-0[12]"` and `node scripts/acceptance-check.mjs remote-config`

## Batch 2 — the agent loop, runs in the cloud (needs `capture-cascade` merged)

- [x] T8 — **Pin the capture constants first (tests only, RCF-07).** In `agent/domain/src/capture_cascade.rs`, `agent/core/src/watch_screen.rs`
      and `agent/core/src/capturer.rs`, tests that pin `DEMOTE_AFTER`, `PROBE_EVERY`, `RATE_WINDOW` and `TICK` and the call
      counts they produce (they exist; add the ones that are missing). No non-test line changes. Gate:
      `CARGO nextest run -p d2rmm-agent-domain -p d2rmm-agent-core --lib` and
      `CARGO clippy -p d2rmm-agent-domain -p d2rmm-agent-core --all-targets -- -D warnings`
- [x] T9 — The pure type (RCF-05, RCF-06, RCF-07, RCF-10). New `agent/domain/src/remote_config.rs`: `Ranges`, `Defaults`, `Effective`,
      `from_wire(body, held_version)` and the version rule. Tests: every field at, below and above its range; an unknown field;
      a phrase with a forbidden character, an over-length one and an empty one; a region outside the client or under the
      minimum size; an older, an equal and a newer version; an empty body; a body over 64 KiB; each section falling back on
      its own. No clock, randomness or I/O. Gate: as T8
- [x] T10 — The generated type and the pinning of defaults. Run the contracts generator so
      `agent/adapters/src/contracts/generated.rs` and `schemas.rs` gain `AgentConfig`; a test that every `Defaults` field equals
      the value in the committed `agent-config.json` (read from the repository file) and in the constants it replaces. Gate:
      `pnpm contracts:check && CARGO nextest run -p d2rmm-agent-domain -p d2rmm-agent-adapters --lib`
- [x] T11 — The fetch loop (RCF-04, RCF-06). `agent/core/src/ports.rs` (`ConfigGateway`, `ConfigStore`), new `agent/core/src/remote_config.rs`
      (`run`: fetch at start and after pairing, every six hours, conditional request, backoff, apply through a `watch`
      channel, persist the last good body), the HTTP gateway call on the agent's API base only, and `agent/src/adapters/config_store.rs`
      (atomic write, read back through `from_wire`, a corrupted file deleted). Tests with fakes: applied, unchanged, invalid,
      stale, unreachable, a restart with the API gone, a corrupted stored file. Gate:
      `CARGO nextest run -p d2rmm-agent-domain -p d2rmm-agent-core -p d2rmm-agent-adapters -p d2rmm-agent --lib` and
      `CARGO clippy -p d2rmm-agent-domain -p d2rmm-agent-core -p d2rmm-agent-adapters --all-targets -- -D warnings`
- [ ] T12 — Apply the cadence (RCF-08, RCF-09). `capture_cascade` takes `demote_after`, `probe_every` and `rate_window` from
      `Effective`; `watch_screen::run` sleeps `look_interval` (never under one second). Call-count tests at the extremes of
      every range: captures and reads per 600 looks never exceed today's. Gate: as T11
- [ ] T13 — Telemetry and the window (RCF-08, RCF-11). `agent.config.fetch` span with `config.outcome` and `config.version`;
      the sanitiser keeps both with fixed values only; the vision-span source rule is extended to the new span the way
      `capture.*` was; the window shows the version in the diagnostics (`diagnostics.config`), en and pt-BR. A source-rule test
      lists the fields of the configuration and fails on a new one (RCF-10). Gate: as T11, plus
      `pnpm test:harness && pnpm --filter @d2rmm/agent test && pnpm --filter @d2rmm/agent typecheck`
- [ ] T14 — The headless agent and the agent acceptance steps (RCF-05, RCF-06, RCF-08). The example prints a `config` line (version
      and the effective probe cadence); steps in `remote-config.steps.ts` use the T6 test control. Never edit
      `acceptance.feature`. Gate **(CI)**: `pnpm exec turbo run test:acceptance -- --grep @RCF-` and
      `node scripts/acceptance-check.mjs remote-config`

## Orchestrator (local; the maintainer answers the gate where it asks)

- [ ] O1 — Before batch 3: add `agent/domain/src/remote_config.rs` to `scripts/agent/reading-modules.json` (it decides the
      thresholds and areas the reading uses), and any `windows` or source-rule list the loop needs (none expected). Gate:
      `pnpm test:harness`

## Batch 3 — values into the reading modules, **[R14]** (needs `game-name-reading` and `feat/F2-screen-recognition-2` merged)

- [ ] T15 — **[R14] Pin the reading constants first.** For each constant and area this batch will thread (`TRACK_PAD`, `HUD_BAND_TOP`,
      the HUD, automap and Party areas of `layout.rs`, the search cadences, the title-ink limits), tests that pin today's
      value and the read at each client size the existing tests use (1033, 1045, 1056, 1080), passing on the unchanged code.
      No non-test line changes. Gate: `CARGO nextest run -p d2rmm-agent-domain -p d2rmm-agent-core --lib`
- [ ] T16 — **[R14] Thresholds and search cadences** from `Effective` (`thresholds`, the search cadences of `cadence`), one
      reading module per commit, the defaults unchanged, call counts at every extreme (RCF-09). Real-print proof in CI:
      `ocr-real` green, `ocr-variations` not regressing. Gate: as T15, plus
      `CARGO clippy -p d2rmm-agent-domain -p d2rmm-agent-core --all-targets -- -D warnings`
- [ ] T17 — **[R14] Regions** from `Effective.regions` (`hudBand`, `automapArea`, `partyArea`): the area is the configured
      fraction when it passes the clamp, else the default; the zero-wrong-confirmation rule of the game-name match is not touched.
      Tests: a configured region moves the read at each client size; an out-of-range one is the default. Real-print proof
      as T16. Gate: as T16
- [ ] T18 — **[R14] Phrases** per language from `Effective.phrases` (the Party words and the chat "joined" and "left" phrases of
      `game-name-reading`), compared as literals by the existing rules; a phrase that fails its rule never reaches the
      reader. Tests with English and pt-BR phrases and with a hostile phrase. Real-print proof as T16. Gate: as T16
- [ ] T19 — Close the proofs. The PR's table: every range and its test, call counts at the extremes, the version fallback cases,
      `ocr-real` per print and `ocr-variations` before and after, and the threat table of the spec with the control that
      closes each line. Gate: `pnpm specs:check && pnpm test:harness`

## Batch 4 — waits for the maintainer's PC

- [ ] T20 — Field check on a per-PR installer: serve a configuration with a changed `probeEvery` and a changed region on the
      staging API, and confirm in the agent window that the version and the effect change without a restart; then withdraw
      the API and confirm the agent keeps the last good one. Needs the maintainer's PC.
- [ ] T21 — Document the operation (RCF-12): `docs/engineering/remote-config.md` (the file, every field's range, how to raise the
      version, how a configuration is rolled back by a revert and a release) and a line in `AGENTS.md`'s map. Gate:
      `pnpm format:check && pnpm specs:check`
