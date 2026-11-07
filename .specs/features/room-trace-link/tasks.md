# Room Trace Link Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, the walk, check_proofs, the Verifier and the screens sub-agent).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

Rules of this feature:

- Only the API and the acceptance steps change. No contract, agent, site, scenario, Playwright config or sensor change. `acceptance.feature` does not change during Execute.
- **The domain stays free of OpenTelemetry** (AGENTS.md rule 1). `LobbyRoom` and every domain file gain no trace field. The trace context lives behind a new application port, `RoomTraceContexts`, and the `shared-kernel` tracing helpers, which already import `@opentelemetry/api`.
- The link target is a span inside trace A (the outbox relay of `MatchFormed`). Tests and names say "trace A" or "the stored traceparent", never "the click".
- No test, scenario or sensor is weakened, skipped or focused. The only changed expectation is the migration list of `migrate.int.test.ts`, which gains `0003_room_trace_context` (additive).
- Every gate runs through `node scripts/attempt.mjs run --feature room-trace-link --step T<n> -- "<gate>"`, with nothing outside the quotes.

---

**Design**: none - Medium feature; the placement is fixed in the rules above and in each task
**Status**: Approved
**Approved**: 2026-11-07 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)
**Mutations**: 3
**Build**: `pnpm build; pnpm typecheck; pnpm lint; pnpm arch`

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `AGENTS.md` (How to test, rules 1, 3, 4 and 12), `docs/engineering/testing.md`.

| Code Layer                            | Required Test Type                                      | Coverage Expectation                                                            | Location Pattern                                                           | Run Command                                                                                                |
| ------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Shared-kernel tracing helpers         | unit (Vitest)                                           | Valid, absent and malformed contexts; one link with both ids; no link otherwise | `apps/api/src/shared-kernel/tracing.test.ts`                               | `pnpm --filter @d2rmm/api exec vitest run src/shared-kernel/tracing.test.ts`                               |
| Lobby Room use cases (application)    | unit (Vitest, in-memory fakes, in-memory span exporter) | RTL-01 to RTL-07, 1:1, and every edge case of `spec.md`                         | `apps/api/src/modules/lobby-room/application/lobby-room-use-cases.test.ts` | `pnpm --filter @d2rmm/api exec vitest run src/modules/lobby-room/application/lobby-room-use-cases.test.ts` |
| Migration and Postgres adapter        | integration (Testcontainers)                            | The new column, a room with none, a room with one                               | `apps/api/src/**/*.int.test.ts`                                            | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts <file>`                          |
| Composition root and acceptance steps | acceptance (playwright-bdd)                             | The scenario as written, against the local telemetry backend                    | `tests/acceptance/steps/observability.steps.ts`                            | `pnpm exec turbo run test:acceptance -- --grep @RTL-09`                                                    |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use                      | Command                                                                                                                                         |
| ---------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Quick      | Unit tasks                       | `pnpm --filter @d2rmm/api exec vitest run <test file>`                                                                                          |
| Full       | Integration and acceptance tasks | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts <test file>`; `pnpm exec turbo run test:acceptance -- --grep @RTL-09` |
| Build      | After the last task              | `pnpm build; pnpm typecheck; pnpm lint; pnpm arch`                                                                                              |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Helpers, storage, use cases and the scenario

One tight chain of six tasks, one batch.

```
T1 → T2 → T3 → T4 → T5 → T6
```

---

## Task Breakdown

### T1: Read the active traceparent and link the active span

**What**: add `activeTraceparent(): string | null` and `linkActiveSpan(traceparent: string): void` to the shared-kernel tracing helpers, exported from `shared-kernel/index.ts`. `activeTraceparent` returns the W3C `traceparent` (`00-<32 hex>-<16 hex>-<2 hex>`) of the active span when its context is valid (non-zero trace id and span id), otherwise `null`. `linkActiveSpan` parses the value and adds exactly one span link with that trace id and span id to the active span; a value that is not a valid W3C `traceparent`, or no active span, adds nothing and never throws.
**Where**: `apps/api/src/shared-kernel/tracing.ts`
**Depends on**: None
**Reuses**: `@opentelemetry/api` (`trace.getSpan`, `isSpanContextValid`, `Span.addLink`); the in-memory exporter set-up of `tracing.test.ts`. If `Span.addLink` is missing from the pinned `@opentelemetry/api`, stop and report: the plan relies on it.
**Requirement**: RTL-01, RTL-02, RTL-03, RTL-05

**Done when**:

- [x] `activeTraceparent` inside `withSpan` returns that span's traceparent; outside any span it returns `null`
- [x] `linkActiveSpan` with a valid value gives the active span exactly one link with the value's trace id and span id
- [x] `linkActiveSpan` with a malformed value (wrong length, non-hex, all-zero ids) adds no link and does not throw
- [x] Tests run with a context manager (`AsyncLocalStorageContextManager`) so the active span is real
- [x] Gate passes; every existing test of the file still passes

