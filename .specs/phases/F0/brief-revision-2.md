# Phase F0 — Brief revision 2 (proposal)

**Status**: APPLIED to `brief.md` on 2026-11-01. Approved by the maintainer: "aprovo a revisão 2 do brief da F0".
**Why**: ADR 027 (Accepted 2026-11-01) makes the desktop agent hexagonal. The maintainer chose to carry the migration in
F0, before `observability-e2e`, so the observability work instruments the agent once, on the final layout
(decisions.md, "agent architecture (hexagonal)"; answer "opção 1").

When approved, the orchestrator applies the three changes below to `brief.md` and quotes the approval words in the
revision's `**Approved**` line. Until then the F0 brief keeps its current features.

## 1. New exit criterion

- [ ] The agent core follows ADR 027: the domain crate has no I/O dependency (an architecture test fails on a deliberate
      violation kept as a fixture), the generated contract types do not reach the domain, and mutation testing runs on the
      domain and application of the agent with unit tests only (ADR 026) — proof: `pnpm test:harness` + the cargo-mutants
      report

## 2. New feature row

| Feature                   | Size    | Depends on     | Parallel | Covers                          | Wall-clock |
| ------------------------- | ------- | -------------- | -------- | ------------------------------- | ---------- |
| agent-hexagonal-migration | Complex | agent-skeleton | no       | NFR-06, NFR-10, ADR 010/026/027 | 10 h       |

And `observability-e2e` now depends on: `api-web-skeleton`, `agent-skeleton`, `agent-hexagonal-migration`.

`NFR-06` (the agent accepts data only, never commands) is preserved by the migration, not changed; `NFR-10` (mutation
testing on domain and application) is extended to the agent. Both stay primary in F0 in `ROADMAP.md`; no row moves.

## 3. Scope of the feature (sketch for its Specify; the runner writes the requirement IDs)

In (behaviour-preserving; the integration tests of `core/tests/*` stay untouched and green):

1. The structure of ADR 027: a `d2rmm-agent-domain` crate, `d2rmm-agent-core` as the application layer, adapters in the
   app crate; the architecture test (`scripts/test/agent-architecture.test.mjs`) with one fixture per rule; the
   `clippy.toml` entries for the domain; the rule in `AGENTS.md` and `.cursor/rules/agent-rust.mdc`.
2. The aggregates, one step each, with their rules moved from the loops and unit-tested: `Pairing`, `PairedDevice`,
   `RoomAssignment`, the observation retry policy; stream reconnection and fusion as domain services. Timings are domain
   constants.
3. The anti-corruption layer: the generated contract types stay in `contracts/` and the adapters; `reqwest` leaves `core`
   behind an API gateway port (where the HTTP adapter lives is decided in the feature's Design).
4. `cargo-mutants` on `d2rmm-agent-domain` and `d2rmm-agent-core`, `--lib` only (ADR 026); the nightly job and its harness
   test updated.

Out: any new agent behaviour, vision/capture (F2), changes to the contract or the API.

Risks to confirm in Design: (a) the per-step cost, since each step rebuilds the Tauri crate; the unit-only mutation scope
keeps the proofs cheap; (b) `Context` is split in the same steps, not in one big change; (c) the Windows-only adapters keep
being checked with `node scripts/agent/win-check.mjs` (AD-071).

## Approval

<!-- The maintainer writes or dictates this line. The agent never fills it in on its own. -->
