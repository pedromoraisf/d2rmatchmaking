# STATE

## Decisions

AD-001…AD-025 mirror the accepted ADRs in `docs/adr/` (one line each; the ADR is the full record). New project-level decisions continue at AD-026. Decisions the phase runner takes on its own carry `(assumed)` on the heading and are queued in `.specs/phases/<F>/decisions.md` until the phase review.

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

### AD-025

- **Decision**: The orchestrator (Opus 5.5, medium) plans and gates; Haiku `feature-worker`s implement task batches in parallel; Sonnet reviewers and Verifier judge — enforced by the gate through `scripts/lib/model-policy.mjs`.
- **Reason**: see [ADR 025](../docs/adr/025-agent-roles-and-models.md) — Agent roles and models
- **Trade-off**: see ADR 025 § Consequences
- **Scope**: project
- **Date**: 2026-10-30
- **Status**: active

### AD-026 (assumed)

- **Decision**: In F0 `apps/agent` is the TypeScript UI workspace only; `apps/agent/src-tauri` (Rust) is created by `agent-skeleton`.
- **Reason**: harness-foundation creates "empty workspaces"; `ci.yml` turns the Rust job on when `apps/agent/src-tauri/Cargo.toml` exists, and an empty crate would only add a job with nothing to check.
- **Trade-off**: the Rust job stays skipped until `agent-skeleton`; reversal is adding the crate earlier.
- **Scope**: harness-foundation
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-027 (assumed)

- **Decision**: harness-foundation writes the shared kernel (`Result`, `Clock` + `FakeClock`, `IdGenerator` + fake) with unit tests, and the domain Stryker run mutates `src/modules/*/domain/**` plus `src/shared-kernel/**`.
- **Reason**: the F0 exit criterion asks for a domain mutation report; with no code Stryker reports no score. The shared kernel is pure like the domain (rule `shared-kernel-is-leaf`) and AGENTS.md already lists its contents.
- **Trade-off**: the `mutation.api.domain` metric also counts shared-kernel mutants; reversal is narrowing the Stryker `mutate` glob.
- **Scope**: harness-foundation / apps/api
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-028 (assumed)

- **Decision**: harness-foundation ships only `release-please-config.json` and `.release-please-manifest.json` (package `apps/agent`, component `agent`, tags `agent-v*`, version `0.0.0`); the `release-please.yml` workflow comes with `agent-skeleton`.
- **Reason**: ADR 015 releases only the agent; the workflow creates tags on `main`, which belongs with the release pipeline it feeds.
- **Trade-off**: none user-visible; reversal is moving the workflow between features.
- **Scope**: harness-foundation
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-029 (assumed)

- **Decision**: In F0 a player signs in with a test sign-in (`POST /v1/auth/test-login`, display name) that exists only while `ENABLE_STAGING_ENDPOINTS=true`; Battle.net OAuth comes in F1.
- **Reason**: api-web-skeleton AWS-01: FR-01's primary phase is F1 and the brief scopes F0 to a stub; staging-only adds no production-visible behaviour.
- **Trade-off**: none in production; reversal is deleting the route when OAuth lands.
- **Scope**: api-web-skeleton / identity
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-030 (assumed)

- **Decision**: The agent gets its token by polling `POST /v1/agents/pairing-codes/claim` with a one-time `claimSecret` returned with the code; the token is returned once and stored as a SHA-256 hash.
- **Reason**: api-web-skeleton AWS-07: ADR 011 does not say how the token reaches the agent, which has no session or stream before pairing.
- **Trade-off**: a few polling requests during pairing; reversal is a contract change shared with agent-skeleton.
- **Scope**: api-web-skeleton, agent-skeleton / agents
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-031 (assumed)

- **Decision**: The agent sends a heartbeat every 15 s and the API shows it offline after 45 s without one; both are constants in one place.
- **Reason**: api-web-skeleton AWS-13/AWS-15: the PRD sets no number; three missed beats tolerate one lost request and keep Render bandwidth low.
- **Trade-off**: presence lags up to 45 s on a crash; reversal is changing the constants.
- **Scope**: api-web-skeleton, agent-skeleton / agents
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-032 (assumed)

- **Decision**: Pairing accepts at most 10 code submissions per account per 5 minutes; the 11th answers 429.
- **Reason**: api-web-skeleton AWS-09: a 6-digit code valid 5 minutes needs a brute-force cap; stricter on safety and invisible to an honest player.
- **Trade-off**: a player who mistypes 10 times waits up to 5 minutes; reversal is a constant.
- **Scope**: api-web-skeleton / agents
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-033 (assumed)

- **Decision**: The staging `match-formed` endpoint forms a one-member Leveling Baal match in Hell with the caller as host; its room name is `mmbaalh-<n>` (ADR 017).
- **Reason**: api-web-skeleton AWS-19: Q3 names the endpoint but not the match; one member is the smallest match that exercises the host path.
- **Trade-off**: staging-only; reversal is a parameter on the endpoint.
- **Scope**: api-web-skeleton / lobby-room
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-034 (assumed)

- **Decision**: A `GAME_NAME_SEEN` observation matches when its value equals the expected room name after trimming and lower-casing; confidence is stored but not used in F0.
- **Reason**: api-web-skeleton AWS-23: ADR 017 names are lower-case ASCII; fuzzy matching is the agent's fusion (F2). Exact match is the stricter option.
- **Trade-off**: an OCR misread leaves the room Awaiting host; reversal is a matcher change in the domain.
- **Scope**: api-web-skeleton / lobby-room
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-035 (assumed)

