# Site Stale Read Fix Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, the walk, check_proofs, the Verifier and the screens sub-agent).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

Rules of this feature:

- Only `apps/web/src/app/App.tsx`, `apps/web/src/app/App.test.tsx` and `tests/acceptance/steps/lobby-room.steps.ts` change, plus the marks in this file. No API, contract, stream, scenario, Playwright config or sensor change.
- **The first proof decides.** In T1, write the unit tests before the fix and run them. If `ignores a read that answers after a stream event` does not fail on today's code, stop and return to the orchestrator: the cause in `spec.md` is inferred, and a fix for a cause that does not reproduce would leave the failure in place.
- No test, scenario or sensor is weakened, skipped or focused. `acceptance.feature` does not change during Execute. No `retries` and no longer timeout.
- Every gate runs through `node scripts/attempt.mjs run --feature site-stale-read-fix --step T<n> -- "<gate>"`, with nothing outside the quotes.

---

**Design**: none - Small feature; the design is in T1 and T2
**Status**: Approved
**Approved**: 2026-11-05 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)
**Mutations**: 3
**Build**: `pnpm build; pnpm typecheck; pnpm lint; pnpm arch`

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `AGENTS.md` (How to test, rules 3, 4 and 12), `docs/engineering/testing.md`.

| Code Layer                   | Required Test Type          | Coverage Expectation                                                                     | Location Pattern                             | Run Command                                                     |
| ---------------------------- | --------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------- |
| Site composition (`App.tsx`) | unit (Vitest)               | Every SSR criterion and edge case of `spec.md`, through a held fetch and the fake stream | `apps/web/src/app/App.test.tsx`              | `pnpm --filter @d2rmm/web exec vitest run src/app/App.test.tsx` |
| Acceptance steps             | acceptance (playwright-bdd) | The scenarios as written, black-box, through the browser's network and the screen        | `tests/acceptance/steps/lobby-room.steps.ts` | `pnpm exec turbo run test:acceptance -- --grep @SSR-`           |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use          | Command                                                         |
| ---------- | -------------------- | --------------------------------------------------------------- |
| Quick      | After the site's fix | `pnpm --filter @d2rmm/web exec vitest run src/app/App.test.tsx` |
| Full       | The last task        | `pnpm exec turbo run test:acceptance -- --grep @SSR-`           |
| Build      | After the last task  | `pnpm build; pnpm typecheck; pnpm lint; pnpm arch`              |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: The site's fix

```
T1
```

### Phase 2: The scenarios

```
T2
```

---

## Task Breakdown

### T1: Ignore a read that a stream event overtook

**What**: `refreshSite` counts stream events and, when one arrived while its read was in flight, ignores the whole answer and reads again; `App.test.tsx` holds the answers to prove it.
**Where**: `apps/web/src/app/App.tsx`
**Depends on**: None
**Reuses**: `routeFetch`, `jsonResponse` and `fakeStream` from `apps/web/src/test/fake-api.ts` and the tests of `App.test.tsx`; `Fetcher` from `apps/web/src/shared/api-client.ts`
**Requirement**: SSR-01, SSR-02, SSR-03, SSR-04, SSR-05

How:

- `onEvent` adds one to a `useRef` counter before it calls `setBoot`.
- `refreshSite` loops: it keeps the counter, awaits `client.myAgent()` and `client.myRoom()`, and only when the counter did not move does it call `setBoot`, with the rules it has today, and return. When the counter moved, it reads again. The API client returns a failure as a result and does not throw, so a failed read takes the same path.
- `routeFetch` answers synchronously, so a test that holds an answer passes its own `Fetcher` to `createApiClient`, resolving a promise per `GET /api/v1/me/room` in call order.

**Done when**:

- [x] The tests below were written first, and `ignores a read that answers after a stream event` failed on today's code
- [x] `ignores a read that answers after a stream event`: with the read held, a `room.stage_changed` to `created` arrives, the held answer says `awaiting_host`, and while the new read is still held the screen shows "Created" and not "Awaiting host"
- [x] `reads again after ignoring a read`: one more `GET /api/v1/me/room` follows, and its answer shows
- [x] `reads again when a read fails after a stream event`: the held read answers 500, and a new read still follows
- [x] `ignores a test match read that answers after a stream event`: the same order, with the read started by "Start test match"
- [x] `a presence event during a read also makes the site read again`: an `agent.presence_changed` is enough
- [x] `a repeated event during a read costs one more read`: two events during one read cause one new read, and the screen does not change
- [x] `shows the answer of a read with no stream event during it and reads once`: the answer shows, and no further `GET /api/v1/me/room` follows
- [x] `clears the room when a read answers no room and no stream event arrived`: a 404 clears the room on screen
- [x] `keeps the stage from the stream when the new read fails`: the new read answers 500, and "Created" stays on screen
- [x] Gate check passes: `pnpm --filter @d2rmm/web exec vitest run src/app/App.test.tsx`
- [x] Test count: every test that was in `App.test.tsx` still passes, plus these 9

**Tests**: unit
**Gate**: `pnpm --filter @d2rmm/web exec vitest run src/app/App.test.tsx`
**Commit**: `fix(web): ignore a read that a stream event overtook`

---

### T2: Hold the browser's answer in the scenarios

