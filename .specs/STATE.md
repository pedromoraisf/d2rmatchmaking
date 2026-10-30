# STATE

## Decisions

AD-001…AD-024 mirror the accepted ADRs in `docs/adr/` (one line each; the ADR is the full record). New project-level decisions continue at AD-025. Decisions the phase runner takes on its own carry `(assumed)` on the heading and are queued in `.specs/phases/<F>/decisions.md` until the phase review.

### AD-001
- **Decision**: One public repository (MIT) with pnpm workspaces and Turborepo: `apps/web`, `apps/api`, `apps/agent`, `packages/contracts`, `packages/telemetry`, `packages/config`.
- **Reason**: see [ADR 001](../docs/adr/001-public-monorepo.md) — Public monorepo
- **Trade-off**: see ADR 001 § Consequences
- **Scope**: project
- **Date**: 2026-10-30
- **Status**: active

### AD-002
- **Decision**: One deployable API with five modules.
- **Reason**: see [ADR 002](../docs/adr/002-modular-monolith.md) — Modular monolith
- **Trade-off**: see ADR 002 § Consequences
- **Scope**: project
- **Date**: 2026-10-30
- **Status**: active

### AD-003
- **Decision**: Three layers per module (`domain`, `application`, `adapters`) plus a global composition layer `main/` per provider (`main/local.ts`, `main/render.ts`).
- **Reason**: see [ADR 003](../docs/adr/003-layers.md) — Layers: domain, application, adapters, main
- **Trade-off**: see ADR 003 § Consequences
- **Scope**: project
- **Date**: 2026-10-30
- **Status**: active

### AD-004
- **Decision**: `.dependency-cruiser.cjs` encodes the layer and module rules and runs on edit (Claude Code PostToolUse hook), in pre-commit (Lefthook) and in CI.
- **Reason**: see [ADR 004](../docs/adr/004-dependency-rules.md) — Dependency rules as a sensor
- **Trade-off**: see ADR 004 § Consequences
- **Scope**: project
- **Date**: 2026-10-30
- **Status**: active

### AD-005
- **Decision**: Web on Cloudflare Pages, API on Render free web service, Postgres on Neon free, prints on Cloudflare R2, CI and releases on GitHub.
- **Reason**: see [ADR 005](../docs/adr/005-hosting.md) — Hosting: Cloudflare Pages, Render free, Neon free
- **Trade-off**: see ADR 005 § Consequences
- **Scope**: project
- **Date**: 2026-10-30
- **Status**: active

### AD-006
- **Decision**: Keep them in memory behind ports (`QueueStore`, `ReadyCheckStore`, `PresenceStore`, `EventBus`).
- **Reason**: see [ADR 006](../docs/adr/006-no-redis.md) — No Redis in the MVP
- **Trade-off**: see ADR 006 § Consequences
- **Scope**: project
- **Date**: 2026-10-30
- **Status**: active

### AD-007
- **Decision**: One SSE stream per client at `GET /v1/stream` with `Last-Event-ID` resume and a 25 s keep-alive.
- **Reason**: see [ADR 007](../docs/adr/007-sse.md) — Server-Sent Events for push
- **Trade-off**: see ADR 007 § Consequences
- **Scope**: project
- **Date**: 2026-10-30
- **Status**: active

### AD-008
- **Decision**: Events are written to an outbox table in the same transaction as the state change and relayed by an in-process worker to the EventBus and SSE.
- **Reason**: see [ADR 008](../docs/adr/008-outbox.md) — Transactional outbox
- **Trade-off**: see ADR 008 § Consequences
- **Scope**: project
- **Date**: 2026-10-30
- **Status**: active

### AD-009
- **Decision**: Zod 4 schemas in `packages/contracts` are the single source; JSON Schema is generated and turned into Rust types with `typify`.
- **Reason**: see [ADR 009](../docs/adr/009-shared-contracts.md) — Shared contracts from Zod
- **Trade-off**: see ADR 009 § Consequences
- **Scope**: project
- **Date**: 2026-10-30
- **Status**: active

### AD-010
- **Decision**: Window capture cascade (windows-capture), Windows OCR, image processing and OS signals only.
- **Reason**: see [ADR 010](../docs/adr/010-read-only-agent.md) — The desktop agent only reads pixels and OS signals
- **Trade-off**: see ADR 010 § Consequences
- **Scope**: project
- **Date**: 2026-10-30
- **Status**: active

### AD-011
- **Decision**: The agent shows a 6-digit code; the logged-in user types it on the site.
- **Reason**: see [ADR 011](../docs/adr/011-agent-auth.md) — Agent authentication by pairing code
- **Trade-off**: see ADR 011 § Consequences
- **Scope**: project
- **Date**: 2026-10-30
- **Status**: active

### AD-012
- **Decision**: MVP: the site calls the API at same-origin `/api/*`; a Cloudflare Pages Function proxies to Render, so the cookie is first-party.
- **Reason**: see [ADR 012](../docs/adr/012-session-cookie.md) — Same-site session through the Pages proxy
- **Trade-off**: see ADR 012 § Consequences
- **Scope**: project
- **Date**: 2026-10-30
- **Status**: active

### AD-013
- **Decision**: OpenTelemetry in web, API and agent; OTLP to Grafana Cloud free for the MVP, configured only in `main/`.
- **Reason**: see [ADR 013](../docs/adr/013-observability.md) — OpenTelemetry to a swappable backend
- **Trade-off**: see ADR 013 § Consequences
- **Scope**: project
- **Date**: 2026-10-30
- **Status**: active

