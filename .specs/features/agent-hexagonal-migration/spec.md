# Agent Hexagonal Migration Specification

**Approved**: 2026-11-01 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)

## Problem Statement

The desktop agent's core mixes scheduling, I/O and rules inside async loops, hands every loop a `Context` that holds all
ports, the HTTP client and the counters, and depends on `reqwest` and the generated contract types everywhere. Nothing
enforces a boundary inside the crate, so the next features (vision, capture, fusion in F2) would add to the coupling.
ADR 027 makes the agent hexagonal like the Agents context of the backend (`domain ← application ← adapters`). This
feature migrates the agent to that layout in behaviour-preserving steps, enforces it by crate boundaries and a
harness test, and extends mutation testing to the agent's domain and application with unit tests only (ADR 026).

## Goals

- [ ] The agent's rules live in a `d2rmm-agent-domain` crate that cannot import I/O, async, UI or contract crates
      (NFR-10, ADR 027).
- [ ] The application layer (`d2rmm-agent-core`) reaches the network and the OS only through ports; the generated
      contract types and `reqwest` stay in the adapters (ADR 027, rules 3 and 5).
- [ ] Nothing the agent does on the wire or on the machine changes: the existing integration tests and the
      read-only boundary stay green and unedited (NFR-06, ADR 010).
- [ ] `cargo-mutants` runs on the domain and the application with the unit tests only (ADR 026).

## Out of Scope

| Feature                                                          | Reason                                                                                                     |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Any new agent behaviour, new screen, new request                 | The migration is behaviour-preserving (brief revision 2)                                                   |
| Vision, capture, hotkeys, the local outbox, remote configuration | F2 (ROADMAP); ADR 027 asks to revisit the layer table when F2 starts                                       |
| Changes to the wire contracts, the JSON Schemas or the API       | Contracts first (AGENTS.md rule 2); the agent only changes how it holds the generated types                |
| Exporting spans and the end-to-end trace                         | `observability-e2e` (NFR-09), which runs after this feature; here spans only move to the application layer |
| Reading timings from the contract or from remote configuration   | Rejected by the maintainer (ADR 027, rule 4): timings are domain constants                                 |
| A shared Rust domain crate between the agent and the API         | ADR 027, alternatives considered                                                                           |
| Renaming the backend's `Agent` aggregate                         | The device-side concept gets its own name, `PairedDevice`; the backend is untouched                        |

---

## Assumptions & Open Questions

