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

## Features

| Feature            | Size    | Depends on                       | Parallel              | Covers                                                                                          | Wall-clock |
| ------------------ | ------- | -------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------- | ---------- |
| harness-foundation | Large   | —                                | no (first)            | NFR-10, NFR-11, ADR 001/003/004/014/019/020/021                                                 | default    |
| api-web-skeleton   | Large   | harness-foundation               | with agent-skeleton   | FR-01 (stub), FR-03, FR-05, NFR-01, NFR-07, NFR-08, NFR-12, ADR 002/005/006/007/008/009/012/017 | default    |
| agent-skeleton     | Complex | harness-foundation               | with api-web-skeleton | FR-03, FR-05, FR-27 (fixture), FR-29, NFR-04, NFR-06, ADR 010/011/015/016                       | 10 h       |
| observability-e2e  | Large   | api-web-skeleton, agent-skeleton | no                    | NFR-09, ADR 013                                                                                 | default    |
| load-baseline      | Large   | observability-e2e                | no                    | NFR-01, NFR-14                                                                                  | default    |

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

## Runner state

<!-- generated by `pnpm phase:status --write` from files, git trailers and the retry ledger — do not edit -->

**Phase next step**: awaiting-approval

| Feature            | Next step | Status                                      | Tasks |
| ------------------ | --------- | ------------------------------------------- | ----- |
| harness-foundation | specify   | ready                                       | 0/0   |
| api-web-skeleton   | specify   | waiting on harness-foundation               | 0/0   |
| agent-skeleton     | specify   | waiting on harness-foundation               | 0/0   |
| observability-e2e  | specify   | waiting on api-web-skeleton, agent-skeleton | 0/0   |
| load-baseline      | specify   | waiting on observability-e2e                | 0/0   |
