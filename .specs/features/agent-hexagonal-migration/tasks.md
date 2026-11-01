# Agent Hexagonal Migration Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, the walk, check_proofs, the Verifier and the screens sub-agent).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

Project rules for every task of this feature:

- Run each task's gate as its own Bash call, with nothing before or after it:
  `node scripts/attempt.mjs run --feature agent-hexagonal-migration --step T<n> -- "<gate command>"`.
- This is a behaviour-preserving migration (spec, brief revision 2). No task adds agent behaviour, a request, a screen or a contract change.
- **Assertions are never edited** (AGENTS.md rule 3, AD-082). The assertion lines of `core/tests/**` stay byte-identical; `use` lines, harness construction and act lines may change. `node --test scripts/test/agent-test-preservation.test.mjs`
  (T9) must pass on every commit that touches those files. A task that cannot keep an assertion stops, records the blocker in `## Handoff` and reports; the maintainer decides.
- Code under `#[cfg(windows)]` is checked with `node scripts/agent/win-check.mjs` (AD-071); its tests run in the CI `agent` job.
- Until T28 `core` still holds `reqwest`; the architecture rules that would fail on it are added in T28, and nothing is loosened to get there.
- `.claude/hooks/**`, `.claude/settings.json` and `docs/adr/**` are not edited by any task. If a gate needs one, record it in `decisions.md` and report.
- Rust lives in `~/.cargo/bin`, which is not on the default shell PATH; a gate runs with `PATH="$HOME/.cargo/bin:$PATH"`.
- Test names below are the names the tests must carry; the checks select them by name.

---

**Design**: `.specs/features/agent-hexagonal-migration/design.md`
**Status**: Approved
**Approved**: 2026-11-01 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)
**Mutations**: 3
**Build**: `cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace --all-targets -- -D warnings; pnpm typecheck; pnpm lint`

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `AGENTS.md` (How to test, Rust conventions, rules 3, 4, 12), `docs/engineering/testing.md`, `docs/adr/026-mutation-unit-tests-only.md`, `docs/adr/027-agent-hexagonal-architecture.md`, `.cargo/mutants.toml`.

| Code Layer                               | Required Test Type                                | Coverage Expectation                                                                                | Location Pattern                                                               | Run Command                        |
| ---------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------- |
| Domain (aggregates, services, constants) | unit (`cargo nextest --lib`) + mutation           | All branches, both sides of every boundary, 1:1 to the ACs; every constant pinned                   | `apps/agent/src-tauri/domain/src/**` (colocated)                               | Rust domain gate                   |
| Application (ports, use cases, loops)    | unit against `FakeApiGateway` (paused tokio time) | Every branch of each use case; the 401/426 effects; the sleep-gate and epoch check                  | `apps/agent/src-tauri/core/src/**` (colocated)                                 | Rust core gate                     |
| Adapters (gateway, ACL, SSE)             | unit (`--lib`) + integration (fake API, `tests/`) | ACL drops no field; limits, idle timeout, oversize event, invalid-body paths; integration unchanged | `apps/agent/src-tauri/adapters/{src,tests}/**`                                 | Rust adapters gate                 |
| App crate (composition root, Windows)    | unit, `#[cfg(windows)]` in CI                     | Wiring compiles for Windows; loopback rule test stays                                               | `apps/agent/src-tauri/src/**`                                                  | `node scripts/agent/win-check.mjs` |
| Architecture and preservation guards     | harness unit (`node:test`)                        | Each rule fails on its own fixture; clean tree passes                                               | `scripts/test/agent-*.test.mjs`, `scripts/test/fixtures/agent-architecture/**` | Harness gate                       |
| Workflows, mutants config                | harness unit (`node:test`)                        | Domain, core and adapters present with `-- --lib`; a fixture without them fails                     | `scripts/test/agent-mutation-scope.test.mjs`                                   | Harness gate                       |
| Docs (`AGENTS.md`, cursor rule)          | harness unit (`node:test`)                        | Layer table and direction present in both                                                           | `scripts/test/agent-architecture.test.mjs`                                     | Harness gate                       |
| Cargo manifests, clippy.toml, fixtures   | none                                              | - (covered by the architecture tests above)                                                         | -                                                                              | build gate only                    |

## Gate Check Commands

> Generated from codebase - confirm before Execute. `$M` is written out: `--manifest-path apps/agent/src-tauri/Cargo.toml`.

| Gate Level     | When to Use                               | Command                                                                                                                                                                                                                                                                                                            |
| -------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rust domain    | Domain crate tasks                        | `cargo fmt --manifest-path apps/agent/src-tauri/Cargo.toml --all -- --check && cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-domain --all-targets -- -D warnings && cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-domain --lib` |
| Rust core      | Application tasks                         | the same three commands with `-p d2rmm-agent-core`, then `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core` (integration tests while they still live in `core/tests`)                                                                                                |
| Rust adapters  | Adapters tasks                            | the same with `-p d2rmm-agent-adapters` (all tests, `tests/` included)                                                                                                                                                                                                                                             |
| Rust workspace | Moves and tasks that touch several crates | `cargo fmt --manifest-path apps/agent/src-tauri/Cargo.toml --all -- --check && cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace --all-targets -- -D warnings && cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace`                           |
| Rust Windows   | Tasks touching `#[cfg(windows)]` code     | `node scripts/agent/win-check.mjs` (AD-071)                                                                                                                                                                                                                                                                        |
| Harness        | Guards, workflows, docs                   | `pnpm test:harness`                                                                                                                                                                                                                                                                                                |
| Build          | End of a phase with manifest changes      | Rust workspace gate, then `pnpm typecheck && pnpm lint`                                                                                                                                                                                                                                                            |

---

## Execution Plan

Phases run in order; tasks within a phase run in order. Batches (whole phases): 1 = Phases 1–2, 2 = Phase 3, 3 = Phase 4, 4 = Phase 5, 5 = Phases 6–7, 6 = Phase 8, 7 = Phases 9–10. Batches 8 and 9 are kept for the Verifier's findings.

### Phase 1: The domain crate (M0)

```
T1 → T2 → T3 → T4 → T5
```

### Phase 2: The guards (M0)

```
T6 → T7 → T8 → T9 → T10 → T11
```

### Phase 3: The gateway port and the ACL, still inside core (M1a)

```
T12 → T13 → T14 → T15 → T16 → T17 → T18
```

### Phase 4: The loops on the port, port groups and the probe (M1a)

```
T19 → T20 → T21 → T22 → T23 → T24 → T25
```

### Phase 5: Move the HTTP stack to the adapters crate (M1b)

```
T26 → T27 → T28 → T29 → T30 → T31 → T32
```

### Phase 6: RoomAssignment and vision to the domain (M2)

```
T33 → T34 → T35 → T36 → T37
```

### Phase 7: Pairing (M3)

```
T38 → T39 → T40 → T41
```

### Phase 8: PairedDevice and the end of Context (M4)

```
T42 → T43 → T44 → T45 → T46 → T47
```

### Phase 9: Retry, reconnection, fusion, presence (M5)

```
T48 → T49 → T50 → T51 → T52
```

### Phase 10: Mutation scope, boundaries and the close (M6, M7)

```
T53 → T54 → T55 → T56 → T57 → T58
```

---

## Task Breakdown

#### Phase 1: The domain crate (M0)

### T1: Create the domain crate

**What**: `d2rmm-agent-domain` exists, builds, is a workspace member, and depends only on `thiserror`, `chrono` (`default-features = false`) and `uuid` (default features off).
**Where**: `apps/agent/src-tauri/domain/` (`Cargo.toml`, `src/lib.rs`) and the `members` line of `apps/agent/src-tauri/Cargo.toml`
**Depends on**: None
**Reuses**: `core/Cargo.toml` metadata and the `#![forbid(unsafe_code)]` line of `core/src/lib.rs`
**Requirement**: AHM-01

**Done when**:

- [x] `domain/src/lib.rs` has `#![forbid(unsafe_code)]` and a test `domain_crate_builds` asserting `env!("CARGO_PKG_NAME") == "d2rmm-agent-domain"`
- [x] `cargo tree -e normal -p d2rmm-agent-domain` lists only `thiserror`, `chrono`, `uuid` and their own dependencies
- [x] Rust domain gate passes; test count 1

**Tests**: unit
**Gate**: Rust domain

---

### T2: Pin the timing constants in the domain

**What**: `domain/src/timings.rs` holds `HEARTBEAT_INTERVAL` 15 s, `OFFLINE_AFTER` 45 s (AD-079), `CLAIM_INTERVAL` 2 s, `UNREACHABLE_RETRY` 15 s, `RATE_LIMIT_DEFAULT` 60 min, `UNUSED_LIMIT` 2, `PAIRING_CODE_DIGITS` 6, `OBSERVATION_RETRY_DELAYS` [1, 2, 4, 8] s, `RECONNECT_MIN` 1 s, `RECONNECT_MAX` 60 s, `RESET_AFTER_OPEN` 60 s, `CHECK_EVERY` 6 h, `GAME_PROCESS` `D2R.exe`.
**Where**: `apps/agent/src-tauri/domain/src/timings.rs`
**Depends on**: T1
**Reuses**: the values in `core/src/{pairing,heartbeat,stream,observations,updates}.rs`
**Requirement**: AHM-13