### AD-014
- **Decision**: Unit → integration (Testcontainers) → contract → e2e (Playwright) → load (k6).
- **Reason**: see [ADR 014](../docs/adr/014-testing-and-mutation.md) — Test pyramid with mutation testing
- **Trade-off**: see ADR 014 § Consequences
- **Scope**: project
- **Date**: 2026-10-30
- **Status**: active

### AD-015
- **Decision**: release-please keeps a release PR from Conventional Commits; merging tags `agent-v*`; tauri-action builds on `windows-latest`, signs the updater artifact, publishes `latest.json` and a fixed-name installer `D2RMatchMaking-setup.exe` to GitHub Releases.
- **Reason**: see [ADR 015](../docs/adr/015-agent-release.md) — Agent release pipeline
- **Trade-off**: see ADR 015 § Consequences
- **Scope**: project
- **Date**: 2026-10-30
- **Status**: active

### AD-016
- **Decision**: Apply to the SignPath Foundation programme (free for OSI-licensed projects); the repository is MIT.
- **Reason**: see [ADR 016](../docs/adr/016-windows-signing.md) — Windows code signing via SignPath Foundation
- **Trade-off**: see ADR 016 § Consequences
- **Scope**: project
- **Date**: 2026-10-30
- **Status**: active

### AD-017
- **Decision**: `mm{activity}{difficulty}-{n}` (e.g.
- **Reason**: see [ADR 017](../docs/adr/017-game-name.md) — Game name pattern
- **Trade-off**: see ADR 017 § Consequences
- **Scope**: project
- **Date**: 2026-10-30
- **Status**: active

### AD-018
- **Decision**: Rating per character × difficulty × season, classic ELO with K = 32, only from double-confirmed results.
- **Reason**: see [ADR 018](../docs/adr/018-elo-per-difficulty.md) — ELO per character and difficulty
- **Trade-off**: see ADR 018 § Consequences
- **Scope**: project
- **Date**: 2026-10-30
- **Status**: active

### AD-019
- **Decision**: `AGENTS.md` canonical (CLAUDE.md imports it), scoped Cursor rules, Claude Code hooks (gate on PreToolUse, feedback on PostToolUse, stop on Stop) with committed scripts, Lefthook pre-commit/pre-push, CI sensors, and `harness-score --min-level 4` in CI.
- **Reason**: see [ADR 019](../docs/adr/019-harness-l4.md) — Agentic harness at L4
- **Trade-off**: see ADR 019 § Consequences
- **Scope**: project
- **Date**: 2026-10-30
- **Status**: active

### AD-020
- **Decision**: OpenAPI 3.1 generated from Zod and Fastify (`@fastify/swagger` with the Zod type provider), committed at `packages/contracts/openapi.json`, served at `/docs` outside production; SSE events in AsyncAPI next to it.
- **Reason**: see [ADR 020](../docs/adr/020-openapi-generated.md) — OpenAPI generated from contracts
- **Trade-off**: see ADR 020 § Consequences
- **Scope**: project
- **Date**: 2026-10-30
- **Status**: active

### AD-021
- **Decision**: The project skill `d2rmm-phase-runner` wraps TLC.
- **Reason**: see [ADR 021](../docs/adr/021-automated-phase-delivery.md) — Automated per-phase delivery
- **Trade-off**: see ADR 021 § Consequences
- **Scope**: project
- **Date**: 2026-10-30
- **Status**: active

### AD-022
- **Decision**: Every unit of agentic work gets one attempt plus at most 2 retries; the third failure blocks it, enforced by hooks and `scripts/attempt.mjs`.
- **Reason**: see [ADR 022](../docs/adr/022-retry-budget.md) — Retry budget: one attempt plus two retries, enforced by code
- **Trade-off**: see ADR 022 § Consequences
- **Scope**: project
- **Date**: 2026-10-30
- **Status**: active

### AD-023
- **Decision**: Acceptance scenarios are English Gherkin in `.specs/features/<feature>/acceptance.feature`, tagged with requirement IDs and executed as-is by playwright-bdd.
- **Reason**: see [ADR 023](../docs/adr/023-bdd-acceptance.md) — BDD acceptance tests: Gherkin in the spec, executed by playwright-bdd
- **Trade-off**: see ADR 023 § Consequences
- **Scope**: project
- **Date**: 2026-10-30
- **Status**: active

### AD-024
- **Decision**: Phase and feature state are derived by `scripts/phase-status.mjs` from .specs files, git commit trailers and the retry ledger; the roadmap assigns every requirement to one phase.
- **Reason**: see [ADR 024](../docs/adr/024-deterministic-phase-state.md) — Deterministic phase state and idempotent resume
- **Trade-off**: see ADR 024 § Consequences
- **Scope**: project
- **Date**: 2026-10-30
- **Status**: active

## Handoff

- **Feature**: none — pre-foundation committed; phase F0 brief drafted, awaiting the maintainer's approval
- **Phase / Task**: F0 kickoff
- **Completed**: pre-foundation (harness, docs, ADRs, specs scaffolding)
- **In-progress**: none
- **Next step**: maintainer answers the F0 brief's open questions and approves it with delegation; then `/phase-run F0`
- **Blockers**: none
- **Uncommitted files**: none
- **Branch**: main
