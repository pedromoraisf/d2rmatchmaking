# Phase F0 — Walking skeleton

**Goal**: the thinnest slice through every layer and environment — "a test room becomes Created" — with the three
pipelines, telemetry and the harness live, before any real feature.
**Roadmap**: .specs/phases/ROADMAP.md#f0
**Status**: DRAFT — questions answered and delegation chosen by the maintainer (2026-10-30); waiting for the approval line

## Exit criteria

From Design Doc § Walking skeleton. Every item needs a proof in the phase review.

- [ ] Monorepo with `apps/web`, `apps/api`, `apps/agent`, `packages/contracts`, `telemetry`, `config` builds in CI — proof: `ci.yml` run
- [ ] The five API modules exist with three layers; dependency-cruiser fails on a deliberate violation kept as a test — proof: `pnpm arch` + fixture test
- [ ] Web on Cloudflare Pages with PR previews — proof: preview URL on a PR
- [ ] API on Render from `main/render.ts`, Neon migration before deploy, `GET /healthz` — proof: `deploy-api.yml` run + smoke
- [ ] Agent `v0.0.1` released by tauri-action; once installed it self-updates to `v0.0.2` — proof: release pages + maintainer's Windows check
- [ ] Site download button points to the latest release without redeploy — proof: link resolves to `D2RMatchMaking-setup.exe`
- [ ] Pairing by code and heartbeat end to end — proof: e2e test + trace
- [ ] One trace: site click → API → Postgres → outbox → SSE; agent spans linked by `traceparent` — proof: Grafana trace link
- [ ] At least one test per pyramid level in CI, and a domain mutation report — proof: CI artifacts
- [ ] Claude Code gate/feedback/stop hooks active; Lefthook installed — proof: `pnpm test:harness`, hook logs
- [ ] `harness-score --min-level 4` green in CI — proof: CI step
- [ ] Daily Postgres backup workflow — proof: `nightly.yml` run with an object in R2
- [ ] Session cookie through the Pages Function proxy, SSE included (ADR 012) — proof: e2e on the preview
- [ ] Load test of the main journey passes ≥ 100 concurrent players and publishes max players/rooms and bytes per player-hour — proof: k6 summary in `reports/load/`
- [ ] `.quality-baseline.json` has first real values for harness, mutation (domain), CI time and load — proof: ratchet `--update` diff
- [ ] The agent core follows ADR 027: the domain crate has no I/O dependency (an architecture test fails on a deliberate violation kept as a fixture), the generated contract types do not reach the domain, and mutation testing runs on the domain and application of the agent with unit tests only (ADR 026) — proof: `pnpm test:harness` + the cargo-mutants report

## Features

| Feature                   | Size    | Depends on                                                  | Parallel              | Covers                                                                                          | Wall-clock |
| ------------------------- | ------- | ----------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------- | ---------- |
| harness-foundation        | Large   | —                                                           | no (first)            | NFR-10, NFR-11, ADR 001/003/004/014/019/020/021                                                 | default    |
| api-web-skeleton          | Large   | harness-foundation                                          | with agent-skeleton   | FR-01 (stub), FR-03, FR-05, NFR-01, NFR-07, NFR-08, NFR-12, ADR 002/005/006/007/008/009/012/017 | default    |
| agent-skeleton            | Complex | harness-foundation                                          | with api-web-skeleton | FR-03, FR-05, FR-27 (fixture), FR-29, NFR-04, NFR-06, ADR 010/011/015/016                       | 10 h       |
| agent-hexagonal-migration | Complex | agent-skeleton                                              | no                    | NFR-06, NFR-10, ADR 010/026/027                                                                 | 10 h       |
| observability-e2e         | Large   | api-web-skeleton, agent-skeleton, agent-hexagonal-migration | no                    | NFR-09, ADR 013                                                                                 | default    |
| load-baseline             | Large   | observability-e2e                                           | no                    | NFR-01, NFR-14                                                                                  | default    |
| ci-and-review-fixes       | Small   | load-baseline                                               | no                    | NFR-10, NFR-11, ADR 020/021/023/026                                                             | default    |
| site-stale-read-fix       | Small   | ci-and-review-fixes                                         | no                    | NFR-01, ADR 007                                                                                 | default    |

Retry budget is fixed for every feature: 1 attempt + 2 retries per unit (ADR 022); a brief cannot raise it.

Every feature ships an English `acceptance.feature` covering each requirement ID (ADR 023). Seed for the walking
skeleton's journey (the runner refines it in `api-web-skeleton`'s Specify, with that spec's requirement IDs):

```gherkin
Feature: A test room becomes Created
  The walking skeleton proves web, API, agent, outbox and SSE end to end.

  Background:
    Given "Player One" is signed in on the site
    And "Player One" has a paired agent that is online

  Scenario: The host's agent sees the expected game name
    Given a test match is formed with "Player One" as host
    And the site shows the room as "Awaiting host"
    When the agent reports the game name of the room
    Then the site shows the room as "Created" within 2 seconds
    And the trace links the site, the API, the outbox and the agent
```

