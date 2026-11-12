# AGENTS.md — D2R Match Making

Canonical guide for every coding agent (Claude Code, Cursor, Codex…) and for humans. `CLAUDE.md` imports this file.
Read it fully before acting. When this file and another doc disagree, this file wins; fix the other doc.

## What this is

Community matchmaking for **Diablo II: Resurrected** (PC). Players queue for **PvP** or **Leveling**, accept a ready check,
receive a generated game name, the host creates the game **manually in-game** (public, no password), and a **read-only
desktop agent** confirms presence by reading the game window. Ranking is ELO per character × difficulty.

- Product: [`docs/product/prd.md`](docs/product/prd.md) (FR-01…FR-32, NFR-01…NFR-14)
- Architecture: [`docs/architecture/design-doc.md`](docs/architecture/design-doc.md) and [`docs/adr/`](docs/adr/)
- Domain: [`docs/domain/`](docs/domain/) — contexts, glossary, invariants, events
- Engineering rules: [`docs/engineering/`](docs/engineering/)
- Work in flight: [`.specs/`](.specs/) — `STATE.md`, phases, features

The project is open source (MIT), English-first UI with pt-BR i18n. Repo docs are in English; product source docs
(PRD, Design Doc) are kept in pt-BR as exported from the maintainer's Claude Docs.

## Repository map

```text
apps/web           React 19 + Vite SPA (Cloudflare Pages). features/<context>, shared/, app/ (composition)
apps/api           Node.js 26, Fastify 5, modular monolith (Render). src/modules/<ctx>/{domain,application,adapters}
                   src/shared-kernel (ids, Result, Clock, events), src/main/{local,render}.ts (composition roots)
apps/agent         Tauri 2, hexagonal (ADR 027): src-tauri/domain (d2rmm-agent-domain), src-tauri/core (d2rmm-agent-core),
                   src-tauri/adapters (d2rmm-agent-adapters), src-tauri (app crate d2rmm-agent: composition root), ui (React)
packages/contracts Zod schemas → JSON Schema (Rust via typify) → openapi.json + asyncapi.json (generated, committed)
packages/telemetry OpenTelemetry bootstrap for Node and browser
packages/config    shared tsconfig / eslint / prettier presets
.specs/            phases/<F#>/ (brief, decisions, review), features/<feature>/ (spec, scenarios, tasks), archive/
.claude/           settings.json (hooks), hooks/, skills/, agents/, commands/
.cursor/rules/     scoped rules (same content, Cursor format)
```

Bounded contexts: **Identity** (Account, Character) · **Agents** (pairing, presence, version, remote config) ·
**Matchmaking** (QueueTicket, ReadyCheck) · **Lobby Room** (LobbyRoom, Member, Run, ScoreReport) · **Ranking** (Rating, Season).

## Commands

| Goal                                                  | Command                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Install (also installs Lefthook git hooks)            | `pnpm install`                                                                              |
| Everything CI runs, locally                           | `pnpm check`                                                                                |
| Unit tests (all workspaces + harness)                 | `pnpm test`                                                                                 |
| Harness self-tests only (hooks, ratchet, specs)       | `pnpm test:harness`                                                                         |
| Lessons to read before planning                       | `docs/engineering/lessons.md`                                                               |
| Secret scan (secretlint locally; gitleaks runs in CI) | `pnpm secrets:scan`                                                                         |
| Lint / types / architecture                           | `pnpm lint` · `pnpm typecheck` · `pnpm arch`                                                |
| Integration (Testcontainers) / e2e (Playwright)       | `pnpm test:integration` · `pnpm test:e2e`                                                   |
| Acceptance (Gherkin via playwright-bdd)               | `pnpm test:acceptance` · coverage check: `pnpm acceptance:check`                            |
| Mutation (nightly only; Stryker / cargo-mutants)      | `pnpm test:mutation` · agent core, domain and adapters: `pnpm test:mutation:agent`          |
| Regenerate OpenAPI + AsyncAPI                         | `pnpm contracts:openapi` (then commit the JSON)                                             |
| Harness-score report (informational)                  | `pnpm harness`                                                                              |
| Quality ratchet                                       | `pnpm quality:collect && pnpm quality:ratchet --context pr`                                 |
| Checks on `.specs/` (roadmap coverage, scenarios)     | `pnpm specs:check`                                                                          |
| Where is the phase? (derived from files and branches) | `pnpm phase:status` · `--json`                                                              |
| Rust agent                                            | `cargo nextest run` / `cargo clippy --all-targets -- -D warnings` in `apps/agent/src-tauri` |

