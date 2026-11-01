# ADR 026 — Mutation testing runs against unit tests only

**Status**: Proposed
**Date**: 2026-11-01
**Deciders**: maintainer
**Supersedes**: none (refines ADR 014)

## Context

ADR 014 adopted mutation testing on the domain, the application layer and the agent core. It did not say which tests
prove a mutation. In F0, `agent-skeleton` proved 24 of its 28 mutations with `cargo nextest run --workspace -E
'test(...)'`. The named tests live in `core/tests/*.rs`: they start a fake HTTP API (`axum`) and drive the agent
loops through it. Each mutation therefore rebuilt every crate of the workspace (the Tauri app included), re-linked 15
test binaries and ran an assembled service. 28 mutations plus 27 unmutated baselines took well over an hour and timed
out the session.

Mutation testing multiplies the cost of its test suite by the number of mutations. Only a suite that is cheap per run
can carry that multiplier. The test pyramid already says which suite that is: unit tests are many, fast and isolated;
tests that assemble the service (integration, e2e, acceptance, load) are few and slow.

## Decision

**A mutation is proved by unit tests only.** Integration, e2e, acceptance (BDD) and load tests never run once per
mutation, whatever the language.

A **unit test** exercises one module through its public interface with fakes for its ports (`FakeClock`, in-memory
stores). It starts no server, opens no socket, needs no database, container or browser, spawns no process and uses no
real time. A test that boots the service, or a route, a loop or a runtime together with a fake peer, is integration.

Per language, the proof command of a mutation must be:

| Language   | Allowed proof                                                         | Refused                                                                                                |
| ---------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Rust       | `cargo nextest run -p <crate> --lib …` (the `#[cfg(test)]` in `src/`) | `--workspace`, `--all`, `--all-targets`, `--test`, `--tests`, `--bin`, `--doc`, a missing `-p`/`--lib` |
| TypeScript | `vitest run <*.test.ts or src/ path>` on colocated unit tests         | `integration`, `e2e`, `acceptance`, `load` paths; Playwright, Testcontainers, k6, `bddgen`             |
| Harness    | `node --test <file>` under `scripts/test` or `.claude/hooks/test`     | any other `node --test` target                                                                         |

Consequences for design: a rule that today can only be observed through the assembled service (for example "a 401 on
any loop returns the agent to pairing") is extracted into a pure function or state machine in `src/` and unit-tested
there. The assembled behaviour keeps its integration test and its acceptance scenario; those prove the requirement,
not the mutation.

**Enforcement is by code**, not by memory:

- `scripts/lib/mutation-scope.mjs` classifies a proof command; `scripts/mutation-scope-check.mjs` validates every
  `.specs/features/*/mutations.json` and is part of `pnpm specs:check` (and therefore of `pnpm check` and CI).
- The PreToolUse gate refuses `mutate.py --spec <file>` and `check_proofs.py --mutations <file>` when a proof in the
  file is not a unit test, or when the spec comes from stdin. The reason names the offending mutation.
- `cargo-mutants` on the agent core is configured with `-p d2rmm-agent-core` and `--lib` for the same reason; the
  agent crate is not on `phase/F0` yet, so that configuration is a task of the `agent-skeleton` migration.
- The Verifier writes `mutations.json` under this rule; an exact-name filter (`-E 'test(name)'`) is encouraged so a
  run executes one test, not the file.

## Alternatives considered

- **Keep integration proofs and make them faster** (narrower `-p`, warm `CARGO_TARGET_DIR`, `sccache`). Cheaper to adopt
  but the cost still scales with the number of mutations and with the weight of the assembled service; it also lets a
  slow suite creep back in. Narrowing the build is kept as an optimisation _within_ the unit suite.
- **A time limit per mutation instead of a scope rule.** Treats the symptom: a mutation that times out is reported as
  killed (`yes (timeout)`), which is the wrong signal.
- **Run integration proofs nightly only.** Possible later for a separate "integration mutation" job; it is out of the
  per-feature proofs and needs its own decision.

## Consequences

- Mutation runs get an order of magnitude cheaper per mutation, so the Verifier can afford more mutations.
- Features must put their rules where unit tests can reach them. The design (`design.md`) says which module owns each
  rule; a rule with no unit-testable home is a design smell and is raised in the architecture review.
- Mutations of closed features keep passing the check (`api-web-skeleton`, `harness-foundation` already use unit proofs).
  `agent-skeleton` must be migrated before it can pass the `proofs` step: its 24 integration-backed mutations need unit
  tests (and the extraction above) or a new proof; this is feature work done through the normal task flow.
- The vendored TLC scripts (`mutate.py`, `check_proofs.py`) are unchanged: the rule lives in the project harness
  (the gate, `scripts/` and `specs:check`).
- Revisit when F0 closes: if the unit-only mutation score hides regressions that only integration shows, add an
  integration mutation job as a separate decision.