**Done when**:

- [x] Test `timing_constants_are_pinned` asserts every value above
- [x] Test `offline_threshold_is_three_heartbeats` asserts `OFFLINE_AFTER == 3 * HEARTBEAT_INTERVAL`
- [x] The constants are not yet read by `core` (it keeps its own until each aggregate moves); no value in `core` changes
- [x] Rust domain gate passes; test count 2 more

**Tests**: unit
**Gate**: Rust domain

---

### T3: The domain's clippy policy

**What**: `domain/clippy.toml` repeats every entry of `apps/agent/src-tauri/clippy.toml` and adds `std::time::Instant`, `std::time::SystemTime::now`, `chrono::Utc::now`, `chrono::Local::now` and `uuid::Uuid::new_v4` (clippy reads only the nearest file).
**Where**: `apps/agent/src-tauri/domain/clippy.toml`
**Depends on**: T2
**Reuses**: `apps/agent/src-tauri/clippy.toml`
**Requirement**: AHM-04

**Done when**:

- [x] The file is a superset of the root list with a reason on each added entry
- [x] Rust domain gate passes (clippy with the new file)
- [ ] The test that pins the superset is T8's `domain clippy.toml repeats the root bans and adds the clock bans`

**Tests**: none (config; covered by T8 and T4)
**Gate**: Rust domain

---

### T4: A fixture that must fail the domain clippy policy

**What**: `boundary-fixtures/domain-clock` is a one-file crate whose `clippy.toml` is byte-identical to the domain's and whose `main.rs` calls `std::time::Instant::now()`; it is outside the workspace like the other fixtures.
**Where**: `apps/agent/src-tauri/boundary-fixtures/domain-clock/` (`Cargo.toml`, `clippy.toml`, `src/main.rs`)
**Depends on**: T3
**Reuses**: `boundary-fixtures/command-new/`
**Requirement**: AHM-04

**Done when**:

- [x] `cargo clippy --manifest-path apps/agent/src-tauri/boundary-fixtures/domain-clock/Cargo.toml -- -D warnings` fails naming `std::time::Instant`
- [x] The workspace build ignores it (`exclude` already covers `boundary-fixtures`)
- [x] Rust workspace gate passes

**Tests**: none (its test is the CI step of T5)
**Gate**: Rust workspace

---

### T5: Run the fixture in CI through expect-failure

**What**: The `agent` job of `ci.yml` runs the `domain-clock` fixture through `scripts/agent/expect-failure.mjs` with its lint id, like the other boundary fixtures. The existing exact-list test `the agent job runs the four boundary fixtures by rule id` is renamed `the agent job runs the five boundary fixtures by rule id` and its expected ids grow to `banned`, `unsafe_code`, `disallowed_types`, `disallowed_methods`, `disallowed_types` (same order as the job). This tightens the test: the list stays exact.
**Where**: `.github/workflows/ci.yml`, `scripts/test/agent-ci.test.mjs`
**Depends on**: T4
**Reuses**: the existing boundary-fixture steps and `scripts/test/agent-ci.test.mjs`
**Requirement**: AHM-04

**Done when**:

- [x] Test `domain clock fixture runs through expect-failure with its lint id` in `scripts/test/agent-ci.test.mjs` passes and fails when the step is removed
- [x] Test `the agent job runs the five boundary fixtures by rule id` passes with the five ids in job order and fails when any step is removed or reordered
- [x] Harness gate passes

**Tests**: harness unit
**Gate**: Harness

---

#### Phase 2: The guards (M0)

### T6: Architecture test, manifest rules

**What**: `scripts/test/agent-architecture.test.mjs` reads each crate's `Cargo.toml` and enforces the manifest half of the layer table, with one failing fixture per rule under `scripts/test/fixtures/agent-architecture/<rule>/`. Dependency names match by family prefix (`windows*`, `tauri*`, `opentelemetry*`). Rules that hold today: the domain depends only on `std`, `thiserror`, `chrono`, `uuid`; `core` does not depend on `tauri*`, `keyring*`, `windows*`; the adapters crate (when it exists) never depends on `tauri*`, `keyring*`, `windows*`; the adapters crate never depends on the app crate (the app crate depends on adapters, T30). The positive rule `core depends on the domain` is switched on in T34, when core first uses a domain type; the `reqwest` rules for core and the app crate arrive in T28 and T30. Rules are only added, never relaxed.
**Where**: `scripts/test/agent-architecture.test.mjs`
**Depends on**: T5
**Reuses**: `scripts/test/agent-source-rules.test.mjs` helpers, `scripts/test/arch-fixtures.test.mjs`
**Requirement**: AHM-01, AHM-02, AHM-05

**Done when**:

- [x] Tests `domain depends only on std thiserror chrono and uuid`, `core depends on the domain and not on reqwest tauri keyring or windows` (the `depends on the domain` part is switched on in T34 and the `reqwest` part in T28), `adapters never depend on tauri keyring or windows`, `adapters never depend on the app crate`
- [x] Test `each architecture rule fails on its fixture` runs every fixture of this task and expects the named rule to fail
- [x] Harness gate passes

**Tests**: harness unit
**Gate**: Harness

---

### T7: Architecture test, source rules

**What**: The same file reads `src/**/*.rs` of the domain and core and fails on a forbidden `use` or path: in the domain `tokio`, `reqwest`, `tauri`, `keyring`, `windows`, `serde`, `tracing`, `zeroize`, `generated`, `std::time::Instant`, `SystemTime`, `Utc::now`, `Local::now`, `Uuid::new_v4`, `std::env`, any item named `Agent`; in core `contracts::generated` and `tauri`, `keyring`, `windows` (the `reqwest` and `serde_json` uses arrive in T28).
**Where**: `scripts/test/agent-architecture.test.mjs`
**Depends on**: T6
**Reuses**: T6 helpers
**Requirement**: AHM-03, AHM-05, AHM-14

**Done when**:

- [x] Tests `contract types stay out of the domain and the application` (the application half is switched on in T28) and `domain reads no clock or randomness and names nothing Agent`, with a fixture per rule
- [x] Harness gate passes

**Tests**: harness unit
**Gate**: Harness

---

### T8: Architecture test, structural rules

**What**: The same file adds: `domain clippy.toml repeats the root bans and adds the clock bans`; `every agent crate forbids unsafe code and process use` (`#![forbid(unsafe_code)]` in domain, core, adapters; no `std::process` or `tokio::process`); `no struct in core holds more than five ports` (switched on in T47, when `Adapters` and `Context` are gone); `core tests use in-memory fakes only` (no `mockall`, no `mock!`); `only the app crate builds adapters and depends on tauri keyring and windows`; `the app crate never mentions Probe or start_with_probe`. Each with a fixture.
**Where**: `scripts/test/agent-architecture.test.mjs`
**Depends on**: T7
**Reuses**: T6 helpers
**Requirement**: AHM-04, AHM-17, AHM-19

**Done when**:

- [x] The six tests above exist, each with a failing fixture; rules about crates that do not exist yet (adapters) apply once they do, and the ports rule is switched on in T47 (its fixture fails now, the real tree is checked from T47)
- [x] Harness gate passes

**Tests**: harness unit
**Gate**: Harness

---

### T9: Assertion-preservation guard

**What**: `scripts/test/agent-test-preservation.test.mjs` compares the multiset of assertion lines (`assert*` statements, multi-line forms joined) of `core/tests/**` and, after they move, `adapters/tests/**`, against the same files at commit `b1519d6` using `git show` and rename detection, and fails on any added or removed line.
**Where**: `scripts/test/agent-test-preservation.test.mjs`
**Depends on**: T8
**Reuses**: `scripts/lib` git helpers if any; `git diff -M`
**Requirement**: AHM-20

**Done when**:

- [x] Test `moved tests keep every assertion line` passes on the current tree and fails against a fixture where one `assert_eq!` expected value is edited
- [x] It finds the tests by content when files move (rename detection), and fails if a file of the baseline set is missing
- [x] Harness gate passes

**Tests**: harness unit
**Gate**: Harness

---

### T10: The cursor rule states the layout

**What**: `.cursor/rules/agent-rust.mdc` states the three layers, the crates, the dependency direction (`adapters → application → domain`), the table of what each may and must not depend on, and that the domain has no clock or randomness.
**Where**: `.cursor/rules/agent-rust.mdc`
**Depends on**: T9
**Reuses**: ADR 027 layer table
**Requirement**: AHM-06

**Done when**:

- [x] The section exists and names `d2rmm-agent-domain`, `d2rmm-agent-core`, `d2rmm-agent-adapters`
- [x] Harness gate passes