**Tests**: unit
**Gate**: `pnpm --filter @d2rmm/api exec vitest run src/shared-kernel/tracing.test.ts`

**Commit**: `feat(api): read the active traceparent and link the active span`

---

### T2: Add the room's traceparent column

**What**: migration `0003_room_trace_context` adds `lobby.rooms.trace_context text null` (down drops it); register it in `platform/postgres/migrator.ts`; add `trace_context: string | null` to `lobby.rooms` in `modules/lobby-room/adapters/postgres/schema.ts`; `migrate.int.test.ts` expects `['0001_skeleton', '0002_outbox_trace_context', '0003_room_trace_context']` with its other assertions unchanged.
**Where**: `apps/api/migrations/0003_room_trace_context.ts`
**Depends on**: T1
**Reuses**: `apps/api/migrations/0002_outbox_trace_context.ts`
**Requirement**: RTL-08

**Done when**:

- [x] The migration runs once on a fresh database and the column is nullable
- [x] `migrate.int.test.ts` and `migrator.int.test.ts` pass, with only the migration list extended
- [x] Gate passes

**Tests**: integration
**Gate**: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/migrate.int.test.ts src/platform/postgres/migrator.int.test.ts`

**Commit**: `feat(api): add the room's traceparent column`

---

### T3: Store the traceparent when a room opens

**What**: add the port `RoomTraceContexts { record(tx, roomId, traceparent): Promise<void>; find(roomId): Promise<string | null> }` to `application/ports.ts`, an in-memory fake in `application/testing/in-memory-room-trace-contexts.ts`, and a `traceContexts` dependency to `LobbyRoomDeps`. In `onMatchFormed`, inside the same unit of work that inserts the room, record `activeTraceparent()` when it is not `null`; an `already-created` match records nothing.
**Where**: `apps/api/src/modules/lobby-room/application/lobby-room-use-cases.ts`
**Depends on**: T2
**Reuses**: the in-memory fakes in `application/testing/`; T1's helpers
**Requirement**: RTL-01, RTL-02, RTL-07

**Done when**:

- [x] A room opened inside a span records that span's traceparent (test `stores the traceparent active when the room opens`)
- [x] A room opened with no span active records nothing (test `stores no traceparent when no span is active`)
- [x] A second `MatchFormed` for the same match records nothing new (test `records nothing for a match that already has a room`)
- [x] The events appended and the room's snapshot carry no traceparent field (test `keeps the traceparent out of the room's events and views`)
- [x] `LobbyRoom` and every file under `domain/` are unchanged
- [x] Gate passes; every existing test of the file still passes

**Tests**: unit
**Gate**: `pnpm --filter @d2rmm/api exec vitest run src/modules/lobby-room/application/lobby-room-use-cases.test.ts`

**Commit**: `feat(lobby-room): store the match's traceparent when a room opens`

---

### T4: Link the observation span to the room's traceparent

**What**: in `recordObservation`, after the membership check passes and before the `UNKNOWN` and idempotency exits, read `traceContexts.find(room.id)` and, when it is not `null`, call `linkActiveSpan` on it. The answers stay exactly as they are.
**Where**: `apps/api/src/modules/lobby-room/application/lobby-room-use-cases.ts`
**Depends on**: T3
**Reuses**: T1's `linkActiveSpan`; T3's fake
**Requirement**: RTL-03, RTL-04, RTL-05, RTL-06

**Done when**:

- [x] With a stored traceparent, the `lobby.record-observation` span has exactly one link with its trace id and span id (test `links the observation span to the room's stored traceparent`)
- [x] A repeated observation and an `UNKNOWN` one get the same link (test `links a repeated observation too`)
- [x] With nothing stored, no link and the same answer (test `adds no link when the room has no stored traceparent`)
- [x] With a malformed stored value, no link and the same answer (test `adds no link for a malformed stored traceparent`)
- [x] A stranger's agent and an unknown room get `forbidden` and no link (test `adds no link and answers forbidden for a stranger's agent`)
- [x] Gate passes; every existing test of the file still passes

**Tests**: unit
**Gate**: `pnpm --filter @d2rmm/api exec vitest run src/modules/lobby-room/application/lobby-room-use-cases.test.ts`

**Commit**: `feat(lobby-room): link the observation span to the match's trace`

---

### T5: Keep the traceparent in Postgres

**What**: `PostgresRoomTraceContexts` implements `RoomTraceContexts`: `record` updates `lobby.rooms.trace_context` for the room inside the given transaction; `find` reads it, `null` for a room with none or an unknown room.
**Where**: `apps/api/src/modules/lobby-room/adapters/postgres/postgres-room-trace-contexts.ts`
**Depends on**: T4
**Reuses**: `postgres-lobby-room-repository.ts` and `executor.ts` patterns; `lobby-repositories.int.test.ts` set-up
**Requirement**: RTL-08

