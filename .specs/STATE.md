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

### AD-044 (assumed)

- **Decision**: harness-foundation's HF-04 scenario lines "declares version 3.1 with no paths" and "3.0 with no channels" become structural assertions — "declares version 3.1 and the path /healthz" and "declares version 3.0 and the channel stream" — when api-web-skeleton adds routes and events.
- **Reason**: api-web-skeleton design: the empty documents were declared placeholders (`packages/contracts/src/documents.ts`); with real routes the old lines are false. The drift check that HF-04 exists for stays.
- **Trade-off**: edits a done feature's scenario; the gate asks the maintainer to confirm it. Reversal is impossible without removing the routes.
- **Scope**: harness-foundation, api-web-skeleton / contracts
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-045 (assumed)

- **Decision**: Acceptance isolation uses test-control endpoints (`POST /__test/reset`, `POST /__test/clock`) mounted only by `main/local.ts` when `D2RMM_ACCEPTANCE=true`; `main/render.ts` can never mount them (dependency rule).
- **Reason**: api-web-skeleton design: scenarios reuse personas and need code expiry and rate windows without waiting minutes; the brief's single staging fake is the test match, and these are not reachable on staging or production.
- **Trade-off**: a local-only test surface to keep out of production; reversal is per-scenario databases and real waits.
- **Scope**: api-web-skeleton / main, tests/acceptance
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-046 (assumed)

- **Decision**: The F0 site uses `fetch` and `EventSource` without TanStack Router or Query; F1 adds them with real navigation.
- **Reason**: api-web-skeleton design: the Design Doc stack lists both, but F0 has one page and three requests; smallest scope.
- **Trade-off**: F1 introduces the router and query cache; no user-visible change.
- **Scope**: api-web-skeleton / web
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-047 (assumed)

- **Decision**: The FR-27 fixture is a synthetic image (`apps/agent/fixtures/automap-game-name.png`) drawn by a repository script with an openly licensed font — dark background, the game name and "Difficulty: Hell" in the automap's top-right text block — not a game screenshot.
- **Reason**: agent-skeleton AGS-16: no screenshot with its owner's consent exists yet (Design Doc § testes) and the repository never publishes Blizzard assets (AGENTS.md "Never do"); F0 proves the pipeline, F2 adds real crops.
- **Trade-off**: the fixture is easier than the real automap; F2's reference images replace it. Reversal is adding consented crops.
- **Scope**: agent-skeleton / vision
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-048 (assumed)

- **Decision**: The agent keeps its token only in the Windows Credential Manager, never in a file.
- **Reason**: agent-skeleton AGS-06/AGS-09: NFR-06 asks for a revocable, restricted token and ADR 011 says nothing about storage; the OS store keeps it out of files, backups and logs.
- **Trade-off**: none user-visible; reversal is a storage adapter.
- **Scope**: agent-skeleton / pairing
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-049 (assumed)

- **Decision**: The agent checks for updates at start, every 6 hours while running, and right after a `426`.
- **Reason**: agent-skeleton AGS-24: ADR 015 says "at start and periodically" without a period; 6 h keeps GitHub requests low and the `426` path covers urgent minimum-version raises.
- **Trade-off**: a release can take up to 6 h to reach a running agent unless the minimum is raised; reversal is a constant.
- **Scope**: agent-skeleton / updater
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-050 (assumed)

- **Decision**: While showing a pairing code, the agent claims every 2 seconds.
- **Reason**: agent-skeleton AGS-06: AD-030 sets polling without a period; 2 s shows "Paired" within a few seconds and stays far below the code's 5 minutes.
- **Trade-off**: up to 150 claims per code; reversal is a constant.
- **Scope**: agent-skeleton / pairing
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-051 (assumed)

- **Decision**: In F0 observations are retried in memory with the same idempotency key, 5 attempts in total with 1, 2, 4 and 8 s between them, then dropped and counted; no SQLite outbox.
- **Reason**: agent-skeleton AGS-19: nothing captures live in F0, so the Design Doc's local outbox has no producer yet; it comes with F2's capture.
- **Trade-off**: an observation can be lost if the agent quits mid-retry; reversal is adding the outbox in F2 as planned.
- **Scope**: agent-skeleton / api_client
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-052 (assumed)

- **Decision**: Fusion accepts a read only when its text, trimmed and lower-cased, equals the expected game name lower-cased, and sends that normalised text as the observation's value.
- **Reason**: agent-skeleton AGS-17/18 (spec-reviewer finding 1): game names differ only by their number (`-12` vs `-13` is edit distance 1), so any tolerance can mark the wrong room Created (INV-06); exact match is the stricter option and agrees with the server (AD-034).
- **Trade-off**: an OCR slip leaves the room Awaiting host; F2's fusion adds tolerance with the "same server as host" signal. Reversal is a fusion change.
- **Scope**: agent-skeleton / fusion
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-053 (assumed)

- **Decision**: `release-agent.yml` signs the installer through SignPath only when the SignPath secrets exist; otherwise it publishes it unsigned and the site shows the SmartScreen note.
- **Reason**: agent-skeleton AGS-29/AGS-30: ADR 016 — "Until accepted, releases are unsigned and the site explains the warning."
- **Trade-off**: players see SmartScreen until SignPath accepts the project; reversal is automatic once the secrets exist.
- **Scope**: agent-skeleton / release
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-054 (assumed)

- **Decision**: The agent window renders in pt-BR when the Windows display language starts with `pt`, in English otherwise; no switcher.
- **Reason**: agent-skeleton AGS-32: same rule as the site (AD-040); NFR-12 and AGENTS.md rule 9.
- **Trade-off**: none beyond AD-040's; reversal is a switcher.
- **Scope**: agent-skeleton / ui
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-055 (assumed)

- **Decision**: "Game open" means a process named `D2R.exe` is in the toolhelp snapshot (`CreateToolhelp32Snapshot`, `Process32FirstW`/`Process32NextW`); the agent never opens a handle to the game process, `OpenProcess` is a clippy error and `sysinfo` a `cargo deny` ban.
- **Reason**: agent-skeleton AGS-10: ADR 010 allows OS signals only, and the Design Doc lists "abrir o processo do jogo" among what the agent never does; the toolhelp snapshot lists names without opening processes, while `sysinfo` opens process handles on Windows.
- **Trade-off**: a renamed executable is not detected; reversal is adding window-title detection in F2.
- **Scope**: agent-skeleton / sensors
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-056 (assumed)

- **Decision**: `AgentPresenceChanged` and `AgentRevoked` are transient events on the in-memory bus, not outbox rows; their stream ids are `<lastOutboxId>.<k>` and the site re-reads presence on every (re)connect.
- **Reason**: api-web-skeleton design: ADR 008 puts events in the outbox in the same transaction as their state change, but presence is not in Postgres (ADR 006, AWS-13 forbids a Postgres write per heartbeat). A presence event lost to a restart is rebuilt from the next heartbeat.
- **Trade-off**: presence changes are not replayed by `Last-Event-ID`; reversal is moving presence to Postgres, which NFR-07 rules out. `AgentRevoked` follows a committed revoke: if a crash loses it, the restart drops every open stream and the token read-through checks `revoked_at`. The phase review proposes amending ADR 008's wording to name transient events.
- **Scope**: api-web-skeleton / agents, platform
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-057 (assumed)

- **Decision**: In F0 the agent reads the reference image only in builds with the Cargo feature `fixture-read`, started with `--read-fixture <png>`; `release-agent.yml` never enables it, so released agents never read an image nor post an observation.
- **Reason**: agent-skeleton AGS-33 (spec-reviewer finding 2): a release build posting `GAME_NAME_SEEN` from a fixture would mark real rooms Created with no game open; observability-e2e builds the agent with the feature to drive the end-to-end trace.
- **Trade-off**: released F0 agents confirm no room; live capture is F2. Reversal is removing the feature gate when live capture lands.
- **Scope**: agent-skeleton, observability-e2e / vision
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-058 (assumed)

- **Decision**: After 2 consecutive codes expire unused the agent stops requesting codes and shows "Pairing paused" with "Get a new code"; a `429` on the code request waits `Retry-After`, or 60 minutes without it.
- **Reason**: agent-skeleton AGS-34/35 (spec-reviewer finding 3): the API allows 10 code requests per IP per hour (AD-041); an unattended agent renewing every 5 minutes would reach 12 per hour on its own.
- **Trade-off**: a player who leaves the agent open for more than 10 minutes clicks once to get a code. Reversal is a constant.
- **Scope**: agent-skeleton / pairing
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-059 (assumed)

- **Decision**: The agent reconnects a dropped stream after 1 s, doubling to at most 60 s, and resets the delay once a stream has stayed open 60 s.
- **Reason**: agent-skeleton AGS-13 (spec-reviewer finding 11): ADR 007 sets no client delay; a bounded backoff keeps a down API on the free tier from being hammered.
- **Trade-off**: up to 60 s to see a new room after a long outage; the assignment is re-fetched on reconnect. Reversal is a constant.
- **Scope**: agent-skeleton / stream
- **Date**: 2026-10-30
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-060 (assumed)

- **Decision**: The agent-facing JSON Schemas in `packages/contracts/json-schema/` are emitted as draft-07 (`z.toJSONSchema(schema, { target: 'draft-7' })`), and a `claim-request.json` is added.
- **Reason**: agent-skeleton design: `typify` (schemars) reads draft-07; the api-web-skeleton generator emits draft 2020-12, and the agent also sends the claim request.
- **Trade-off**: the JSON Schema files use the older dialect; OpenAPI and AsyncAPI are unchanged. Reversal is the target option once `typify` reads 2020-12.
- **Scope**: agent-skeleton, contracts

### AD-061 (assumed)

- **Decision**: the staging `POST /v1/staging/match-formed` route answers 404 `no-room` when the room does not exist and 404 `no-assignment` when there is no assignment; it lives in the Matchmaking routes file, the design's owner, not the Lobby Room routes file T34 names.
- **Reason**: neither response is specified in the spec or design; 404 with a stable code is the conservative answer for a staging-only route and changes nothing a player sees.
- **Trade-off**: the codes become part of `openapi.json`; reversal is a contract change on a staging route.
- **Scope**: api-web-skeleton / matchmaking
- **Date**: 2026-10-31
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-062 (assumed)

- **Decision**: a third acceptance test control, `POST /__test/redeliver-match-formed`, publishes the newest `MatchFormed` outbox row again on the `EventBus` (same outbox id and payload) so AWS-20's scenario "the same match is delivered to the Lobby Room again" runs black-box through the real consumer. Same guards as reset (secret header, `acc_w<n>` on loopback, `local.ts` only, AD-045).
- **Reason**: the approved scenario needs a redelivery, and no product route can cause one: each staging `match-formed` call mints a new `matchId` (AD-033). Scenarios are never edited (ADR 023), so the stack gains the control, the smallest addition that drives the at-least-once path the relay already has.
- **Trade-off**: one more test-only endpoint; it is unreachable from `render.ts` and the Pages Function like the other two. Reversal is a consumer-level proof instead of a scenario, which needs the maintainer.
- **Scope**: api-web-skeleton / main, tests/acceptance

