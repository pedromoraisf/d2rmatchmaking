# API and Web Skeleton Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, the walk, check_proofs, the Verifier and the screens sub-agent).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

Project rules for every task of this feature:

- Run each task's gate as its own Bash call, with nothing before or after it:
  `node scripts/attempt.mjs run --feature api-web-skeleton --step T<n> -- "<gate command>"`. The whole gate goes
  inside the quotes; no `cd … &&`, no `; echo`, no pipe outside them.
- Integration gates need Docker running (Testcontainers Postgres). If `docker info` fails, stop and report; do not
  skip the gate.
- `bddgen` without `--tags` fails on this branch until T50 (every scenario of `acceptance.feature` needs its steps,
  `missingSteps: 'fail-on-gen'`). Acceptance gates before T50 generate only their own tags with `bddgen test --tags`.
- Names in the ubiquitous language (`docs/domain/glossary.md`); files kebab-case; `Result` for expected failures; no
  `any`, no `enum`; every user-facing string through i18n; every use case inside `withSpan` (T8).
- Editing the sensor files named in a task's `Where` (`.dependency-cruiser.cjs`, `packages/config/eslint.mjs`,
  workflows, `tests/acceptance/playwright.config.ts`) is the task itself, under the phase delegation
  `harness-edits`; it only adds rules. The gate hook asks the maintainer for `playwright.config.ts` (T47) and for the
  harness-foundation scenario edit (T37, AD-044).

---

**Design**: `.specs/features/api-web-skeleton/design.md`
**Status**: Approved
**Approved**: 2026-10-30 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)
**Mutations**: 3
**Build**: `pnpm build; pnpm typecheck; pnpm lint; pnpm arch`

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `AGENTS.md` (How to test), `docs/engineering/testing.md`, `docs/adr/014-testing-and-mutation.md`, `docs/adr/023-bdd-acceptance.md`, `.quality-baseline.json` (mutation floors 80/70), `apps/api/scripts/mutation-plan.ts`, `tests/acceptance/playwright.config.ts`. Integration tests sit next to the code they exercise as `*.int.test.ts` (design.md § Composition roots), not under `apps/api/test/integration` as `testing.md` suggests; the unit config excludes them, so Stryker never runs them.

| Code Layer                                                      | Required Test Type                                          | Coverage Expectation                                                                                                | Location Pattern                                                                      | Run Command                                             |
| --------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Contracts schemas and generator                                 | unit (Vitest)                                               | Each schema accepts the design's example and rejects each bound; the generator writes every file, deterministically | `packages/contracts/src/**/*.test.ts`                                                 | `pnpm --filter @d2rmm/contracts test`                   |
| API domain and shared kernel                                    | unit (Vitest) + mutation ≥ 80%                              | All branches, 1:1 to the ACs, every boundary (2/16 chars, 7 days, 5 min, 45 s, 10 per window)                       | `apps/api/src/modules/*/domain/*.test.ts`, `apps/api/src/shared-kernel/*.test.ts`     | `pnpm --filter @d2rmm/api test`                         |
| API application (use cases)                                     | unit (Vitest, in-memory fakes) + mutation ≥ 70%             | Every use case: happy path and each error result; the span name                                                     | `apps/api/src/modules/*/application/*.test.ts`                                        | `pnpm --filter @d2rmm/api test`                         |
| API platform, pure parts (event bus, stream projection, guards) | unit (Vitest; guards with Fastify `inject` and fake ports)  | All branches                                                                                                        | `apps/api/src/platform/**/*.test.ts`                                                  | `pnpm --filter @d2rmm/api test`                         |
| API Postgres adapters, outbox, relay, migrations                | integration (Vitest + Testcontainers)                       | Key queries and constraints, the atomic claim race, rollback, restart, dead letter                                  | `apps/api/src/**/*.int.test.ts`                                                       | `pnpm --filter @d2rmm/api test:integration`             |
| API routes, stream hub, composition roots                       | integration (Fastify `inject` / real HTTP + Testcontainers) | Every route: happy path, every listed edge case, every error path                                                   | `apps/api/src/main/__tests__/*.int.test.ts`, `apps/api/src/platform/**/*.int.test.ts` | `pnpm --filter @d2rmm/api test:integration`             |
| Web shared modules and components                               | unit (Vitest + Testing Library, jsdom)                      | Each state (signed out, loading, error, signed in), each label, en/pt-BR key parity                                 | `apps/web/src/**/*.test.ts(x)`                                                        | `pnpm --filter @d2rmm/web test`                         |
| Pages Function                                                  | unit (Vitest)                                               | Allowed and refused paths, header allow-list, `Set-Cookie` and streamed bodies passed through                       | `apps/web/functions/**/*.test.ts`                                                     | `pnpm --filter @d2rmm/web test`                         |
| Sensor configuration (dependency-cruiser, ESLint) and workflows | harness unit (`node:test`) / preset unit (Vitest)           | Each new rule fails on its fixture and the clean fixture passes; each workflow guard asserted                       | `scripts/test/*.test.mjs`, `packages/config/test/*.test.ts`                           | `pnpm test:harness`, `pnpm --filter @d2rmm/config test` |
| Acceptance scenarios                                            | acceptance (playwright-bdd)                                 | Every scenario of `acceptance.feature`, as written                                                                  | `tests/acceptance/steps/*.steps.ts`                                                   | `pnpm --filter @d2rmm/acceptance test:acceptance`       |
| Type-only port declarations, `render.yaml`                      | none                                                        | - (build gate; their users are tested)                                                                              | -                                                                                     | build gate                                              |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use                            | Command                                                                                                                                                                                             |
| ---------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quick      | After tasks with unit tests only       | `pnpm --filter <workspace> typecheck && pnpm --filter <workspace> test` or `pnpm test:harness`                                                                                                      |
| Full       | After tasks with integration tests     | `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test && pnpm --filter @d2rmm/api test:integration`                                                                                  |
| Acceptance | After acceptance step tasks            | `pnpm --filter @d2rmm/acceptance exec bddgen test --tags "<tags>" && pnpm --filter @d2rmm/acceptance exec playwright test --grep "<tags>"` (T50: `pnpm --filter @d2rmm/acceptance test:acceptance`) |
| Build      | After config-only tasks and at the end | `pnpm build && pnpm typecheck && pnpm lint && pnpm arch && pnpm format:check`                                                                                                                       |

---

## Execution Plan

Phases run in order; tasks within a phase run in order. Reordered on 2026-10-30 at the maintainer's request ("C": advance what does not need Docker): every task that needs Docker (Testcontainers or the acceptance stack) is in Phase 9 or later. Task numbers are unchanged. Batches: 1 = Phase 1 (done), 2 = T6–T8 (done), 3 = Phases 2–4, 4 = Phases 5–6, 5 = Phases 7–8, 6 = Phases 9–10, 7 = Phase 11, 8 = Phase 12.

### Phase 1: Contracts and sensors

```
T1 → T2 → T3 → T4 → T5
```

### Phase 2: Shared kernel

```
T6 → T7 → T8 → T12
```

### Phase 3: Identity core

```
T14 → T15
```

### Phase 4: Agents core

```
T17 → T18 → T19 → T20 → T22
```

### Phase 5: Lobby Room and Matchmaking core

```
T23 → T24 → T25 → T27
```

### Phase 6: Pure platform

```
T28 → T29
```

### Phase 7: Web

```
T38 → T39 → T40 → T41 → T42 → T43 → T44
```

### Phase 8: Deploy workflows

```
T45 → T46
```

### Phase 9: Persistence (needs Docker from here on)

```
T9 → T10 → T11 → T13
```

### Phase 10: Postgres adapters

```
T16 → T21 → T26
```

### Phase 11: Streams, HTTP routes and composition roots

```
T30 → T31 → T32 → T33 → T34 → T35 → T36 → T37
```

### Phase 12: Acceptance

```
T47 → T48 → T49 → T50
```

---

## Task Breakdown

#### Phase 1: Contracts and sensors

### T1: Write the HTTP contract schemas

**What**: Zod 4 schemas for every route of the feature (design.md § Contracts, `http/*.ts`): `PairingCodeResponse`, `ClaimRequest`, `ClaimResponse`, `Heartbeat` (`screen: 'UNKNOWN' | 'AUTOMAP_OPEN'`), `Observation` (the six glossary types, unknown types caught to `UNKNOWN`, `value` and `idempotencyKey` ≤ 64 chars, `confidence` 0–1), `Assignment`, `RoomView`, `MeResponse`, `AgentView`, `ConfigResponse`, `TestLoginRequest`, `ErrorResponse`, exported from `@d2rmm/contracts`.
**Where**: `packages/contracts/src/http/`
**Depends on**: None
**Reuses**: `packages/contracts` workspace, `docs/domain/glossary.md` (observation types), Design Doc § Contratos
**Requirement**: AWS-36

**Done when**:

- [x] Each schema has a test that accepts the design's example payload and one test per bound it enforces (code not 6 digits, value of 65 chars, confidence 1.1, unknown screen)
- [x] `Observation.parse({ type: 'SOMETHING_NEW', … })` yields `type: 'UNKNOWN'` (test `catches an unknown observation type`)
- [x] Gate check passes: `pnpm --filter @d2rmm/contracts typecheck && pnpm --filter @d2rmm/contracts test`
- [x] Test count: ≥ 20 tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

---

### T2: Write the stream event schemas

**What**: Zod schemas `room.assigned`, `room.stage_changed`, `agent.presence_changed`, and the unions `SiteStreamEvent` and `AgentStreamEvent` (design.md § Contracts, `events/*.ts`), exported from `@d2rmm/contracts`.
**Where**: `packages/contracts/src/events/`
**Depends on**: T1
**Reuses**: T1 schemas (`RoomView`, `Assignment`), `docs/domain/events.md` payloads
**Requirement**: AWS-36

