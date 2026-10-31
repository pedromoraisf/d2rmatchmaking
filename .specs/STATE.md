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

## Handoff

- **Feature**: agent-skeleton (Execute next)
- **Phase / Task**: F0 run. harness-foundation and api-web-skeleton merged into `phase/F0`. agent-skeleton: spec, design and tasks approved (T1–T33), Execute not started
- **Completed**: AD-029…AD-062 recorded
- **In-progress**: none
- **Next step**: agent-skeleton Execute from T1 in worktree `.claude/worktrees/agent-skeleton` (phase/F0 merged in after api-web-skeleton's integration, AD-035). Then observability-e2e and load-baseline Specify
- **Blockers**: none. Rust lives in `~/.cargo/bin`, which is not on the default shell PATH; Docker is running
- **Uncommitted files**: none after the merge commit
- **Branch**: feat/F0-agent-skeleton