- **Date**: 2026-10-31
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-063 (assumed)

- **Decision**: agent-skeleton's T6 gate and its `## Checks` proof run `cargo deny --config apps/agent/src-tauri/deny.toml --manifest-path … check bans`; `--config` comes before `check`.
- **Reason**: cargo-deny 0.20.2 rejects `--config` after `check bans` (`error: unexpected argument '--config' found`), reported by execute-batch-1. The same command with the flag first reports `error[banned]` for `sysinfo`. design.md § Read-only boundary keeps the old order as an illustration.
- **Trade-off**: none; argument order only, the boundary checked is the same.
- **Scope**: agent-skeleton / T6
- **Date**: 2026-10-31
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-064 (assumed)

- **Decision**: `apps/agent/src-tauri/deny.toml` sets `[graph] targets = ["x86_64-pc-windows-msvc"]`, so cargo-deny judges the dependency graph the agent ships on.
- **Reason**: the agent ships for Windows only; on Linux and macOS graphs `winapi` (banned) enters through `tao`/`gtk`, which never reach the Windows build. No ban was removed.
- **Trade-off**: a banned crate pulled in only on a non-Windows target is not reported. This scopes a new sensor; the maintainer confirms it at the phase review. Reversal is deleting the filter and handling the Linux graph.
- **Scope**: agent-skeleton / T5
- **Date**: 2026-10-31
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-065 (assumed)

- **Decision**: the Tauri identifier is `com.d2rmm.agent`; `icons/icon.png` and `icon.ico` are plain placeholders; the window string "Requesting a pairing code…" (en, with a pt-BR translation) is the worker's wording.
- **Reason**: none of the three is in the spec or design; T3 and T4 needed a value to build.
- **Trade-off**: the identifier is hard to change after the first release (it keys the install and the Credential Manager entries). The maintainer reviews all three at the phase review.
- **Scope**: agent-skeleton / T3, T4
- **Date**: 2026-10-31
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-066 (assumed)

- **Decision**: the T7 test `windows features stay on the allow-list` fails when the app enables a `windows` feature outside the allow-list (subset check), not when a listed feature is missing.
- **Reason**: the app has no `windows` dependency until T23/T24, so design.md's "exactly" fails on the repo today. The subset direction is the one that enforces the read-only boundary (ADR 010).
- **Trade-off**: a missing allow-listed feature shows up as a build error, not a test failure. Reversal is equality once T24 lands.
- **Scope**: agent-skeleton / T7
- **Date**: 2026-10-31
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-067 (assumed)

- **Decision**: the agent's stream handler dispatches on the SSE `event:` name and parses the SSE `data:` as `RoomAssignedEventData` (the `data` member of `agent-event-room-assigned.json`), not the `{type, data}` envelope. The T12 fake API writes events the same way the real API does.
- **Reason**: the merged API writes `event: <type>` and `data: <JSON of event.data>` (`apps/api/src/platform/stream-hub.ts:139`). AsyncAPI and design.md § Stream describe the envelope; the wire is the evidence.
- **Trade-off**: the contract document and the wire differ until the docs are aligned (follow-up queued). Reversal is parsing the envelope if the API starts sending it.
- **Scope**: agent-skeleton / T16
- **Date**: 2026-10-31
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-068 (assumed)

- **Decision**: `core/src/stream.rs` reads SSE with its own line parser instead of `eventsource-stream` (design.md § Stream).
- **Reason**: the 64 KiB line and event bounds (AGS-15) must be enforced before an event is assembled and dispatched; no new dependency.
- **Trade-off**: about 100 lines of parser the crate would have provided, covered by the T16 tests. Reversal is swapping in the crate with a bounded byte stream.
- **Scope**: agent-skeleton / T16
- **Date**: 2026-10-31
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-069 (assumed)

- **Decision**: the F0 heartbeat body is `pcState: IDLE`, `window: ""` and no `assignment`; while a 426 is pending the window keeps "Update required" even after a failed update check; the stream checks the update gate before each request.
- **Reason**: neither the spec nor the design fixes the F0 heartbeat values (presence detection beyond `D2R.exe` is F2); keeping "Update required" is the conservative reading of AGS-27.
- **Trade-off**: the site shows the agent idle in F0. Reversal is filling the fields when F2 detection lands.
- **Scope**: agent-skeleton / T15, T19
- **Date**: 2026-10-31
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-070 (assumed)

- **Decision**: the built-in 1920×1080 automap game-name region is `{x:1380, y:40, w:520, h:80}` (`AUTOMAP_NAME_1080P` in `core/src/vision.rs`).
- **Reason**: the design names the region but not its coordinates; the T24 synthetic fixture (AD-047) is drawn inside it.
- **Trade-off**: a wrong region shows up only on a real game screen (F2 tuning). Reversal is a constant.
- **Scope**: agent-skeleton / T17
- **Date**: 2026-10-31
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-071 (maintainer: Docker, 2026-10-31)

- **Decision**: the local Windows-target check of the `#[cfg(windows)]` adapters (T22–T24) runs `cargo clippy … --target x86_64-pc-windows-msvc` inside a slim Linux container (`apps/agent/src-tauri/win-check.Dockerfile`, driven by `scripts/agent/win-check.mjs`): clang-cl, lld and llvm tools plus the Windows CRT/SDK headers splatted by `xwin`. Nothing is installed on the host. The CI `agent` job keeps compiling and testing natively on `windows-latest`; the container is only for development machines that are not Windows.
- **Reason**: `reqwest` → `rustls` → `aws-lc-sys` compiles C for the Windows target, which needs Windows headers that macOS lacks (T22 blocked at 2/3). The maintainer chose Docker over a host install of `cargo-xwin` and over changing the TLS stack.
- **Trade-off**: the first run builds the image and every dependency (cached afterwards on named volumes); `xwin` downloads the Microsoft CRT/SDK, which requires accepting Microsoft's licence. Accepted by the maintainer on 2026-10-31: "aceito a licença do Windows SDK".
- **Scope**: agent-skeleton / T22–T24
- **Date**: 2026-10-31
- **Status**: active

### AD-072 (maintainer, 2026-10-31)

- **Decision**: the harness test `core has no tauri dependency` encodes AGS-01's "core declares no Cargo features" as two assertions on `core/Cargo.toml`: no `[features]` table and no dependency with `optional = true` (an optional dependency is an implicit feature). It replaces `/features\s*=/`, which also matched dependency feature selections the design requires (`reqwest` `json`/`stream`).
- **Reason**: the old regex contradicted the approved design and turned `pnpm test:harness` red at T13; T13–T21 gates did not run the harness, so it surfaced at T22.
- **Trade-off**: none against AGS-01; the optional-dependency check is new coverage. Each assertion gets a failing fixture under `scripts/test/fixtures/agent-rules/`.
- **Scope**: agent-skeleton / harness
- **Date**: 2026-10-31
- **Status**: active (maintainer answered "Corrigir (Recomendado)")

### AD-073 (assumed)

- **Decision**: T27 splits the app entry: `src/app.rs` (compiled on every target) holds `run(adapters)` and the `get_new_code` handler over a one-method `CodeRequester` trait implemented for `core::runtime::Handle`; `src/main.rs` builds the real Windows adapters under `#[cfg(windows)]`, and under `#[cfg(not(windows))]` prints that the agent runs on Windows only and exits with code 1. T27's gate adds `node scripts/agent/win-check.mjs`.
- **Reason**: the T27 gate runs clippy and nextest on macOS, but the adapters exist only under `#[cfg(windows)]`, and `Handle` has no seam for the fake the test names. Stub adapters on other OSes would pretend to read the game; a Windows-only exit is the conservative choice (the agent ships for Windows only).
- **Trade-off**: the app cannot be launched on macOS or Linux for manual checks; observability-e2e drives the core and the fake API instead. Reversal is a non-Windows adapter set.
- **Scope**: agent-skeleton / T27
- **Date**: 2026-10-31
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-074 (assumed)

- **Decision**: T27 wiring details: the app crate supplies the production `Clock` and `IdGenerator` (`src/adapters/system.rs`: `SystemClock` over `chrono::Utc::now`, `RandomIds` over `uuid::Uuid::new_v4`); when `WindowsOcr::new()` fails (no en-US OCR engine) the app wires `NoOcrEngine`, whose every read returns `ReadError::EngineUnavailable`; `app.rs` compiles under `cfg(any(windows, test))` and its Tauri shell under `cfg(windows)`, so a non-Windows build has no dead code; adapters are built inside Tauri `setup` because the updater needs the `AppHandle`.
- **Reason**: core injects clock and ids as ports (AGENTS.md rule 1) but had no production implementation; the missing-engine path is the spec'd error, and it reads nothing.
- **Trade-off**: two more app dependencies (`chrono`, `uuid` v4). Reversal is moving the adapters.
- **Scope**: agent-skeleton / T27
- **Date**: 2026-10-31
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-075 (assumed)

