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
- **Status**: active (pending phase review: .specs/phases/F0/decisions.md)

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

- **Decision**: with no backend configured the relay answers `202` and drops; the relay keeps the spec's order (authentication, rate, type, size). A request with a credential is authenticated first, whatever the address bucket holds; the address bucket (120 a minute) counts only credential-less and failed-authentication requests and answers `429` for credential-less callers over the limit; a credential that misses the cache takes a token from a relay-wide lookup bucket (50 a second) and is refused with `429` when it is empty, so bad tokens stay off the database without refusing valid callers. Per principal 60 requests and 2 MiB a minute; relay-wide 4 MiB a minute and 16 MiB a UTC day (10% of the 5 GB monthly egress, NFR-14); at most 32 forwards and 8 MiB of bodies in flight; no redirects; response body cancelled. The limiter keeps principals and addresses in separate maps (addresses capped at 10 000 with an overflow bucket for credential-less callers), unwraps IPv4-mapped IPv6, and lives in `platform`.
- **Reason**: the spec fixes an immediate `202`, no retry and the order of AC 7; AC 4 limits unauthenticated callers only, so a shared address (Pages egress, NAT) must not lock valid callers out; the bounds keep a single free instance and the egress budget safe (ADR 006, NFR-14); the agents limiter is module-internal.
- **Trade-off**: a small duplication of the sliding-window rule; spans are lost silently under a flood; the daily counter resets on a restart; a flood of bad cookies through the Pages proxy can drain the lookup bucket and delay site telemetry. Reversal is exporting a rate-limit port from the agents module.
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

- **Decision**: the API's sampler is `ParentBased`: local parents are followed, `root` and `remoteParentNotSampled` use `TraceIdRatioBased(ratio)`, and `remoteParentSampled` uses the ratio plus a global token bucket (20 traces a second, burst 40). A caller's sampled flag or a ground trace id cannot export more than the bucket allows. Amends the reading of AD-089 and OBS-43 for remote parents only.
- **Reason**: a client chooses its trace id and sampled flag on any route, authenticated or not, so a pure parent-based or ratio sampler lets it force export to the maintainer's quota.
- **Trade-off**: under abuse the agent's sampled traces can be trimmed on the API side, leaving a partial trace; normal traffic stays far under 20 a second. Reversal is the plain `ParentBased(TraceIdRatioBased)` of AD-089.
- **Scope**: observability-e2e / OBS-43
- **Date**: 2026-11-02
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