**Done when**:

- [x] Tests: each event accepts its example; `SiteStreamEvent` rejects `room.assigned` without a game name; `AgentStreamEvent` does not accept `agent.presence_changed`
- [x] Gate check passes: `pnpm --filter @d2rmm/contracts typecheck && pnpm --filter @d2rmm/contracts test`
- [x] Test count: ≥ 26 tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

---

### T3: Generate AsyncAPI and the agent JSON Schemas

**What**: Replace `documents.ts` so `pnpm contracts:openapi` writes `asyncapi.json` (AsyncAPI 3.0, channel `stream`, the T2 events) and one JSON Schema per agent-facing message with `z.toJSONSchema` into `packages/contracts/json-schema/{pairing-code,claim,heartbeat,assignment,observation,agent-stream-event}.json`; the root `contracts:check` script also diffs `packages/contracts/json-schema/`. Regenerate and commit the outputs.
**Where**: `packages/contracts/src/documents.ts`
**Depends on**: T2
**Reuses**: `packages/contracts/scripts/generate.ts`, existing `documents.test.ts`
**Requirement**: AWS-36

**Done when**:

- [x] `documents.test.ts` asserts: AsyncAPI version `3.0.0` with channel `stream` and the three messages; the six JSON Schema file names (test `writes one JSON Schema per agent message`); two runs produce byte-identical output
- [x] Root `package.json` `contracts:check` runs `git diff --exit-code` on `openapi.json`, `asyncapi.json` and `json-schema/`
- [x] Gate check passes: `pnpm --filter @d2rmm/contracts typecheck && pnpm --filter @d2rmm/contracts test && pnpm contracts:check`
- [x] Test count: ≥ 29 tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

---

### T4: Add the three dependency rules

**What**: Add `platform-is-adapter`, `platform-uses-public-ports` and `render-no-test-controls` to `.dependency-cruiser.cjs` and `^apps/api/src/platform` to the `to` list of `shared-kernel-is-leaf` (design.md § Dependency rules added), each with a violation fixture under `scripts/test/fixtures/arch/` and a case in `scripts/test/arch-fixtures.test.mjs`. No existing rule changes.
**Where**: `.dependency-cruiser.cjs`
**Depends on**: T3
**Reuses**: existing fixtures and `arch-fixtures.test.mjs` cases
**Requirement**: AWS-31

**Done when**:

- [x] Fixtures `module-imports-platform/`, `platform-imports-internal/`, `render-imports-test-controls/` each fail with their rule name; the `clean` fixture still passes
- [x] Gate check passes: `pnpm test:harness && pnpm arch`
- [x] Test count: the three new fixture cases pass and no existing harness test disappears

**Tests**: unit
**Gate**: quick

---

### T5: Tighten the ESLint preset

**What**: In `packages/config/eslint.mjs` add `n/no-process-env` (error) for `apps/api/src/**` except `apps/api/src/main/**`, `i18next/no-literal-string` (error, JSX text and attributes) for `apps/web/src/**/*.tsx`, and `no-restricted-properties` banning `Math.random` in `apps/api/src/**`; extend `test/presets.test.ts` with the new blocks and add `test/rules.test.ts`, which lints text with the ESLint API under a given file path.
**Where**: `packages/config/eslint.mjs`
**Depends on**: T4
**Reuses**: T1 of harness-foundation's presets test
**Requirement**: AWS-31, AWS-37

**Done when**:

- [x] `rules.test.ts`: `process.env.X` in `apps/api/src/modules/a/application/x.ts` reports `n/no-process-env` (test `n/no-process-env reports a process.env read in a module file`) and in `apps/api/src/main/config.ts` reports nothing; `<p>Hello</p>` in `apps/web/src/app/x.tsx` reports `i18next/no-literal-string` (test `reports a literal string in a component`); `Math.random()` in `apps/api/src/platform/x.ts` reports `no-restricted-properties`
- [x] `pnpm lint` still exits 0
- [x] Gate check passes: `pnpm --filter @d2rmm/config typecheck && pnpm --filter @d2rmm/config test && pnpm lint`
- [x] Test count: ≥ 4 new tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

---

#### Phase 2: Shared kernel

### T6: Declare the event and persistence ports

**What**: `DomainEvent<T, P>`, the payload types of `MatchFormed`, `RoomAssignmentChanged`, `RoomStageChanged`, `AgentPresenceChanged`, `AgentRevoked`, `BusEvent`, and the ports `Outbox`, `UnitOfWork`, `Transaction` (branded) and `EventBus` (design.md § Shared kernel additions), exported from `shared-kernel/index.ts`.
**Where**: `apps/api/src/shared-kernel/events.ts`
**Depends on**: T5
**Reuses**: `docs/domain/events.md`
**Requirement**: AWS-26

**Done when**:

- [x] Types only, no runtime code; `pnpm arch` reports no violation
- [x] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm arch`

**Tests**: none
**Gate**: build

---

### T7: Add RandomSource and Scheduler with their fakes

**What**: `RandomSource { int(maxExclusive), bytes(n) }` with `SeededRandomSource` (deterministic), and `Scheduler { every(ms, fn), at(time, fn) }` returning a cancel function, with `FakeScheduler` driven by `FakeClock.advance`.
**Where**: `apps/api/src/shared-kernel/scheduler.ts`
**Depends on**: T6
**Reuses**: `FakeClock` (`shared-kernel/clock.ts`)
**Requirement**: AWS-15, AWS-40

**Done when**:

- [x] Tests: `every(25_000)` fires at 25 s and 50 s and not at 24.999 s; cancel stops it; `at` fires once; `SeededRandomSource.int(10)` stays in `[0, 10)` and repeats for the same seed; `bytes(32)` has 32 bytes
- [x] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test`
- [x] Test count: ≥ 8 new tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

---

### T8: Add withSpan on the OpenTelemetry API

**What**: `withSpan(name, attributes, fn)` in `shared-kernel/tracing.ts` using `@opentelemetry/api` only: starts an active span, records an exception and sets status error when `fn` throws or returns an `err` Result, ends the span always. Attributes accept ids and bounded enums only (typed as `Record<string, string | number | boolean>`).
**Where**: `apps/api/src/shared-kernel/tracing.ts`
**Depends on**: T7
**Reuses**: `Result` (`shared-kernel/result.ts`)
**Requirement**: AWS-35

**Done when**:

- [x] Tests with `@opentelemetry/sdk-trace-base` `InMemorySpanExporter` (devDependency only): span named as given (test `opens a span with the use-case name`), ended on success, on throw (status error, exception recorded, error rethrown) and on `err` Result (status error)
- [x] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test`
- [x] Test count: ≥ 4 new tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

---

### T12: Implement the in-memory event bus

**What**: `InMemoryEventBus` implementing `EventBus`: subscribers per event type, awaited in subscription order; a throwing subscriber rejects `publish`.
**Where**: `apps/api/src/platform/event-bus.ts`
**Depends on**: T8
**Reuses**: T6 ports
**Requirement**: AWS-26, AWS-33

**Done when**:

- [x] Tests: two subscribers called in order; other types not called; a throwing subscriber rejects `publish`; transient and durable events both delivered
- [x] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test`
- [x] Test count: ≥ 4 new tests pass

**Tests**: unit
**Gate**: quick

---

#### Phase 3: Identity core

### T14: Write the Identity domain