What the pre-foundation already delivered (do not redo; extend): AGENTS.md/CLAUDE.md, scoped rules, hooks + tests,
phase-runner skill, reviewer/verifier/worker subagents, commands, dependency-cruiser rules, Lefthook, CI + nightly
workflows, quality baseline + ratchet, specs-check, ADRs 001–021, domain and engineering docs.

`harness-foundation` therefore covers: installing Playwright browsers and running a first `bddgen` against a sample feature (ADR 023), the first `pnpm install` (the pre-foundation was written without registry access, so no lockfile and no ESLint/Prettier run yet), `pnpm format` + `pnpm lint` fixes across the harness files, committing `pnpm-lock.yaml`, `packages/config` presets, empty workspaces for the
three apps and three packages, the five modules × three layers with a deliberate-violation fixture, Vitest + Stryker
configs, release-please config, first green CI on GitHub, and the first measured baseline values.

## Scope notes

- In: only what the exit criteria need. The staging-only endpoint that simulates `MatchFormed` is the single fake.
- Out: real Battle.net login beyond a stub flow if the OAuth app is not ready (see Q2), real matchmaking, ranking, UI polish.
- Revision 2 (2026-11-01, ADR 027): `agent-hexagonal-migration` migrates the agent core to the hexagonal layout before
  `observability-e2e`. In: a behaviour-preserving migration (domain crate, application layer, adapters, anti-corruption
  layer, architecture test, mutation on domain and application with unit tests only). Out: new agent behaviour,
  vision/capture, contract or API changes. Details: `.specs/phases/F0/brief-revision-2.md`.
- Revision 3 (2026-11-04, from the F0 review): `ci-and-review-fixes` fixes three harness defects before `phase/F0` is
  pushed. In: acceptance builds the site it needs, `mutation.agent.core` becomes measurable locally and in the nightly,
  and the review stops re-running `validate_verification.py` on the phase branch. Out: product behaviour, and the other
  risks listed in `review.md`. Details: `.specs/phases/F0/brief-revision-3.md`.
- Revision 4 (2026-11-05, from the first GitHub runs): `site-stale-read-fix` stops a read in flight from undoing a stage
  the stream delivered. In: the site's re-read and its tests. Out: API, contract and stream changes, and overlapping
  reads with no event involved. Details: `.specs/phases/F0/brief-revision-4.md`.

## Open questions (answered by the maintainer on 2026-10-30)

1. **GitHub repository** — **Answer**: `pedromoraisf/d2rmatchmaking`, public from the first push (done; rulesets in
   `.github/rulesets/` imported).
2. **External accounts and secrets** — **Answer**: on demand. The maintainer creates each account and secret when a
   feature needs it; the runner raises it as an escalation listing the exact secret names (agents never create
   secrets). `harness-foundation` needs none.
3. **Staging** — **Answer**: Neon branch `staging` + Cloudflare Pages previews per PR + a single Render service; the
   simulate-`MatchFormed` endpoint exists only when `ENABLE_STAGING_ENDPOINTS=true` (off in production after F0).
4. **Windows validation of the updater** — **Answer**: the maintainer's Windows PC, as a checklist item in the phase
   review (install `v0.0.1`, confirm the self-update to `v0.0.2`).

## Delegation

Tick what you delegate. Unticked items are asked during the run. Chosen by the maintainer on 2026-10-30: all four
scopes delegated — the maintainer reviews at the end of the phase (escalations still interrupt).

- [x] specs-and-tasks: approve each feature's spec.md and tasks.md once they pass the automatic gates
- [x] sub-agents: dispatch feature workers (worktrees), the Verifier and the reviewer subagents
- [x] harness-edits: edit sensor/harness configuration to tighten or extend it (hooks and settings.json still ask)
- [x] local-merge-phase-branch: merge green feature branches into phase/F0 locally (never push)

## Approval

<!-- The maintainer writes or dictates this line. The agent never fills it in on its own. Example:
**Approved**: 2026-11-02 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch"
-->

**Approved**: 2026-10-30 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch"

**Approved**: 2026-11-01 - user: "aprovo a revisão 2 do brief da F0"

**Approved**: 2026-11-04 - user: "aprovo a revisão 3 do brief da F0"

**Approved**: 2026-11-05 - user: "Pelo fluxo da fase"

## Runner state

<!-- generated by `pnpm phase:status --write` from files, git trailers and the retry ledger — do not edit -->

**Phase next step**: awaiting-review

| Feature                   | Next step | Status | Tasks |
| ------------------------- | --------- | ------ | ----- |
| harness-foundation        | done      | done   | 22/22 |
| api-web-skeleton          | done      | done   | 53/53 |
| agent-skeleton            | done      | done   | 33/33 |
| agent-hexagonal-migration | done      | done   | 58/58 |
| observability-e2e         | done      | done   | 56/56 |
| load-baseline             | done      | done   | 43/43 |
| ci-and-review-fixes       | done      | done   | 13/13 |
| site-stale-read-fix       | done      | done   | 2/2   |
