# Lobby rooms — Tasks

Spec: `spec.md` · Design: `design.md` · Scenarios: `acceptance.feature` · Branch: `feat/F1-lobby-rooms` → `phase/F1`
(after `ready-check` and `agent-game-name`)

Rules: domain pure (`now` passed in); contracts regenerated; a route task runs the whole API integration suite;
committed migrations never edited; no test weakened; `acceptance.feature` not edited; never commit a game screenshot.

## Batch 1

- [x] T1 — Domain: the full `LobbyRoom` state machine of `design.md`, unit tests on every transition and refusal, the
      3:00 expiry boundary (2:59.999 / 3:00.000), host handover by join order, next-run name and confirmations reset —
      gate: `pnpm --filter @d2rmm/api exec vitest run src/modules/lobby-room/domain`
- [x] T2 — Contracts and events: `room.run_opened`, member changes, the new routes' schemas, the extended room view;
      OpenAPI, AsyncAPI and Rust types regenerated — gate:
      `pnpm --filter @d2rmm/contracts exec vitest run && pnpm contracts:openapi && (cd apps/agent/src-tauri && cargo run -q -p xtask -- contracts && cargo nextest run -p d2rmm-agent-adapters)`
- [ ] T3 — Application, persistence, routes and wiring (migration, timers, drop tolerance, subscribers, projection,
      spans, metrics in the AD-087 list with dashboard panels); unit and integration tests — gate:
      `pnpm --filter @d2rmm/api exec vitest run && pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts && pnpm --filter @d2rmm/telemetry exec vitest run && pnpm contracts:openapi && git diff --exit-code packages/contracts/openapi.json packages/contracts/asyncapi.json && pnpm arch`
- [ ] T4 — Agent: `room.run_opened` updates the assignment (new expected name) so the Party step reads the new run;
      core unit tests — gate:
      `cd apps/agent/src-tauri && cargo nextest run && cargo clippy --all-targets -- -D warnings`
- [ ] T5 — Site: the room panel of `design.md § Site`, en + pt-BR, component tests including keyboard use — gate:
      `pnpm --filter @d2rmm/web exec vitest run && pnpm --filter @d2rmm/web lint`

## Batch 2

- [ ] T6 — Acceptance steps for every step of `acceptance.feature` (two headless agents with drawn Party fixtures; the
      stack's clock) — gate: `pnpm exec turbo run test:acceptance -- --grep @LBR-`
- [ ] T7 — The whole existing acceptance suite still passes (rooms changed under F0, queues and ready-check scenarios),
      then the sensors — gate:
      `pnpm exec turbo run test:acceptance -- --grep "@AWS-|@IDB-|@CHR-|@QUE-|@RDY-|@AGN-|@LBR-|@SHL-" && pnpm exec turbo run test:acceptance -- --grep @OBS- --workers=1 && pnpm typecheck && pnpm lint && pnpm arch && pnpm specs:check`