**Done when**:

- [x] A room inserted without a traceparent reads `null` (test `reads a room written without a traceparent as having none`)
- [x] A recorded traceparent reads back equal (test `stores and reads a room's traceparent`)
- [x] Gate passes; every existing test of the file still passes

**Tests**: integration
**Gate**: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/modules/lobby-room/adapters/postgres/lobby-repositories.int.test.ts`

**Commit**: `feat(lobby-room): keep the room's traceparent in Postgres`

---

### T6: Wire the link and prove it in the scenario

**What**: pass `traceContexts: new PostgresRoomTraceContexts(...)` to `createLobbyRoomUseCases` in `main/app.ts`; implement the two new steps of `acceptance.feature` in `tests/acceptance/steps/observability.steps.ts`: "the telemetry backend holds, within 30 seconds, the trace whose root is the agent's observation span" and "its "lobby.record-observation" span links to the trace whose root is the site's test match action" (the link's trace id equals the id of the trace whose root is the site's action, read from the backend).
**Where**: `apps/api/src/main/app.ts`
**Depends on**: T5
**Reuses**: the trace reader in `tests/acceptance/support/trace-reader.ts` and the OBS-08 and OBS-12 steps
**Requirement**: RTL-09

**Done when**:

- [x] `@RTL-09` passes against the local telemetry backend
- [x] `lobby-routes.int.test.ts` passes unchanged
- [x] Gate passes

**Tests**: acceptance
**Gate**: `pnpm exec turbo run test:acceptance -- --grep @RTL-09`

**Commit**: `feat(api): wire the room trace link`

---

## Checks

**C1** - Inside a span, `activeTraceparent` returns that span's W3C traceparent (RTL-01, AC 1)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/shared-kernel/tracing.test.ts -t "returns the traceparent of the active span"`

**C2** - With no span active, `activeTraceparent` returns null (RTL-02, AC 2)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/shared-kernel/tracing.test.ts -t "returns null when no span is active"`

**C3** - A room opened inside a span records that span's traceparent (RTL-01, AC 1)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/modules/lobby-room/application/lobby-room-use-cases.test.ts -t "stores the traceparent active when the room opens"`

**C4** - A room opened with no span active records nothing (RTL-02, AC 2)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/modules/lobby-room/application/lobby-room-use-cases.test.ts -t "stores no traceparent when no span is active"`

**C5** - The observation span carries exactly one link, with the stored trace id and span id (RTL-03, AC 3)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/modules/lobby-room/application/lobby-room-use-cases.test.ts -t "links the observation span to the room's stored traceparent"`

**C6** - A repeated or `UNKNOWN` observation from a member gets the same link (RTL-03, AC 3)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/modules/lobby-room/application/lobby-room-use-cases.test.ts -t "links a repeated observation too"`

**C7** - With nothing stored, the observation span has no link and the answer is unchanged (RTL-04, AC 4)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/modules/lobby-room/application/lobby-room-use-cases.test.ts -t "adds no link when the room has no stored traceparent"`

**C8** - A malformed stored traceparent gives no link and the same answer (RTL-05, AC 5)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/modules/lobby-room/application/lobby-room-use-cases.test.ts -t "adds no link for a malformed stored traceparent"`

**C9** - A stranger's agent gets `forbidden` and no link (RTL-06, AC 6)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/modules/lobby-room/application/lobby-room-use-cases.test.ts -t "adds no link and answers forbidden for a stranger's agent"`

**C10** - The room's events and views carry no traceparent field (RTL-07, AC 7)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/modules/lobby-room/application/lobby-room-use-cases.test.ts -t "keeps the traceparent out of the room's events and views"`

**C11** - A room written without a traceparent reads as having none, and a recorded one reads back (RTL-08, AC 8)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/modules/lobby-room/adapters/postgres/lobby-repositories.int.test.ts -t "traceparent"`

**C12** - The migrations add `0003_room_trace_context` after the first two (RTL-08, AC 8)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/migrate.int.test.ts`

**C13** - In the backend, the agent's trace links to the trace whose root is the site's test match action (RTL-09, AC 9)
Proof: `pnpm exec turbo run test:acceptance -- --grep @RTL-09`

---

## Handoff

The feature's live state, written as it happens - a compaction gives no warning.

**Settled mid-build:** none
**Dispatched:** execute-batch-1 (T1 to T6) to `feature-worker` at `3166fa0`, 2026-11-07
**Walked:** none

---

## Phase Execution Map

```
Phase 1:  T1 ------→ T2 ------→ T3 ------→ T4 ------→ T5 ------→ T6
```

Execution is strictly sequential. Six tasks fit one batch: `execute-batch-1` runs T1 to T6.