Node 26 (`.nvmrc`), pnpm 10, Python 3.8+ (the commit-message check, stdlib only), Rust stable for the agent. Everything
else (secret scanning, Playwright, Lefthook…) comes from `pnpm install`; no other system install is needed.

## Inviolable rules

1. **Architecture.** `domain` imports only its own domain and `shared-kernel`: no I/O, no frameworks, no clock or
   randomness (inject `Clock`, `IdGenerator`). `application` uses ports, never `adapters`, `main`, Fastify, Kysely or `pg`.
   Modules talk through their public `index.ts` port or events — never another module's internals. Nothing imports
   `main/`; only `main/` knows the provider (Render, Neon, Grafana). Enforced by `.dependency-cruiser.cjs`.
   The desktop agent keeps the same direction, `adapters → application → domain` (`d2rmm-agent-adapters` →
   `d2rmm-agent-core` → `d2rmm-agent-domain`, ADR 027). Its domain imports no I/O crate, reads no clock or randomness and
   no generated contract type. Enforced by the Cargo crate boundaries and `scripts/test/agent-architecture.test.mjs`.
2. **Contracts first.** Every route or schema change regenerates and commits `openapi.json` / `asyncapi.json`
   (`pnpm contracts:openapi`). CI fails on drift (ADR 020).
3. **Tests are never weakened.** Never delete, skip, `.only`, or loosen assertions to make a gate pass. Tests derive from
   the spec's acceptance criteria, not from the implementation.
4. **Sensors are never bypassed.** No `--no-verify`, no disabling Lefthook, no lowering `.quality-baseline.json`,
   no relaxing dependency-cruiser/ESLint rules, no lowering mutation thresholds. Those are maintainer decisions.
5. **The desktop agent only reads pixels and OS signals** of the game window (ADR 010). It never reads or writes game
   memory, injects code, hooks DirectX, intercepts network traffic, captures outside the game window, sends input that
   confirms an action in-game, or accepts commands from the server (the server sends data only).
6. **Secrets** live only in GitHub/Render/Cloudflare secrets. Never read, print or commit `.env*` (except `.env.example`).
   Never use the production database connection string.
7. **Blast radius (ADR 028).** Delivery is the runner's: `git push` (never forced), pull requests, merges (into phase
   branches and, through the phase PR, into `main`), releases, tags and workflow runs happen when the gates say so,
   without asking. Still the maintainer's: secrets and variables, the production database, repository settings,
   rulesets and environments, and anything that costs money. Force pushes and remote deletions are never allowed.
8. **Approvals are the maintainer's.** Never write an `**Approved**:` line the maintainer did not give. Approving a
   phase brief or a brief revision, approving a phase review, and accepting or superseding an ADR, are always the
   maintainer's.
9. **i18n from day 0.** No user-facing string hard-coded in components; English source strings, pt-BR translation.
10. **Telemetry from day 0.** New request paths, jobs and agent loops get spans; see `docs/engineering/telemetry.md`.
11. **Three failures, then stop.** Fix the cause before rerunning; an unchanged rerun proves nothing. After three
    failures of the same thing (a gate, a check, a dispatch), record the blocker in the phase's `decisions.md` (what
    failed, the last error, what each attempt changed), add a lesson to `docs/engineering/lessons.md` if it teaches
    one, and move to work that does not depend on it. Never route around it (ADR 029).
12. **Mutation testing runs against unit tests only** (ADR 026). A mutation's proof is a unit test: Rust
    `cargo nextest run -p <crate> --lib`, TypeScript `vitest run` on a colocated `*.test.ts`. Tests that assemble the
    service (integration, e2e, acceptance, load) never run once per mutation. A rule that only the assembled service
    can observe is extracted into a pure function and unit-tested. Mutation runs in the nightly only, never on a PR or in
    a task gate (ADR 029).

