# ADR 027 — The desktop agent is hexagonal, like the Agents context of the backend

**Status**: Accepted
**Date**: 2026-11-01 (accepted 2026-11-01 by the maintainer: "aprovado")
**Deciders**: maintainer
**Supersedes**: none (extends ADR 003 to the Rust agent; builds on ADR 010 and ADR 026)

## Context

The desktop agent is the field-acting incarnation of the **Agents** bounded context (`docs/domain/contexts.md`): pairing,
token, presence, version, and delivery of the assignment to the device. Were it part of the backend, it would live inside
`apps/api/src/modules/agents` as `domain / application / adapters`, behind a public port. The backend enforces that layout
with dependency-cruiser (ADR 003, ADR 004). The agent has no equivalent.

What F0 produced in `apps/agent/src-tauri/core`:

- The async loops (`pairing::show_code`, `stream::run`, `observations::send`) mix scheduling, I/O and rules in one body.
  ADR 026 forced the rules out into pure functions, one at a time, to make them unit-testable.
- `Context` holds the ports, the HTTP client, the signals between loops, the view and the counters. Every loop reaches
  everything through it.
- `core` depends on `reqwest` directly and on the generated contract types (`contracts/generated.rs`) everywhere. A contract
  change reaches every rule.
- Nothing enforces a boundary inside the crate. `scripts/test/agent-source-rules.test.mjs` pins only the ADR 010 ban lists.
- The agent's `Agent`-like concepts have no name of their own: the backend's `Agent` holds `tokenHash`, `claimSecretHash`
  and `revokedAt`; the device holds the token in clear in the OS credential store. Same concept, other side of the wire.

The maintainer's reading (2026-11-01, `.specs/phases/F0/decisions.md`): the agent follows the backend's hexagonal layout,
its aggregates are isolated with their rules decoupled and unit-testable, and ports and adapters simulate "being inside the
context".

## Decision

**The agent is organised in the same three layers as a backend module, with the same direction of dependency:
`adapters → application → domain`.** Nothing points the other way.

| Layer         | Holds                                                                                                                   | May depend on                                              | Must not depend on                                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `domain`      | aggregates, value objects, domain services, domain events, domain constants, pure rules and their errors                | `std`, `thiserror`, `chrono` types, `uuid` types           | `tokio`, `reqwest`, `tauri`, `keyring`, `windows`, `std::time::Instant`, `serde_json`, the generated contracts, `application`, `adapters` |
| `application` | use cases (pair, beat, follow the stream, post an observation, check for an update), ports (traits), loop orchestration | `domain`                                                   | `adapters`, `reqwest`, `tauri`, `keyring`, `windows`, the generated contracts                                                             |
| `adapters`    | reqwest gateway, Credential Manager, toolhelp, Windows OCR, Tauri updater and window, contract translation (ACL)        | `application`, `domain`, third-party SDKs, generated types | each other                                                                                                                                |

Rules:

1. **Aggregates in the domain.** Candidates, to be confirmed in the design of the first migration feature: `PairedDevice`
   (the pairing state, the token's presence, the 401/426 consequences), `Pairing` (a code, its expiry, the unused count and
   the pause), `RoomAssignment`, and the observation retry policy. Stream reconnection and fusion of reads are domain
   services. A domain object has no clock, no randomness and no I/O: time and ids are passed in (`WallClock`, `IdGenerator`).
2. **The domain has its own names.** The device's concept is `PairedDevice`, not `Agent`, so it is never mistaken for the
   backend's aggregate that models the same thing from the server side.
3. **Anti-corruption layer.** The generated contract types stay in `contracts/` and `adapters/`. Adapters translate between
   them and domain types. The domain never imports `contracts::generated`.
4. **Timings are domain constants.** The 15 s heartbeat, the 45 s offline threshold, the 2 s claim interval, the code format
   and the retry/backoff schedules are constants of the domain. They are agreed with the server by convention and by
   acceptance tests, not read from the contract.
5. **Ports belong to the application layer** (as `TokenStore`, `ProcessSource`, `TextReader`, `UpdateChecker`,
   `IdGenerator`, `WallClock`, `StateSink` do today), with the new ones the migration needs (an API gateway port replacing the
   direct `reqwest` use in `core`). Fakes are in-memory (ADR 026, `docs/engineering/testing.md` rule 2).
6. **The Tauri app crate is the composition root,** the equivalent of `main/` in the backend: it builds the adapters and
   hands them to the application. Only it knows `tauri`, `keyring` and `windows`.
7. **Telemetry spans live in the application layer;** the domain emits no spans.

**Enforcement is by code**, the same way the backend's is:

- **Cargo crate boundaries decide the dependency direction.** The domain becomes its own crate (`d2rmm-agent-domain`) with
  the dependencies in the table and nothing else, so `tokio`, `reqwest` or `tauri` cannot be imported from it. The
  application keeps living in `d2rmm-agent-core`, which depends on the domain only. Adapters stay in the app crate.
- A harness test (`scripts/test/agent-architecture.test.mjs`) reads each crate's `Cargo.toml` and source tree and fails on any
  forbidden dependency or `use` from the table, with a fixture per rule that must fail (the pattern of
  `agent-source-rules.test.mjs` and `arch-fixtures.test.mjs`).
- `clippy.toml` gains the disallowed types for the domain crate (`std::time::Instant`, `SystemTime::now`).
- `cargo-mutants` runs on `d2rmm-agent-domain` and `d2rmm-agent-core` under ADR 026: unit tests only, `--lib`.
- The rule goes into `AGENTS.md` (repository map and inviolable rules) and `.cursor/rules/agent-rust.mdc`, so the models are
  told the layout and the gate refuses what breaks it.

## Alternatives considered

- **Modules inside one `core` crate plus a lint/test for imports.** Closer to the backend's folders, cheaper to migrate, but the
  boundary is a convention checked after the fact; the compiler would accept `use tokio::…` in `domain/`. A crate boundary makes
  the violation impossible rather than detectable.
- **Leave the loops as they are and keep extracting pure functions (ADR 026 only).** It keeps the tests unit-level but leaves
  the god object and the contract coupling, and the next feature (vision, capture) would add to both.
- **A shared Rust domain crate used by both the agent and the API.** The API is TypeScript; there is nothing to share, and the
  two sides model the same facts differently on purpose (rule 2).
- **Read the timings from the contract (remote config).** Rejected by the maintainer: they are domain constants.

## Consequences

- Rules stay testable by unit tests and survive mutation testing without service assembly; the ADR 026 residual risk (wiring in
  an async loop that no unit test reaches) shrinks to a thin use-case body.
- A new crate, a new harness test and a migration of `core` (in steps, behaviour-preserving, one aggregate per step). Each step
  keeps the integration tests untouched and green.
- The generated contract types stop leaking: a contract change touches the adapters and the translation only.
- `reqwest` leaves `core`. The HTTP gateway becomes an adapter behind an application port; where it lives (the app crate, or a
  new `d2rmm-agent-adapters` crate if the app crate grows) is decided in the first migration feature.
- Revisit when F2 starts (vision and capture): they add sensors and a fusion domain service, and show whether the layer table
  holds.

## Open points after acceptance

1. Domain as a separate crate: **settled** by the Decision section (`d2rmm-agent-domain`), as approved.
2. Where the HTTP adapter lives (the app crate, or a new `d2rmm-agent-adapters` crate): decided in the design of the first
   migration feature.
3. Which phase carries the migration: decided in the brief of that phase (`/phase-kickoff`).