**Tests**: none (the doc test is T11's)
**Gate**: Harness

---

### T11: AGENTS.md states the layout, and the docs test

**What**: `AGENTS.md` repository map lists the three agent crates and an inviolable rule states the direction and that the domain imports no I/O, clock or contract type; `agent-architecture.test.mjs` gets the docs test.
**Where**: `AGENTS.md`
**Depends on**: T10
**Reuses**: ADR 027
**Requirement**: AHM-06

**Done when**:

- [x] Test `AGENTS.md and the cursor rule state the layer table` passes, and fails when either file lacks the three crate names or the direction
- [x] Harness gate passes

**Tests**: harness unit
**Gate**: Harness

---

#### Phase 3: The gateway port and the ACL, still inside core (M1a)

### T12: The port error moves to ports.rs

**What**: `ApiError` is defined in `core/src/ports.rs` (variants unchanged) and `api_client.rs` re-exports it, so every `ApiError::…` assertion keeps its text.
**Where**: `apps/agent/src-tauri/core/src/ports.rs`
**Depends on**: T11
**Reuses**: `ApiError` in `core/src/api_client.rs`
**Requirement**: AHM-16

**Done when**:

- [x] Test `api_error_debug_never_contains_a_secret_or_url` formats every variant with `Debug` and `Display` and finds no token, URL or body
- [ ] All `core/tests` pass; preservation test passes
- [x] Rust core gate passes

**Tests**: unit
**Gate**: Rust core

---

### T13: The message types, still in core

**What**: `core/src/messages.rs` holds the plain message types the port exchanges: `PairingCode`, `IssuedCode { code, expires_at, claim_secret: Secret }`, `RoomId`, `GameName`, `Member`, `Assignment { room, run: NonZeroU64, expected_game_name, members }`, `GameNameObservation`, `Presence`, `Screen`. They move to the domain in M2, M3 and M5.
**Where**: `apps/agent/src-tauri/core/src/messages.rs`
**Depends on**: T12
**Reuses**: field lists from `contracts/generated.rs` (`Assignment`, `PairingCodeResponse`, `Heartbeat`, `Observation`)
**Requirement**: AHM-16

**Done when**:

- [x] `PairingCode::new` accepts exactly six ASCII digits (test `pairing_code_accepts_six_digits_only`)
- [x] Test `issued_code_debug_never_contains_the_claim_secret`
- [x] Rust core gate passes

**Tests**: unit
**Gate**: Rust core

---

### T14: The ApiGateway port and the event stream

**What**: `ports.rs` gains `ApiGateway` (`request_code`, `claim`, `heartbeat`, `assignment`, `post_observation`, `open_stream`), `EventStream` (`next`, `last_event_id`), `StreamItem::{RoomAssigned, Ended}` and `EndReason::{Closed, Idle, Failed}` exactly as in the design.
**Where**: `apps/agent/src-tauri/core/src/ports.rs`
**Depends on**: T13
**Reuses**: the `ApiClient` method list
**Requirement**: AHM-16

**Done when**:

- [x] The traits compile and are object-safe where the design says (`Box<dyn EventStream>`)
- [x] Rust core gate passes

**Tests**: none (types; exercised by T15–T18)
**Gate**: Rust core

---

### T15: The anti-corruption translation

**What**: `core/src/gateway/translate.rs` translates in both directions between the contract types and the message types: `contracts::Assignment` ⇄ `Assignment`, `PairingCodeResponse` → `IssuedCode`, `Presence` → `Heartbeat`, `GameNameObservation` → `Observation`. It adds no check the code lacks today.
**Where**: `apps/agent/src-tauri/core/src/gateway/translate.rs`
**Depends on**: T14
**Reuses**: the construction of `Heartbeat` in `heartbeat::heartbeat_body` and of `Observation` in `fusion.rs`
**Requirement**: AHM-16

**Done when**:

- [x] Tests `assignment_translation_keeps_every_field`, `heartbeat_translation_matches_the_contract`, `observation_translation_matches_the_contract` (valid against the JSON Schemas), each failing when a field is dropped
- [x] Test `non_uuid_room_is_carried_unchanged` pins the opaque `RoomId`
- [x] Rust core gate passes

**Tests**: unit
**Gate**: Rust core

---

### T16: HttpGateway over the unchanged ApiClient

**What**: `core/src/gateway/http.rs` implements `ApiGateway` by calling the unchanged `ApiClient` and translating; `open_stream` returns the event stream of T17.
**Where**: `apps/agent/src-tauri/core/src/gateway/http.rs`, `apps/agent/src-tauri/core/extra-tests/gateway.rs`, `apps/agent/src-tauri/core/Cargo.toml`
**Depends on**: T15
**Reuses**: `ApiClient`, T15
**Requirement**: AHM-16

**Done when**:

- [x] Integration test `http_gateway_forwards_each_route` against the fake API passes. It lives in a new test target outside `tests/` (`core/extra-tests/gateway.rs`, registered with `[[test]] name = "gateway"`), because the preservation guard (T9) forbids added assertions under `core/tests/**` and `adapters/tests/**`; the guard is not changed
- [x] `ApiClient` is untouched; its tests pass; preservation test passes
- [x] Rust core gate passes

**Tests**: integration
**Gate**: Rust core

---

### T17: The SSE event stream behind the port

**What**: `core/src/gateway/sse_stream.rs` implements `EventStream` over a response: it feeds `SseParser`, keeps `last_event_id`, applies the 60 s idle timeout and the 64 KiB event cap, skips unknown or invalid events, and returns `Ended` with `Closed`, `Idle` or `Failed`. `next` is cancel-safe.
**Where**: `apps/agent/src-tauri/core/src/gateway/sse_stream.rs`
**Depends on**: T16
**Reuses**: `stream::{SseParser, handle, valid_game_name, valid_last_event_id, IDLE_TIMEOUT, MAX_EVENT_BYTES}`, `read_events`
**Requirement**: AHM-16, AHM-22

**Done when**:

- [x] Tests `event_stream_yields_room_assigned`, `event_stream_ends_idle_after_sixty_seconds`, `event_stream_skips_unknown_and_invalid_events`, `event_stream_tracks_last_event_id`, `event_stream_next_is_cancel_safe`
- [x] Rust core gate passes

**Tests**: unit
**Gate**: Rust core

---

### T18: An in-memory ApiGateway fake

**What**: `core/src/fakes.rs` holds `FakeApiGateway` (scripted responses per call, recorded calls, a scripted `EventStream`) beside the existing fakes, for the use-case unit tests (the mutation proofs).
**Where**: `apps/agent/src-tauri/core/src/fakes.rs`
**Depends on**: T17
**Reuses**: `PausedWallClock`, `SequentialIds` in `ports.rs`
**Requirement**: AHM-19

**Done when**:

- [x] Test `fake_gateway_scripts_responses_and_records_calls`
- [x] No `mockall` or `mock!` anywhere in core (T8 rule)
- [x] Rust core gate passes

**Tests**: unit
**Gate**: Rust core

---

#### Phase 4: The loops on the port, port groups and the probe (M1a)

### T19: Per-loop port groups

**What**: `context.rs` gains `PairingPorts`, `HeartbeatPorts`, `StreamPorts`, `UpdatePorts`, `ReadPorts` (exactly five ports) and a way to build the `Context` from them; `Adapters` and the old `Runtime::start` still work.
**Where**: `apps/agent/src-tauri/core/src/context.rs`
**Depends on**: T18
**Reuses**: the fields of `Adapters`
**Requirement**: AHM-17

**Done when**:

- [x] Test `groups_build_a_context`
- [x] Architecture test `no struct in core holds more than five ports` passes
- [x] Rust core gate passes

**Tests**: unit
**Gate**: Rust core

---

### T20: The probe and its entry point

**What**: `runtime.rs` gains `Runtime::start_with_probe(...) -> (Handle, Probe)`; `Probe` holds `update_required: watch::Receiver<bool>`, `dropped_observations()`, `assignment` read access and the mutators `set_paired`, `set_assignment`, `on_unauthorized`, `on_upgrade_required`. `Runtime::start` returns the `Handle` alone.
**Where**: `apps/agent/src-tauri/core/src/runtime.rs`
**Depends on**: T19
**Reuses**: the `Context` fields the tests read today
**Requirement**: AHM-20

**Done when**:

- [x] Test `probe_reads_the_agent_state_without_ports`
- [x] `*probe.update_required.borrow()` compiles with the text `*h.ctx.update_required.borrow()`
- [x] Rust core gate passes

**Tests**: unit
**Gate**: Rust core

---

### T21: The pairing loop on the gateway

**What**: `pairing.rs` calls `request_code` and `claim` through the port and keeps the claim secret as a core `Secret` next to the pairing state; its behaviour and spans are unchanged.
**Where**: `apps/agent/src-tauri/core/src/pairing.rs`
**Depends on**: T20
**Reuses**: T14, T18
**Requirement**: AHM-16, AHM-20

**Done when**:

- [x] `core/tests/pairing.rs` and `core/tests/runtime.rs` pass unchanged in their assertions; preservation test passes
- [x] Rust core gate passes

**Tests**: integration
**Gate**: Rust core

---

### T22: The heartbeat loop on the gateway

**What**: `heartbeat.rs` builds a `Presence` and calls `heartbeat` through the port; `heartbeat_body` stays only as the contract mapping inside the ACL.
**Where**: `apps/agent/src-tauri/core/src/heartbeat.rs`
**Depends on**: T21
**Reuses**: T14, T15
**Requirement**: AHM-16, AHM-20

**Done when**:

- [x] `core/tests/heartbeat.rs` passes unchanged in its assertions; preservation test passes
- [x] Rust core gate passes

**Tests**: integration
**Gate**: Rust core

---

### T23: The stream loop on the gateway

**What**: `stream.rs` fetches the assignment and follows the stream through `assignment` and `open_stream`, passing `last_event_id()` back on reconnect and racing `next` against `wait_until_closed`; the reconnect delay rules stay in place for now.
**Where**: `apps/agent/src-tauri/core/src/stream.rs`
**Depends on**: T22
**Reuses**: T17
**Requirement**: AHM-16, AHM-20, AHM-22

**Done when**:

- [x] `core/tests/stream.rs` passes unchanged in its assertions; preservation test passes
- [x] Rust core gate passes

**Tests**: integration
**Gate**: Rust core

---

### T24: The observation flow on the gateway

**What**: `observations.rs` posts through `post_observation`; `SendOutcome` stays a core type with its variants; retry delays and the epoch check are unchanged.
**Where**: `apps/agent/src-tauri/core/src/observations.rs`
**Depends on**: T23
**Reuses**: T14
**Requirement**: AHM-16, AHM-20

**Done when**:

- [x] `core/tests/observations.rs` passes unchanged in its assertions; preservation test passes
- [x] Rust core gate passes

**Tests**: integration
**Gate**: Rust core

---

### T25: Switch the harness and the app to the port groups

**What**: `core/tests/support/harness.rs` and the app's `app.rs` build the five groups and call `start_with_probe` / `start`; `Adapters` and the old `Runtime::start` are removed. Only act lines and construction change in the tests.
**Where**: `apps/agent/src-tauri/core/tests/support/harness.rs` (with `apps/agent/src-tauri/src/app.rs`)
**Depends on**: T24
**Reuses**: T19, T20
**Requirement**: AHM-17, AHM-20

**Done when**:

- [x] All `core/tests` pass; preservation test passes (T9)
- [x] Rust workspace gate and Rust Windows gate pass
- [x] `grep -rn "Adapters" apps/agent/src-tauri/core/src apps/agent/src-tauri/src` finds no type of that name

**Tests**: integration
**Gate**: Rust workspace

---

#### Phase 5: Move the HTTP stack to the adapters crate (M1b)

### T26: Create the adapters crate

**What**: `d2rmm-agent-adapters` exists as a workspace member with the dependencies of the design, `#![forbid(unsafe_code)]`, and no `tauri`, `keyring` or `windows`.
**Where**: `apps/agent/src-tauri/adapters/` (`Cargo.toml`, `src/lib.rs`) and the `members` line of `apps/agent/src-tauri/Cargo.toml`
**Depends on**: T25
**Reuses**: `core/Cargo.toml`
**Requirement**: AHM-02, AHM-05

**Done when**:

- [x] Test `adapters_crate_builds`
- [x] Architecture rules `adapters never depend on tauri keyring or windows` and `adapters never depend on the app crate` pass on the real crate
- [x] Rust workspace gate passes

**Tests**: unit
**Gate**: Rust workspace

---

### T27: Move the HTTP stack to the adapters crate

**What**: One move, one commit (`git mv` so history follows): `contracts/` (generated types), `api_client.rs` → `http/api_client.rs` (contract-typed, unchanged), `gateway/*` → `http/{translate,gateway,sse_stream}.rs`, the SSE parser and `valid_*`/limits from `stream.rs` → `http/sse.rs`, `ApiBase`/`AllowLoopbackHttp` → `config.rs`, `telemetry.rs`, the client builder from the app crate → `http/client.rs`. `core::Config` keeps `version` only. `xtask` writes the contracts to the new path and points the secret fields at `d2rmm_agent_core::secret::{Secret, expose}`; `xtask/src/fixture.rs` keeps working.
**Where**: `apps/agent/src-tauri/adapters/src/` (moved modules), `apps/agent/src-tauri/xtask/src/lib.rs`, `apps/agent/src-tauri/core/src/lib.rs`
**Depends on**: T26
**Reuses**: every moved file; `contracts_are_current`
**Requirement**: AHM-02, AHM-03, AHM-16

**Done when**:

- [ ] `core/src` no longer contains `contracts/`, `api_client.rs`, `gateway/`, `telemetry.rs`, and `stream.rs` keeps only the loop and the reconnect rules
- [ ] `cargo nextest run --workspace -E 'test(contracts_are_current)'` passes (AGS-03)
- [ ] The unit tests that lived in the moved files moved with them and pass; test count before = after
- [ ] Rust workspace gate passes (integration tests still in `core/tests`, importing from the adapters through a dev-dependency only until T29)

**Tests**: unit
**Gate**: Rust workspace

---

### T28: Core loses reqwest and the contract types

**What**: `core/Cargo.toml` drops `reqwest`, `serde_json`, `regress`, `url`, `opentelemetry*`, `tracing-opentelemetry`, `tracing-subscriber`; the architecture test switches on the core `reqwest`/`serde_json`/`opentelemetry*` manifest rules and the `contracts::generated` and `reqwest` source rules for the application.
**Where**: `apps/agent/src-tauri/core/Cargo.toml`
**Depends on**: T27
**Reuses**: T6, T7
**Requirement**: AHM-02, AHM-03, AHM-16

**Done when**:

- [ ] `cargo tree -e normal -p d2rmm-agent-core` lists none of those crates
- [ ] Architecture tests `core depends on the domain and not on reqwest tauri keyring or windows`, `contract types stay out of the domain and the application` and `application reaches the API only through the gateway port` pass and fail on their fixtures
- [ ] Rust workspace gate passes

**Tests**: harness unit
**Gate**: Rust workspace

---

### T29: Move the integration tests to the adapters crate

**What**: `core/tests/**` (including `tests/support/**`) move to `adapters/tests/` with `git mv`; `use` lines and harness construction change, no assertion line does. The preservation test now reads `adapters/tests/**`.
**Where**: `apps/agent/src-tauri/adapters/tests/`
**Depends on**: T28
**Reuses**: T9, T25
**Requirement**: AHM-20, AHM-21, AHM-22

**Done when**:

- [ ] `moved tests keep every assertion line` passes; test count before = after
- [ ] Rust adapters gate passes
- [ ] `core/tests/` no longer exists

**Tests**: integration
**Gate**: Rust adapters

---

### T30: The app crate drops reqwest

**What**: The app crate's `Cargo.toml` drops `reqwest` and uses the client builder and `HttpGateway` from the adapters crate; its `src/config.rs` keeps the rule that only a debug build accepts loopback HTTP, with its test; the architecture test switches on `the app crate never depends on reqwest`.
**Where**: `apps/agent/src-tauri/Cargo.toml`
**Depends on**: T29
**Reuses**: `src/app.rs`, `src/config.rs`
**Requirement**: AHM-19, AHM-22

**Done when**:

- [ ] `debug_build_accepts_loopback_http_base` and the release-rejection test pass unchanged
- [ ] Architecture test `the app crate never depends on reqwest` passes and fails on its fixture
- [ ] Rust workspace gate and Rust Windows gate pass

**Tests**: unit
**Gate**: Rust workspace

---

### T31: Repoint the existing harness tests

**What**: `agent-source-rules.test.mjs`, `agent-mutation-scope.test.mjs`, `mutation-scope.test.mjs` and `.cargo/mutants.toml` use the new crate paths (`adapters/src/http/api_client.rs` replaces `core/src/api_client.rs`); every check they had still runs over every crate (not fewer paths).
**Where**: `scripts/test/agent-source-rules.test.mjs`
**Depends on**: T30
**Reuses**: the existing helpers; `apps/agent/src-tauri/.cargo/mutants.toml`
**Requirement**: AHM-22, AHM-24

**Done when**:

- [ ] `unsafe is allowed only in the two adapters`, `clippy.toml disallows every boundary type and method` and the other existing tests pass and still fail on their fixtures
- [ ] `node scripts/mutation-scope-check.mjs` passes
- [ ] Harness gate passes

**Tests**: harness unit
**Gate**: Harness

---

### T32: Adapter limits and invalid-body paths

**What**: The moved tests keep the idle timeout, oversize event, reconnect on timeout and `valid_last_event_id`; one new test per invalid-body path is added (the GET assignment path and a stream event).
**Where**: `apps/agent/src-tauri/adapters/tests/stream.rs` (moved tests, unchanged), `apps/agent/src-tauri/adapters/extra-tests/stream_limits.rs`, `apps/agent/src-tauri/adapters/Cargo.toml`
**Depends on**: T31
**Reuses**: `unknown_or_invalid_events_are_ignored`, `room_ids_must_be_uuids`
**Requirement**: AHM-22

**Done when**:

- [ ] Tests `invalid_assignment_body_is_an_invalid_error` and `invalid_stream_event_is_skipped` pass; they live in the new target `adapters/extra-tests/stream_limits.rs` (`[[test]]`), not under `tests/`, so no assertion is added to or changed in the preserved set (preservation test)
- [ ] Rust adapters gate passes

**Tests**: integration
**Gate**: Rust adapters

---

#### Phase 6: RoomAssignment and vision to the domain (M2)

### T33: The assignment types and the RoomAssignment aggregate

**What**: `domain/src/room_assignment.rs` holds `RoomId`, `GameName` (with `as_str()`), `Member`, `Assignment` (`room`, `run: NonZeroU64`, `expected_game_name`, `members`) and `RoomAssignment` (`empty`, `receive` → bool, `clear`, `current`).
**Where**: `apps/agent/src-tauri/domain/src/room_assignment.rs`
**Depends on**: T32
**Reuses**: `messages.rs`, the `watch` use in `stream.rs`
**Requirement**: AHM-09

**Done when**:

- [ ] Tests `latest_assignment_wins`, `clear_empties_the_assignment`, `receive_reports_whether_it_replaced`
- [ ] Rust domain gate passes

**Tests**: unit
**Gate**: Rust domain

---

### T34: Core uses the domain assignment

**What**: `messages.rs` loses `RoomId`, `GameName`, `Member`, `Assignment`; core, the ACL and `Probe` use the domain types; the stream loop keeps its `watch` channel fed from `RoomAssignment`. `core/Cargo.toml` gains the `d2rmm-agent-domain` dependency and the architecture test switches on `core depends on the domain`.
**Where**: `apps/agent/src-tauri/core/src/stream.rs`, `apps/agent/src-tauri/core/Cargo.toml`, `scripts/test/agent-architecture.test.mjs`
**Depends on**: T33
**Reuses**: T33
**Requirement**: AHM-09, AHM-20

**Done when**:

- [ ] `adapters/tests/stream.rs` passes; preservation test passes
- [ ] Test `core depends on the domain and not on reqwest tauri keyring or windows` asserts the domain dependency
- [ ] Rust workspace gate and Harness gate pass

**Tests**: integration
**Gate**: Rust workspace

---

### T35: The vision rule in the domain

**What**: `domain/src/vision.rs` holds `Region`, `ReadText`, `AUTOMAP_NAME_1080P` and `region_for` (AD-047).
**Where**: `apps/agent/src-tauri/domain/src/vision.rs`
**Depends on**: T34
**Reuses**: `core/src/vision.rs`, `core/src/ports.rs`
**Requirement**: AHM-12

**Done when**:

- [ ] The tests of `region_for` moved with it (both sides of the size boundary) and pass
- [ ] Rust domain gate passes

**Tests**: unit
**Gate**: Rust domain

---

### T36: Core reads a frame through the domain rule

**What**: `core/src/vision.rs` becomes `read_frame.rs`: `read_game_name` calls the domain `region_for` and the `TextReader` port; `Region` and `ReadText` leave `ports.rs`; `xtask/src/fixture.rs` and the app's `windows_ocr.rs` import them from the domain.
**Where**: `apps/agent/src-tauri/core/src/read_frame.rs`
**Depends on**: T35
**Reuses**: T35
**Requirement**: AHM-12, AHM-20

**Done when**:

- [ ] `adapters/tests/runtime.rs` and the fixture-read test pass; preservation test passes
- [ ] Rust workspace gate and Rust Windows gate pass

**Tests**: integration
**Gate**: Rust workspace

---

### T37: The ACL targets the domain types

**What**: `translate.rs` converts to and from the domain `Assignment` and `GameName`; the contract-typed `ApiClient` is untouched.
**Where**: `apps/agent/src-tauri/adapters/src/http/translate.rs`
**Depends on**: T36
**Reuses**: T33
**Requirement**: AHM-16

**Done when**:

- [ ] `assignment_translation_keeps_every_field` and `non_uuid_room_is_carried_unchanged` pass
- [ ] Rust adapters gate passes

**Tests**: unit
**Gate**: Rust adapters

---

#### Phase 7: Pairing (M3)

### T38: PairingCode and the Pairing aggregate

**What**: `domain/src/pairing.rs` holds `PairingCode` (six digits), `Pairing` (`new`, `show`, `claim_result`, `expired`, `rate_limited`, `minutes_left`, `remaining_until`), `ClaimOutcome`, `ClaimNext`, `CodeNext`, using the timing constants.
**Where**: `apps/agent/src-tauri/domain/src/pairing.rs`
**Depends on**: T37
**Reuses**: the rule functions and tests of `core/src/pairing.rs`
**Requirement**: AHM-07, AHM-15

**Done when**:

- [ ] Tests `pairing_claims_every_two_seconds_and_pauses_after_two_unused_codes`, `gone_counts_as_expiry`, `unauthorized_resets_unused_count`, `rate_limit_waits_retry_after_or_sixty_minutes`, `unused_limit_boundary_both_sides`, `minutes_left_rounds_up_at_every_offset` (moved)
- [ ] Rust domain gate passes

**Tests**: unit
**Gate**: Rust domain

---

### T39: The pair use case on the aggregate

**What**: `core/src/pairing.rs` becomes `pair.rs`: the loop and `show_code` drive `Pairing`; `Command` stays here; the claim secret stays a core `Secret`; spans unchanged.
**Where**: `apps/agent/src-tauri/core/src/pair.rs`
**Depends on**: T38
**Reuses**: T38, T18
**Requirement**: AHM-07, AHM-20

**Done when**:

- [ ] `adapters/tests/pairing.rs` passes; preservation test passes
- [ ] Rust workspace gate passes

**Tests**: integration
**Gate**: Rust workspace

---

### T40: Unit tests of the pair use case

**What**: Colocated `--lib` tests drive `pair` against `FakeApiGateway` on a paused clock: a code is shown with its minutes left, a claim stores the token through `TokenStore`, a `410` shows a new code, two unused codes pause, "Get a new code" resumes.
**Where**: `apps/agent/src-tauri/core/src/pair.rs`
**Depends on**: T39
**Reuses**: T18
**Requirement**: AHM-07, AHM-19

**Done when**:

- [ ] Tests `pair_shows_code_then_stores_token`, `pair_gone_shows_a_new_code`, `pair_pauses_after_two_unused_codes`, `pair_resumes_on_get_new_code` pass under `--lib`
- [ ] Rust core gate passes

**Tests**: unit
**Gate**: Rust core

---

### T41: Secret hygiene stays proved

**What**: The test that no secret reaches logs or spans keeps passing after the moves, in the adapters crate; core keeps a `Secret` `Debug`/`Display` test.
**Where**: `apps/agent/src-tauri/core/src/secret.rs`
**Depends on**: T40
**Reuses**: `no_secret_in_logs_or_spans`, `authorization_is_sensitive_and_never_logged`
**Requirement**: AHM-16, AHM-20

**Done when**:

- [ ] Test `secret_debug_and_display_are_redacted` in core and the two moved tests pass; preservation test passes
- [ ] Rust workspace gate passes

**Tests**: unit
**Gate**: Rust workspace

---

#### Phase 8: PairedDevice and the end of Context (M4)

### T42: The PairedDevice aggregate

**What**: `domain/src/paired_device.rs` holds `PairedDevice`, `DeviceEffect` and the effect lists of a `401` and a `426`, the retry epoch, `api_allowed`, `pairing_allowed`.
**Where**: `apps/agent/src-tauri/domain/src/paired_device.rs`
**Depends on**: T41
**Reuses**: `Context::{on_unauthorized, on_upgrade_required, epoch, api_allowed, pairing_allowed}`
**Requirement**: AHM-08, AHM-15

**Done when**:

- [ ] Tests `paired_device_401_and_426_effects_in_order`, `epoch_bumps_on_both`, `api_allowed_needs_a_token_and_no_pending_update`
- [ ] Rust domain gate passes

**Tests**: unit
**Gate**: Rust domain

---

### T43: DeviceState in core

**What**: `core/src/device_state.rs` holds the `PairedDevice`, `RoomAssignment`, the `watch` channels, the dropped counter and the `Hub` (which owns the `StateSink`); it applies each `DeviceEffect` to the ports and the view. It holds no port other than through the `Hub`.
**Where**: `apps/agent/src-tauri/core/src/device_state.rs`
**Depends on**: T42
**Reuses**: `Context`, `Hub`
**Requirement**: AHM-08, AHM-17

**Done when**:

- [ ] Tests `unauthorized_applies_forget_clear_drop_ask`, `upgrade_required_applies_require_drop_check_now` (core, fake ports)
- [ ] Rust core gate passes

**Tests**: unit
**Gate**: Rust core

---

### T44: The beat use case

**What**: `core/src/heartbeat.rs` becomes `beat.rs`, running on `DeviceState` and `HeartbeatPorts`.
**Where**: `apps/agent/src-tauri/core/src/beat.rs`
**Depends on**: T43
**Reuses**: T43
**Requirement**: AHM-08, AHM-20

**Done when**:

- [ ] `adapters/tests/heartbeat.rs` passes; preservation test passes
- [ ] Tests `beat_every_fifteen_seconds_with_running_flag`, `beat_failure_shows_unreachable_then_connected` pass under `--lib`
- [ ] Rust workspace gate passes

**Tests**: unit
**Gate**: Rust workspace

---

### T45: The follow-stream use case

**What**: `core/src/stream.rs` becomes `follow_stream.rs` on `DeviceState` and `StreamPorts`.
**Where**: `apps/agent/src-tauri/core/src/follow_stream.rs`
**Depends on**: T44
**Reuses**: T43, T18
**Requirement**: AHM-08, AHM-20

**Done when**:

- [ ] `adapters/tests/stream.rs` passes; preservation test passes
- [ ] Tests `follow_fetches_assignment_then_streams`, `follow_closes_on_401_and_426` pass under `--lib`
- [ ] Rust workspace gate passes

**Tests**: unit
**Gate**: Rust workspace

---

### T46: The check-update use case

**What**: `core/src/updates.rs` becomes `check_update.rs` on `DeviceState` and `UpdatePorts`, keeping `view_after`.
**Where**: `apps/agent/src-tauri/core/src/check_update.rs`
**Depends on**: T45
**Reuses**: T43
**Requirement**: AHM-08, AHM-20

**Done when**:

- [ ] `adapters/tests/updates.rs` passes; preservation test passes
- [ ] Tests `check_update_at_start_every_six_hours_and_after_426`, `view_after_required_wins` pass under `--lib`
- [ ] Rust workspace gate passes

**Tests**: unit
**Gate**: Rust workspace

---

### T47: Context is gone

**What**: `context.rs` is deleted; nothing refers to `Context`; `Runtime` builds `DeviceState` and the use cases from the port groups; `Probe` wraps `DeviceState`. The architecture test switches on `no struct in core holds more than five ports` against the real tree.
**Where**: `apps/agent/src-tauri/core/src/runtime.rs`, `scripts/test/agent-architecture.test.mjs`
**Depends on**: T46
**Reuses**: T20, T43
**Requirement**: AHM-17, AHM-20

**Done when**:

- [ ] `grep -rn "Context" apps/agent/src-tauri/core/src` finds no agent `Context` type
- [ ] All adapters tests pass; preservation test passes
- [ ] Test `no struct in core holds more than five ports` passes on the tree
- [ ] Rust workspace gate, Rust Windows gate and Harness gate pass

**Tests**: integration
**Gate**: Rust workspace

---

#### Phase 9: Retry, reconnection, fusion, presence (M5)

### T48: The ObservationRetry policy

**What**: `domain/src/observation_retry.rs` holds `ObservationRetry` (`new(epoch)`, `after_failure`, `after_sleep`), `PostFailure`, `Wait`, `Retry`.
**Where**: `apps/agent/src-tauri/domain/src/observation_retry.rs`
**Depends on**: T47
**Reuses**: `observations::{RETRY_DELAYS, retry_delay, is_retryable}` and their tests
**Requirement**: AHM-10, AHM-15

**Done when**:

- [ ] Tests `observation_retry_delays_one_two_four_eight_then_drop`, `non_retryable_failure_drops`, `epoch_moved_during_sleep_drops`
- [ ] Rust domain gate passes

**Tests**: unit
**Gate**: Rust domain

---

### T49: The post-observation use case

**What**: `core/src/observations.rs` becomes `post_observation.rs` using `ObservationRetry` and keeping the `sleep_while_allowed` gate result; `SendOutcome` stays.
**Where**: `apps/agent/src-tauri/core/src/post_observation.rs`
**Depends on**: T48
**Reuses**: T48, T18
**Requirement**: AHM-10, AHM-20

**Done when**:

- [ ] `adapters/tests/observations.rs` passes; preservation test passes
- [ ] Tests `post_retries_with_the_same_key_five_attempts`, `post_drops_when_a_426_moves_the_epoch`, `post_drops_when_the_gate_closes_during_sleep` pass under `--lib`
- [ ] Rust workspace gate passes

**Tests**: unit
**Gate**: Rust workspace

---

### T50: The Reconnect service

**What**: `domain/src/reconnect.rs` holds `Reconnect` (`new`, `delay`, `slept`, `opened_for`) and `follow_stream.rs` uses it.
**Where**: `apps/agent/src-tauri/domain/src/reconnect.rs`
**Depends on**: T49
**Reuses**: `stream::{delay_after_open, next_delay}` and their tests
**Requirement**: AHM-11, AHM-15

**Done when**:

- [ ] Tests `reconnect_doubles_to_sixty_and_resets_at_sixty_seconds`, `interrupted_sleep_does_not_double`, `open_for_fifty_nine_point_nine_nine_nine_seconds_keeps_the_delay`
- [ ] `adapters/tests/stream.rs` passes; preservation test passes
- [ ] Rust workspace gate passes

**Tests**: unit
**Gate**: Rust workspace

---

### T51: Fusion and the observation in the domain

**What**: `domain/src/fusion.rs` holds `fuse` (exact match after trim and lower-case, normalised text, confidence clamped to [0, 1], NaN as 0, key drawn only on a match, `None` for a non-UUID room) and `GameNameObservation`; core calls it.
**Where**: `apps/agent/src-tauri/domain/src/fusion.rs`
**Depends on**: T50
**Reuses**: `core/src/fusion.rs` and its tests
**Requirement**: AHM-12, AHM-15

**Done when**:

- [ ] Tests `fuse_exact_match_after_trim_and_lowercase`, `fuse_ignores_a_distance_one_name`, `fuse_clamps_confidence_and_maps_nan_to_zero`, `fuse_refuses_a_non_uuid_room`, `fuse_draws_a_key_only_on_a_match`
- [ ] `core/src/fusion.rs` is gone; `adapters/tests/observations.rs` passes; preservation test passes
- [ ] Rust workspace gate passes

**Tests**: unit
**Gate**: Rust workspace

---

### T52: Presence in the domain

**What**: `domain/src/presence.rs` holds `game_running` (`D2R.exe`, ASCII case-insensitive), `Presence` and `Screen`; `beat.rs` uses them.
**Where**: `apps/agent/src-tauri/domain/src/presence.rs`
**Depends on**: T51
**Reuses**: `heartbeat::{game_running, GAME_PROCESS}` and `game_running_matches_the_executable_name_only`
**Requirement**: AHM-12, AHM-15

**Done when**:

- [ ] Test `game_running_matches_the_executable_name_only` moved and passes
- [ ] `adapters/tests/heartbeat.rs` passes; preservation test passes
- [ ] Rust workspace gate passes

**Tests**: unit
**Gate**: Rust workspace

---

#### Phase 10: Mutation scope, boundaries and the close (M6, M7)

### T53: Mutation scope in mutants.toml

**What**: `.cargo/mutants.toml` examines all of `domain/src/`, the rule modules of design § Mutation scope in core (`pair.rs`, `follow_stream.rs`, `check_update.rs`, `post_observation.rs`, `beat.rs`) and in adapters (`http/api_client.rs`, `http/translate.rs`, `http/sse.rs`).
**Where**: `apps/agent/src-tauri/.cargo/mutants.toml`
**Depends on**: T52
**Reuses**: the current file
**Requirement**: AHM-23, AHM-25

**Done when**:

- [ ] Test `mutation rule modules list matches the migrated locations` passes and fails on a fixture that drops a module
- [ ] Harness gate passes

**Tests**: harness unit
**Gate**: Harness

---

### T54: The nightly run covers the three crates

**What**: `nightly.yml` runs `cargo mutants` for `d2rmm-agent-domain`, `d2rmm-agent-core` and `d2rmm-agent-adapters`, each with `-- --lib`.
**Where**: `.github/workflows/nightly.yml`
**Depends on**: T53
**Reuses**: the current `agent-mutation` job
**Requirement**: AHM-23, AHM-24

**Done when**:

- [ ] Tests `the nightly mutation run covers the domain core and adapters with --lib` and `a mutation run without the domain or --lib fails` pass in `agent-mutation-scope.test.mjs`
- [ ] Harness gate passes

**Tests**: harness unit
**Gate**: Harness

---

### T55: The mutation-scope guard follows the new layout

**What**: `scripts/mutation-scope-check.mjs` and its test accept the three packages and still fail on any assembled-service test run per mutant (ADR 026, rule 12).
**Where**: `scripts/mutation-scope-check.mjs`
**Depends on**: T54
**Reuses**: the current script
**Requirement**: AHM-24

**Done when**:

- [ ] `node scripts/mutation-scope-check.mjs` passes; a fixture that runs `tests/` per mutant fails
- [ ] Harness gate passes

**Tests**: harness unit
**Gate**: Harness

---

### T56: Windows check and boundary fixtures follow the layout

**What**: `scripts/agent/win-check.mjs` and the `agent` job cover every crate; the boundary fixtures still fail with their ids; `cargo deny check bans` covers the new crates.
**Where**: `scripts/agent/win-check.mjs`
**Depends on**: T55
**Reuses**: AD-071
**Requirement**: AHM-22

**Done when**:

- [ ] Rust Windows gate passes; `cargo deny check bans` passes in the workspace
- [ ] Harness gate passes

**Tests**: harness unit
**Gate**: Rust Windows

---

### T57: The loop spans stay named

**What**: The loop-span and `agent.http.*` span tests pass in the adapters crate with the application creating the loop spans and the gateway the HTTP ones; the domain manifest has no `tracing` or `opentelemetry`.
**Where**: `apps/agent/src-tauri/adapters/tests/runtime.rs`
**Depends on**: T56
**Reuses**: `loop_spans_are_named`, `each_operation_opens_its_child_span`
**Requirement**: AHM-18

**Done when**:

- [ ] Both tests pass, assertions unchanged; preservation test passes
- [ ] Rust adapters gate passes

**Tests**: integration
**Gate**: Rust adapters

---

### T58: The full gate

**What**: `pnpm check`-level run of everything this feature touches, plus the quality ratchet and harness maturity, recorded for the review.
**Where**: `.specs/features/agent-hexagonal-migration/tasks.md` (Handoff)
**Depends on**: T57
**Reuses**: `pnpm check`, `pnpm quality:collect && pnpm quality:ratchet --context pr`, `pnpm harness:gate`
**Requirement**: AHM-21

**Done when**:

- [ ] Build gate passes; no `.quality-baseline.json` value is lowered
- [ ] `core/tests` is gone and `adapters/tests` assertions equal the baseline set

**Tests**: none (aggregate gate)
**Gate**: Build

---

## Checks

**C1** - The domain crate depends only on `std`, `thiserror`, `chrono` and `uuid` (AHM-01, AC 1)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="domain depends only on std thiserror chrono and uuid" scripts/test/agent-architecture.test.mjs`

**C2** - `d2rmm-agent-core` depends on the domain and on none of `reqwest`, `tauri`, `keyring`, `windows` (AHM-02, AC 2)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="core depends on the domain and not on reqwest tauri keyring or windows" scripts/test/agent-architecture.test.mjs`

**C3** - The generated contract types are imported by neither the domain nor the application (AHM-03, AC 3)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="contract types stay out of the domain and the application" scripts/test/agent-architecture.test.mjs`

**C4** - The domain `clippy.toml` repeats the root bans and adds `Instant`, `SystemTime::now`, `Utc::now`, `Local::now`, `Uuid::new_v4` (AHM-04, AC 6)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="domain clippy.toml repeats the root bans and adds the clock bans" scripts/test/agent-architecture.test.mjs`

**C5** - Every forbidden dependency or `use` fails the harness test with its file and rule, one fixture per rule (AHM-05, AC 4-5)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="each architecture rule fails on its fixture" scripts/test/agent-architecture.test.mjs`

**C6** - `AGENTS.md` and the cursor rule state the layer table and the direction (AHM-06, AC 7)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="AGENTS.md and the cursor rule state the layer table" scripts/test/agent-architecture.test.mjs`

**C7** - Pairing claims every 2 s and pauses after 2 unused codes (AHM-07, AC 1)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-domain --lib -E 'test(pairing_claims_every_two_seconds_and_pauses_after_two_unused_codes)'`

**C8** - A 401 yields forget-token, clear-room, drop-retries, ask-code in that order; a 426 yields require-update, drop-retries, check-now (AHM-08, AC 2)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-domain --lib -E 'test(paired_device_401_and_426_effects_in_order)'`

**C9** - The latest of two assignments wins (AHM-09, AC 3)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-domain --lib -E 'test(latest_assignment_wins)'`

**C10** - The retry delays are 1, 2, 4, 8 s and the observation is dropped after the fifth failed attempt (AHM-10, AC 4)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-domain --lib -E 'test(observation_retry_delays_one_two_four_eight_then_drop)'`

**C11** - Reconnection starts at 1 s, doubles to 60 s and resets after a stream open at least 60 s (AHM-11, AC 5)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-domain --lib -E 'test(reconnect_doubles_to_sixty_and_resets_at_sixty_seconds)'`

**C12** - Fusion yields an observation only for an exact match after trim and lower-case (AHM-12, AC 6)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-domain --lib -E 'test(fuse_exact_match_after_trim_and_lowercase)'`

**C13** - Every timing constant has its value, and the offline threshold is three heartbeats (AHM-13, AC 7)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-domain --lib -E 'test(timing_constants_are_pinned)'`

**C14** - The domain reads no clock, random source or environment, and names nothing `Agent` (AHM-14, AC 8-9)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="domain reads no clock or randomness and names nothing Agent" scripts/test/agent-architecture.test.mjs`

**C15** - A value-dependent branch has a test on both sides of its boundary (AHM-15, AC 10)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-domain --lib -E 'test(unused_limit_boundary_both_sides)'`

**C16** - The application reaches the API only through the gateway port and holds no HTTP client (AHM-16, AC 1)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="application reaches the API only through the gateway port" scripts/test/agent-architecture.test.mjs`

**C17** - The translation drops no field of the assignment (AHM-16, AC 2)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-adapters --lib -E 'test(assignment_translation_keeps_every_field)'`

**C18** - No struct in core holds more than five ports (AHM-17, AC 3)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="no struct in core holds more than five ports" scripts/test/agent-architecture.test.mjs`

**C19** - The loop spans are created by the application and the domain has no `tracing` (AHM-18, AC 4)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-adapters -E 'test(loop_spans_are_named)'`

**C20** - Only the app crate builds adapters and depends on `tauri`, `keyring`, `windows` (AHM-19, AC 5)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="only the app crate builds adapters and depends on tauri keyring and windows" scripts/test/agent-architecture.test.mjs`

**C21** - The application tests use in-memory fakes and no mock of an owned type (AHM-19, AC 6)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="core tests use in-memory fakes only" scripts/test/agent-architecture.test.mjs`

**C22** - The moved integration tests keep every assertion line (AHM-20, AC 1)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="moved tests keep every assertion line" scripts/test/agent-test-preservation.test.mjs`

**C23** - Every request keeps its version header and `traceparent` (AHM-21, AC 2)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-adapters -E 'test(every_request_carries_version_and_traceparent)'`

**C24** - The window shows the same states and sentences (AHM-21, AC 6)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core --lib -E 'test(/^view::/)'`

**C25** - Unknown or invalid stream events change nothing; the server sends data only (AHM-22, AC 3)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-adapters -E 'test(unknown_or_invalid_events_are_ignored)'`

**C26** - The clippy bans of ADR 010 still cover every boundary type and method (AHM-22, AC 4)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="clippy.toml disallows every boundary type and method" scripts/test/agent-source-rules.test.mjs`

**C27** - The Windows adapters keep compiling for Windows (AHM-22, AC 5)
Proof: `node scripts/agent/win-check.mjs`

**C28** - The nightly run covers the domain, core and adapters with `-- --lib` (AHM-23, AC 1)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="the nightly mutation run covers the domain core and adapters with --lib" scripts/test/agent-mutation-scope.test.mjs`

**C29** - A mutation run without the domain or `--lib` fails the harness (AHM-24, AC 3)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="a mutation run without the domain or --lib fails" scripts/test/agent-mutation-scope.test.mjs`

**C30** - No service-assembling test runs per mutant (AHM-24, AC 2)
Proof: `node scripts/mutation-scope-check.mjs`

**C31** - The rule modules in `mutants.toml` are the migrated locations of the old list (AHM-25, AC 5)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="mutation rule modules list matches the migrated locations" scripts/test/agent-mutation-scope.test.mjs`

**C32** - Every mutant of a domain rule is killed by a unit test (AHM-25, AC 4)
Proof: `cargo mutants --locked --manifest-path apps/agent/src-tauri/Cargo.toml --package d2rmm-agent-domain -- --lib`

---

## Handoff

The feature's live state, written as it happens - a compaction gives no warning.

**Batch 4 (execute-batch-4), complete: T19 to T25**

**Batch 5 (execute-batch-5), in progress: T26 to T32**

- T26 done (commit carries `Task: T26`): `adapters/` is a workspace member (`d2rmm-agent-adapters`) with the design's dependencies and `#![forbid(unsafe_code)]`; `adapters_crate_builds` passes; `Cargo.lock` gains the member. Gate `Rust workspace` passed on attempt 1 (132 tests). Deviation to note: the architecture test for the app-crate direction is named `adapters and the app crate do not depend on each other` (T6 file), not `adapters never depend on the app crate` as T26 lists it; the rule passes under the existing name, and the name was left as it is (harness file not edited here).

- T19 done (commit carries `Task: T19`): `Context` is generic over the gateway (`Context<G = HttpGateway>`) and gained `gateway: Arc<G>` beside the transitional `api: ApiClient`. The five groups (`PairingPorts`, `HeartbeatPorts`, `StreamPorts`, `UpdatePorts`, `ReadPorts`) and `Groups<G>` are in `context.rs`; `Context::from_groups(version, sink, api, groups)` builds the context. Deviation (for the orchestrator to note): `from_groups` also takes the transitional `api`, because the loops still call `ctx.api` until T21 to T24, and `api` goes with the last of them. Gate `Rust core` passed on attempt 1 (113 tests). The arch rule `no struct in core holds more than five ports` is switched off on the real tree until T47, so its pass is by the rule's own gating.
- T20 done (commit carries `Task: T20`): `Runtime::start_with_probe(config, http, adapters) -> (Handle, Probe)` and `Probe` (`update_required` receiver, `dropped_observations`, `assignment`, `set_paired`, `set_assignment`, `on_unauthorized`, `on_upgrade_required`). `Runtime::start` returns the `Handle` alone. Both still take `Adapters`; they move to the groups in T25. Gate `Rust core` passed on attempt 1 (114 tests).
- T25 done (commit carries `Task: T25`): `Adapters` and the `Context::new` path are gone. `Context::from_groups(version, sink, groups)` is the only constructor, `Context` no longer holds the transitional `api` field, and `Runtime::start` / `start_with_probe` take `(config, sink, groups)`. The harness keeps `ctx: Probe` (assertions) and `context: Arc<Context>` (loops); `Probe::over(ctx)` builds the probe without starting loops. The app builds the five groups in `main.rs::ports` (Windows) and `app.rs` builds the one `HttpGateway` both use. Act lines changed in `core/tests/{heartbeat,stream,updates,observations,runtime}.rs` (paired, assignment, context handle, the runtime start call, and `expected_name`'s body); no assertion line changed. Gate `Rust workspace` passed on attempt 1 (131 tests); `win-check` passed; preservation guard passed. The `grep` of the Done-when finds two doc comments that name the design section `§ Adapters`, not a type. Deviation for the orchestrator: `Runtime::start` and `start_with_probe` take `HttpGateway` groups (concrete), not a generic gateway; the loops are still concrete over `Context` (the generic loops come with the use cases in M4/M5).
- T24 done (commit carries `Task: T24`): `observations::send(ctx, observation)` takes `GameNameObservation` and posts through `ctx.gateway.post_observation`; `SendOutcome`, the retry delays and the epoch check are unchanged. `fuse` now returns a `GameNameObservation` (the contract type left the core's fusion). Deviation for the orchestrator to note: in `fusion.rs` the unit tests' contract-field assertions (`type_`, `value`, `idempotency_key`) and the no-image key check now read the wire form through `observation_to_contract` (the `type` string, `game_name`, `key`, the same key set and schema check); the values checked are the same. Gate `Rust core` passed on attempt 2 (one failed run: `ctx.api` left in `observations.rs`; 114 tests); preservation guard passed.
- T23 done (commit carries `Task: T23`): `stream.rs` fetches the assignment through `ctx.gateway.assignment` and follows the stream through `ctx.gateway.open_stream`, racing `EventStream::next` against `wait_until_closed`; the last event id is copied back after each read. The reconnect rules are unchanged. The loop now carries `messages::Assignment`, so `Context::assignment`, `Probe`, `fuse` (input only; its output stays the contract `Observation` until T24) and the test helpers of `context.rs`, `runtime.rs`, `fusion.rs` and `tests/observations.rs` (helper body only, no assertion) moved to the message type. Gate `Rust core` passed on attempt 1 (114 tests); preservation guard passed.
- T22 done (commit carries `Task: T22`): `heartbeat.rs` builds a `Presence` and calls `heartbeat` through `ctx.gateway`. `heartbeat_body` is gone; its contract mapping is the ACL's `heartbeat_from_presence`, and its test `heartbeat_body_follows_the_contract` moved to `gateway/translate.rs` with the same assertions. A version the contract refuses fails in the translation before any request and still shows unreachable. Gate `Rust core` passed on attempt 1 (114 tests); preservation guard passed.
- T21 done (commit carries `Task: T21`): `pairing.rs` calls `request_code` and `claim` through `ctx.gateway` (the `ApiGateway` port over `HttpGateway`); it takes `IssuedCode` and keeps the claim secret as a core `Secret`. Spans and behaviour unchanged. Gate `Rust core` passed on attempt 1 (114 tests); preservation guard passed (5 tests).

**Batch 3 (execute-batch-3), stopped at T16 by a plan defect, since replanned by the orchestrator (T16 and T32 put their new asserting tests in `extra-tests/` targets; guard untouched); resume at T16, then T17, T18**

- T12 done: commit `7337c33` (`refactor(agent): move the port error to the ports module`), gate `Rust core` passed on attempt 1. The preservation item of its Done-when is not executed: `core/tests` is unchanged, so the guard holds by reasoning. It runs at the next harness gate that touches the guard.
- T13 done: commit `de375af` (`refactor(agent): add the plain messages the ports exchange`), gate `Rust core` passed on attempt 1.
- T14 done: commit `003e2e1` (`feat(agent): define the gateway port and the room stream`), gate `Rust core` passed on attempt 1. Deviation: `EventStream::next` returns a boxed future, the form `Updater` uses. An `async fn` in a trait cannot sit behind `Box<dyn EventStream>`, which the Done-when requires. The rest of the signature follows the design.
- T15 done: commit `00bddba` (`feat(agent): translate between the contract and the messages`), gate `Rust core` passed on attempt 2. Attempt 1 failed on my own test expectation (`readRate` is the float `0.0`); the mapping was right, the assertion was corrected to `as_f64() == Some(0.0)`.
- T16 done (commit carries `Task: T16`): `HttpGateway` in `core/src/gateway/http.rs` over the unchanged `ApiClient`. The gateway test is `core/extra-tests/gateway.rs` (target `gateway` in `core/Cargo.toml`), reusing the fake API through `#[path]`; `core/tests/**` untouched. Gate `Rust core` passed on attempt 1 (104 tests). Deviation: `open_stream` on the port returns `ApiError::Invalid` until T17 supplies the SSE stream; no caller reaches it before T23.
- T17 done (commit carries `Task: T17`): `SseEventStream` in `core/src/gateway/sse_stream.rs` over a `ChunkSource` (implemented for `reqwest::Response`; scripted in the tests). It feeds `SseParser`, keeps `last_event_id`, applies the 60 s idle timeout and the 64 KiB cap, and skips invalid events. `HttpGateway::open_stream` now returns it, so the T16 placeholder is gone. Gate `Rust core` passed on attempt 2 (111 tests). Attempt 1 failed on clippy `manual_async_fn`; the impls were rewritten as `async fn`.
- T18 done (commit carries `Task: T18`): `FakeApiGateway` in `core/src/fakes.rs` (scripted answers per route, a recorded `Call` log, a scripted `EventStream`; an unscripted call answers `Server`). Gate `Rust core` passed on attempt 2 (112 tests); attempt 1 failed on an unused test import. No `mockall` or `mock!` in core.
- Batch 3 complete: T12 to T18 committed. T16 gateway test is in `core/extra-tests/gateway.rs`; `core/tests/**` is untouched in this batch.

**Batch 2 (execute-batch-2), blocked at T7 by the retry budget of the implementer session**

- T6 done: commit `356d5a6` (`feat(agent): guard the crate manifests of the agent layers`), gate `pnpm test:harness` passed on attempt 1.
- T7 code and six source fixtures exist uncommitted; resume by running the T7 gate alone through `attempt.mjs`, then commit. T8 to T11 not started. Plan note resolved: T6 and T30 now say the adapters crate never depends on the app crate (one direction), tasks gate green.

**Settled mid-build:** none
**Dispatched:** none
**Walked:** none (no screen)
**Blocked:** none. T6/T8 plan defect (rules that cannot hold on the tree at 05a1639) resolved by replanning: `core depends on the domain` is switched on in T34, the ports rule in T47; tasks gate re-run green.

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7 → Phase 8 → Phase 9 → Phase 10

Phase 1:  T1 → T2 → T3 → T4 → T5
Phase 2:  T6 → T7 → T8 → T9 → T10 → T11
Phase 3:  T12 → T13 → T14 → T15 → T16 → T17 → T18
Phase 4:  T19 → T20 → T21 → T22 → T23 → T24 → T25
Phase 5:  T26 → T27 → T28 → T29 → T30 → T31 → T32
Phase 6:  T33 → T34 → T35 → T36 → T37
Phase 7:  T38 → T39 → T40 → T41
Phase 8:  T42 → T43 → T44 → T45 → T46 → T47
Phase 9:  T48 → T49 → T50 → T51 → T52
Phase 10: T53 → T54 → T55 → T56 → T57 → T58
```

Execution is strictly sequential within a phase. Batches follow the Execution Plan; the Verifier's findings, when any, are dispatched as `execute-batch-8` (and `execute-batch-9` for a second round).
