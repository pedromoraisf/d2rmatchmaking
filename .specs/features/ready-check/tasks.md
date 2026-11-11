# Ready check — Tasks

Spec: `spec.md` · Scenarios: `acceptance.feature` · Branch: `feat/F1-ready-check` → `phase/F1` (after `queues`)

Placement (no design.md, Medium): the check is a `ReadyCheck` aggregate in `apps/api/src/modules/matchmaking/domain/`
(pure: `open`, `accept`, `decline`, `expire(now)` → outcome with accepted/declined/timed-out members); open checks in an
in-memory `ReadyCheckStore`; penalties in Postgres `matchmaking.penalties` (new migration, next free number); the 60 s
deadline through the existing `TimerScheduler`; `runMatcher` hands a group to `openReadyCheck` instead of publishing
`MatchFormed`; accepted members re-enter the queue with their original `joinedAt`. Routes:
`POST /v1/ready-checks/:id/accept` and `/decline` with a session (same origin) or the agent token (accept only).
Stream events `ready_check.started`, `ready_check.updated`, `ready_check.resolved` to the site; `ready_check.started`
and `ready_check.resolved` to the agent. Rules: domain pure, contracts regenerated, the whole API integration suite in
any route task's gate, no test weakened, `acceptance.feature` not edited; the hotkey sends no input (ADR 010).

## Batch 1

- [ ] T1 — Contracts: ready-check views, answer routes, refusal `ready-check-penalty` with seconds left, the three stream
      events for the site and two for the agent; OpenAPI, AsyncAPI and Rust types regenerated — gate:
      `pnpm --filter @d2rmm/contracts exec vitest run && pnpm contracts:openapi && (cd apps/agent/src-tauri && cargo run -q -p xtask -- contracts && cargo nextest run -p d2rmm-agent-adapters)`
- [ ] T2 — Domain `ReadyCheck` and the queue re-entry rule (RDY-01 … RDY-05), unit tests on the 60 s boundary (59.999 /
      60.000), decline at once, accepted members ahead of later tickets, penalties of 5 min at the boundary — gate:
      `pnpm --filter @d2rmm/api exec vitest run src/modules/matchmaking/domain`
- [ ] T3 — Application and adapters: `openReadyCheck`, `answerReadyCheck`, `expireReadyCheck`, penalty store (migration),
      the join refusal for a penalty, routes, stream projection, spans and the outcome metric (AD-087 list and dashboard
      panel); unit and integration tests (a penalty survives a restart); OpenAPI regenerated — gate:
      `pnpm --filter @d2rmm/api exec vitest run && pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts && pnpm --filter @d2rmm/telemetry exec vitest run && pnpm contracts:openapi && git diff --exit-code packages/contracts/openapi.json packages/contracts/asyncapi.json && pnpm arch`
- [ ] T4 — Site: the ready-check overlay of the prototype inside the site shell (countdown ring, members' marks, Accept,
      Decline, hotkey hint, the penalty sentence; focus on Accept; Escape does not decline), the penalty message on the
      queue panel; en + pt-BR; component tests — gate:
      `pnpm --filter @d2rmm/web exec vitest run && pnpm --filter @d2rmm/web lint`
- [ ] T5 — Agent: the `ready_check.started/resolved` events in the core, the accept call through the gateway, and the
      Ctrl+Shift+A global hotkey (Tauri global-shortcut) active only while a check is open; it calls the API only; Rust
      unit tests with fakes; the agent window shows the hotkey while a check is open (en + pt-BR) — gate:
      `pnpm --filter @d2rmm/agent exec vitest run && pnpm --filter @d2rmm/agent lint && cd apps/agent/src-tauri && cargo nextest run && cargo clippy --all-targets -- -D warnings && node ../../../scripts/agent/win-check.mjs`

## Batch 2

- [ ] T6 — Headless example: a `hotkey` stdin command that triggers the same accept path; acceptance steps for every
      step of `acceptance.feature` — gate: `pnpm exec turbo run test:acceptance -- --grep @RDY-`
- [ ] T7 — Whole-repo sensors — gate:
      `pnpm typecheck && pnpm lint && pnpm arch && pnpm specs:check && cd apps/agent/src-tauri && cargo clippy --all-targets -- -D warnings`