- **Decision**: `agent-skeleton` executes after `api-web-skeleton` is merged into `phase/F0`; its Specify and Design may run earlier.
- **Reason**: Both features would otherwise edit `packages/contracts` in parallel worktrees; the agent consumes the contracts written by api-web-skeleton.
- **Trade-off**: the two features run one after the other instead of in parallel; reversal is splitting contracts into their own feature.
- **Scope**: phase F0
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-036 (assumed)

- **Decision**: The F0 session lasts 7 days in an `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` cookie whose random id is stored in `identity.sessions`.
- **Reason**: api-web-skeleton AWS-01: FR-01 asks for a cookie session without a lifetime; 7 days is shorter than the usual 30 and the cookie is first-party through the Pages proxy (ADR 012).
- **Trade-off**: testers sign in again weekly; reversal is a constant.
- **Scope**: api-web-skeleton / identity
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-037 (assumed)

- **Decision**: An account has one paired agent; pairing a new agent revokes the previous agent's token.
- **Reason**: api-web-skeleton AWS-10: the PRD speaks of "the agent"; one live token per account is stricter (NFR-06) and FR-04's revoke is F1.
- **Trade-off**: a player with two PCs re-pairs when switching; reversal is dropping the revoke-on-pair rule.
- **Scope**: api-web-skeleton / agents
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-038 (assumed)

- **Decision**: In F0 the presence screen is `UNKNOWN` or `AUTOMAP_OPEN`; F2 adds values.
- **Reason**: api-web-skeleton AWS-14: FR-05 names "current screen" without a list, and F0's agent detects no screen; adding enum values later is backward compatible.
- **Trade-off**: none user-visible beyond "Unknown"; reversal is a contract addition.
- **Scope**: api-web-skeleton, agent-skeleton / contracts
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-039 (assumed)

- **Decision**: A room is created and moved to `awaiting_host` in the same transaction; the `n` of `mm{activity}{difficulty}-{n}` comes from one Postgres sequence shared by every room.
- **Reason**: api-web-skeleton AWS-20: `formed` has no observable duration before the ready check (F1); ADR 017 does not say how `n` is chosen, and a global sequence never repeats a name.
- **Trade-off**: names grow (`mmbaalh-1234`); F1 may reset or scope the counter with FR-14. Reversal is a domain change, no data migration.
- **Scope**: api-web-skeleton / lobby-room
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-040 (assumed)

- **Decision**: The site renders in pt-BR when the browser's first preferred language starts with `pt`, in English otherwise; F0 has no language switcher.
- **Reason**: api-web-skeleton AWS-37: NFR-12 asks for both languages from day 0, not for a control; no switcher adds no UI commitment.
- **Trade-off**: a Portuguese speaker with an English browser sees English; reversal is adding a switcher.
- **Scope**: api-web-skeleton / web
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-041 (assumed)

- **Decision**: The unauthenticated pairing-code endpoint answers 429 after 10 requests per IP address per hour.
- **Reason**: api-web-skeleton AWS-09: ADR 011 requires rate limiting; the endpoint is reachable without auth and each request creates a row.
- **Trade-off**: players behind one shared IP may wait; reversal is a constant.
- **Scope**: api-web-skeleton / agents
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-042 (assumed)

- **Decision**: Test-account names compare ignoring case: `PlayerOne` and `playerone` open the same `<name>#test` account, displayed as first typed.
- **Reason**: api-web-skeleton AWS-01: the test sign-in reuses an account by name and nothing says whether case matters; one account per name avoids look-alikes.
- **Trade-off**: staging only; reversal is a comparison change.
- **Scope**: api-web-skeleton / identity
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-043 (assumed)

- **Decision**: Every agent endpoint (pairing code and claim included) requires `X-Agent-Version`; the minimum comes from `AGENT_MIN_VERSION`, read only in `main/`, default `0.0.0`.
- **Reason**: api-web-skeleton AWS-12: ADR 011 sets the 426 rule without a value or an endpoint list; requiring the header everywhere lets an outdated agent be stopped before pairing.
- **Trade-off**: the maintainer raises the minimum by config; reversal is exempting pairing.
- **Scope**: api-web-skeleton, agent-skeleton / agents
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

## Handoff

- **Feature**: api-web-skeleton — BLOCKED at the spec gate (`dispatch:api-web-skeleton/review-spec`, 3/3)
- **Phase / Task**: F0 run; spec at 0719825 passes `validate_spec.py` and `acceptance-check.mjs`; review 1 FAIL and review 2 FAIL were fixed; review 3 was cut off by an API usage limit and still counted
- **Completed**: `spec.md` (AWS-01…AWS-40), `acceptance.feature`, AD-029…AD-043 (assumed)
- **In-progress**: none
- **Next step**: maintainer chooses in `.specs/phases/F0/decisions.md` → Blocked (reset the review-spec budget, or approve the spec). Meanwhile agent-skeleton Specify can run (AD-035: its Execute waits for api-web-skeleton)
- **Blockers**: review-spec budget exhausted. Execute later needs Docker running and, for agent-skeleton, a Rust toolchain (not installed)
- **Uncommitted files**: none after the blocker commit
- **Branch**: feat/F0-api-web-skeleton
