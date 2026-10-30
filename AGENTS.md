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
apps/agent         Tauri 2: src-tauri (Rust core: sensors, fusion, local queue), ui (React)
packages/contracts Zod schemas → JSON Schema (Rust via typify) → openapi.json + asyncapi.json (generated, committed)
packages/telemetry OpenTelemetry bootstrap for Node and browser
packages/config    shared tsconfig / eslint / prettier presets
.specs/            TLC spec-driven state: STATE.md, phases/<F#>/, features/<feature>/
.claude/           settings.json (hooks), hooks/, skills/, agents/, commands/
.cursor/rules/     scoped rules (same content, Cursor format)
```

Bounded contexts: **Identity** (Account, Character) · **Agents** (pairing, presence, version, remote config) ·
**Matchmaking** (QueueTicket, ReadyCheck) · **Lobby Room** (LobbyRoom, Member, Run, ScoreReport) · **Ranking** (Rating, Season).

## Commands

| Goal | Command |
| --- | --- |
| Install (also installs Lefthook git hooks) | `pnpm install` |
| Everything CI runs, locally | `pnpm check` |
| Unit tests (all workspaces + harness) | `pnpm test` |
| Harness self-tests only (hooks, ratchet, specs) | `pnpm test:harness` |
| Lint / types / architecture | `pnpm lint` · `pnpm typecheck` · `pnpm arch` |
| Integration (Testcontainers) / e2e (Playwright) | `pnpm test:integration` · `pnpm test:e2e` |
| Mutation (Stryker / cargo-mutants) | `pnpm test:mutation` |
| Regenerate OpenAPI + AsyncAPI | `pnpm contracts:openapi` (then commit the JSON) |
| Harness maturity gate (L4) | `pnpm harness:gate` |
| Quality ratchet | `pnpm quality:collect && pnpm quality:ratchet --context pr` |
| Phase-delegation checks on `.specs/` | `pnpm specs:check` |
| Run a gate within the retry budget (phase runs) | `node scripts/attempt.mjs run --feature <f> --step <T#> -- "<cmd>"` |
| Retry-budget status / report | `node scripts/attempt.mjs status [--feature <f>]` · `node scripts/attempt.mjs report` |
| Rust agent | `cargo nextest run` / `cargo clippy --all-targets -- -D warnings` in `apps/agent/src-tauri` |

Node 26 (`.nvmrc`), pnpm 10, Python 3.8+ (TLC gate scripts, stdlib only), Rust stable for the agent.

## Inviolable rules

1. **Architecture.** `domain` imports only its own domain and `shared-kernel`: no I/O, no frameworks, no clock or
   randomness (inject `Clock`, `IdGenerator`). `application` uses ports, never `adapters`, `main`, Fastify, Kysely or `pg`.
   Modules talk through their public `index.ts` port or events — never another module's internals. Nothing imports
   `main/`; only `main/` knows the provider (Render, Neon, Grafana). Enforced by `.dependency-cruiser.cjs`.
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
7. **Blast radius.** Approvals authorize local work and local commits only. `git push`, merges to `main`, deploys,
   releases, tags, secrets and any production DB access need the maintainer's explicit go-ahead for that action.
8. **Approvals are the maintainer's.** Never write an `**Approved**:` line the maintainer did not give. Under a phase
   delegation, quote the kickoff words verbatim and cite the brief (see "Phase workflow").
9. **i18n from day 0.** No user-facing string hard-coded in components; English source strings, pt-BR translation.
10. **Telemetry from day 0.** New request paths, jobs and agent loops get spans; see `docs/engineering/telemetry.md`.
11. **Retry budget: 1 attempt + 2 retries.** Any failing unit of work — a gate, a subagent dispatch, a red stop, the
    same sensor failing on the same file, the same denied action — may be retried at most twice. The third failure
    blocks it; record the blocker and move on or report. Never route around it. Enforced by code (ADR 022,
    `.claude/skills/d2rmm-phase-runner/references/retry-budget.md`).

The Claude Code gate hook (`.claude/hooks/gate.mjs`) enforces most of these deterministically. If it denies or asks,
do not look for a workaround: follow the reason it gives.

## Phase workflow (how work is planned and run)

Development follows **TLC spec-driven development** (`.claude/skills/tlc-spec-driven`, vendored, CC-BY-4.0) wrapped by
the project skill **`d2rmm-phase-runner`** (ADR 021). The maintainer reviews **once per phase**, not per task:

1. **Kickoff** — `/phase-kickoff F<n>` drafts `.specs/phases/F<n>/brief.md` (features, scope, delegation checkboxes,
   budgets). The maintainer approves it in their own words, e.g.
   `aprovo specs e tasks da F0 que passarem nos gates automáticos`. That sentence is the phase approval.
2. **Run** — `/phase-run F<n>` executes each feature through Specify → Design → Tasks → Execute. Human stops in TLC are
   replaced by automatic gates: TLC scripts (`validate_spec.py`, `validate_tasks.py`), traceability to PRD FR/NFR, and the
   read-only reviewer subagents. A spec/tasks file that passes gets
   `**Approved**: <date> - user: "<kickoff words>" (delegated via .specs/phases/F<n>/brief.md)`.
   Gray areas take the **conservative default**, are recorded as `AD-NNN … (assumed)` in `.specs/STATE.md` and queued in
   `.specs/phases/F<n>/decisions.md`.
3. **Retry budget** — every failing unit gets 2 retries, then it is blocked (ADR 022). During a run, gates go through
   `scripts/attempt.mjs` and subagent prompts start with `[d2rmm feature=<f> step=<step>]`.
4. **Escalations interrupt mid-phase** (everything else waits for the review): push/merge to `main`, deploy, production
   DB, secrets, changing an accepted ADR, loosening tests/thresholds/sensors, a blocked feature that blocks the phase.
5. **Review** — `/phase-review F<n>` generates `.specs/phases/F<n>/review.md`: what shipped, proofs, mutation results,
   harness and ratchet deltas, assumed decisions to confirm, blocked items. The maintainer approves or sends back.

One commit per task (Conventional Commits, checked by `check_commit.py`), on a feature branch off `phase/F<n>`.

## How to test

- Pyramid: unit (Vitest / `cargo nextest`, snapshot with `insta`) → integration (Testcontainers Postgres) → contract
  (schema + OpenAPI drift) → e2e (Playwright) → load (k6, NFR-14: ≥100 concurrent players). Mutation on domain and
  application (StrykerJS) and agent core (`cargo-mutants`).
- Domain tests use fakes for ports (`FakeClock`, in-memory stores). No mocks of what you own.
- Each acceptance criterion has a check in `tasks.md ## Checks` whose command selects its test.
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
- Store prints longer than 30 days or capture without consent (NFR-04, NFR-05).