| Assumption / decision                   | Chosen default                                                                                                                                                                                                     | Rationale                                                                                                                                                                         | Confirmed? |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| How agent behaviour is proved           | Rust unit tests, the existing integration tests under `core/tests` (assertions unedited), the harness test `scripts/test/agent-architecture.test.mjs` and `pnpm specs:check`; scenarios are `# not-scenario` lines | The acceptance runner cannot drive the Windows agent; same rule as agent-skeleton ("the code tests are enough for the agent"), authorised by the maintainer on 2026-11-01. AD-078 | y (AD-078) |
| The 45 s offline threshold in the agent | A domain constant `OFFLINE_AFTER` (45 s) next to `HEARTBEAT_INTERVAL` (15 s), pinned by a test that it is three heartbeats; the agent's loops do not use it                                                        | ADR 027 rule 4 lists it among the domain constants; the server owns the rule (AD-031), the constant documents the agreement. AD-079 (assumed)                                     | y (AD-079) |
| Mutation thresholds for the new crates  | The same module-level survival rule the agent already runs (`.cargo/mutants.toml`), widened to every module of `d2rmm-agent-domain` and the rule modules of `d2rmm-agent-core`; no number is lowered               | AGENTS.md rule 4 (thresholds are the maintainer's); ADR 026 sets the scope, not a score. AD-080 (assumed)                                                                         | y (AD-080) |
| Where the HTTP adapter lives            | Decided in Design (ADR 027, open point 2); this spec requires only that `reqwest` is outside `d2rmm-agent-core`                                                                                                    | A placement is a design choice, not a product behaviour                                                                                                                           | y          |
| Which aggregates exist                  | `Pairing`, `PairedDevice`, `RoomAssignment`, the observation retry policy; stream reconnection and fusion as domain services; Design may merge or split them if a rule has no home                                 | ADR 027 rule 1 lists them as candidates "to be confirmed in the design of the first migration feature"                                                                            | y          |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: The layers are real and enforced ⭐ MVP

**User Story**: As the maintainer, I want the agent split into domain, application and adapters with the dependency
direction enforced by the compiler and a harness test so that the next agent features cannot erode the boundary.

**Why P1**: ADR 027 and the F0 exit criterion "the domain crate has no I/O dependency".

**Acceptance Criteria**:

1. The agent SHALL have a crate `d2rmm-agent-domain` whose dependencies are limited to `std`, `thiserror`, `chrono` and `uuid`.
2. The crate `d2rmm-agent-core` SHALL depend on `d2rmm-agent-domain` and SHALL NOT depend on `reqwest`, `tauri`, `keyring` or `windows`.
3. The generated contract types SHALL be imported only by adapter code, never by `d2rmm-agent-domain` or by the application layer in `d2rmm-agent-core`.
4. IF a manifest or source file of `d2rmm-agent-domain` or `d2rmm-agent-core` adds a dependency or a `use` that the layer table of ADR 027 forbids THEN `pnpm test:harness` SHALL fail naming the file and the rule.
5. The harness test SHALL keep one fixture per forbidden-dependency rule, and each fixture SHALL make the test fail when applied.
6. The `clippy.toml` of the domain crate SHALL disallow `std::time::Instant`, `std::time::SystemTime::now`, `chrono::Utc::now`, `chrono::Local::now` and `uuid::Uuid::new_v4`, and `cargo clippy --all-targets -- -D warnings` SHALL fail on a domain file that calls either.
7. `AGENTS.md` and `.cursor/rules/agent-rust.mdc` SHALL state the layer table and the dependency direction of the agent.

**Independent Test**: add `use tokio::time::sleep;` to a domain file and `pnpm test:harness` and `cargo build` both fail.

---

### P1: The rules live in the domain, with their own names ⭐ MVP

**User Story**: As a maintainer, I want each rule of pairing, device state, assignment, observation retry, stream
reconnection and fusion in a pure domain object so that it is unit-tested and mutation-tested without starting a loop.

**Why P1**: NFR-10 asks for mutation testing on domain and application; ADR 026 requires the proof to be a unit test.

**Acceptance Criteria**:

1. `Pairing` SHALL hold a code, its expiry, the count of consecutively unused codes and the pause, and SHALL decide when to claim, when to ask a new code, when to stop asking and how long to wait after a rate limit, with the values the agent uses today (claim every 2 s, stop after 2 unused codes, a `410` on a claim counts as an expiry, a `401` resets the unused count to 0, wait `Retry-After` or 60 minutes after a rate limit; the clamp of `Retry-After` to 1..3600 s stays in the API client adapter).
2. `PairedDevice` SHALL hold the pairing state and the token's presence, and SHALL decide the consequence of a `401` (token deleted, a new code asked) and of a `426` (update required, an update check started); a `401` or `426` SHALL also clear the room and drop the pending observation retries (AD-051), and the application SHALL wake the update loop (AD-049).
3. `RoomAssignment` SHALL hold the current assignment and SHALL keep only the latest of two assignments received.
4. The observation retry policy SHALL give the delay before attempt 2, 3, 4 and 5 as 1, 2, 4 and 8 s and SHALL say to drop the observation after the fifth failed attempt.
5. Stream reconnection SHALL be a domain service that starts at 1 s, doubles to at most 60 s and resets after a stream stays open at least 60 s.
6. Fusion SHALL be a domain service that yields an observation only for an exact match of the expected game name after trimming and lower-casing, and SHALL yield nothing otherwise; the observation SHALL carry the normalised text, a confidence clamped to [0, 1] with NaN as 0, and SHALL NOT be yielded when the room id is not a UUID.
7. The heartbeat interval (15 s), the offline threshold (45 s), the claim interval (2 s), the six-digit code format (mirroring the contract's `^\d{6}$`, not replacing it) and the retry and reconnect schedules SHALL be constants of `d2rmm-agent-domain`, not read from a contract or a configuration file.
8. The domain SHALL receive time and identifiers as arguments (`WallClock`, `IdGenerator`) and SHALL NOT read a clock, a random source or the environment.
9. The device-side concept SHALL be named `PairedDevice` in the domain and SHALL NOT be named `Agent`.
10. IF a rule has a branch that depends on a value (a status code, a count, a duration boundary) THEN a unit test in `d2rmm-agent-domain` SHALL cover both sides of that boundary.

**Independent Test**: `cargo nextest run -p d2rmm-agent-domain --lib` passes and each rule above has a test that fails when the rule's constant or comparison is mutated.

---

### P1: The application orchestrates through ports ⭐ MVP

**User Story**: As a maintainer, I want the loops to be thin use cases over ports so that a contract or a library
change reaches the adapters only.

**Why P1**: ADR 027 rules 3, 5 and 7; the F0 exit criterion "the generated contract types do not reach the domain".

**Acceptance Criteria**:

1. The application layer SHALL reach the API through a gateway port and SHALL NOT hold an HTTP client.
2. An adapter SHALL translate between the generated contract types and the domain types in both directions, and the translation SHALL be covered by tests that fail when a field is dropped.
3. The application layer SHALL have no type that holds every port at once: each use case (pair, beat, follow the stream, post an observation, check for an update) SHALL receive only the ports it uses.
4. The telemetry spans of the agent SHALL be created in the application layer, and `d2rmm-agent-domain` SHALL NOT depend on `tracing` or `opentelemetry`.
5. The Tauri app crate SHALL be the only place that builds the adapters and hands them to the application, and the only crate that depends on `tauri`, `keyring` and `windows`.
6. The fakes used by the application tests SHALL be in-memory implementations of the ports, with no mock of a type the agent owns.

**Independent Test**: `cargo tree -p d2rmm-agent-core` lists no `reqwest`, `tauri`, `keyring` or `windows`.

---

### P1: Nothing changes for the player or the server ⭐ MVP

**User Story**: As a player and as the API, I want the agent to behave exactly as before the migration so that the
walking skeleton keeps working.

**Why P1**: brief revision 2: "behaviour-preserving; the integration tests of `core/tests/*` stay untouched and green".

**Acceptance Criteria**:

1. WHEN the migration of an aggregate is committed THEN every test in `apps/agent/src-tauri/core/tests/` SHALL pass without any change to its assertions.
2. The requests the agent sends SHALL keep the same paths, methods, headers (`X-Agent-Version`, `traceparent`, idempotency key) and bodies, valid against the same JSON Schemas.
3. The agent SHALL keep accepting data from the server and never commands: no stream event or response SHALL start a process, send input or change anything but the agent's own state (NFR-06).
4. The read-only boundary of ADR 010 SHALL keep holding for every crate, including the new one: `cargo deny check bans`, the clippy bans and `scripts/test/agent-source-rules.test.mjs` SHALL pass.
5. The Windows adapters SHALL keep passing `node scripts/agent/win-check.mjs`.
6. The window's view model SHALL show the same states and sentences as before the migration.

**Independent Test**: `cargo nextest run --workspace` and `pnpm test:harness` pass with `core/tests/**` unchanged in `git diff`.

---

### P1: Mutation testing covers the agent's domain and application ⭐ MVP

**User Story**: As the maintainer, I want mutants of the agent's rules to be killed by unit tests alone so that the
proofs stay cheap and honest (ADR 026).

**Why P1**: NFR-10 and the F0 exit criterion on `cargo-mutants`.

**Acceptance Criteria**:

1. The nightly `agent-mutation` job SHALL run `cargo-mutants` on `d2rmm-agent-domain` and on the rule modules of `d2rmm-agent-core`, each with `-- --lib`.
2. IF a mutation workflow or configuration step runs a test that assembles the service (integration, e2e, acceptance, load) per mutant THEN `pnpm specs:check` SHALL fail.
3. `scripts/test/agent-mutation-scope.test.mjs` SHALL fail when the nightly run omits `d2rmm-agent-domain` or drops `--lib`.
4. Each mutant of a rule listed in this spec SHALL be killed by at least one unit test in the domain or application crate.
5. The rule modules of `d2rmm-agent-core` SHALL be the modules listed in `.cargo/mutants.toml` (pairing, fusion, stream, updates, observations, api client, heartbeat), which Design updates to their migrated locations.

**Independent Test**: `cargo mutants --package d2rmm-agent-domain -- --lib` reports no surviving mutant in the modules of `.cargo/mutants.toml`.

---

## Edge Cases

- IF the domain needs a time value THEN it SHALL receive it as an argument; a call to `Instant::now` SHALL fail clippy (AHM-04).
- WHEN a generated contract type changes THEN the compiler SHALL point only to files in the adapters (follows from AHM-03 and AHM-16).

---

## Requirement Traceability

| Requirement ID | Story                                                       | Phase  | Status  |
| -------------- | ----------------------------------------------------------- | ------ | ------- |
| AHM-01         | P1: The layers are real and enforced (AC 1)                 | Design | Pending |
| AHM-02         | P1: The layers are real and enforced (AC 2)                 | Design | Pending |
| AHM-03         | P1: The layers are real and enforced (AC 3)                 | Design | Pending |
| AHM-04         | P1: The layers are real and enforced (AC 6)                 | Design | Pending |
| AHM-05         | P1: The layers are real and enforced (AC 4-5)               | Design | Pending |
| AHM-06         | P1: The layers are real and enforced (AC 7)                 | Design | Pending |
| AHM-07         | P1: The rules live in the domain (AC 1)                     | Design | Pending |
| AHM-08         | P1: The rules live in the domain (AC 2)                     | Design | Pending |
| AHM-09         | P1: The rules live in the domain (AC 3)                     | Design | Pending |
| AHM-10         | P1: The rules live in the domain (AC 4)                     | Design | Pending |
| AHM-11         | P1: The rules live in the domain (AC 5)                     | Design | Pending |
| AHM-12         | P1: The rules live in the domain (AC 6)                     | Design | Pending |
| AHM-13         | P1: The rules live in the domain (AC 7)                     | Design | Pending |
| AHM-14         | P1: The rules live in the domain (AC 8-9)                   | Design | Pending |
| AHM-15         | P1: The rules live in the domain (AC 10)                    | Design | Pending |
| AHM-16         | P1: The application orchestrates through ports (AC 1-2)     | Design | Pending |
| AHM-17         | P1: The application orchestrates through ports (AC 3)       | Design | Pending |
| AHM-18         | P1: The application orchestrates through ports (AC 4)       | Design | Pending |
| AHM-19         | P1: The application orchestrates through ports (AC 5-6)     | Design | Pending |
| AHM-20         | P1: Nothing changes for the player or the server (AC 1)     | Design | Pending |
| AHM-21         | P1: Nothing changes for the player or the server (AC 2, 6)  | Design | Pending |
| AHM-22         | P1: Nothing changes for the player or the server (AC 3-5)   | Design | Pending |
| AHM-23         | P1: Mutation testing covers domain and application (AC 1)   | Design | Pending |
| AHM-24         | P1: Mutation testing covers domain and application (AC 2-3) | Design | Pending |
| AHM-25         | P1: Mutation testing covers domain and application (AC 4-5) | Design | Pending |

**Coverage:** 25 total, 0 mapped to tasks, 25 unmapped ⚠️ (mapped at Tasks)

---

## Sources

- `docs/product/prd.md#NFR-06` - the agent accepts data only, never commands; token handling unchanged → AHM-08, AHM-21, AHM-22
- `docs/product/prd.md#NFR-10` - mutation testing on domain and application, extended to the agent → AHM-01, AHM-15, AHM-23…AHM-25
- ADR 003 (hexagonal architecture) and ADR 004 (module boundaries) - the layering the backend already enforces → AHM-01…AHM-05
- ADR 010 (read-only agent) - the boundary stays whole in every crate → AHM-22
- ADR 026 (mutation on unit tests only) - the proof of every rule is a unit test → AHM-15, AHM-23…AHM-25
- ADR 027 (the desktop agent is hexagonal) - layer table, aggregates, timings as constants, ACL, enforcement → all
- `docs/engineering/testing.md` rule 2 - in-memory fakes, no mocks of what the agent owns → AHM-19
- `.specs/phases/F0/brief.md` and `.specs/phases/F0/brief-revision-2.md` - the feature row, the exit criterion, scope in/out → all
- `.specs/features/agent-skeleton/spec.md` (AGS-05…AGS-27) - the behaviour this feature preserves → AHM-07…AHM-12, AHM-20, AHM-21
- AD-071 (Windows-only adapters checked by `win-check.mjs`) → AHM-22
- AD-078…AD-080 (assumed) - `.specs/STATE.md`

---

## Success Criteria

- [ ] `pnpm test:harness`, `cargo clippy --all-targets -- -D warnings` and `cargo nextest run --workspace` are green in `apps/agent/src-tauri`, with `core/tests/**` assertions unedited.
- [ ] `cargo tree -p d2rmm-agent-domain` lists only `std`-level dependencies, `thiserror`, `chrono` and `uuid`.
- [ ] `cargo mutants -p d2rmm-agent-domain -- --lib` and `cargo mutants -p d2rmm-agent-core -- --lib` report no surviving mutant in the listed rule modules.