**What**: `player-name.ts` (`PlayerName.parse`, `^[A-Za-z0-9-]{2,16}$`, no trimming, `testKey` lower-cased), `account.ts` (test accounts' BattleTag `<display>#test`), `session.ts` (`Session.open`, expires 7 days later, `isValidAt` false from exactly 7 days) — design.md § Identity module.
**Where**: `apps/api/src/modules/identity/domain/`
**Depends on**: T12
**Reuses**: `Result`, `Clock`
**Requirement**: AWS-01, AWS-02, AWS-04

**Done when**:

- [ ] Tests 1:1 to AWS-01/02: accepts 2 and 16 chars, digits and `-`; rejects empty, 1 char, 17 chars, ` PlayerOne`, `Player_One`, `Jogadoré` (test `rejects names outside the rules`); `testKey` of `PlayerOne` is `playerone`; session valid at 7 days − 1 ms and invalid at exactly 7 days (test `expires at exactly 7 days`)
- [ ] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test`
- [ ] Test count: ≥ 10 new tests pass

**Tests**: unit
**Gate**: quick

---

### T15: Write the Identity use cases

**What**: Ports `AccountRepository`, `SessionRepository`, `SecretHasher`; use cases `signInTestAccount`, `authenticateSession`, `getMe`, each in `withSpan('identity.<use-case>')`; in-memory fakes of the repositories under `application/testing/`; the public `IdentityPort` in `modules/identity/index.ts`.
**Where**: `apps/api/src/modules/identity/application/`
**Depends on**: T14
**Reuses**: T14 domain, T7 `SeededRandomSource`, `FakeClock`
**Requirement**: AWS-01, AWS-04, AWS-35

**Done when**:

- [ ] Tests: first sign-in creates `PlayerOne#test` with display name as typed; `playerone` later reuses it and keeps `PlayerOne` (test `reuses the account ignoring case`); the lookup never returns a non-test account; the session token is `d2rmm_s_` + 43 base64url chars and only its hash is stored; unknown and expired tokens give `unauthenticated`; span names asserted
- [ ] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test`
- [ ] Test count: ≥ 8 new tests pass

**Tests**: unit
**Gate**: quick

---

#### Phase 4: Agents core

### T17: Write pairing code, agent and agent version

**What**: `pairing-code.ts` (`issue`: 6 digits zero-padded, expires 5 min later; `use`; `claimState`), `agent.ts` (`pair`, `revoke`, `isActive`), `agent-version.ts` (`parse` `^\d+\.\d+\.\d+$`, `isBelow`) — design.md § Agents module.
**Where**: `apps/api/src/modules/agents/domain/`
**Depends on**: T15
**Reuses**: T7 `RandomSource`, `Clock`, `Result`
**Requirement**: AWS-05, AWS-06, AWS-07, AWS-08, AWS-10, AWS-12

**Done when**:

- [ ] Tests: `int` 7 → code `000007`; expiry exactly 5 min; `use` before, at and after expiry; used code gives `invalid-code`; `claimState` pending / claimable / gone (expired unused); `revoke` makes `isActive` false; versions `0.0.1` vs min `0.0.0` not below, `0.0.9` vs `0.1.0` below (numeric, not lexical), `1.0`, `v1.0.0`, `` rejected (test `rejects a version that is not semantic`)
- [ ] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test`
- [ ] Test count: ≥ 14 new tests pass

**Tests**: unit
**Gate**: quick

---

### T18: Write the sliding-window limit and presence

**What**: `sliding-window.ts` (`check(timestamps, now)` → `allowed` or `limited(retryAt)`; IPv6 keyed by /64 via a `rateLimitKey(ip)` helper) and `presence.ts` (`fromHeartbeat`, `isOfflineAt` from 45 s, `differs`).
**Where**: `apps/api/src/modules/agents/domain/`
**Depends on**: T17
**Reuses**: `Clock`
**Requirement**: AWS-09, AWS-13, AWS-15

**Done when**:

- [ ] Tests: the 10th submission in 5 min allowed, the 11th limited until the oldest is 5 min old (test `limits the 11th submission until the oldest is 5 minutes old`); the IP window is 1 h; two IPv6 addresses in the same /64 share a key; presence online at 44.999 s and offline at 45 s (test `marks the agent offline after 45 s`); `differs` on each field
- [ ] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test`
- [ ] Test count: ≥ 10 new tests pass

**Tests**: unit
**Gate**: quick

---

### T19: Write the pairing use cases

**What**: Ports `AgentRepository`, `PairingCodeRepository`, `RateLimitStore`, `AgentTokenCache`; use cases `requestPairingCode({ ip })`, `pairAgent({ accountId, code })` (revokes the previous agent in the same transaction, publishes transient `AgentRevoked`), `claimToken({ claimSecret })` (token `d2rmm_a_<32 bytes>`, hash only stored, one atomic repository call), each in `withSpan('agents.<use-case>')`; in-memory fakes under `application/testing/`.
**Where**: `apps/api/src/modules/agents/application/`
**Depends on**: T18
**Reuses**: T17/T18 domain, T6 `UnitOfWork`/`EventBus`
**Requirement**: AWS-05, AWS-06, AWS-07, AWS-08, AWS-09, AWS-10

**Done when**:

- [ ] Tests: code request returns code, expiry, claim secret and stores no account; the 11th request per IP per hour → `rate-limited`; pairing binds and marks used; unknown / expired / used → `invalid-code`; the 11th submission per account in 5 min → `rate-limited`; pairing a second agent revokes the first and publishes `AgentRevoked`; claim before use → `pending`, after use → token once then `gone`, expired unused → `gone`
- [ ] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test`
- [ ] Test count: ≥ 12 new tests pass

**Tests**: unit
**Gate**: quick

---

### T20: Write the agent authentication and presence use cases

**What**: `authenticateAgent({ token })` (empty → `unauthenticated` before any lookup; cache hit; miss → one repository read rejecting null hash or revoked, then cached), `recordHeartbeat` (presence in `PresenceStore`, transient `AgentPresenceChanged` only when it differs), `sweep()` (offline rule and rate-limit pruning), `getMyAgent({ accountId })`; port `PresenceStore`.
**Where**: `apps/api/src/modules/agents/application/`
**Depends on**: T19
**Reuses**: T18 presence, T19 fakes
**Requirement**: AWS-11, AWS-13, AWS-14, AWS-15

**Done when**:

- [ ] Tests: a cached token authenticates without a repository call; a revoked agent's token → `unauthenticated` and is evicted; a heartbeat changing `gameRunning` publishes one `AgentPresenceChanged`, an identical one publishes none; `sweep` 45 s after the last heartbeat publishes offline once; `getMyAgent` returns presence or `none`
- [ ] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test`
- [ ] Test count: ≥ 8 new tests pass

**Tests**: unit
**Gate**: quick

---

### T22: Implement the Agents in-memory stores

**What**: `MemoryPresenceStore`, `MemoryRateLimitStore` and `MemoryAgentTokenCache` (LRU bounded to 10 000 entries) implementing the T19/T20 ports (ADR 006).
**Where**: `apps/api/src/modules/agents/adapters/memory/`
**Depends on**: T20
**Reuses**: T19/T20 ports
**Requirement**: AWS-13, AWS-33

**Done when**:

- [ ] Tests: the 10 001st token evicts the least recently used; `invalidate` removes; rate-limit timestamps pruned before the widest window; presence get/set/list
- [ ] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test`
- [ ] Test count: ≥ 5 new tests pass

**Tests**: unit
**Gate**: quick

---

#### Phase 5: Lobby Room and Matchmaking core

### T23: Write game name and observation

**What**: `game-name.ts` (`GameName.of(activity, difficulty, n)` → `mmbaalh-<n>` for `baal`/`hell`, `err('unsupported-difficulty')` for other difficulties; `matches(value)` case-insensitive, no trimming) and `observation.ts` (value ≤ 64 chars, confidence 0–1) — design.md § Lobby Room module.
**Where**: `apps/api/src/modules/lobby-room/domain/`
**Depends on**: T22
**Reuses**: `Result`
**Requirement**: AWS-20, AWS-23

**Done when**:

- [ ] Tests: `of('baal','hell',12)` is `mmbaalh-12`; `normal` → `unsupported-difficulty`; `matches('MMBAALH-12')` true, `matches(' mmbaalh-12')` false, `matches('mmbaalh-13')` false; 65-char value and confidence 1.1 rejected
- [ ] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test`
- [ ] Test count: ≥ 7 new tests pass

**Tests**: unit
**Gate**: quick

---

### T24: Write the LobbyRoom aggregate

**What**: `lobby-room.ts`: `LobbyRoom.fromMatch(match, n, ids)` → stage `awaiting_host`, run 1, host = lowest `joinOrder`, empty password, events `[RoomAssignmentChanged, RoomStageChanged]` with `members[]`; `observe(obs)` moves `awaiting_host → created` only for `GAME_NAME_SEEN` from the host's account, the current run and a matching value, else `ignored`; once `created`, always `ignored`.
**Where**: `apps/api/src/modules/lobby-room/domain/lobby-room.ts`
**Depends on**: T23
**Reuses**: T23 `GameName`, `IdGenerator`
**Requirement**: AWS-20, AWS-23, AWS-24

**Done when**:

- [ ] Tests 1:1 to AWS-20/23/24 (INV-06, INV-08): two members → host is join order 1 (test `fromMatch creates awaiting_host with run 1`); non-host, other run, other name, other type each `ignored`; matching → `created` with one `RoomStageChanged`; a second match after `created` → `ignored`, no event
- [ ] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test`
- [ ] Test count: ≥ 8 new tests pass

**Tests**: unit
**Gate**: quick

---

### T25: Write the Lobby Room use cases

**What**: Ports `LobbyRoomRepository`, `ObservationRepository`, `GameNameSequence`; `onMatchFormed(event)` (idempotent by `matchId`), `recordObservation({ agentId, roomId, body })` in the order membership (403) → unknown type (202, nothing stored) → idempotency key already stored for this agent (202, no change) → insert + `observe` in one transaction; `getCurrentRoom({ accountId })` (newest room), `getAssignment({ agentId })`; each in `withSpan('lobby.<use-case>')`; fakes under `application/testing/`; public `LobbyRoomPort` in `index.ts`.
**Where**: `apps/api/src/modules/lobby-room/application/`
**Depends on**: T24
**Reuses**: T24 aggregate, T6 ports, `AgentsPort.accountOfAgent`
**Requirement**: AWS-20, AWS-21, AWS-22, AWS-23, AWS-24, AWS-25, AWS-35

**Done when**:

- [ ] Tests: a second `MatchFormed` with the same `matchId` creates no room (test `creates no second room for the same match`); non-member → `forbidden`, nothing stored; `UNKNOWN` type → `accepted`, nothing stored; repeated key → `accepted`, no event; the newest of two rooms is current; span `lobby.record-observation` asserted
- [ ] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test`
- [ ] Test count: ≥ 9 new tests pass

**Tests**: unit
**Gate**: quick

---

### T27: Write the staging test match use case

**What**: `formTestMatch({ accountId })` appending the fixed `MatchFormed` of design.md § Matchmaking module (AD-033) to the outbox in one transaction, in `withSpan('matchmaking.form-test-match')`.
**Where**: `apps/api/src/modules/matchmaking/application/form-test-match.ts`
**Depends on**: T25
**Reuses**: T6 `UnitOfWork`/`Outbox`, `IdGenerator`
**Requirement**: AWS-19

**Done when**:

- [ ] Tests: the appended event has mode `leveling`, activity `baal`, difficulty `hell`, region `americas`, ladder `sc-ladder`, era `rotw`, one member with join order 1 and role `host`; each call gets a new `matchId`
- [ ] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test`
- [ ] Test count: ≥ 3 new tests pass

**Tests**: unit
**Gate**: quick

---

#### Phase 6: Pure platform

### T28: Write the stream projection

**What**: Pure `platform/stream-projection.ts`: `RoomAssignmentChanged` → `room.assigned` for each member account and each member's current agent; `RoomStageChanged` → `room.stage_changed` for each member account; `AgentPresenceChanged` → `agent.presence_changed` for the owner account; and `compareStreamIds` for ids `"<outboxId>"` / `"<outboxId>.<k>"` (design.md § Event ids).
**Where**: `apps/api/src/platform/stream-projection.ts`
**Depends on**: T27
**Reuses**: T2 event schemas, `AgentsPort.currentAgentOf`
**Requirement**: AWS-27, AWS-39

**Done when**:

- [ ] Tests: a two-member assignment yields two site and two agent recipients; a stage change yields no agent recipient; presence goes to its owner only; `12` < `12.1` < `12.2` < `13` (test `ids increase with outbox order`)
- [ ] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test`
- [ ] Test count: ≥ 6 new tests pass

**Tests**: unit
**Gate**: quick

---

### T29: Write the HTTP guards

**What**: `platform/http/guards.ts`: `requireAgentVersion`, `requireAgent`, `requireSession`, `requireSameOrigin` as Fastify preHandlers built from `IdentityPort`, `AgentsPort` and `AGENT_MIN_VERSION` (design.md § Platform, guards).
**Where**: `apps/api/src/platform/http/guards.ts`
**Depends on**: T28
**Reuses**: T15 `IdentityPort`, T20 `AgentsPort`, T17 `AgentVersion`
**Requirement**: AWS-11, AWS-12

**Done when**:

- [ ] Tests with Fastify `inject` and fake ports: no / `1.0` / below-min `X-Agent-Version` → 426 before auth runs, equal version passes (test `answers 426 before authentication`); bearer token → `agentId`, cookie ignored on agent routes; `Authorization` on a site route → 401; cross-origin or non-JSON cookie POST → 403
- [ ] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test`
- [ ] Test count: ≥ 10 new tests pass

**Tests**: unit
**Gate**: quick

---

#### Phase 7: Web

### T38: Bootstrap the site with i18n

**What**: Vite 8 + React 19 app in `apps/web` (`index.html`, `src/main.tsx`, `vite.config.ts`, Vitest with jsdom and Testing Library), `react-i18next` bootstrap in `src/app/i18n.ts`, `src/shared/language.ts` (pt-BR when the first preferred language starts with `pt`, else English) and `src/shared/locales/{en,pt-BR}.json` with every string of the spec.
**Where**: `apps/web/src/shared/language.ts`
**Depends on**: T29
**Reuses**: `packages/config/tsconfig.dom.json`, T5 i18next rule
**Requirement**: AWS-37

**Done when**:

- [ ] Tests: `en` and `pt-BR` hold the same keys (test `en and pt-BR hold the same keys`); `pt-BR`, `pt-PT`, `pt` → pt-BR; `fr-FR`, `en-US`, none → en
- [ ] `pnpm --filter @d2rmm/web build` writes `apps/web/dist`
- [ ] Gate check passes: `pnpm --filter @d2rmm/web typecheck && pnpm --filter @d2rmm/web test && pnpm --filter @d2rmm/web build`
- [ ] Test count: ≥ 6 tests pass

**Tests**: unit
**Gate**: quick

---

### T39: Write the API client, stream and labels

**What**: `shared/api-client.ts` (`/api/v1/...`, `Content-Type: application/json` on every POST, 401 → `unauthenticated`), `shared/stream.ts` (`EventSource('/api/v1/stream')`, typed events, re-read room and presence on every open), `shared/labels.ts` (contract values → translation keys).
**Where**: `apps/web/src/shared/`
**Depends on**: T38
**Reuses**: `@d2rmm/contracts` schemas
**Requirement**: AWS-14, AWS-21, AWS-23

**Done when**:

- [ ] Tests: POST sends the JSON content type; 401 maps to `unauthenticated`; a stream `open` triggers both re-reads; labels map `awaiting_host` → "Awaiting host", `created` → "Created", `UNKNOWN` → "Screen: Unknown", `AUTOMAP_OPEN` → "Screen: Automap open", online/offline, game open/closed
- [ ] Gate check passes: `pnpm --filter @d2rmm/web typecheck && pnpm --filter @d2rmm/web test`
- [ ] Test count: ≥ 8 new tests pass

**Tests**: unit
**Gate**: quick

---

### T40: Write the layout with the notice and the download link

**What**: `app/App.tsx` and `app/Layout.tsx`: loading and error states, the non-affiliation notice and "Download the agent" linking to `https://github.com/pedromoraisf/d2rmatchmaking/releases/latest/download/D2RMatchMaking-setup.exe` on every page.
**Where**: `apps/web/src/app/Layout.tsx`
**Depends on**: T39
**Reuses**: T38 i18n
**Requirement**: AWS-17, AWS-38

**Done when**:

- [ ] Tests: the link's `href` equals the release URL; the notice text in en and pt-BR; "Loading…" and "Something went wrong. Try again." states
- [ ] Gate check passes: `pnpm --filter @d2rmm/web typecheck && pnpm --filter @d2rmm/web test`
- [ ] Test count: ≥ 4 new tests pass

**Tests**: unit
**Gate**: quick

---

### T41: Write the sign-in panel

**What**: `features/identity/SignInPanel.tsx`: "Sign in with a test account" form (only when `/v1/config` says staging), "Signed in as <name>", the invalid-name message.
**Where**: `apps/web/src/features/identity/SignInPanel.tsx`
**Depends on**: T40
**Reuses**: T39 client
**Requirement**: AWS-01, AWS-02, AWS-03, AWS-04

**Done when**:

- [ ] Tests: form hidden when staging is off; 400 shows "Use 2 to 16 letters, digits or hyphens." and stays signed out; success shows "Signed in as PlayerOne"; 401 on `/v1/me` shows the signed-out view
- [ ] Gate check passes: `pnpm --filter @d2rmm/web typecheck && pnpm --filter @d2rmm/web test`
- [ ] Test count: ≥ 4 new tests pass

**Tests**: unit
**Gate**: quick

---

### T42: Write the pairing form and presence panel

**What**: `features/agents/PairingForm.tsx` ("Pairing code", "Pair agent", "Agent paired", invalid-code and too-many-attempts messages) and `features/agents/PresencePanel.tsx` (online/offline, game open/closed, screen), updated from `agent.presence_changed`.
**Where**: `apps/web/src/features/agents/`
**Depends on**: T41
**Reuses**: T39 client, stream and labels
**Requirement**: AWS-06, AWS-08, AWS-09, AWS-14, AWS-16

**Done when**:

- [ ] Tests: no agent → form shown; 200 → "Agent paired"; 400 → "This code is invalid or has expired."; 429 → "Too many attempts. Try again in a few minutes."; a presence event switches "Agent offline" to "Agent online" and "Game open"
- [ ] Gate check passes: `pnpm --filter @d2rmm/web typecheck && pnpm --filter @d2rmm/web test`
- [ ] Test count: ≥ 5 new tests pass

**Tests**: unit
**Gate**: quick

---

### T43: Write the room panel and the test match button

**What**: `features/lobby-room/RoomPanel.tsx` (game name, "No password", stage; newest room wins) and `features/lobby-room/StartTestMatchButton.tsx` (staging only).
**Where**: `apps/web/src/features/lobby-room/`
**Depends on**: T42
**Reuses**: T39 client, stream and labels
**Requirement**: AWS-19, AWS-21, AWS-23

**Done when**:

- [ ] Tests: button hidden when staging is off; `room.assigned` shows the game name, "No password", "Awaiting host"; `room.stage_changed` to `created` shows "Created"; a newer room replaces the shown one
- [ ] Gate check passes: `pnpm --filter @d2rmm/web typecheck && pnpm --filter @d2rmm/web test`
- [ ] Test count: ≥ 4 new tests pass

**Tests**: unit
**Gate**: quick

---

### T44: Write the Pages Function proxy

**What**: `functions/api/[[path]].ts` per design.md § Web, Pages Function: path allow-list, `URL`-based target from `API_ORIGIN`, request header allow-list, `new Response(upstream.body, upstream)` with `Cache-Control: no-store`.
**Where**: `apps/web/functions/api/[[path]].ts`
**Depends on**: T43
**Reuses**: none
**Requirement**: AWS-29

**Done when**:

- [ ] Tests with a fake `fetch`: `/api/v1/me` → `API_ORIGIN/v1/me` with the query; `/api/__test/reset`, `/api/v1/../x`, `/api/v1//x`, `%2f`, `%5c` → 404 (test `rejects hostile paths`); `Authorization`, `X-Agent-Version`, `Host`, `X-Forwarded-For`, `CF-Connecting-IP` dropped, the allow-listed headers kept (test `drops Authorization and X-Agent-Version`); `Set-Cookie` passed through; a streamed body delivered chunk by chunk
- [ ] Gate check passes: `pnpm --filter @d2rmm/web typecheck && pnpm --filter @d2rmm/web test`
- [ ] Test count: ≥ 6 new tests pass

**Tests**: unit
**Gate**: quick

---

#### Phase 8: Deploy workflows

### T45: Write the API deploy workflow

**What**: `.github/workflows/deploy-api.yml` per design.md § Workflows (`workflow_run` of `ci` with its guards, path check, frozen install, migrations with `NEON_DATABASE_URL`, `RENDER_DEPLOY_HOOK`, 5-minute `/healthz` loop, environment `production`, minimal permissions, SHA-pinned actions) and `scripts/test/deploy-workflows.test.mjs` asserting it.
**Where**: `.github/workflows/deploy-api.yml`
**Depends on**: T44
**Reuses**: `ci.yml` setup steps
**Requirement**: AWS-34

**Done when**:

- [ ] `deploy-workflows.test.mjs`: trigger and guards; migrate step before the deploy-hook step; health loop bounded to 5 minutes (test `deploy-api runs migrations before the deploy hook and polls healthz 5 minutes`); secrets only in the deploy job; no `${{ github.event.* }}` inside `run:`; actions pinned by SHA
- [ ] Gate check passes: `pnpm test:harness`
- [ ] Test count: ≥ 5 new harness tests pass

**Tests**: unit
**Gate**: quick

---

### T46: Write the web deploy workflow and render.yaml

**What**: `.github/workflows/deploy-web.yml` (secret-free `build` job, `deploy` job for `main` and same-repo previews with the URL commented on the PR) and `render.yaml` (one free web service, `/healthz`, `autoDeploy: false`, `D2RMM_ENV=staging`, `ENABLE_STAGING_ENDPOINTS=true`); `deploy-workflows.test.mjs` extended.
**Where**: `.github/workflows/deploy-web.yml`
**Depends on**: T45
**Reuses**: T45 test helpers
**Requirement**: AWS-34

**Done when**:

- [ ] Tests: build job has no secrets; previews only when the PR head repo equals the repository (test `deploy-web publishes previews only for same-repo PRs`); branch name passed through `env:`; `pull-requests: write` only on the comment job; `render.yaml` health path and `autoDeploy: false`
- [ ] Gate check passes: `pnpm test:harness`
- [ ] Test count: ≥ 4 new harness tests pass

**Tests**: unit
**Gate**: quick

---

#### Phase 9: Persistence (needs Docker from here on)

### T9: Set up the API integration test runner

**What**: `apps/api/vitest.config.ts` (unit: excludes `**/*.int.test.ts`), `apps/api/vitest.integration.config.ts` (only `**/*.int.test.ts`, one fork, 120 s hook timeout), script `test:integration`, and `apps/api/test/support/postgres.ts` that starts one `@testcontainers/postgresql` container per run and gives each test file a fresh database (under `test/`, so `no-dev-deps-in-runtime` exempts it, as `docs/engineering/testing.md` places integration support). Kysely and `pg` added to the API.
**Where**: `apps/api/vitest.integration.config.ts`
**Depends on**: T46
**Reuses**: turbo task `test:integration`, CI `integration` job
**Requirement**: AWS-32

**Done when**:

- [ ] `test/support/postgres.int.test.ts`: two test files' databases are distinct and `select 1` answers; the integration config includes `src/**/*.int.test.ts` and `test/**/*.int.test.ts`
- [ ] `pnpm --filter @d2rmm/api test` runs no `*.int.test.ts`; `pnpm --filter @d2rmm/api test:mutation` still exits 0
- [ ] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test && pnpm --filter @d2rmm/api test:integration`
- [ ] Test count: ≥ 2 integration tests pass

**Tests**: integration
**Gate**: full

---

### T10: Write the skeleton migration and the migrate command

**What**: `apps/api/migrations/0001_skeleton.ts` (Kysely) creating exactly the schemas, tables, sequence and indexes of design.md § Data Models, and `src/main/migrate.ts` (Kysely `Migrator` over `apps/api/migrations`; it reads `DATABASE_URL` itself, which the T5 rule allows inside `main/`, and T31 moves that read into `main/config.ts`) behind script `db:migrate`.
**Where**: `apps/api/migrations/0001_skeleton.ts`
**Depends on**: T9
**Reuses**: T9 container helper
**Requirement**: AWS-32

**Done when**:

- [ ] `src/main/__tests__/migrate.int.test.ts`: the first run applies `0001_skeleton` and creates schemas `identity`, `agents`, `lobby`, `platform`; the second run applies none and exits 0 (test `second run applies none`); the partial unique index on live pairing codes rejects a second unused `123456`
- [ ] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test:integration`
- [ ] Test count: ≥ 3 new integration tests pass

**Tests**: integration
**Gate**: full

---

### T11: Implement the Postgres unit of work and outbox

**What**: `platform/postgres/unit-of-work.ts` (Kysely transaction behind `UnitOfWork`, calls `relay.wake()` after a commit that appended outbox rows) and `platform/postgres/outbox.ts` (`append` inserts into `platform.outbox`).
**Where**: `apps/api/src/platform/postgres/`
**Depends on**: T10
**Reuses**: T6 ports, T9 helper
**Requirement**: AWS-26

**Done when**:

- [ ] `outbox.int.test.ts`: an append in a committed transaction leaves one row and calls `wake` once; an append in a transaction that throws leaves no row and no wake (test `rolls back the outbox row with the transaction`); a commit without appends does not wake
- [ ] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test:integration`
- [ ] Test count: ≥ 3 new integration tests pass

**Tests**: integration
**Gate**: full

---

### T13: Implement the outbox relay

**What**: `platform/outbox-relay.ts` per design.md § Platform: `wake()`, start-up `sweep()`, `select … for update skip locked limit 100` in id order, publish each as a durable `BusEvent` with its outbox id, mark `published_at`; on a handler error increment `attempts`, keep the row's next-attempt time in memory and schedule a wake through `Scheduler.at` after 1, 2, 4, 8 s (a row is skipped until its time; after a restart the sweep retries it at once — no schema change), set `failed_at` after the 5th failure and continue with the next rows. Also `TimerScheduler` (production `Scheduler` on `setTimeout`/`setInterval`) in `platform/timer-scheduler.ts`, unit-tested with Vitest fake timers.
**Where**: `apps/api/src/platform/outbox-relay.ts`
**Depends on**: T11
**Reuses**: T7 `FakeScheduler`, T11 outbox, T12 bus
**Requirement**: AWS-26

**Done when**:

- [ ] `outbox-relay.int.test.ts`: rows committed while no relay ran are published by `sweep()` after a new relay starts (test `publishes rows left unpublished before a restart`); rows publish in id order; a handler failing 5 times leaves `failed_at` set and `attempts = 5` while the next row is published (test `dead-letters after 5 failures and keeps going`); retry delays are 1, 2, 4, 8 s on the fake scheduler
- [ ] `timer-scheduler.test.ts`: `every` and `at` fire on Vitest fake timers and cancel stops them
- [ ] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test && pnpm --filter @d2rmm/api test:integration`
- [ ] Test count: ≥ 4 new integration tests pass

**Tests**: integration
**Gate**: full

---

#### Phase 10: Postgres adapters

### T16: Implement the Identity Postgres adapters

**What**: Kysely `AccountRepository`, `SessionRepository` and the SHA-256 `SecretHasher` (`domain + ':' + value`) in the Identity adapters.
**Where**: `apps/api/src/modules/identity/adapters/postgres/`
**Depends on**: T13
**Reuses**: T9 helper, T10 migration
**Requirement**: AWS-01, AWS-04

**Done when**:

- [ ] `identity-repositories.int.test.ts`: insert and find a test account by `test_key`; a second insert with the same key fails on the unique index; session found by hash; hashes of the same value in domains `session` and `agent` differ
- [ ] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test:integration`
- [ ] Test count: ≥ 4 new integration tests pass

**Tests**: integration
**Gate**: full

---

### T21: Implement the Agents Postgres repositories

**What**: Kysely `AgentRepository` (including the atomic claim `update … returning` of design.md § Agents module) and `PairingCodeRepository` (issue deletes expired unused rows with the same code, retries on conflict).
**Where**: `apps/api/src/modules/agents/adapters/postgres/`
**Depends on**: T16
**Reuses**: T9 helper, T10 migration
**Requirement**: AWS-05, AWS-07, AWS-10

**Done when**:

- [ ] `agents-repositories.int.test.ts`: two concurrent claims with one secret return the token once (test `two concurrent claims return the token once`); a claim for an unpaired or revoked agent updates no row; an expired unused code with the same digits is replaced; a live duplicate code is retried
- [ ] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test:integration`
- [ ] Test count: ≥ 4 new integration tests pass

**Tests**: integration
**Gate**: full

---

### T26: Implement the Lobby Room Postgres adapters

**What**: Kysely `LobbyRoomRepository` (rooms, members, runs), `ObservationRepository` (primary key `(agent_id, idempotency_key)`) and `GameNameSequence` on `lobby.game_name_seq`.
**Where**: `apps/api/src/modules/lobby-room/adapters/postgres/`
**Depends on**: T21
**Reuses**: T9 helper, T10 migration
**Requirement**: AWS-20, AWS-24

**Done when**:

- [ ] `lobby-repositories.int.test.ts`: a room round-trips with members and run 1; a second room with the same `match_id` fails on the unique constraint; two sequence values differ and increase; the same idempotency key for two agents is stored twice, for one agent once
- [ ] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test:integration`
- [ ] Test count: ≥ 4 new integration tests pass

**Tests**: integration
**Gate**: full

---

#### Phase 11: Streams, HTTP routes and composition roots

### T30: Implement the stream hub

**What**: `platform/stream-hub.ts` with `GET /v1/stream` (design.md § Platform, stream hub): credential precedence, query-string credential → 400, subscribe-buffer-replay-flush resume from `Last-Event-ID`, `: ka` every 25 s, SSE headers, closing on `AgentRevoked`, at session expiry and on a 6th stream.
**Where**: `apps/api/src/platform/stream-hub.ts`
**Depends on**: T26
**Reuses**: T28 projection, T13 relay, T7 `FakeScheduler`, T29 guards
**Requirement**: AWS-27, AWS-28, AWS-39, AWS-40

**Done when**:

- [ ] `stream-hub.int.test.ts` over real HTTP: a site stream gets only its account's events, an agent stream only its agent's; reconnect with `Last-Event-ID: 3` gets 4, 5 in order then live, no duplicate (test `replays the events after Last-Event-ID in order`); ids increase (test `event ids increase`); `: ka` at 25 s and 50 s on the fake scheduler (test `sends a keep-alive comment every 25 seconds`); `AgentRevoked` closes the agent's stream; the 6th stream closes the oldest; `?token=` → 400
- [ ] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test:integration`
- [ ] Test count: ≥ 8 new integration tests pass

**Tests**: integration
**Gate**: full

---

### T31: Build the app with config, health and the staging switch

**What**: `main/config.ts` (the only `process.env` reader, variables of design.md § Composition roots) and `main/app.ts` `buildApp(deps)`: Zod type provider, `@fastify/cookie`, `@fastify/swagger`, guards, `/healthz` (no SQL), `/v1/config`, staging routes registered only when `stagingEndpoints`, logger redaction, validation error handler without values, 503 on a database error.
**Where**: `apps/api/src/main/app.ts`
**Depends on**: T30
**Reuses**: T29 guards, T30 stream hub
**Requirement**: AWS-03, AWS-30, AWS-31, AWS-33

**Done when**:

- [ ] `src/main/__tests__/app.int.test.ts`: `/healthz` answers 200 `{"status":"ok"}` with the database stopped (test `healthz answers with the database down`); `/v1/config` reflects the flags; with `stagingEndpoints: false` the test-login and match-formed routes answer 404; a validation error lists field paths and not values; the API's dependencies contain no Redis, broker or queue client and its stores are the memory adapters (test `runs with no external broker`)
- [ ] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test:integration`
- [ ] Test count: ≥ 6 new integration tests pass

**Tests**: integration
**Gate**: full

---

### T32: Add the Identity routes

**What**: `identityRoutes(app, { useCases, guards })` with `POST /v1/auth/test-login` (staging only, `requireSameOrigin`, sets `__Host-d2rmm_session`) and `GET /v1/me`, registered in `buildApp`.
**Where**: `apps/api/src/modules/identity/adapters/http/routes.ts`
**Depends on**: T31
**Reuses**: T15 use cases, T16 adapters, contracts `TestLoginRequest`, `MeResponse`
**Requirement**: AWS-01, AWS-02, AWS-03, AWS-04

**Done when**:

- [ ] `src/main/__tests__/identity-routes.int.test.ts`: sign-in sets `__Host-d2rmm_session` with `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `Max-Age=604800` and no `Domain` (test `sets the session cookie`); invalid name → 400 `invalid-player-name`, no cookie; `/v1/me` with no, unknown or expired cookie → 401; cross-origin sign-in → 403
- [ ] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test:integration`
- [ ] Test count: ≥ 6 new integration tests pass

**Tests**: integration
**Gate**: full

---

### T33: Add the Agents routes

**What**: `agentsRoutes(app, { useCases, guards })` with `POST /v1/agents/pairing-codes`, `POST /v1/agents/pairing-codes/claim`, `POST /v1/agents/pair`, `POST /v1/agents/heartbeat`, `GET /v1/agents/me` (status codes, `Cache-Control: no-store` and guards of design.md § Agents module), registered in `buildApp`, with `TRUST_PROXY_HOPS` for the client IP.
**Where**: `apps/api/src/modules/agents/adapters/http/routes.ts`
**Depends on**: T32
**Reuses**: T19/T20 use cases, T21/T22 adapters, contracts
**Requirement**: AWS-05, AWS-06, AWS-07, AWS-08, AWS-09, AWS-10, AWS-11, AWS-12, AWS-13, AWS-18

**Done when**:

- [ ] `src/main/__tests__/agents-routes.int.test.ts`: the full pairing flow (201 → 202 → pair 200 → claim 200 → claim 410); a heartbeat issues no SQL statement, counted on the `pg` pool (test `a heartbeat issues no SQL statement`); an invalid heartbeat → 400 and the previous presence kept; a forged left-most `X-Forwarded-For` does not change the rate-limit key (test `ignores a forged left-most X-Forwarded-For`); captured logs of the pairing flow contain no code, claim secret or token (test `logs no pairing secret`)
- [ ] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test:integration`
- [ ] Test count: ≥ 8 new integration tests pass

**Tests**: integration
**Gate**: full

---

### T34: Add the Lobby Room and Matchmaking routes

**What**: `POST /v1/lobby-rooms/:id/observations` (agent, body limit 4 KB), `GET /v1/agents/me/assignment` (agent), `GET /v1/me/room` (site) and `POST /v1/staging/match-formed` (staging only, 202); `onMatchFormed` subscribed to the bus in `buildApp`.
**Where**: `apps/api/src/modules/lobby-room/adapters/http/routes.ts`
**Depends on**: T33
**Reuses**: T25/T27 use cases, T26 adapters, contracts
**Requirement**: AWS-19, AWS-20, AWS-21, AWS-22, AWS-23, AWS-24, AWS-25, AWS-35

**Done when**:

- [ ] `src/main/__tests__/lobby-routes.int.test.ts`: match-formed → 202 and, after the relay, `GET /v1/me/room` shows `mmbaalh-<n>`, "awaiting_host", empty password; the assignment endpoint returns the room, run, expected game name and members (test `assignment endpoint returns the room`); the host's matching observation → 202 and stage `created`; non-member → 403 and nothing stored; a 5 KB body → 413; `record-observation` runs in span `lobby.record-observation` (test `record-observation runs in its span`)
- [ ] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test:integration`
- [ ] Test count: ≥ 6 new integration tests pass

**Tests**: integration
**Gate**: full

---

### T35: Write the local and Render composition roots and the test controls

**What**: `main/local.ts` (Postgres from `DATABASE_URL`, migrations on start, binds `127.0.0.1`, registers `main/test-controls.ts` when `D2RMM_ACCEPTANCE=true`), `main/test-controls.ts` (`POST /__test/reset`, `POST /__test/clock` with `ControllableClock`, secret header, database-name and host guards, AD-045) and `main/render.ts` (Neon TLS, `0.0.0.0:$PORT`, fail-closed checks).
**Where**: `apps/api/src/main/render.ts`
**Depends on**: T34
**Reuses**: T31 `buildApp`, T10 migrator
**Requirement**: AWS-31

**Done when**:

- [ ] `src/main/__tests__/roots.int.test.ts`: `local.ts` started as a child process answers `/healthz`; `render.ts` exits non-zero with `ENABLE_STAGING_ENDPOINTS=true` and `D2RMM_ENV=production` (test `render refuses staging endpoints outside staging`) and with `D2RMM_ACCEPTANCE` set; the Render app has no `/__test` route; reset without the secret → 403, against a database not named `acc_w<n>` → refused
- [ ] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test:integration && pnpm arch`
- [ ] Test count: ≥ 5 new integration tests pass

**Tests**: integration
**Gate**: full

---

### T36: Generate openapi.json from the routes

**What**: `main/openapi.ts` builds the app with in-memory ports and writes `app.swagger()` to `packages/contracts/openapi.json`; the API's `contracts:openapi` script runs it; regenerate and commit.
**Where**: `apps/api/src/main/openapi.ts`
**Depends on**: T35
**Reuses**: T31 `buildApp`, `@fastify/swagger`
**Requirement**: AWS-36

**Done when**:

- [ ] `src/main/__tests__/openapi.int.test.ts`: every route registered by `buildApp` with staging on appears in `openapi.json` with its schemas (test `openapi.json lists every route`)
- [ ] Gate check passes: `pnpm --filter @d2rmm/api typecheck && pnpm --filter @d2rmm/api test:integration && pnpm contracts:check`
- [ ] Test count: ≥ 1 new integration test passes

**Tests**: integration
**Gate**: full

---

### T37: Make HF-04 structural (AD-044)

**What**: In `.specs/features/harness-foundation/acceptance.feature` replace the two Then lines "… with no paths" / "… with no channels" with "declares version 3.1 and the path /healthz" / "declares version 3.0 and the channel stream", and update their steps in `tests/acceptance/steps/harness-foundation.steps.ts`. The gate hook asks the maintainer to confirm (AD-044).
**Where**: `tests/acceptance/steps/harness-foundation.steps.ts`
**Depends on**: T36
**Reuses**: existing HF-04 steps
**Requirement**: AWS-36

**Done when**:

- [ ] The HF-04 scenario passes against the generated documents
- [ ] Gate check passes: `pnpm --filter @d2rmm/acceptance exec bddgen test --tags "@HF-04" && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@HF-04"`

**Tests**: acceptance
**Gate**: acceptance

---

#### Phase 12: Acceptance

### T47: Build the acceptance stack

**What**: `globalSetup` in `tests/acceptance/playwright.config.ts` (one Postgres container), `support/global-setup.ts`, the worker-scoped `stack` fixture in `support/stack.ts` (database `acc_w<n>`, two API processes with staging on and off, two `wrangler pages dev apps/web/dist`, reset before each scenario), `support/agent-client.ts`, and `steps/site.steps.ts` with the site-wide and health steps (design.md § Acceptance stack). The gate hook asks the maintainer for the config edit.
**Where**: `tests/acceptance/support/stack.ts`
**Depends on**: T37
**Reuses**: `tests/acceptance/fixtures.ts`, T35 `local.ts` and test controls
**Requirement**: AWS-17, AWS-30, AWS-37, AWS-38

**Done when**:

- [ ] Scenarios tagged `@AWS-30`, `@AWS-17`, `@AWS-37`, `@AWS-38` pass
- [ ] Gate check passes: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen test --tags "@AWS-30 or @AWS-17 or @AWS-37 or @AWS-38" && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@AWS-30|@AWS-17|@AWS-37|@AWS-38"`

**Tests**: acceptance
**Gate**: acceptance

---

### T48: Write the Identity steps

**What**: `steps/identity.steps.ts` for the sign-in scenarios.
**Where**: `tests/acceptance/steps/identity.steps.ts`
**Depends on**: T47
**Reuses**: T47 stack
**Requirement**: AWS-01, AWS-02, AWS-03, AWS-04

**Done when**:

- [ ] Every scenario tagged `@AWS-01` … `@AWS-04` passes
- [ ] Gate check passes: `pnpm --filter @d2rmm/acceptance exec bddgen test --tags "@AWS-01 or @AWS-02 or @AWS-03 or @AWS-04" && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@AWS-0[1-4]"`

**Tests**: acceptance
**Gate**: acceptance

---

### T49: Write the Agents steps

**What**: `steps/agents.steps.ts` for pairing, tokens, versions and presence, driving the simulated agent through `agent-client.ts` and the clock through `/__test/clock`.
**Where**: `tests/acceptance/steps/agents.steps.ts`
**Depends on**: T48
**Reuses**: T47 stack and agent client
**Requirement**: AWS-05, AWS-06, AWS-07, AWS-08, AWS-09, AWS-10, AWS-11, AWS-12, AWS-13, AWS-14, AWS-16, AWS-18

**Done when**:

- [ ] Every scenario tagged `@AWS-05` … `@AWS-18` passes
- [ ] Gate check passes: `pnpm --filter @d2rmm/acceptance exec bddgen test --tags "@AWS-05 or @AWS-06 or @AWS-07 or @AWS-08 or @AWS-09 or @AWS-10 or @AWS-11 or @AWS-12 or @AWS-13 or @AWS-14 or @AWS-16 or @AWS-18" && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@AWS-(0[5-9]|1[0-468])"`

**Tests**: acceptance
**Gate**: acceptance

---

### T50: Write the Lobby Room and stream steps

**What**: `steps/lobby-room.steps.ts` for the room, observation, stream and proxy scenarios; then the whole acceptance suite runs.
**Where**: `tests/acceptance/steps/lobby-room.steps.ts`
**Depends on**: T49
**Reuses**: T47 stack and agent client
**Requirement**: AWS-19, AWS-20, AWS-21, AWS-22, AWS-23, AWS-24, AWS-25, AWS-27, AWS-28, AWS-29

**Done when**:

- [ ] Every scenario of both features' `acceptance.feature` passes (harness-foundation included)
- [ ] Gate check passes: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance test:acceptance`

**Tests**: acceptance
**Gate**: acceptance

---

## Checks

Acceptance proofs run `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "<scenario>"` after `pnpm --filter @d2rmm/web build`; integration proofs need Docker.

**C1** - A test player signs in, sees "Signed in as PlayerOne" and still sees it after a reload (AWS-01, AC 1)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "A test player signs in and stays signed in"`

**C2** - The session cookie is `__Host-d2rmm_session` with `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `Max-Age=604800` and no `Domain` (AWS-01, AC 1)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/identity-routes.int.test.ts -t "sets the session cookie"`

**C3** - `playerone` signs into the account first opened as `PlayerOne` and keeps the display name `PlayerOne` (AWS-01, AC 1)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/modules/identity/application -t "reuses the account ignoring case"`

**C4** - Names of 0, 1 or 17+ characters, with a space or a character other than a letter, digit or `-` are refused with "Use 2 to 16 letters, digits or hyphens." (AWS-02, AC 2)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "A player name outside the rules is refused"`

**C5** - `PlayerName.parse` rejects ` PlayerOne`, `Player_One` and `Jogadoré` and accepts 2- and 16-character names (AWS-02, AC 2)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/modules/identity/domain -t "rejects names outside the rules"`

**C6** - With staging endpoints off, test sign-in and test match answer 404 and the site shows neither control (AWS-03, AC 3)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "Test sign-in and test matches do not exist when staging endpoints are off"`

**C7** - A site request with no, an unknown or an expired session answers 401 (AWS-04, AC 4)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "A site request without a valid session is refused"`

**C8** - A session is valid 1 ms before 7 days and invalid at exactly 7 days (AWS-04, AC 4)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/modules/identity/domain -t "expires at exactly 7 days"`

**C9** - A visitor with an unknown session sees "Sign in with a test account" and no "Signed in as" (AWS-04, AC 4)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "A visitor with an unknown session sees the site signed out"`

**C10** - A pairing code request answers 201 with 6 digits, an expiry 5 minutes later and a claim secret (AWS-05, AC 1)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "An agent receives a pairing code"`

**C11** - Submitting the code pairs the agent, the site shows "Agent paired" and the claim returns the token once (AWS-06, AC 2; AWS-07, AC 3)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "A player pairs an agent with the code it shows"`

**C12** - A claim before the code is used answers 202 with no token (AWS-07, AC 5)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "An agent waits until its code is typed"`

**C13** - A claim for a code that expired unused answers 410 with no token (AWS-07, AC 4)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "A claim for a code that expired unused is refused"`

**C14** - Two concurrent claims with one secret return the token exactly once (AWS-07, AC 3)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/modules/agents/adapters/postgres -t "two concurrent claims return the token once"`

**C15** - An unknown, expired or used code answers 400 and the site shows "This code is invalid or has expired." (AWS-08, AC 6)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "A pairing code that cannot be used is refused"`

**C16** - The 11th code submission of an account in 5 minutes answers 429 and the site shows "Too many attempts. Try again in a few minutes." (AWS-09, AC 7)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "Too many pairing attempts are refused for a while"`

**C17** - Submissions are allowed again once the oldest of the 10 is 5 minutes old (AWS-09, AC 7)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/modules/agents/domain -t "limits the 11th submission until the oldest is 5 minutes old"`

**C18** - The 11th pairing-code request from one IP address within an hour answers 429 (AWS-09, AC 8)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "Too many pairing codes from one address are refused"`

**C19** - A forged left-most `X-Forwarded-For` does not change the address the limit counts (AWS-09, AC 8)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/agents-routes.int.test.ts -t "ignores a forged left-most X-Forwarded-For"`

**C20** - Pairing a second agent makes the first agent's token answer 401 on every agent endpoint (AWS-10, AC 9)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "Pairing a new agent revokes the previous one"`

**C21** - The agent token opens only heartbeat, assignment, observation and stream, and the session cookie opens none of them (AWS-11, AC 10)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "The agent token and the session cookie each open only their own endpoints"`

**C22** - A missing, non-semantic or below-minimum `X-Agent-Version` answers 426 on every agent endpoint, and the minimum itself is processed (AWS-12, AC 11)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "An outdated agent is told to upgrade"`

**C23** - The version check runs before authentication (AWS-12, AC 11)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/platform/http -t "answers 426 before authentication"`

**C24** - A valid heartbeat answers 204 and issues no SQL statement (AWS-13, AC 1)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/agents-routes.int.test.ts -t "a heartbeat issues no SQL statement"`

**C25** - After a heartbeat with the game running the site shows "Agent online", "Game open" and "Screen: Unknown" within 2 seconds (AWS-13, AC 1; AWS-14, AC 2)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "A paired agent shows as online with the game open"`

**C26** - A presence change reaches the site within 2 seconds (AWS-14, AC 2)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "The site follows a presence change"`

**C27** - An agent is online at 44.999 s and offline at 45 s after its last heartbeat (AWS-15, AC 3)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/modules/agents/domain -t "marks the agent offline after 45 s"`

**C28** - A player without an agent sees "Pairing code" and "Pair agent" (AWS-16, AC 4)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "A player without an agent is offered pairing"`

**C29** - "Download the agent" links to `…/releases/latest/download/D2RMatchMaking-setup.exe` (AWS-17, AC 5)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "The download button points to the latest agent release"`

**C30** - A heartbeat body outside the contract answers 400 and keeps the previous presence (AWS-18, AC 6)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "A heartbeat that breaks the contract is refused"`

**C31** - Start test match → 202, room `mmbaalh-<n>` "Awaiting host" with "No password"; the host's agent receives the room; its matching observation shows "Created" within 2 seconds (AWS-19, AC 1; AWS-20, AC 2; AWS-21, AC 4; AWS-22, AC 5; AWS-23, AC 6)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "The host's agent sees the expected game name"`

**C32** - `fromMatch` creates stage `awaiting_host`, run 1, an empty password, the lowest join order as host and the two events (AWS-20, AC 2)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/modules/lobby-room/domain -t "fromMatch creates awaiting_host with run 1"`

**C33** - A second `MatchFormed` with the same `matchId` creates no second room (AWS-20, AC 3)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "The same match never makes two rooms"`

**C34** - The room's game name and stage survive a reload (AWS-21, AC 12)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "The room survives a page reload"`

**C35** - A newer test match replaces the room shown on the site (AWS-21, AC 13)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "A newer test match replaces the room on the site"`

**C36** - The assignment endpoint returns the room, run, expected game name and members (AWS-22, AC 5)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/lobby-routes.int.test.ts -t "assignment endpoint returns the room"`

**C37** - `MMBAALH-<n>` from the host moves the room to Created (AWS-23, AC 6)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "The game name matches whatever its letter case"`

**C38** - A non-host, another run or another name answers 202, is stored and leaves "Awaiting host" (AWS-24, AC 7)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "An observation that does not prove the game leaves the room waiting"`

**C39** - A second matching sighting after Created raises no second stage change (AWS-24, AC 8)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "A second sighting after Created changes nothing"`

**C40** - A repeated idempotency key answers 202 and changes nothing (AWS-24, AC 9)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "A repeated observation changes nothing"`

**C41** - An unknown observation type answers 202 and is neither stored nor acted on (AWS-25, AC 10)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "An observation of an unknown type is discarded"`

**C42** - An observation for a room the agent's account is not in answers 403 and stores nothing (AWS-25, AC 11)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "An agent outside the room cannot report on it"`

**C43** - An outbox row appended in a rolled-back transaction does not exist (AWS-26, AC 1)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/postgres -t "rolls back the outbox row with the transaction"`

**C44** - Rows committed before a restart are published by the new relay's sweep (AWS-26, AC 2)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform -t "publishes rows left unpublished before a restart"`

**C45** - A row whose handler fails 5 times is dead-lettered and the next rows are still published (AWS-26, AC 2)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform -t "dead-letters after 5 failures and keeps going"`

**C46** - A site stream receives only its account's events (AWS-27, AC 3)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "Each player's stream carries only that player's events"`

**C47** - An agent stream receives only its agent's events (AWS-27, AC 3)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "Each agent's stream carries only that agent's events"`

**C48** - A stream without a session answers 401 (AWS-27, AC 3)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "A stream without a session is refused"`

**C49** - A stream reopened with `Last-Event-ID` first receives the missed events in order (AWS-28, AC 5)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "A reconnecting stream receives the events it missed"`

**C50** - The site reaches the API only through `/api/*` on its own origin, cookies and streams included (AWS-29, AC 7)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "The site talks to the API only through its own origin"`

**C51** - The Function answers 404 to `/__test`, `..`, `//`, `%2f` and `%5c` paths (AWS-29, AC 7)
Proof: `pnpm --filter @d2rmm/web exec vitest run functions -t "rejects hostile paths"`

**C52** - The Function drops `Authorization` and `X-Agent-Version` from the browser (AWS-29, AC 7)
Proof: `pnpm --filter @d2rmm/web exec vitest run functions -t "drops Authorization and X-Agent-Version"`

**C53** - `GET /healthz` answers 200 `{"status":"ok"}` (AWS-30, AC 1)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "The API answers its health check"`

**C54** - `/healthz` answers 200 with the database stopped (AWS-30, AC 1)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/app.int.test.ts -t "healthz answers with the database down"`

**C55** - ESLint reports `n/no-process-env` for a `process.env` read in a module file (AWS-31, AC 2)
Proof: `pnpm --filter @d2rmm/config exec vitest run test/rules.test.ts -t "n/no-process-env reports a process.env read in a module file"`

**C56** - `render.ts` refuses to start with staging endpoints on outside staging (AWS-31, AC 2)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/roots.int.test.ts -t "render refuses staging endpoints outside staging"`

**C57** - The second migration run applies nothing and exits 0 (AWS-32, AC 3)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/migrate.int.test.ts -t "second run applies none"`

**C58** - The API runs with in-memory stores and depends on no Redis, broker or queue client (AWS-33, AC 4)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/app.int.test.ts -t "runs with no external broker"`

**C59** - `deploy-api.yml` migrates before calling the deploy hook and fails unless `/healthz` answers within 5 minutes (AWS-34, AC 5)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="deploy-api runs migrations before the deploy hook" scripts/test/deploy-workflows.test.mjs`

**C60** - `deploy-web.yml` deploys `main` and publishes previews only for same-repository pull requests (AWS-34, AC 6)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="deploy-web publishes previews only for same-repo PRs" scripts/test/deploy-workflows.test.mjs`

**C61** - The first runs of both deploy workflows after the maintainer's merge succeed, with a preview URL on the PR (AWS-34, AC 5, 6)
Proof: walk - the maintainer merges `phase/F0` after the phase review; the Actions page shows `deploy-api` and `deploy-web` green and the PR shows the preview comment (queued in `.specs/phases/F0/review.md`)

**C62** - Recording an observation runs inside span `lobby.record-observation` (AWS-35, AC 7)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/lobby-routes.int.test.ts -t "record-observation runs in its span"`

**C63** - `withSpan` opens a span with the use-case name and ends it on every path (AWS-35, AC 7)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/shared-kernel -t "opens a span with the use-case name"`

**C64** - `openapi.json` lists every route with its schemas (AWS-36, AC 1)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/openapi.int.test.ts -t "openapi.json lists every route"`

**C65** - The AsyncAPI document and one JSON Schema per agent-facing message are generated (AWS-36, AC 2, 3)
Proof: `pnpm --filter @d2rmm/contracts exec vitest run src -t "writes one JSON Schema per agent message"`

**C66** - `pnpm contracts:check` reports no drift (AWS-36, AC 3)
Proof: `pnpm contracts:check`

**C67** - The site renders in pt-BR for `pt-*` browsers and in English otherwise (AWS-37, AC 2)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "The site follows the browser's language"`

**C68** - `en` and `pt-BR` hold the same keys (AWS-37, AC 1)
Proof: `pnpm --filter @d2rmm/web exec vitest run src -t "en and pt-BR hold the same keys"`

**C69** - ESLint reports a literal user-facing string in a component (AWS-37, AC 1)
Proof: `pnpm --filter @d2rmm/config exec vitest run test/rules.test.ts -t "reports a literal string in a component"`

**C70** - Every page shows "D2R Match Making is a community project and is not affiliated with Blizzard Entertainment." (AWS-38, AC 3)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "The site says it is not affiliated with Blizzard"`

**C71** - Stream ids compare by outbox id, then by transient counter (AWS-39, AC 4)
Proof: `pnpm --filter @d2rmm/api exec vitest run src/platform -t "ids increase with outbox order"`

**C72** - Ids on an open stream increase (AWS-39, AC 4)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform -t "event ids increase"`

**C73** - An open stream receives `: ka` every 25 seconds (AWS-40, AC 6)
Proof: `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform -t "sends a keep-alive comment every 25 seconds"`

---

## Handoff

The feature's live state, written as it happens - a compaction gives no warning.

**Settled mid-build:** none
**Dispatched:** execute-batch-3 (T12, T14, T15, T17–T20, T22) → pending; execute-batch-2 (T6–T13) → returned, stopped at T9 (T6 b8845d1, T7 e1185e7, T8 4286251); execute-batch-1 (T1–T5) at e6e13d6 → returned (T1 6d5306e, T2 4b5c0c9, T3 6ad6335, T4 0139cd7, T5 34eabbd; all gates green, T3 on retry 1); execute-batch-2 (T6–T13) at 34eabbd + this note → pending

**execute-batch-1 notes (2026-10-30)** — accepted by the orchestrator: T3 replaced the placeholder AsyncAPI "no channels" unit assertion with the stream-channel assertion T3 requires (a requirement change, not a weakened test); T3 added `packages/contracts/json-schema/` to `.prettierignore` and to the turbo `contracts:openapi` outputs, like the other generated contract files; `claim.json` holds `ClaimResponse`; `room.stage_changed` members use the `Member` schema; `@d2rmm/contracts` exports its TypeScript source, which Node 26 loads through the workspace symlink (verified by the orchestrator, no build step needed). HF-04's AsyncAPI line is false until T37 (AD-044), as planned.
**execute-batch-2 notes (2026-10-30, feature-worker)**: done and committed T6 b8845d1, T7 e1185e7, T8 4286251; all three gates green on the first attempt. T7 changed `FakeClock` (adds `onMove`, so `FakeScheduler` moves with `clock.advance`) and put `RandomSource` in `random-source.ts`; T8 pins `@opentelemetry/api` to `~1.9.1` because `@opentelemetry/sdk-trace-base` 2.12 rejects 1.10 as a peer.
**BLOCKED at T9 (environment, not code)**: `docker pull postgres:17-alpine` hangs for about 21 minutes in `docker-credential-desktop get` (the Docker credential helper), so Testcontainers cannot start Postgres and the T9 full gate cannot run. The T9 code is written but uncommitted and unverified: `apps/api/vitest.config.ts`, `apps/api/vitest.integration.config.ts`, `apps/api/src/test-support/postgres.ts` and `postgres.int.test.ts`, the `test:integration` script, and the Kysely, pg, @types/pg and @testcontainers/postgresql dependencies. A T9 run that hung was killed by the feature-worker (exit 144); the ledger shows no T9 failure. The gate hook denies direct `pnpm arch` and direct test runs outside `attempt.mjs`, so the typecheck and the arch sensor have not run on the T9 code.
**Open question for the orchestrator (T9 vs. the arch sensor)**: `src/test-support/postgres.ts` imports the devDependency `@testcontainers/postgresql` from `src/`. `.dependency-cruiser.cjs` rule `no-dev-deps-in-runtime` flags `npm-dev` imports from `^apps/api/src` unless the path matches TESTS, and `test-support/` does not match it. Not yet confirmed by a run. Resolution needs the maintainer or the orchestrator (the file path is fixed by T9), not a sensor change by the worker.
**T10–T13**: not started (strictly in order after T9).
**Orchestrator replan (2026-10-30)**: T9's helper moves to `apps/api/test/support/` (covered by the depcruise TESTS pattern and `testing.md`; no sensor change); T10's `migrate.ts` reads `DATABASE_URL` itself inside `main/`; T13 keeps retry times in memory and adds the production `TimerScheduler`. Tasks gate re-run. T9 waits for the maintainer to fix Docker Desktop's credential helper (escalation).
**Reordered (2026-10-30)**: the maintainer chose "C" (advance what does not need Docker). The Docker-dependent tasks (T9–T11, T13, T16, T21, T26, T30–T37, T47–T50) move to Phases 9–12; task numbers unchanged; tasks gate re-run. The unverified T9 files are set aside in stash `d2rmm-api-web-skeleton-T9-wip-2026-10-30` (f7661745) and restored with `git stash apply f7661745` when T9 runs (the helper then moves to `apps/api/test/support/`).
**Walked:** none
