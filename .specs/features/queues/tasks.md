# Queues — Tasks

Spec: `spec.md` · Design: `design.md` · Scenarios: `acceptance.feature` · Branch: `feat/F1-queues` → `phase/F1`

Rules: domain pure (no clock, no randomness: `now` is a parameter); the matcher and entry rules are unit-tested at every
boundary (rule 12); contracts regenerated in the task that changes them; no test weakened; `acceptance.feature` not
edited; one Conventional Commit per task (`feat(matchmaking): …`, `feat(web): …`, `test(acceptance): …`).

## Batch 1

- [x] T1 — Contracts of `design.md § Contracts` with unit tests; OpenAPI and AsyncAPI regenerated — gate:
      `pnpm --filter @d2rmm/contracts exec vitest run && pnpm contracts:openapi`
- [x] T2 — Domain: queue ticket, entry rules (QUE-03, QUE-04), band (QUE-08), matcher (QUE-07, QUE-09 … QUE-12) with
      unit tests on every boundary (band at 29/30/59/60 s and the ± 400 cap, mutual band, floors 9/10, 39/40, 69/70,
      each filter differing alone, group sizes, teleporter/BO priority, host and join order, 2v2 snake teams) — gate:
      `pnpm --filter @d2rmm/api exec vitest run src/modules/matchmaking/domain`
- [x] T3 — Application: ports, `joinQueue` (every refusal of QUE-03 … QUE-06), `leaveQueue`, `runMatcher` (one unit of
      work: tickets out, `MatchFormed` in the outbox), `dropTicket`, `queue.updated` events, spans and metrics (QUE-16);
      unit tests with fakes — gate: `pnpm --filter @d2rmm/api exec vitest run src/modules/matchmaking/application`
- [x] T4 — Adapters and wiring: in-memory store, routes, the public port methods on Identity and Lobby Room, the stream
      hub's site-stream presence, the 1 s matcher timer and the drop subscribers in `main/`; route integration tests;
      OpenAPI regenerated — gate:
      `pnpm --filter @d2rmm/api exec vitest run && pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__ && pnpm contracts:openapi && git diff --exit-code packages/contracts/openapi.json packages/contracts/asyncapi.json && pnpm arch`
- [x] T5 — Site: `QueuePanel` and `SearchingPanel` per `design.md § Site`, en + pt-BR, component tests including
      keyboard use — gate: `pnpm --filter @d2rmm/web exec vitest run && pnpm --filter @d2rmm/web lint`

## Batch 2

- [x] T8 — Review of Batch 1: the `matchmaking.match` span and metrics run only when the matcher has tickets (no span on
      an idle tick); `d2r.queue.size` and `d2r.queue.wait` join the AD-087 instrument list in `packages/telemetry` with
      their dashboard panels, as that list's parity test requires; the site shows a translated message per refusal code
      (en + pt-BR) instead of one generic message — gate:
      `pnpm --filter @d2rmm/api exec vitest run src/modules/matchmaking && pnpm --filter @d2rmm/telemetry exec vitest run && pnpm --filter @d2rmm/web exec vitest run && pnpm --filter @d2rmm/web lint`

- [x] T6 — Acceptance steps in `tests/acceptance/steps/queues.steps.ts` for every step of `acceptance.feature`, using
      the stack's clock for waits — gate: `pnpm exec turbo run test:acceptance -- --grep @QUE-`
- [x] T7 — Whole-repo sensors — gate: `pnpm typecheck && pnpm lint && pnpm arch && pnpm specs:check`

## Batch 3 — review fixes (PR #51)

- [ ] T9 — 2v2 teams reach the room (architecture finding 1, QUE-12): `MatchMember` gains an optional `team: 'a' | 'b'`
      set by the matcher's snake teams in 2v2; contract and AsyncAPI regenerated; Lobby Room stores nothing new yet
      (teams are read in F3) but keeps the field in the room's members view — gate:
      `pnpm --filter @d2rmm/contracts exec vitest run && pnpm --filter @d2rmm/api exec vitest run && pnpm contracts:openapi && git diff --exit-code packages/contracts/openapi.json packages/contracts/asyncapi.json`
- [ ] T10 — Matcher cost (security finding 1, QUE-18, QUE-19): the store indexes tickets by id and by account (Maps);
      each tick buckets tickets by pool once and computes pool sizes per bucket; a pool holds at most 2,000 waiting
      tickets; joins are limited to 10 per account per minute (reuse the existing rate-limit store pattern), 429; a test
      with 3,000 unmatchable tickets in one pool asserts the tick does at most O(n·group size) band checks (count them;
      no wall-clock limit) — gate:
      `pnpm --filter @d2rmm/api exec vitest run src/modules/matchmaking && pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts`
- [ ] T11 — Small fixes (architecture findings 2, 3): a Lobby Room unit case for two members marked host; the test
      controls' reset cancels pending site-closed timers — gate:
      `pnpm --filter @d2rmm/api exec vitest run && pnpm exec turbo run test:acceptance -- --grep @QUE-`