The Claude Code gate hook (`.claude/hooks/gate.mjs`) guards the irreversible ones (force pushes, deletions, secrets,
the production database, skipped hooks, vendored files, committed migrations, sensors); CI and the reviewers check the
rest. If the gate denies or asks, do not look for a workaround: follow the reason it gives.

## Phase workflow (how work is planned and run)

The project skill **`d2rmm-phase-runner`** runs each roadmap phase (ADR 029). The maintainer stops the work twice per
phase, at the brief and at the review:

1. **Kickoff** — `/phase-kickoff F<n>` drafts `.specs/phases/F<n>/brief.md`: goal, exit criteria, features with their
   requirements, decisions taken, what the runner needs. The maintainer approves it in their own words; that line
   covers every spec of the phase.
2. **Run** — `/phase-run F<n>`. Per feature: `spec.md` (EARS requirements traced to the PRD) with its
   `acceptance.feature`; `design.md` only for Large or Complex features; `tasks.md` as a checklist. `feature-worker`s
   (Sonnet by default; the maintainer switches the model in chat, ADR 031) implement batches in their own worktrees, runnable features in parallel, one Conventional Commit
   per task on `feat/F<n>-<feature>`. Each feature becomes one PR into `phase/F<n>`, reviewed once by the architecture
   (and, when relevant, security) reviewer, and merged when CI is green. Gray areas take the conservative default,
   written in the PR description; what the maintainer should confirm goes to the phase `decisions.md`.
3. **Escalations** interrupt mid-phase: production DB, secrets, repository settings and rulesets, money, changing an
   accepted ADR, loosening tests or sensors, a blocked feature that blocks the phase.
4. **Review** — `/phase-review F<n>` writes `review.md` with real numbers (exit criteria, PRs, nightly mutation scores,
   decisions to confirm, blocked items). The maintainer approves it; then the phase PR merges into `main`.

State is never remembered: `pnpm phase:status` derives it from the brief, the feature files and the merged feature
branches, so any session resumes from the same answer. `ROADMAP.md` assigns every PRD requirement to exactly one of
the five phases. Before planning, read `docs/engineering/lessons.md`.

## How to test

- Pyramid: unit (Vitest / `cargo nextest`, snapshot with `insta`) → integration (Testcontainers Postgres) → contract
  (schema + OpenAPI drift) → **acceptance (BDD)**: the English Gherkin scenarios in each feature's
  `.specs/features/<feature>/acceptance.feature`, run as-is by playwright-bdd (ADR 023) → load (k6, NFR-14: ≥100 concurrent players). Mutation on domain and
  application (StrykerJS) and agent core (`cargo-mutants`), always against the unit tests only (rule 12), in the
  nightly only.
- Domain tests use fakes for ports (`FakeClock`, in-memory stores). No mocks of what you own.
- Each requirement has at least one scenario tagged with its ID (`playwright test --grep @<REQ-ID>`). Scenarios are
  never edited to make code pass, skipped or focused.
- Details: `docs/engineering/testing.md`.

## Conventions

- TypeScript strict, ESM, no `any`, no `enum` (string unions), `Result` for expected failures, exceptions for bugs.
- Naming: domain in ubiquitous language (`docs/domain/glossary.md`). Room names `mm{activity}{difficulty}-{n}` (ADR 017).
- Files: kebab-case; one aggregate per folder in `domain/`.
- Commits: Conventional Commits with scope = app or module (`feat(lobby-room): …`).
- Rust: `clippy -D warnings`, no `unsafe` outside the capture crate's FFI boundary, `thiserror` for errors.

## Never do

- Add Redis, a queue service or a second instance in the MVP (ADR 006).
- Add a provider SDK outside `main/` (e.g. Datadog SDK — use OTLP, ADR 013).
- Edit `.claude/skills/tlc-spec-driven/**` (vendored) or an already-committed migration.
- Publish Blizzard logos/assets; the site shows a non-affiliation notice.
- Commit or push a game screenshot, blurred or not, to any branch: the repository is public and a push cannot be
  undone without a force push. Real screenshots stay outside the repository (read from a local path by an `xtask`
  command on the maintainer's machine); committed fixtures are drawn by `xtask`. `scripts/check-images.mjs` enforces it
  at commit time and in CI.
- Store prints longer than 30 days or capture without consent (NFR-04, NFR-05).