- **Decision**: batch 5 details: the `agent-v*` tag ruleset the maintainer imports is the existing `.github/rulesets/agent-release-tags.json` (tasks.md's Execution Protocol names `agent-tags.json`; no duplicate was created); the SignPath job also reads repository variables `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG` and `SIGNPATH_SIGNING_POLICY_SLUG`; `@tauri-apps/api` (window events and `invoke`) and the devDependency `@tauri-apps/cli` (`tauri signer sign`, `tauri build`) are added; the T30 assertion "the build job never clobbers" is scoped to the `build` job and a new test asserts `--clobber` appears only in `sign` (design.md § Release).
- **Reason**: each follows design.md; the ruleset with the same rules already existed.
- **Trade-off**: the maintainer imports a file whose name differs from the plan's. Reversal is a rename.
- **Scope**: agent-skeleton / T28–T31
- **Date**: 2026-10-31
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-076 (assumed)

- **Decision**: every `cargo nextest run … -E 'test(<name>)'` proof in agent-skeleton's `## Checks` passes `--workspace`.
- **Reason**: `apps/agent/src-tauri/Cargo.toml` is both the `d2rmm-agent` package and the workspace root (members `.`, `core`, `xtask`); without `--workspace` nextest selects only the root package, so the proofs of `core` and `xtask` tests ran 0 tests and failed (`check_proofs.py` attempt 1).
- **Trade-off**: none; the filter still names one test per proof.
- **Scope**: agent-skeleton / Checks
- **Date**: 2026-10-31
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-077 (assumed)

- **Decision**: `game.running` is true when a snapshot process name equals `D2R.exe` ignoring ASCII case (`D2R.EXE` counts); any other name, including a prefix or suffix of it, does not.
- **Reason**: AGS-10 says "a process named `D2R.exe`" without a case rule; Windows file names are case-insensitive, so the exact-case reading could miss the running game. Pinned by C59 after the Verifier's finding 8.
- **Trade-off**: none for players. Reversal is a comparison change.
- **Scope**: agent-skeleton / heartbeat
- **Date**: 2026-11-01
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-078 (maintainer, 2026-11-01)

- **Decision**: agent-hexagonal-migration uses `# not-scenario` exemptions for every requirement the acceptance runner cannot observe; the proofs are Rust unit tests, the unchanged `core/tests`, the architecture harness test and static checks.
- **Reason**: the maintainer answered "Autorizo" on 2026-11-01 to the same rule as agent-skeleton ("the code tests are enough for the agent"); the migration changes nothing a player or the API sees.
- **Trade-off**: one `@api` scenario (AHM-21) proves only the API side of the wire.
- **Scope**: agent-hexagonal-migration / acceptance.feature
- **Date**: 2026-11-01
- **Status**: active

### AD-079 (assumed)

- **Decision**: `OFFLINE_AFTER` (45 s) is a constant of `d2rmm-agent-domain` beside `HEARTBEAT_INTERVAL` (15 s), pinned by a test that it equals three heartbeats; the agent's loops do not read it.
- **Reason**: ADR 027 rule 4 lists the 45 s offline threshold among the domain constants; the server owns the rule (AD-031).
- **Trade-off**: an unused constant documents an agreement; reversal is deleting it.
- **Scope**: agent-hexagonal-migration / AHM-13
- **Date**: 2026-11-01
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-080 (assumed)

- **Decision**: mutation scope widens to every module of `d2rmm-agent-domain` and the rule modules of `d2rmm-agent-core`, under the survival rule the agent already runs; no existing number is lowered.
- **Reason**: ADR 026 sets scope, not a score; AGENTS.md rule 4 keeps thresholds with the maintainer.
- **Trade-off**: a later score target would be a maintainer decision.
- **Scope**: agent-hexagonal-migration / AHM-23…AHM-25
- **Date**: 2026-11-01
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-081 (assumed)

- **Decision**: the portable adapters (reqwest gateway, generated contracts, translation, SSE parser, `ApiBase`, telemetry bootstrap) live in a new crate `d2rmm-agent-adapters`; the Windows and Tauri adapters and the composition root stay in the app crate.
- **Reason**: ADR 027 open point 2 leaves the placement to this Design and names this crate as the option when the app crate grows. It keeps the HTTP integration tests and each migration step off the Tauri build.
- **Trade-off**: one more workspace member. Reversal is moving the modules into the app crate.
- **Scope**: agent-hexagonal-migration / design
- **Date**: 2026-11-01
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-082 (assumed)

- **Decision**: the integration tests of `core/tests/` move with the HTTP gateway to `d2rmm-agent-adapters/tests/`; assertion lines stay byte-identical, while `use` lines, harness construction and act lines may change. The few assertions that read internals keep their text through a `Probe` (read-only state, no ports, returned only by the test entry point `Runtime::start_with_probe`, which the app crate may not mention), the port error keeping the name `ApiError`, and the contract-typed `ApiClient` staying as it is. The check runs on every commit touching those files. A task that cannot keep an assertion stops and reports it.
- **Reason**: they drive the real gateway against a fake API, and `core` no longer holds `reqwest`. AHM-20 asks for the same assertions, not for the same directory.
- **Trade-off**: AHM-20's wording names `core/tests/`; the proof is a harness check over `git diff -M` that fails on any added or removed assertion line in the moved files.
- **Scope**: agent-hexagonal-migration / AHM-20
- **Date**: 2026-11-01
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-083 (assumed)

- **Decision**: the `agent.http.*` spans (they record the response status) stay in the gateway adapter; the agent's loop and use-case spans stay in the application layer; the domain emits none.
- **Reason**: ADR 027 rule 7 puts the agent's spans in the application. The HTTP-call spans describe a transport detail core does not know (status codes), and they already live in `ApiClient` today.
- **Trade-off**: a literal reading of rule 7 would move them to core and force core to learn HTTP statuses. Reversal is wrapping each gateway call in a core span.
- **Scope**: agent-hexagonal-migration / AHM-18
- **Date**: 2026-11-01
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-084 (assumed)

- **Decision**: the relay `POST /v1/telemetry/traces` accepts OTLP/HTTP (protobuf or JSON, no content encoding) from an agent token or a site session whose `Origin` is the site origin, at most 1 MiB and 60 requests a minute per principal (120 a minute per address when unauthenticated); it checks in the order authentication, rate, content type and encoding, size; answers an empty `202` at once and forwards the body unchanged in the background with a 5 s timeout. It does not decode the body.
- **Reason**: the site and the agent must not hold backend credentials (ADR 013, design doc); forwarding bytes avoids a second schema and a protobuf dependency; the limits bound a public write path on a single free instance (ADR 006).
- **Trade-off**: redaction is the sender's guarantee, so a hostile or buggy client can put forged spans or a forged `service.name` in the maintainer's backend; accepted and bounded by authentication, size and rate, and the backend treats the data as untrusted. The numbers are guesses. Reversal is decoding and filtering in the relay.
- **Scope**: observability-e2e / OBS-10…OBS-20
- **Date**: 2026-11-02
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-085 (assumed)

- **Decision**: the trace crosses the outbox through a nullable `trace_context` column on `platform.outbox`, written in the transaction that writes the event; the relay continues it with `platform.outbox.relay` and `platform.stream.deliver`.
- **Reason**: The outbox is the only asynchronous hop and has no carrier today; a column is the smallest durable carrier.
- **Trade-off**: A migration adds a column (a new migration file, never an edit of an applied one). Rows written before it have no context and become root spans (OBS-07).
- **Scope**: observability-e2e / OBS-05, OBS-06, OBS-07
- **Date**: 2026-11-02
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-086 (assumed)

- **Decision**: the browser does not report SSE receipt: the stream hop in the trace is the server-side delivery span.
- **Reason**: `EventSource` cannot read a trace id without adding a field to the event payload, which is a contract change (AGENTS.md rule 2).
- **Trade-off**: The trace ends at the server for the stream hop. Reversal is a payload field and a site span in F1.
- **Scope**: observability-e2e / OBS-06
- **Date**: 2026-11-02
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-087 (assumed)

- **Decision**: the metrics created in F0 are `http.server.response.body.size`, `http.server.request.duration` (from the HTTP instrumentation), `sse.connections`, `outbox.lag` and `room.stage_duration`; the others of the design doc arrive with their use case.
- **Reason**: Only these have a subject in the skeleton; empty instruments would be noise.
- **Trade-off**: The dashboard is small. Reversal is adding instruments with their features.
- **Scope**: observability-e2e / OBS-33
- **Date**: 2026-11-02
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-088

- **Decision**: the F0 proof runs against a local `grafana/otel-lgtm` in Docker; no Grafana Cloud endpoint or secret is created or used.
- **Reason**: Confirmed by the maintainer on 2026-11-02 ("Sim e sim" to local-only backend and to Docker).
- **Trade-off**: Production export is configuration only (`OTEL_EXPORTER_OTLP_*` in `main/`); the maintainer enables it when the account exists.
- **Scope**: observability-e2e / OBS-23, OBS-24
- **Date**: 2026-11-02
- **Status**: confirmed by the maintainer

### AD-089 (assumed)

- **Decision**: the API samples with a parent-based sampler whose ratio is `OTEL_TRACES_SAMPLER_ARG`, `0.1` when unset; the acceptance stack sets `1.0`.
- **Reason**: ADR 013 warns that free-tier quotas limit sampling; keeping every trace is not the conservative default.
- **Trade-off**: a lower default hides rare traces in production until the ratio is raised. Reversal is changing the default.
- **Scope**: observability-e2e / OBS-43
- **Date**: 2026-11-02
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-090 (assumed)

- **Decision**: the web build exports spans only when `VITE_TELEMETRY=on`; local and staging builds set it, the production build does not.
- **Reason**: Sending players' browser telemetry to a third party is a privacy decision (NFR-04, NFR-05) the maintainer has not taken.
- **Trade-off**: the production site is not traced until the maintainer decides on a notice. Reversal is setting the flag in the production build.
- **Scope**: observability-e2e / OBS-44
- **Date**: 2026-11-02
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-091 (assumed)

- **Decision**: the `d2r.*` attribute constants replace today's `roomId`; `accountId` and `agentId` are dropped from spans; the use-case span names stay (`lobby.record-observation`, `matchmaking.form-test-match`), not the design doc's draft `lobby.observe` and `matchmaking.match`.
- **Reason**: The design doc fixes attribute names and forbids account identity in telemetry; the span names are shipped and tested (AWS-35).
- **Trade-off**: a lost id makes some debugging harder; the trace id and the room id remain. Reversal is adding the attribute back behind a flag.
- **Scope**: observability-e2e / OBS-30
- **Date**: 2026-11-02
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-092 (assumed)

- **Decision**: a room leaves two complete traces: trace A starts at the site's "Start test match" and reaches the `awaiting_host` delivery; trace B starts at the agent's observation and reaches the `created` delivery; the agent's spans parent the API's spans in trace B; no span link joins A and B.
- **Reason**: `Created` is written in the agent's request, so its outbox row carries the agent's trace; joining them needs the room to store the match trace, a lobby change outside this feature.
- **Trade-off**: the brief's "one trace" is read as one trace per originator; if the maintainer wants a single trace, the room must carry the context (F1). Reversal is a span link.
- **Scope**: observability-e2e / OBS-08, OBS-12
- **Date**: 2026-11-02
- **Status**: reversed by the maintainer on 2026-11-07: the span link, delivered by `room-trace-link` (brief revision 5)

### AD-093 (assumed)

- **Decision**: only the API exports logs over OTLP; the site and the agent export no logs or metrics in F0.
- **Reason**: Only the API has log and metric subjects in the skeleton; NFR-09's wording ("three apps") is met for traces in all three and for logs and metrics where a subject exists.
- **Trade-off**: NFR-09 is partly deferred for the site and the agent; the maintainer confirms at the phase review. Reversal is adding the signals to the relay.
- **Scope**: observability-e2e / OBS-26, OBS-27, OBS-33
- **Date**: 2026-11-02
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-094 (assumed)

- **Decision**: the API loads its OpenTelemetry SDK with a `node --import ./src/main/instrument.ts` preload (start commands of `render.yaml` and the acceptance stack change), and `@d2rmm/telemetry` exports source through `.`, `./node` and `./web` like `@d2rmm/contracts`, with no build step.
- **Reason**: the composition roots import `pg` and `kysely` statically, so instrumentation must patch the modules first; Render installs without a build.
- **Trade-off**: auto-instrumentation of ESM run as TypeScript is unverified here; task 1 is a spike with a fallback (a Fastify hook for the server span and a Kysely log callback for the `pg` span).
- **Scope**: observability-e2e / OBS-01, OBS-03
- **Date**: 2026-11-02
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-095 (assumed)

- **Decision**: `http.server.request.duration` and `http.server.response.body.size` are recorded by one Fastify `onResponse` hook by route template and status class; the HTTP instrumentation's own duration histogram is dropped by a view. Streams (`hijack`) are covered by `sse.connections` only.
- **Reason**: the HTTP instrumentation has no route template, and one source avoids duplicate series.
- **Trade-off**: AD-087 said the duration comes from the HTTP instrumentation; names and instruments are unchanged, only the source differs. Reversal is keeping the instrumentation's histogram and adding the route in a view.
- **Scope**: observability-e2e / OBS-33
- **Date**: 2026-11-02
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-096 (assumed)

- **Decision**: the agent half of the trace scenario runs `examples/headless.rs` in the adapters crate behind that crate's own Cargo feature `fixture-read` (never default, off in every release graph), started with `--read-fixture <png>`, with the real core, the real `HttpGateway`, the OTLP exporter, an in-memory token store and a `TextReader` that returns the text of the sidecar file `<png>.txt` (Linux has no OCR); the agent exports through its own drop-oldest span processor over `opentelemetry-otlp`.
- **Reason**: the app crate's `fixture-read` path is Windows-only (OCR, keyring, Tauri) and CI's acceptance job is Linux; OBS-24 and AGS-33 require a build with the feature `fixture-read` and `--read-fixture`, which this keeps; OBS-18 asks for the oldest span to be dropped and the SDK batch processor drops the newest.
- **Trade-off**: AGS-33 places the feature in the app crate; a second gated place exists in the adapters crate, so the default-feature rule and the release guard cover both manifests. The sidecar text stands in for OCR. Reversal is running the Windows agent with the app crate's feature in a Windows job.
- **Scope**: observability-e2e / OBS-18, OBS-24
- **Date**: 2026-11-02
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-097 (assumed)

- **Decision**: with no backend configured the relay answers `202` and drops; the relay keeps the spec's order (authentication, rate, type, size). A request with a credential is authenticated first, whatever the address bucket holds; the address bucket (120 a minute) counts only credential-less and failed-authentication requests and answers `429` for credential-less callers over the limit; a credential that misses the cache takes a token from a relay-wide lookup bucket (10 a second, at most 3 lookups at once) and is refused with `429` when it is empty, so bad tokens stay off the database without refusing valid callers. Per account 60 requests, 2 MiB a minute and 2 MiB a UTC day; relay-wide 4 MiB a minute and 16 MiB a UTC day (10% of the 5 GB monthly egress, NFR-14); at most 32 forwards and 8 MiB of bodies in flight; no redirects; response body cancelled. The limiter keeps principals and addresses in separate maps (addresses capped at 10 000 with an overflow bucket for credential-less callers), unwraps IPv4-mapped IPv6, and lives in `platform`.
- **Reason**: the spec fixes an immediate `202`, no retry and the order of AC 7; AC 4 limits unauthenticated callers only, so a shared address (Pages egress, NAT) must not lock valid callers out; the bounds keep a single free instance and the egress budget safe (ADR 006, NFR-14); the agents limiter is module-internal.
- **Trade-off**: a small duplication of the sliding-window rule; spans are lost silently under a flood; the daily counter resets on a restart; a flood of bad cookies through the Pages proxy can drain the lookup bucket and delay site telemetry. Behind the Pages proxy signed-out visitors share Cloudflare egress addresses, so the credential-less and overflow buckets are shared; accepted because production site telemetry is off (AD-098). One account can use the whole 2 MiB a day of its own budget but not another's. Reversal is exporting a rate-limit port from the agents module.
- **Scope**: observability-e2e / OBS-10, OBS-14, OBS-15
- **Date**: 2026-11-02
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-098 (assumed)

- **Decision**: production builds of the site and the agent export no telemetry until the maintainer decides on a notice: the site needs `VITE_TELEMETRY=on`, the agent `D2RMM_TELEMETRY=on` at compile time (a debug profile alone is not a decision); the headless example and the e2e site build export. `release-agent.yml` and the Pages production build never set the flags (a harness test asserts it).
- **Reason**: sending players' browser and desktop telemetry to a third party is a privacy decision that is not taken (NFR-04, NFR-05).
- **Trade-off**: OBS-18 and OBS-21 describe capabilities, which exist, but nothing in production is traced until the flags are set. Reversal is setting the flags in the release workflow and the web deploy.
- **Scope**: observability-e2e / OBS-18, OBS-21, OBS-44
- **Date**: 2026-11-02
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-099 (assumed)

- **Decision**: the relay does not apply `requireAgentVersion` (ADR 011's 426 below the minimum version); it authenticates the agent token only.
- **Reason**: telemetry from an old agent is exactly what shows why it misbehaves; a 426 would hide it. The relay carries data only and changes no state.
- **Trade-off**: a deviation from "every agent route answers 426 below the minimum"; the relay is not a product route. Reversal is composing `requireAgentVersion` into the relay guard and mapping `426` to "drop this batch" in the agent.
- **Scope**: observability-e2e / OBS-10, OBS-11
- **Date**: 2026-11-02
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-100 (assumed)

- **Decision**: the API's sampler is `ParentBased`: local parents are followed, and `root`, `remoteParentSampled` and `remoteParentNotSampled` each use `TraceIdRatioBased(ratio)` plus one shared global token bucket (20 sampled traces a second, burst 40) taken only when the ratio check passes. A caller's sampled flag, a ground trace id or a request flood cannot export more than the bucket allows; exported logs are limited to `warn` and above or to sampled spans, 20 a second. The approved spec text is unchanged; this amends the reading of AD-089 and OBS-43 for the root and remote-parent branches.
- **Reason**: a client chooses its trace id and sampled flag on any route, authenticated or not, so a pure parent-based or ratio sampler lets it force export to the maintainer's quota.
- **Trade-off**: under abuse the agent's sampled traces can be trimmed on the API side, leaving a partial trace; normal traffic stays far under 20 a second. Reversal is the plain `ParentBased(TraceIdRatioBased)` of AD-089.
- **Scope**: observability-e2e / OBS-43
- **Date**: 2026-11-02
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-101 (assumed)

- **Decision**: the agent's exporter stops exporting after a relay `401` while its `HeaderSource` token hash equals the refused one, resumes on any difference (including none to some after a re-pair in the same process), sends nothing before a token exists, logs the stop once and probes once an hour; a `429` without `Retry-After` waits 60 s.
- **Reason**: a revoked or expired agent would retry about 12 times a minute for ever; a stop tied to the token hash cannot become a silent trap after a re-pair.
- **Trade-off**: OBS-19 AC 11 says "drop that batch" for `401` and expects the next request to be answered; the stop is a small extension of it. Reversal is dropping only the batch.
- **Scope**: observability-e2e / OBS-19
- **Date**: 2026-11-02
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-102 (assumed)

- **Decision**: the TypeScript samplers of the API and the site implement the same ratio rule as `opentelemetry_sdk` 0.33.1 (`lower 8 bytes of the trace id >> 1 < floor(ratio * 2^63)`) instead of `TraceIdRatioBased` from `sdk-trace-base`; the shared vector `packages/telemetry/test-vectors/sampler.json` is generated from the Rust rule, and the Rust agent uses its built-in sampler as is.
- **Reason**: the JS 2.12 class compares an XOR of the four 32-bit words of the trace id, so the two libraries disagree on the same trace id and the design's "the three senders take the same decision" would not hold.
- **Trade-off**: a small custom sampler class replaces a library class; the rule must follow `opentelemetry_sdk` if its algorithm changes. Reversal is using `TraceIdRatioBased` and dropping the cross-language parity claim and the shared-vector test.
- **Scope**: observability-e2e / OBS-43
- **Date**: 2026-11-02
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-103 (assumed)

- **Decision**: the API instruments HTTP and `pg` (and pino) but not Fastify's own request span (`@fastify/otel` is not installed); a request leaves the HTTP server span, its `pg` children and the use-case spans. The route template is on the request metrics (AD-095), not on the server span.
- **Reason**: with `@fastify/otel` an internal `request` span sat between the HTTP server span and the handler, so the `pg` span became a grandchild and OBS-03 ("each query a child span of it") failed; no requirement asks for the route template on a span.
- **Trade-off**: OBS-03 names "Fastify routes" among the things to instrument; the server span carries the method and `url.path`, not `http.route`. Reversal is `@fastify/otel` with a span processor that re-parents `pg` spans, or setting `http.route` on the server span in the metrics hook.
- **Scope**: observability-e2e / OBS-03
- **Date**: 2026-11-02
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-104

- **Decision**: the acceptance scenario `@HF-01` (which runs `pnpm build`, `pnpm typecheck` and `pnpm test` from the repository root) runs in its own Playwright project that depends on the main project, so it starts after the other scenarios have finished; the scenarios and their steps are unchanged.
- **Reason**: T56's full `pnpm test:acceptance` failed twice under that CPU load: trace A's room took 5.7 s to form against a 5 s window, and `@d2rmm/telemetry`'s `package-exports.test.ts` timed out at 5 s while 13 workers cold-imported OpenTelemetry. Longer windows would hide the load; separating the two removes it.
- **Trade-off**: the full run is longer by the HF-01 time, serialised. `playwright.config.ts` is a harness file (extend only).
- **Scope**: observability-e2e / T56
- **Date**: 2026-11-03
- **Status**: confirmed by the maintainer in chat ("A e B", 2026-11-03)

### AD-105

- **Decision**: `packages/telemetry/src/package-exports.test.ts` gives its dynamic-import test an explicit timeout of 30 s (`it(name, fn, 30_000)`); no assertion changes.
- **Reason**: the test cold-imports the whole OpenTelemetry set (`/`, `/node`, `/web`) and takes about 3 to 5 s on a loaded machine against vitest's 5 s default (it measured 5.2 s once).
- **Trade-off**: a slow import regression would show up later; the assertions still pin the entry points.
- **Scope**: observability-e2e / T56
- **Date**: 2026-11-03
- **Status**: confirmed by the maintainer in chat ("A e B", 2026-11-03)

### AD-106

- **Decision**: `packages/config/test/rules.test.ts` gives `n/no-process-env reports a process.env read in a module file` (the first `ESLint.lintText` call of the file) an explicit timeout of 30 s (`it(name, fn, 30_000)`); no assertion changes.
- **Reason**: after AD-104 the `@HF-01` run still failed once: that test timed out at 5000 ms while the root `pnpm test` ran every workspace in parallel; the first call loads ESLint and the TypeScript parser cold. Same class as AD-105.
- **Trade-off**: as AD-105; a slow cold load shows later.
- **Scope**: observability-e2e / T56
- **Date**: 2026-11-03
- **Status**: confirmed by the maintainer in chat ("C", 2026-11-03)

### AD-107

- **Decision**: the telemetry package also drops `network.peer.address` and `network.peer.port` from every span (the Verifier's finding 1). This is read as part of OBS-29's "the client address is dropped" and NFR-04, not as a new requirement: on a server span these two keys carry the caller's socket address, the same datum `client.address` names. The approved spec text is not edited; C38 and the acceptance forbidden-key scan gain the two keys.
- **Reason**: `instrumentation-http` 0.223 sets both on every server span; `isDroppedKey` listed only `client.address`, `user_agent.original` and `enduser.*`, so a player's IP could reach the third-party backend while every test stayed green.
- **Trade-off**: OBS-29 names `client.address` literally, so strict traceability would add a requirement ID; the conservative reading closes the leak now and the maintainer can ask for the ID at the phase review.
- **Scope**: observability-e2e / Verifier fix pass
- **Date**: 2026-11-03
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-108 (assumed)

- **Decision**: the load run is one k6 container per step, started by a Node orchestrator that provisions each step's new players over HTTP (sign in, pair, claim) outside any window; k6 plays only the steady journey and returns latency, errors, requests and iterations for the window; the orchestrator decides every verdict in pure, unit-tested functions.
- **Reason**: the k6 SSE extension blocks one connection per VU and has no cross-VU channel, so a single long ramp with k6 thresholds cannot isolate the 100-player window or read container state between steps.
- **Trade-off**: more moving parts than one k6 script; a spike (T1) must prove the stream-holding model, with an escalation if k6 cannot hold the streams. Assumed deviation from LB-05: the observation is triggered by `room.assigned` on the site stream (same data), because k6 has no proven channel between the two VUs; the agent stream is held and its `room.assigned` frames are counted.
- **Scope**: load-baseline / LB-01, LB-03, LB-07, LB-08
- **Date**: 2026-11-03
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-109 (assumed)

- **Decision**: bytes per player-hour come from a TCP meter in front of the API that counts bytes sent from the API to the players, headers and SSE framing included, inside the measuring window; k6's own byte counters are not used.
- **Reason**: the 70 KB budget is about what Render bills (service output); k6 does not reliably count SSE bytes with the extension.
- **Trade-off**: one more container in the path; its CPU is not limited.
- **Scope**: load-baseline / LB-14, LB-15
- **Date**: 2026-11-03
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-110 (assumed)

- **Decision**: the load code lives in `scripts/load/`, its unit tests in `scripts/test/load/` and its static test in `scripts/test/load-scripts.test.mjs`, not `tests/load`; `docs/engineering/testing.md` is updated to say so.
- **Reason**: `pnpm arch` scans `tests/` and rejects `k6/*` imports as unresolvable; excluding the path would loosen a sensor (rule 4). `scripts/` is not scanned, its tests under `scripts/test/` already run in `pnpm test:harness`, and `classifyProof` accepts `node --test` mutation proofs only under `scripts/test/`.
- **Trade-off**: the Design Doc and `testing.md` named `tests/load`.
- **Scope**: load-baseline / LB-01, LB-20
- **Date**: 2026-11-03
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-111 (assumed)

- **Decision**: when a step fails more than one rule, `failure.rule` is the first of `container`, `errors`, `latency`.
- **Reason**: the spec names the rule without an order; a dead container explains the other two.
- **Trade-off**: none known.
- **Scope**: load-baseline / LB-08, LB-11
- **Date**: 2026-11-03
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-112 (assumed)

- **Decision**: the API under load runs from an image that mirrors Render's build (`corepack enable && pnpm install --frozen-lockfile --ignore-scripts`) and start command (`node --import ./apps/api/src/main/instrument.ts apps/api/src/main/render.ts`), on `node:26-bookworm-slim`.
- **Reason**: the run should measure what ships; Render's service is not a Docker service, so the image is the closest equivalent.
- **Trade-off**: image build time on the first run.
- **Scope**: load-baseline / LB-01, LB-02
- **Date**: 2026-11-03
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-113 (assumed)

- **Decision**: the run's Postgres serves TLS with a throwaway CA and a server certificate made inside the Postgres container (the CA key is deleted there and no private key reaches the host); only the public CA certificate is copied out, into a 0700 temporary directory removed with the containers, and the API and the migration trust it through `NODE_EXTRA_CA_CERTS` and `sslmode=verify-full`.
- **Reason**: `main/render.ts` verifies the certificate and may not change here.
- **Trade-off**: certificate generation adds a step; nothing is stored in the repository.
- **Scope**: load-baseline / LB-01
- **Date**: 2026-11-03
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-114 (assumed)

- **Decision**: k6 runs from an image that compiles k6 with the `phymbert/xk6-sse` extension at pinned versions; the run never relies on k6's runtime auto-provisioning of extensions.
- **Reason**: reproducible, no network call at run time, supply chain pinned.
- **Trade-off**: a Go build on the first run; exact versions are recorded by T1.
- **Scope**: load-baseline / LB-01, LB-18
- **Date**: 2026-11-03
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-115 (assumed)

- **Decision**: a tool failure (Docker, a build, k6 crashing) is written to a separate `error` field with `passed: false` and a non-zero exit; `failure` keeps the spec's four rules about the system under test.
- **Reason**: an OOM of the generator is not a finding about the API.
- **Trade-off**: one extra summary field the ratchet ignores.
- **Scope**: load-baseline / LB-11, LB-12
- **Date**: 2026-11-03
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-116 (assumed)

- **Decision**: telemetry bytes are counted at the sink on the wire (request line, headers and body), in the same window as the byte meter.
- **Reason**: one definition of "bytes" across the summary.
- **Trade-off**: the API's exports are JSON over HTTP, so the figure is larger than a protobuf exporter would give; it is the figure the API really sends.
- **Scope**: load-baseline / LB-21, LB-22
- **Date**: 2026-11-03
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-117 (assumed)

- **Decision**: besides `LOAD_TARGET` and `DATABASE_URL` (LB-17), the run refuses a `DOCKER_HOST` that is not a local unix socket, a `DOCKER_CONTEXT` other than the default, and any inherited `OTEL_*` variable; the API container's environment is built from an allow-list, never from `process.env`.
- **Reason**: LB-17's intent is that the run touches only what it started; a remote Docker daemon or an inherited collector endpoint are the other ways to reach something else (security review of the design).
- **Trade-off**: a maintainer with a non-default Docker context must switch it for the run.
- **Scope**: load-baseline / LB-17
- **Date**: 2026-11-03
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-118 (assumed)

- **Decision**: the measuring window of a step is an offset pair on k6's own clock (full profile: start 50 s, end 140 s, i.e. 20 s ramp, then 30 s into the hold, 90 s long); the smoke profile's 30 s hold cannot hold a 90 s window, so its window is the whole hold (20 s to 50 s).
- **Reason**: the spec says the same rules for smoke and a non-empty window is the only reading that keeps them; a host clock is never compared with the meters (design § k6 journey).
- **Trade-off**: smoke numbers cover a window three times shorter than the full run's.
- **Scope**: load-baseline / LB-07, LB-09
- **Date**: 2026-11-03
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-119 (assumed)

- **Decision**: the windowed latency samples leave k6 as log lines (`LB_SAMPLE <ms>`, one `console.warn` per sample) that the orchestrator reads from the k6 container output; `step.json` carries the other window totals. An iteration still waiting for its assignment when the next match starts counts one error (status 0) and one iteration.
- **Reason**: `handleSummary` cannot see per-VU values, and the p95 that decides the verdict must come from raw samples computed in Node (architecture review of the design), not from k6's interpolated Trend.
- **Trade-off**: at most about 600 short log lines per step; they carry no secret.
- **Scope**: load-baseline / LB-05, LB-06, LB-08
- **Date**: 2026-11-03
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-120 (assumed)

- **Decision**: the throwaway TLS CA and server certificate are made by a short-lived container of a pinned `alpine/openssl` image into a per-run named volume (labelled, removed by the cleanup), which Postgres mounts read-only; only the public CA is copied out.
- **Reason**: the first real run showed `postgres:17-alpine` has no `openssl`; the design's named fallback applies. `apk add` at run time would fetch unpinned code.
- **Trade-off**: one more image and one more step before Postgres.
- **Scope**: load-baseline / LB-01
- **Date**: 2026-11-03
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-121 (assumed)

- **Decision**: no JavaScript timer runs while an SSE stream is open (k6 2.3 with xk6-sse 0.2.0 stops them): the test match comes from a `match` arrival-rate scenario (players ÷ 60 per second from the end of the ramp), streams end through the `timeout` argument of `sse.open`, and the 5 s `created` rule is evaluated where a frame or the end of the stream arrives (a frame at or after 5 000 ms, a stale iteration settled before the next frame, or an observation still pending 5 s or more at the end, is one error, tallied in the window of its observation time); a match whose assignment never arrives is counted as an error by the orchestrator (2xx `matchesPosted` minus `iterationsStarted`, both over the whole step, conservative); the `match` scenario stops at the window end and streams stay open for a 10 s tail so every observation made in the window is settled at the close.
- **Reason**: the run showed `setTimeout`/`setInterval` created in an `open` callback never fire; the iteration outcome stays the spec's, only the moment an error is counted moves.
- **Trade-off**: an iteration that never gets its frame is counted when its stream ends, not 5 s after its observation.
- **Scope**: load-baseline / LB-03, LB-05, LB-08
- **Date**: 2026-11-03
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-122 (assumed)

- **Decision**: matches start when the ramp ends, so every measuring window contains matches (full: each player's first match between 20 s and 80 s, window 50 s to 140 s; smoke: one match every 12 s from 20 s, window 20 s to 50 s); this completes AD-118.
- **Reason**: with the match posted when a stream opens (during the ramp) the smoke window had no iteration (T32).
- **Trade-off**: the first minute of a full step has no matches in flight.
- **Scope**: load-baseline / LB-05, LB-07, LB-09
- **Date**: 2026-11-03
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-123 (assumed)

- **Decision**: the stream-close tally runs at the stream's `error` event, once per stream; the code after `sse.open` returns shares the same helper and does nothing if it already ran.
- **Reason**: the real run showed `xk6-sse` 0.2.0 reads the `timeout` cut as a read error ("context deadline exceeded") and `sse.open` returns only when k6 interrupts the VU (up to `maxDuration` plus `gracefulStop` later); the code after it would otherwise run late or never, and pending observations would go uncounted.
- **Trade-off**: the handler does a little more work at the cut; a stream that dies with a read error before the tail ends is tallied as an early end.
- **Scope**: load-baseline / LB-05, LB-08
- **Date**: 2026-11-03
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-124 (assumed)

- **Decision**: a step's errors are broken down by kind (`status:<code>`, route, `created-late`, `pending-at-close`, `stream-early`, `lost-assignment`, `dropped`) and, for a failing step, by quarter of its players; the breakdown carries counts only, never a body, header, cookie or token.
- **Reason**: the first full run failed step 50 on `errors` (25 of 75 iterations) with latency and resource peaks low, and the summary could not say which request failed; without the breakdown a capacity finding and a defect cannot be told apart.
- **Trade-off**: two more fields in the summary rows.
- **Scope**: load-baseline / LB-08, LB-11, LB-15
- **Date**: 2026-11-03
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-125 (assumed)

- **Decision**: a failing provisioning request is reported with its route (`test-login`, `pairing-codes`, `pair`, `claim`), the player's index, its kind (`timeout`, `status:<code>`, `network`) and its elapsed time in milliseconds, never a name, cookie or token; the slowest time per route is kept per step. The 10 s limit per request is unchanged.
- **Reason**: the third full run stopped with "The operation was aborted due to timeout" before step 100 started and the summary could not say which request or why.
- **Trade-off**: one more field in the step row.
- **Scope**: load-baseline / LB-03, LB-12
- **Date**: 2026-11-03
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-126 (assumed)

- **Decision**: a step that fails while provisioning has no row, so its `provisionMsByRoute` goes in the summary's `error` text, as a lower bound (requests of the chunk still in flight are not counted); every failure inside a step now starts `step <n> stopped:`.
- **Reason**: T40 asks for the numbers in the step row also for a step that fails to start, and such a step has no row; a made-up row would count as an executed step.
- **Trade-off**: the numbers of a failed step are text inside `error`, not a field.
- **Scope**: load-baseline / LB-03, LB-12
- **Date**: 2026-11-03
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-127 (assumed)

- **Decision**: `pair` reads the account's current agent before `uow.run`, not with `tx` inside it. It is the one API change of load-baseline, authorised by the maintainer on 2026-11-03 ("A, pode descartar").
- **Reason**: the read was already outside the transaction, so moving it keeps behaviour the same with no port change, and removes the second connection a transaction asks for.
- **Trade-off**: the read is still not protected by the transaction, as today; reading with `tx` under a row lock would be a port change.
- **Scope**: load-baseline / LB-03
- **Date**: 2026-11-03
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-128 (assumed)

- **Decision**: the telemetry limit of AD-097 is report-only in F0 by the maintainer's decision ("A", 2026-11-04): `withinTelemetryBudget` is reported and published and does not fail the run. Setting `OTEL_EXPORTER_OTLP_ENDPOINT` in production waits for the share to be at or under 0.10, or for another limit from the maintainer.
- **Reason**: the full run held 400 players with 0 errors, and the share was 6.73. The brief's exit criterion names no telemetry limit, and the API exports nothing until the endpoint is set.
- **Trade-off**: F0 closes with telemetry 67 times over its limit, shown in the baseline and queued as a condition.
- **Scope**: load-baseline / LB-21, LB-22
- **Date**: 2026-11-04
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-129 (assumed)

- **Decision**: a step's error count stays the window's errors plus the whole step's lost assignments and dropped arrivals, and the spec's text now says so. No new requirement ID.
- **Reason**: the Verifier found the spec narrower than the behaviour. The behaviour is the stricter one, design Revision 1 (d) chose it on purpose, and C52's unit test pins it.
- **Trade-off**: a step can fail `errors` on events outside its window; no passing run is affected, since every step had 0 errors.
- **Scope**: load-baseline / LB-08
- **Date**: 2026-11-04
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-130 (assumed)

- **Decision**: the nightly `quality` job needs `agent-mutation` and runs with `if: ${{ !cancelled() }}`, so it still runs when that job fails or is skipped; it downloads the agent's reports unless the job was skipped, and a download with no artifact does not fail the job (`continue-on-error`), so the ratchet step still runs and gives its own verdict.
- **Reason**: brief revision 3 left the skipped case to this feature (CRF-13, CRF-15). `detect` sets `agent=true` whenever `apps/agent/src-tauri/Cargo.toml` exists, so the job runs every night in practice. A real score must reach the ratchet even when cargo-mutants exits non-zero on a missed mutant. The rule adds no user-visible commitment and is reversible in one workflow file.
- **Trade-off**: `quality` now waits up to 90 minutes for the Windows job. If the agent job produces no report once a value is measured, the ratchet fails with "a sensor stopped reporting", which is the wanted signal.
- **Scope**: ci-and-review-fixes / CRF-12 to CRF-17
- **Date**: 2026-11-04
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-131 (assumed)

- **Decision**: the shared sampler vector moves from `packages/telemetry/test-vectors/sampler.json` to `apps/agent/src-tauri/adapters/test-vectors/sampler.json`, both its readers follow it, and the agent's mutation commands create `reports/mutation` first.
- **Reason**: cargo-mutants copies only `apps/agent/src-tauri`, so the adapters' `--lib` baseline fails with the vector outside it, and it does not create the parent of `--output`. The nightly job would fail the same way. Skipping the test or dropping the adapters would weaken a sensor. AD-102 says the vector comes from the Rust rule, so the crate is its natural home. No product code changes: both paths are in test code. This goes past brief revision 3's sketch, so it is listed for the maintainer.
- **Trade-off**: the telemetry package's test reads a file under `apps/`, and turbo's cache for that test no longer sees the vector as an input. Reversal: move the file back and drop the adapters from the mutation commands.
- **Scope**: ci-and-review-fixes / CRF-25 to CRF-28
- **Date**: 2026-11-04
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-132 (assumed)

- **Decision**: the 7 mutants the adapters' run reports as missed are killed with unit tests in `queue.rs`, `relay_client.rs` and `sanitize.rs`, with no production change and no scope exclusion.
- **Reason**: the mutants were hidden because the adapters' baseline had failed since `observability-e2e` added the vector test, so no run reached them. cargo-mutants exits non-zero on a missed mutant, so the nightly's job would stay red. Among them is `sanitize_resource_key -> true`, a privacy rule no `--lib` test pinned. The maintainer chose unit tests over a narrower scope for the same situation on 2026-11-02 (`agent-hexagonal-migration`, decisions.md). Tests only add a sensor and are reversible.
- **Trade-off**: more scope than brief revision 3's sketch, and CRF-29 has no fresh `spec-reviewer` verdict because its dispatches are used up. Reversal: delete the tests, and the nightly's adapters step goes red.
- **Scope**: ci-and-review-fixes / CRF-29
- **Date**: 2026-11-04
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-133 (assumed)

- **Decision**: every stream event that reaches the site during a read makes that read stale, whatever the event's type.
- **Reason**: a rule per event type needs more code and has no case that needs it. An event only costs one more read.
- **Trade-off**: a presence event during a read also costs one more read. Reversal: compare the event's type before marking the read stale.
- **Scope**: site-stale-read-fix / SSR-01
- **Date**: 2026-11-05
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-134 (assumed)

- **Decision**: when the new read fails, the site keeps what is on screen, including the stage the stream delivered.
- **Reason**: every read already follows this rule, and the event's stage is the newest thing the site knows.
- **Trade-off**: the screen can stay behind until the next event or stream open. Reversal: retry the failed read.
- **Scope**: site-stale-read-fix / SSR-04
- **Date**: 2026-11-05
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-135 (assumed)

- **Decision**: a room stores the `traceparent` active when it opens whatever its sampled flag, and the observation links to it the same way.
- **Reason**: a link to a trace that was not exported costs nothing; a rule per flag adds code with no case that needs it.
- **Trade-off**: a link can point at a trace the backend never received. Reversal: store or link only sampled contexts.
- **Scope**: room-trace-link / RTL-01, RTL-03
- **Date**: 2026-11-07
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-136 (assumed)

- **Decision**: `lobby.record-observation` links only when the agent's account is a member of the room; a stranger's observation gets no link and the same 403.
- **Reason**: the span links only rooms the agent may act on, so nothing about a room is read for a stranger.
- **Trade-off**: a rejected observation cannot be followed to its room's match. Reversal: link once the room is found.
- **Scope**: room-trace-link / RTL-06
- **Date**: 2026-11-07
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-137 (assumed)

- **Decision**: the link is a plain OpenTelemetry span link with no attributes.
- **Reason**: Grafana's trace view lists span links and opens the linked trace; the trace id says everything an attribute would.
- **Trade-off**: none known. Reversal: add an attribute such as the room's stage.
- **Scope**: room-trace-link / RTL-03
- **Date**: 2026-11-07
- **Status**: active (assumed; pending phase review: .specs/phases/F0/decisions.md)

### AD-138 (maintainer, 2026-11-07)

- **Decision**: delivery is the runner's. It pushes (never force), opens and merges PRs into phase branches and `main`, releases, tags and runs workflows without asking. Secrets, the production database, repository settings and rulesets, and money stay the maintainer's.
- **Reason**: the maintainer wrote "push, merge, etc etc, não precisa ser mais meu. pode fazer sem precisar pedir aprovacao, ou que eu fale que queira que voce faça", and chose "Toda a entrega" when asked how far it goes.
- **Trade-off**: the required checks of `main` become the only lock before it; they gain `integration` and `agent`.
- **Scope**: harness; ADR 028; brief revision 6 (`harness-bootstrap`, `continuous-delivery`)
- **Date**: 2026-11-07
- **Status**: active once ADR 028 is accepted

### AD-139 (maintainer, 2026-11-07)

- **Decision**: a `harness-self` delegation scope lets the runner edit the gate, its registration and the retry-budget code in features the brief lists under it, guarded by `pnpm test:harness` and a recorded `security-reviewer` PASS on the diff before merge.
- **Reason**: the maintainer chose "Liberar com guarda" over asking for every edit or no guard.
- **Trade-off**: gate changes reach the phase branch without a human; the phase review lists them.
- **Scope**: harness; ADR 028; brief revision 6 (`harness-bootstrap`)
- **Date**: 2026-11-07
- **Status**: active once ADR 028 is accepted

### AD-140 (maintainer, 2026-11-07)

- **Decision**: environment failures and unchanged reruns no longer count against a retry budget, and the orchestrator may reset each unit once with a recorded reason; a second reset of a unit is the maintainer's. `MAX_RETRIES` stays 2.
- **Reason**: the maintainer chose "Orquestrador reseta 1 vez" over keeping every reset or resetting freely.
- **Trade-off**: a unit can now take up to six counted failures across two budgets before it reaches the maintainer.
- **Scope**: harness; ADR 022 in part; ADR 028; brief revision 6 (`budget-v2`)
- **Date**: 2026-11-07
- **Status**: active once ADR 028 is accepted

### AD-141 (maintainer, 2026-11-07)

- **Decision**: the harness pre-work for F1 runs as F0 brief revision 6, through the phase runner under F0's delegation; F0 closes after it.
- **Reason**: the maintainer chose "Revisão 6 da F0" over a separate track outside the phase.
- **Trade-off**: F0 stays open longer; F1's kickoff starts on the new harness.
- **Scope**: phase F0; `.specs/phases/F0/brief-revision-6.md`
- **Date**: 2026-11-07
- **Status**: active

### AD-142 (maintainer, 2026-11-07)

- **Decision**: every recommendation of the F0 retrospective is implemented before F1, ordered by the friction it removes. That includes making PR mutation testing a parallel, non-required job held by the nightly run and the phase ratchet.
- **Reason**: the maintainer wrote "sobre a recomendação que fez, quero que planeje tudo para ser implementado no repositorio" and "priorize as mudanças que removem friccoes do seu desenvolvimento, e aumentem a sua celeridade".
- **Trade-off**: a PR can merge with surviving mutants; the nightly report and the phase ratchet catch the score.
- **Scope**: brief revision 6 (all rows)
- **Date**: 2026-11-07
- **Status**: active

### AD-143 (assumed)

- **Decision**: the gate notes the head of `feat/<F>-<f>` when a foreground `security-reviewer` `review-diff` dispatch starts; a `PostToolUse` hook on the `Agent`/`Task` tool records the verdict from the dispatch's final report at that head, and a FAIL if the head moved or the report cannot be read; the gate denies that dispatch in the background.
- **Reason**: harness-bootstrap, HBS-22 to HBS-25. Brief revision 6 left to the design what the hook input carries. `PostToolUse` carries the tool's input and response, both written by Claude Code; a background dispatch returns before the verdict exists. Stricter: no verdict, no merge.
- **Trade-off**: the review of a harness-self diff blocks the orchestrator while it runs. Reversal: read the SubagentStop transcript instead.
- **Scope**: harness-bootstrap
- **Date**: 2026-11-07
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-144 (assumed)

- **Decision**: `gh pr merge` must name the head branch and use `--merge`; a PR number, no argument, `--squash`, `--rebase` or `--admin` is denied with the corrected command.
- **Reason**: harness-bootstrap, HBS-03 to HBS-05. The gate cannot reach GitHub to map a number to a feature; `main`'s ruleset allows merge commits only, which keep the progress trailers; `--admin` bypasses the required checks ADR 028 § 2 relies on.
- **Trade-off**: the runner types the branch name. Reversal: one rule in the gate.
- **Scope**: harness-bootstrap
- **Date**: 2026-11-07
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-145 (assumed)

- **Decision**: a local `git merge` into `main`, a push to `main`, to a remote other than `origin`, with no refspec or with a `src:dst` refspec, `wrangler deploy` / `wrangler pages deploy`, `npm`/`pnpm publish`, `gh release delete` and any `gh api` call with a method other than `GET` still ask.
- **Reason**: harness-bootstrap, HBS-11 and HBS-12. ADR 028 names the delivery commands and these are not among them: `main` changes through the phase PR, Cloudflare deploys run in CI, no package is published, and `gh api` writes can change rulesets and settings, which stay the maintainer's.
- **Trade-off**: a manual deploy or an API write still prompts. Reversal: one rule each in the gate.
- **Scope**: harness-bootstrap
- **Date**: 2026-11-07
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-146 (assumed)

- **Decision**: verdicts live in `verdicts.json` in the same directory under `.git/` as the hooks' ledger, and the gate denies any Edit or Write there and any shell command, inline code or untracked script that names that folder, `verdicts.json` or `ledger.json`, or enters a `.git` directory, except the read-only status commands. A covered branch merges only at its proven head; any other git command that brings its commits in is denied, and patch and plumbing commands ask (HBS-32 to HBS-48).
- **Reason**: harness-bootstrap, HBS-22 and HBS-26. Outside the tracked tree, so no commit carries a verdict; next to the ledger, which the hooks already own.
- **Trade-off**: verdicts are per machine, like the ledger. Reversal: move the store.
- **Scope**: harness-bootstrap
- **Date**: 2026-11-07
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-147 (assumed)

- **Decision**: HBS-47 (deny an operand that does not resolve) applies while the brief covers at least one feature under `harness-self`; while it does, every unresolvable operand is denied, whatever its name.
- **Reason**: harness-bootstrap Execute (T7). As written, HBS-47 denied merges of unfetched branches with nothing to guard, which contradicts HBS-03 and the existing merge expectations. A narrowing to operands named like a covered branch was rejected: it reopens the bypass of a branch pushed from a covered head, deleted locally and merged by name.
- **Trade-off**: while a feature is covered, the runner fetches or pushes a branch before merging it. Reversal: one condition in the guard.
- **Scope**: harness-bootstrap
- **Date**: 2026-11-07
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-148 (assumed)

- **Decision**: a `gh release create` or `gh release upload` whose file operand has a path segment starting with `.env` or equal to `.git` asks (HBS-49, appended to the approved spec).
- **Reason**: harness-bootstrap, the Verifier's finding 2: `gh release upload v1 .env` was an allowed shape, so a secrets file could reach a public release without a prompt (AGENTS.md rule 6). Stricter, and the release itself stays the runner's.
- **Trade-off**: attaching `.env.example` to a release also asks. Reversal: one pattern in `delivery.mjs`.
- **Scope**: harness-bootstrap
- **Date**: 2026-11-07
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-157 (assumed)

- **Decision**: a shell write to a harness or sensor file, the quality baseline or a test file is denied with an instruction to use the Edit tool; a shell write to a self-protected file keeps `ask`.
- **Reason**: gate-precision, GPR-08 to GPR-10. Brief revision 6 turns the ask into a deny; HBS-23's accepted scenario says `ask` for self-protected files, and changing an accepted scenario is the maintainer's.
- **Trade-off**: shell writes to the gate itself still prompt. Reversal: extend the deny to self-protected files with a new HBS scenario.
- **Scope**: gate-precision
- **Date**: 2026-11-08
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-158 (assumed)

- **Decision**: polling is the same trimmed Bash command string run a fifth time within a sliding 10 minutes in one agent session, every Bash call counted (a denied one too); the per-session history keeps hashes, not commands, in its own file next to the ledger, pruned to 10 minutes.
- **Reason**: gate-precision, GPR-17. The brief names "the fifth identical command within 10 minutes in one session"; the session id already separates parallel workers (ADR 022).
- **Trade-off**: an agent that legitimately repeats a command five times in 10 minutes is refused and told to wait. Reversal: one constant.
- **Scope**: gate-precision
- **Date**: 2026-11-08
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-159 (assumed)

- **Decision**: the replay corpus is extracted once from the F0 session transcripts by a committed extractor that keeps by allow-list: a Bash command is re-emitted word by word, with every word that is not a safe command, option, checkout path or revision replaced by `<v>`; Edit, Write, Read and Agent entries keep only the file path or subagent type, a size bucket and the matched pattern, never content or prompts. The repository path, home paths, the scratchpad, session ids, UUIDs, IPs and long hex or base64 runs are normalised everywhere, the gate's reason included. Expected decisions come from a category table in the test, not from the corpus.
- **Reason**: gate-precision, GPR-23 and GPR-24. The brief asks for "the F0 commands that prompted or were denied"; the transcripts record them. The repository is public, so nothing personal or secret may enter it; a deny-list misses opaque tokens (security review of the design).
- **Trade-off**: the corpus shows F0's commands in a public repository, normalised. Reversal: drop the fixture and keep the test on synthetic cases.
- **Scope**: gate-precision
- **Date**: 2026-11-08
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-160 (assumed)

- **Decision**: the 300 ms p95 is measured by a local benchmark over the corpus on the phase machine; CI runs the replay's decisions, not its timing.
- **Reason**: gate-precision, GPR-22. Timing on shared CI runners is not repeatable; the target is about the agent's machine.
- **Trade-off**: a slow-down shows only when the benchmark runs. Reversal: add a CI step.
- **Scope**: gate-precision
- **Date**: 2026-11-08
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-162 (assumed)

- **Decision**: the gate judges the script file it reads; a change to the file between that read and the run is not seen.
- **Reason**: gate-precision, GPR-11. The same holds today for every untracked script the gate reads; the agent that would change it is the one being gated, and its edits are gated too.
- **Trade-off**: a script rewritten between the gate's read and the run escapes the check. Reversal: ask for every script outside the repository again.
- **Scope**: gate-precision
- **Date**: 2026-11-08
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-163 (assumed)

- **Decision**: the read-only table keeps only forms whose every file read is a path operand the gate checks: no recursive or pattern-file `grep`, no `rg -g`/`-e`, no `diff` on a directory, no `awk`, no `sed` regular expression, and an option allow-list for each `git` command.
- **Reason**: gate-precision, GPR-02, GPR-03 and GPR-30. Each of those can reach a `.env` under a directory or hide what it reads; three spec reviews found such forms one by one.
- **Trade-off**: those forms keep today's prompt. Reversal: add a row with its own proof.
- **Scope**: gate-precision
- **Date**: 2026-11-08
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-164 (assumed)

- **Decision**: `git log -p` and `git show` with no path operand are read-only, though they print the whole history.
- **Reason**: gate-precision, GPR-02. No secret is committed (`.gitignore`, gitleaks in CI, `pnpm secrets:scan` locally), and the history is public on GitHub.
- **Trade-off**: a secret committed by mistake would be printed without a prompt. Reversal: require a path operand.
- **Scope**: gate-precision
- **Date**: 2026-11-08
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-165 (assumed)

- **Decision**: inline code (`python3 -c`, `python3 -` with a here-doc, `node -e`, `perl -e`) that writes the quality baseline keeps today's `ask`; GPR-09's deny naming the Edit tool covers harness, sensor and test files.
- **Reason**: gate-precision, GPR-09. Two accepted assertions of `.claude/hooks/test/gate-rules.test.mjs` (harness-foundation) pin `ask` for inline baseline writes, and the row keeps every existing test unchanged (GPR-27).
- **Trade-off**: an inline write to the baseline prompts instead of being refused. Reversal: change those two assertions to `deny` (the maintainer's decision).
- **Scope**: gate-precision
- **Date**: 2026-11-08
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-166 (assumed)

- **Decision**: inline code whose write call takes a path that is not a string literal asks, whatever file it would write.
- **Reason**: gate-precision, GPR-09. A worker wrote `gate-rules.mjs` through `node -e` with the path in a shell variable and the gate did not see it; the gate cannot judge a write whose target it cannot read, and the conservative answer is a prompt.
- **Trade-off**: inline code that computes its output path prompts. Reversal: one rule in `checkInlineCode`.
- **Scope**: gate-precision
- **Date**: 2026-11-08
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-153 (assumed)

- **Decision**: an unchanged rerun is one with the same command and the same working-directory tree (tracked and untracked files git does not ignore, written through a temporary index, taken before the command starts) as the unit's latest counted failure since its last pass or reset; without a computable tree nothing is refused.
- **Reason**: budget-v2, BUD-08 to BUD-10. ADR 028 § 4 refuses "running a unit again with nothing changed"; the brief says "the content of the paths the feature touches". One tree hash needs no rule for which paths belong to a feature.
- **Trade-off**: an edit anywhere in the worktree lets a rerun run. Reversal: hash a path set instead.
- **Scope**: budget-v2
- **Date**: 2026-11-08
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-154 (assumed)

- **Decision**: `attempt.mjs run` stops a command after `--timeout <minutes>`, 60 by default, and records the stop as an environment failure.
- **Reason**: budget-v2, BUD-06. ADR 028 § 4 lists "the wrapper's own timeout" among the signatures, and the wrapper has none today; 60 minutes is above every F0 gate, a full acceptance run included.
- **Trade-off**: a gate that hangs on a code defect is not counted; three in a row block the unit as `env-blocked`, so it still stops. Reversal: one default.
- **Scope**: budget-v2
- **Date**: 2026-11-08
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-155 (assumed)

- **Decision**: a red stop whose failing checks match an environment signature lets the agent stop, is not counted, and says the machine needs attention.
- **Reason**: budget-v2, BUD-07. Blocking the stop without counting it could loop; counting it is what ADR 028 § 4 removes.
- **Trade-off**: an agent may end a turn with red checks caused by the machine. Reversal: count it again.
- **Scope**: budget-v2
- **Date**: 2026-11-08
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-156 (assumed)

- **Decision**: a failure whose output matches an environment signature and also shows a test-failure marker counts as an ordinary failure; a red stop is uncounted only when every failing check matches a signature with no marker.
- **Reason**: budget-v2, BUD-02, BUD-07 and BUD-26. A real test failure must never spend nothing; a machine problem that is real shows again on the next run.
- **Trade-off**: a run that both hit Docker and failed a test spends a unit. Reversal: drop the marker rule.
- **Scope**: budget-v2
- **Date**: 2026-11-08
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-167 (assumed)

- **Decision**: the environment signatures stay as they are; a unit is `env-blocked` at its fourth environment failure since its last pass or reset, in a row or not (BUD-30), next to the three-in-a-row rule; an agent session leaves at most two red stops uncounted as machine-caused (BUD-31).
- **Reason**: budget-v2, security review of the diff (2026-11-08): the agent writes the gate command and the code its checks run, so `exit 137`, `exit 127` or an echoed signature makes its own failure look environmental. The maintainer chose option (b), "vai de B" (2026-11-08): keep ADR 028's three-in-a-row rule and close the hole without changing it. The runner kept the signatures (making `killed` SIGKILL-only would edit an approved scenario's example) and bounds forging with the two totals instead.
- **Trade-off**: forging a machine failure gains at most three free runs over a unit's life, and the fourth blocks it; a machine that fails four times across a unit's life blocks it too. Reversal: raise the totals.
- **Scope**: budget-v2

### AD-149 (assumed)

- **Decision**: the nightly agent mutation runs on `ubuntu-latest`.
- **Reason**: ci-fast-path, CFP-10. Brief revision 6 moves it "if the three crates build there": none of `d2rmm-agent-domain`, `-core` or `-adapters` has Windows-only code or dependencies, and CI's `integration` job already builds the adapters on Ubuntu.
- **Trade-off**: a Windows-only defect in those crates' unit tests shows in the `agent` PR job, not in the nightly. Reversal: one `runs-on` line.
- **Scope**: ci-fast-path
- **Date**: 2026-11-08
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-150 (assumed)

- **Decision**: majors of the eslint family and of `@opentelemetry/*` arrive in one Dependabot group each, held by a 30-day `cooldown`; npm stays on a weekly schedule.
- **Reason**: ci-fast-path, CFP-20 to CFP-22. The brief asks for a "monthly group"; Dependabot refuses a second `npm` entry for the same directory, so one ecosystem cannot have two schedules. The cooldown gives each major a month before it arrives.
- **Trade-off**: a major can still arrive in any week once it is 30 days old. Reversal: the `cooldown` block.
- **Scope**: ci-fast-path
- **Date**: 2026-11-08
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-151 (assumed)

- **Decision**: the specs check refuses a mutation command only in the gate of an open task (one unticked `Done when` box or more).
- **Reason**: ci-fast-path, CFP-11 and CFP-12. Done tasks of `ci-and-review-fixes` ran mutation in their gates under the old rules; the rule is for the work ahead.
- **Trade-off**: none for open work. Reversal: drop the condition.
- **Scope**: ci-fast-path
- **Date**: 2026-11-08
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-152 (assumed)

- **Decision**: third-party actions of the new CI jobs are pinned by full commit SHA; `actions/*` keep the workflow's tags.
- **Reason**: ci-fast-path, CFP-19. The `agent` job already pins its third-party actions; a non-required job still runs on every PR.
- **Trade-off**: Dependabot bumps the pins. Reversal: use tags.
- **Scope**: ci-fast-path
- **Date**: 2026-11-08
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-161 (assumed)

- **Decision**: the smoke job installs, migrates and starts the API with Render's own commands (`render.yaml` and `deploy-api.yml`) instead of a compiled build; CFP-25 is appended to the approved spec.
- **Reason**: ci-fast-path, CFP-15 and CFP-25. Render runs the API from `src/` with Node; a smoke check of a `tsc` build would test something production never runs.
- **Trade-off**: none; the brief asks for a check of the deploy path. Reversal: one job.
- **Scope**: ci-fast-path
- **Date**: 2026-11-08
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-168 (assumed)

- **Decision**: `phase-status` drops the `awaiting-review` step: a phase whose `review.md` exists goes to `merge`, then `closed` once `phase/F<n>` is merged into `main`; an approval line in the review is no longer read.
- **Reason**: continuous-delivery, CDL-07. ADR 028 § 1: the runner merges the phase PR when the review's gates are green, and the maintainer reads the review afterwards.
- **Trade-off**: the phase closes before the maintainer reads the review; anything sent back becomes a follow-up feature. Reversal: restore the step.
- **Scope**: continuous-delivery
- **Date**: 2026-11-08
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-169 (assumed)

- **Decision**: what still needs the maintainer is a row of a `## For the maintainer` table in the phase's `decisions.md` (Feature, Item, Asked, Answer); a row with an empty Answer blocks its feature with the reason `maintainer`; `phase-status` prints each open row on its feature's line on every run, never suppressed after the first; a blank Answer is open.
- **Reason**: continuous-delivery, CDL-08 to CDL-10. Brief revision 6 asks for one place, "shown once per feature", blocking only the feature that needs it; ADR 024 asks for state derived from files.
- **Trade-off**: the maintainer answers by editing a table. Reversal: another evidence source in `phase-state.mjs`.
- **Scope**: continuous-delivery
- **Date**: 2026-11-08
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-170 (assumed)

- **Decision**: before merging the phase PR into `main`, the runner requires `verify`, `integration`, `agent` and `secrets` (the checks ADR 028 § 2 names) to have run on the PR's head and passed, whatever the applied ruleset requires.
- **Reason**: continuous-delivery, CDL-06. Applying the ruleset is the maintainer's; until it is applied GitHub may require fewer checks, and the runner must not merge into `main` on less than ADR 028 names.
- **Trade-off**: a check renamed in CI blocks the phase merge until the list follows. Reversal: read the required checks from the ruleset file.
- **Scope**: continuous-delivery
- **Date**: 2026-11-08
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-171 (assumed)

- **Decision**: the review step does not merge the phase PR while any maintainer item of the phase is open; it lists the open items in `review.md` and stops.
- **Reason**: continuous-delivery, Verifier finding 4. With `review.md` written and a feature blocked only by an open maintainer item, `phase-status` reads `merge`; merging into `main` with an unanswered maintainer question would ship what the maintainer has not decided.
- **Trade-off**: one open question holds the phase PR. Reversal: one sentence in the skill.
- **Scope**: continuous-delivery
- **Date**: 2026-11-08
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-172 (assumed)

- **Decision**: the BUD-30 total of environment failures is cleared only by a reset of the unit, not by a pass.
- **Reason**: budget-v2, second security review of the diff (2026-11-09): `attempt.mjs run` does not check that a task's command is its `**Gate**`, so `-- "true"` is a real pass, and with the total cleared by a pass an agent bought two free runs per cycle without end. With the total cleared only by a reset, forging buys at most three uncounted environment failures until the next reset (a forged pass adds none and only marks the unit passed), and resets are the orchestrator's one or the maintainer's.
- **Trade-off**: a unit whose machine fails four times over its whole life blocks, even with passes between. Reversal: clear the total on a pass of the task's own gate command, once the wrapper checks it.
- **Scope**: budget-v2
- **Date**: 2026-11-09
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-174 (assumed)

- **Decision**: the proofs preflight keys a proof by its command plus the path and content of every file the branch changes against `phase/<F>` (committed, staged, unstaged or untracked). It keeps its cache in the ignored `reports/proofs-cache/<feature>.json` and runs through the wrapper as step `fix`. The official `check_proofs.py` stays step `proofs`.
- **Reason**: fast-proofs. This is the brief's key and step (brief-revision-6 § 3). `fix` is the closed-list step of the fix loop, so the preflight does not spend the official run's budget.
- **Trade-off**: any change to a feature file invalidates every cached proof of that feature. The cache saves reruns with no change and the proofs left after an unrelated failure. Reversal: a narrower key in one function.
- **Scope**: fast-proofs
- **Date**: 2026-11-09
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-175 (assumed)

- **Decision**: a shell write to a protected, non-self-protected file after `2>&1` is denied, not asked. budget-v2's test "still stops a real write after 2>&1" expects `deny` for `cat a 2>&1 > eslint.config.mjs`.
- **Reason**: merging `phase/F0` into gate-precision. gate-precision's approved GPR-08 to GPR-10 (AD-157, brief revision 6) turn the shell-write ask into a deny. The change tightens budget-v2's assertion: the write is still caught.
- **Trade-off**: none for honest work; the Edit tool is the route. Reversal: one expected value.
- **Scope**: gate-precision, budget-v2
- **Date**: 2026-11-09
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

### AD-176 (assumed)

- **Decision**: two examples of gate-precision's `acceptance.feature` change; no requirement text does:
  - GPR-01's `find . -name …` becomes `find apps -name …`;
  - GPR-33's first example becomes `pnpm --filter @d2rmm/api list`.
- **Reason**: T16's run. A `find` from `.` lists the git directory, which GPR-31 keeps out. In the Background's phase run, a `typecheck` outside the wrapper is denied by the sensor rule, which is not what GPR-33 is about.
- **Trade-off**: neither example tests what it was written for any more; the rules they now cover are the ones the spec states. Reversal: restore the examples with a non-phase Background.
- **Scope**: gate-precision
- **Date**: 2026-11-09
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

## Handoff

- **Feature**: agent-skeleton (Execute next)
- **Phase / Task**: F0 run. harness-foundation and api-web-skeleton merged into `phase/F0`. agent-skeleton: spec, design and tasks approved (T1–T33), Execute not started
- **Completed**: AD-029…AD-062 recorded
- **In-progress**: none
- **Next step**: agent-skeleton Execute from T1 in worktree `.claude/worktrees/agent-skeleton` (phase/F0 merged in after api-web-skeleton's integration, AD-035). Then observability-e2e and load-baseline Specify
- **Blockers**: none. Rust lives in `~/.cargo/bin`, which is not on the default shell PATH; Docker is running
- **Uncommitted files**: none after the merge commit
- **Branch**: feat/F0-agent-skeleton
