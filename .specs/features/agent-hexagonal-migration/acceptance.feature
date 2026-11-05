# Acceptance scenarios for agent-hexagonal-migration (ADR 023). English Gherkin. Executed as-is by tests/acceptance
# (playwright-bdd). The acceptance runner cannot drive the Windows desktop agent, and this migration changes no
# behaviour a player or the API can see. So every requirement is proved by the agent's own tests: Rust unit tests
# (cargo nextest --lib), the unchanged integration tests under core/tests, the harness test
# scripts/test/agent-architecture.test.mjs with one failing fixture per rule, and static checks. The maintainer
# authorised these exemptions on 2026-11-01 (AD-078, same rule as agent-skeleton). Each line below names the proof.

Feature: The agent keeps its rules in a domain that cannot reach the outside
  The agent is organised as domain, application and adapters; players and the server see no difference.

  # not-scenario: AHM-01 — proved by the harness test reading the Cargo.toml of d2rmm-agent-domain: only std, thiserror, chrono and uuid; a fixture manifest with tokio fails it
  # not-scenario: AHM-02 — proved by the harness test reading the Cargo.toml of d2rmm-agent-core: it depends on the domain and on none of reqwest, tauri, keyring, windows; one fixture per crate fails it
  # not-scenario: AHM-03 — proved by the harness test scanning `use` lines of the domain and application sources for the generated contract module; a fixture file fails it
  # not-scenario: AHM-04 — proved by clippy with the domain clippy.toml in the `agent` CI job, with a fixture domain file calling Instant::now that fails it
  # not-scenario: AHM-05 — proved by the harness test failing on each forbidden manifest dependency and each forbidden `use`, naming file and rule, with one fixture per rule
  # not-scenario: AHM-06 — proved by a harness test that AGENTS.md and .cursor/rules/agent-rust.mdc contain the layer table and the direction adapters → application → domain
  # not-scenario: AHM-07 — proved by Rust unit tests of Pairing in d2rmm-agent-domain: 2 s claim, 2 unused codes stop the asking, Retry-After and the 60 minute default
  # not-scenario: AHM-08 — proved by Rust unit tests of PairedDevice: a 401 clears the token and asks a new code, a 426 marks the update required and starts an update check
  # not-scenario: AHM-09 — proved by Rust unit tests of RoomAssignment: the latest of two assignments wins
  # not-scenario: AHM-10 — proved by Rust unit tests of the retry policy: delays 1, 2, 4, 8 s and a drop after the fifth failed attempt
  # not-scenario: AHM-11 — proved by Rust unit tests of the reconnection service: 1 s, doubling to 60 s, reset after a stream open 59.999 s versus 60 s
  # not-scenario: AHM-12 — proved by Rust unit tests of the fusion service: exact match after trim and lower-case yields one observation, a distance-1 name yields none
  # not-scenario: AHM-13 — proved by Rust unit tests that pin each timing constant and that the offline threshold is three heartbeats, and by the harness test that d2rmm-agent-domain imports nothing from the contracts
  # not-scenario: AHM-14 — proved by the harness test that the domain sources and manifest use no clock, random source or environment read, and that no domain type is named Agent
  # not-scenario: AHM-15 — proved by cargo-mutants on d2rmm-agent-domain with --lib: no surviving mutant on a status code, a count or a duration boundary
  # not-scenario: AHM-16 — proved by cargo tree on d2rmm-agent-core showing no reqwest, and by Rust tests of the use cases against an in-memory gateway fake
  # not-scenario: AHM-17 — proved by Rust tests of the contract translation in the adapters, each failing when a field is dropped
  # not-scenario: AHM-18 — proved by a Rust test of the telemetry layer in the application and by the harness test that the domain manifest has no tracing or opentelemetry
  # not-scenario: AHM-19 — proved by the harness test on the app crate manifest and sources: only it builds adapters and depends on tauri, keyring and windows; the application tests use only in-memory fakes
  # not-scenario: AHM-20 — proved by running core/tests/** after each migrated aggregate and by a check that `git diff` shows no changed assertion in those files
  # not-scenario: AHM-21 (agent-side details only) — proved by the existing Rust tests that validate every request against its JSON Schema with the same paths, headers and idempotency key, and by the unchanged view-model tests
  # not-scenario: AHM-22 — proved by `cargo deny check bans`, the clippy bans, agent-source-rules.test.mjs, win-check.mjs and the unchanged stream tests that every event only updates state
  # not-scenario: AHM-23 — proved by the harness test over .github/workflows/nightly.yml: cargo-mutants runs for d2rmm-agent-domain and d2rmm-agent-core, each with `-- --lib`
  # not-scenario: AHM-24 — proved by agent-mutation-scope.test.mjs and mutation-scope-check.mjs, with a fixture workflow that omits the domain crate or drops --lib and fails both
  # not-scenario: AHM-25 — proved by the Verifier's mutations of the listed domain rules, each killed by a unit test of the domain or application crate

  @AHM-21 @api
  Scenario: The API still accepts the heartbeat the migrated agent sends
    Given "PlayerOne" has a paired agent that is online
    When the agent reports that the game is running on the automap
    Then the API answers "204"