**What**: Step definitions for the `@SSR-*` scenarios that hold and release the browser's `GET /api/v1/me/room` with `page.route`.
**Where**: `tests/acceptance/steps/lobby-room.steps.ts`
**Depends on**: T1
**Reuses**: the existing steps of that file, `world.currentVisitor.page`, and the room panel's `Game name` term
**Requirement**: SSR-01, SSR-02, SSR-03, SSR-04, SSR-05

How. Steps stay black-box: they import nothing from `apps/*`. A reload makes two reads of the room: one while the site loads, and one when its stream opens.

- `the site is waiting for a slow answer that says the room is awaiting the host`: route the reads, let the loading read through, reload, and on the stream-open read call `route.fetch()`, assert the body's `stage` is `awaiting_host`, and hold it. Wait until it is held.
- `the site's read before its stream opens has a slow answer that says the room is awaiting the host`: the same, holding the loading read. Do not wait for the page's stream, which opens only after the release.
- `the slow answer about the room arrives`: fulfil the held route with the held response.
- `the read after the slow answer will fail with a server error`: the next read through the route is fulfilled with status 500.
- `the site reads the room again`: wait for one more request to `GET /api/v1/me/room` after the release, and for its response.
- `the site read the room exactly once after its stream opened`: the route's count of reads after the loading read is 1.
- `the read on the next stream open will answer that there is no room`: route the reads, let the loading read through, and fulfil the stream-open read with status 404.
- `the site shows no room`: the room's `Game name` term is not visible.
- Unroute in every path that ends the scenario's interest, so a later read reaches the API.

**Done when**:

- [ ] Every step above exists, and `bddgen` reports no missing step
- [ ] `the site is waiting…` and `the site's read before…` fail the scenario if the held body's `stage` is not `awaiting_host`
- [ ] No scenario, tag or timeout changed
- [ ] Gate check passes: `pnpm exec turbo run test:acceptance -- --grep @SSR-`
- [ ] Test count: the 4 `@SSR-*` scenarios pass

**Tests**: acceptance
**Gate**: `pnpm exec turbo run test:acceptance -- --grep @SSR-`
**Commit**: `test(acceptance): hold the site's read in the stale read scenarios`

---

## Checks

**C1** - An answer that says `awaiting_host` after a `created` event leaves "Created" on screen while the new read is held (SSR-01, AC 1)
Proof: `pnpm --filter @d2rmm/web exec vitest run src/app/App.test.tsx -t "ignores a read that answers after a stream event"`

**C2** - A read started by "Start test match" is ignored the same way (SSR-01, AC 1)
Proof: `pnpm --filter @d2rmm/web exec vitest run src/app/App.test.tsx -t "ignores a test match read that answers after a stream event"`

**C3** - A presence event also makes a read stale (SSR-01, AC 1; AD-133)
Proof: `pnpm --filter @d2rmm/web exec vitest run src/app/App.test.tsx -t "a presence event during a read also makes the site read again"`

**C4** - In the browser, a failed new read after a late `awaiting_host` answer leaves "Created" on screen (SSR-01, AC 1; SSR-04, AC 4)
Proof: `pnpm exec turbo run test:acceptance -- --grep @SSR-04`

**C5** - One more read follows an ignored read, and its answer shows (SSR-02, AC 2)
Proof: `pnpm --filter @d2rmm/web exec vitest run src/app/App.test.tsx -t "reads again after ignoring a read"`

**C6** - A stale read that fails also gets a new read (SSR-02, AC 2)
Proof: `pnpm --filter @d2rmm/web exec vitest run src/app/App.test.tsx -t "reads again when a read fails after a stream event"`

**C7** - Two events during one read cause one new read, and the screen does not change (SSR-02, AC 2; ADR 008)
Proof: `pnpm --filter @d2rmm/web exec vitest run src/app/App.test.tsx -t "a repeated event during a read costs one more read"`

**C8** - In the browser, the site reads the room again after the late answer (SSR-01, AC 1; SSR-02, AC 2)
Proof: `pnpm exec turbo run test:acceptance -- --grep @SSR-02`

**C9** - A read with no event during it shows its answer, with no further read (SSR-03, AC 3)
Proof: `pnpm --filter @d2rmm/web exec vitest run src/app/App.test.tsx -t "shows the answer of a read with no stream event during it and reads once"`

**C10** - In the browser, the stream-open read shows "Created" and is the only read after the stream opens (SSR-03, AC 3)
Proof: `pnpm exec turbo run test:acceptance -- --grep @SSR-03`

**C11** - The new read answers 500, and "Created" stays on screen (SSR-04, AC 4; AD-134)
Proof: `pnpm --filter @d2rmm/web exec vitest run src/app/App.test.tsx -t "keeps the stage from the stream when the new read fails"`

**C12** - A 404 with no event during the read clears the room (SSR-05, AC 5)
Proof: `pnpm --filter @d2rmm/web exec vitest run src/app/App.test.tsx -t "clears the room when a read answers no room and no stream event arrived"`

**C13** - In the browser, a stream-open read that answers 404 clears the room (SSR-05, AC 5)
Proof: `pnpm exec turbo run test:acceptance -- --grep @SSR-05`

---

## Handoff

The feature's live state, written as it happens - a compaction gives no warning.

**Settled mid-build:** none
**Dispatched:** `execute-batch-1` (T1, T2) to `feature-worker`
**Walked:** none - the scenarios drive the site in a browser

---

## Phase Execution Map

```
Phase 1 → Phase 2

Phase 1:  T1
Phase 2:  T2
```

Execution is strictly sequential. Under ADR 025, `feature-worker` runs the tasks in `execute-batch-1`.
